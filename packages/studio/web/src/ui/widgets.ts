/**
 * 基础 UI 组件：卡片 / 徽章 / 键值行 / 错误框 / 表格 / 按钮 / 加载中。
 */
import { el } from './dom.js';
import type { Child } from './dom.js';

export function card(title: string, body: Child, extra?: Child): HTMLElement {
  const titleEl = el('div', { class: 'card-title' }, [
    el('span', null, title),
    ...(extra ? [el('span', { class: 'card-extra' }, extra)] : []),
  ]);
  return el('div', { class: 'card' }, [titleEl, el('div', { class: 'card-body' }, body)]);
}

export function badge(text: string, ok: boolean): HTMLElement {
  return el('span', { class: `badge ${ok ? 'badge-ok' : 'badge-bad'}` }, text);
}

export function kvRow(label: string, value: Child): HTMLElement {
  return el('div', { class: 'kv-row' }, [
    el('span', { class: 'kv-label' }, label),
    el('span', { class: 'kv-value' }, value),
  ]);
}

export function errorBox(msg: string): HTMLElement {
  return el('div', { class: 'error-box' }, msg);
}

export function table(headers: string[], rows: Child[][]): HTMLElement {
  const head = el('thead', null, el('tr', null, headers.map((h) => el('th', null, h))));
  const body = el(
    'tbody',
    null,
    rows.map((row) => el('tr', null, row.map((cell) => el('td', null, cell)))),
  );
  return el('table', { class: 'data-table' }, [head, body]);
}

export function button(text: string, onClick: () => void, extraClass = ''): HTMLButtonElement {
  return el('button', { class: `btn ${extraClass}`.trim(), onclick: onClick }, text);
}

export function spinner(text = '加载中…'): HTMLElement {
  return el('div', { class: 'spinner' }, text);
}

export function jsonPre(value: unknown, small = false): HTMLElement {
  return el('pre', { class: `json${small ? ' small' : ''}` }, JSON.stringify(value, null, 2));
}
