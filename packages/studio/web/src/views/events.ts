/**
 * 事件流视图：SSE 消费 /api/stream/global，实时滚动展示 + filter 前缀过滤。
 * 断开时浏览器原生 EventSource 自动重连（重连成功时状态徽章复位）；
 * 视图卸载（路由切换）时 close 连接。
 * ⚠️ 后端心跳 `:heartbeat` 注释帧被浏览器原生忽略，sse.ts 的 try/catch 兜底的是非 JSON data 帧。
 */
import type { ApiClient } from '../api/client.js';
import { openEventStream, type EventStreamHandle, type StreamEvent } from '../api/sse.js';
import { el } from '../ui/dom.js';
import { badge, button, card } from '../ui/widgets.js';

export function renderEvents(root: HTMLElement, _api: ApiClient): () => void {
  const filterInput = el('input', {
    type: 'text',
    class: 'grow',
    placeholder: '事件类型前缀过滤，如 execution / memory；留空=全部',
    onkeydown: (e: Event) => {
      if (e instanceof KeyboardEvent && e.key === 'Enter') connect();
    },
  });
  const statusEl = el('div', { class: 'row' });
  const countEl = el('span', { class: 'muted' });
  const logEl = el('div', { class: 'event-log' });

  let handle: EventStreamHandle | undefined;
  let count = 0;

  function updateStatus(text: string, ok: boolean): void {
    statusEl.replaceChildren(badge(text, ok));
  }

  function setCount(): void {
    countEl.textContent = `共 ${count} 条`;
  }

  function appendEvent(evt: StreamEvent): void {
    count += 1;
    setCount();
    const t =
      typeof evt.timestamp === 'number'
        ? new Date(evt.timestamp).toLocaleTimeString()
        : new Date().toLocaleTimeString();
    logEl.appendChild(
      el('div', { class: 'event-item' }, [
        el('span', { class: 'evt-time' }, t),
        el('span', { class: 'evt-type' }, evt.type),
        el('span', null, JSON.stringify(evt)),
      ]),
    );
    logEl.scrollTop = logEl.scrollHeight;
  }

  function connect(): void {
    handle?.close();
    logEl.replaceChildren();
    count = 0;
    setCount();
    const filter = filterInput.value.trim() || undefined;
    updateStatus('连接中…', true);
    handle = openEventStream(
      filter,
      appendEvent,
      () => updateStatus('连接异常（自动重连中）', false),
      () => updateStatus('已连接', true),
    );
  }

  function stop(): void {
    handle?.close();
    handle = undefined;
    updateStatus('已停止', false);
  }

  root.replaceChildren(
    el('div', { class: 'view events-view' }, [
      card('实时事件流 SSE', el('div', null, [
        el('div', { class: 'row' }, [
          el('span', { class: 'label' }, 'filter'),
          filterInput,
          button('连接', connect),
          button('停止', stop, 'secondary'),
          button('清空', () => {
            logEl.replaceChildren();
            count = 0;
            setCount();
          }, 'danger'),
        ]),
        el('div', { class: 'row' }, [statusEl, countEl]),
        logEl,
      ])),
    ]),
  );

  connect();

  return () => {
    handle?.close();
    handle = undefined;
  };
}
