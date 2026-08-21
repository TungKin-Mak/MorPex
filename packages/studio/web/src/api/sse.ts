/**
 * SSE 事件流封装：浏览器原生 EventSource 消费 /api/stream/global。
 * - 原生自动重连；`:heartbeat` 注释帧被浏览器原生忽略，
 *   try/catch 兜底的是非 JSON 的 data 帧。
 * - 提供 close() 手动关闭（视图切换/停止按钮时调用）。
 */
import { API_BASE } from '../env.js';

/** 事件流消息：type 必有（后端 EventBus 事件均有 type），其余字段未知。 */
export interface StreamEvent {
  type: string;
  timestamp?: number;
  [k: string]: unknown;
}

export interface EventStreamHandle {
  close: () => void;
}

export function openEventStream(
  filter: string | undefined,
  onEvent: (evt: StreamEvent) => void,
  onError?: (err: Event) => void,
  onOpen?: () => void,
): EventStreamHandle {
  const query = filter && filter.trim() ? `?filter=${encodeURIComponent(filter.trim())}` : '';
  const url = `${API_BASE}/api/stream/global${query}`;
  const source = new EventSource(url);

  source.onopen = () => {
    console.debug(`[sse] 已连接 ${url}`);
    onOpen?.();
  };

  source.onmessage = (e: MessageEvent<string>) => {
    try {
      const data = JSON.parse(e.data) as StreamEvent;
      onEvent(data);
    } catch (err) {
      console.warn('[sse] 解析事件失败:', e.data, err);
    }
  };

  source.onerror = (err) => {
    console.debug('[sse] 连接异常（浏览器将自动重连）:', err);
    onError?.(err);
  };

  return {
    close: () => {
      source.close();
      console.debug('[sse] 已关闭事件流');
    },
  };
}
