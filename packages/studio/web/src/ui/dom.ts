/**
 * DOM 构造工具：el / mount / clear。
 * attrs 约定：
 *   - 'class'  → className
 *   - 'style' / 'data-*' / 其它 attribute 名 → setAttribute
 *   - 以 on 开头且值为函数 → addEventListener（如 onclick、oninput）
 *   - 元素自身存在的属性（value、checked、disabled…）→ 属性赋值
 */
export type Child = Node | string;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, unknown> | null,
  children?: Child | Child[] | null,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null) continue;
      if (key === 'class') {
        node.className = String(value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        const eventName = key.slice(2).toLowerCase();
        node.addEventListener(eventName, value as EventListener);
      } else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected') {
        (node as unknown as Record<string, unknown>)[key] = value;
      } else {
        node.setAttribute(key, String(value));
      }
    }
  }

  if (children !== undefined && children !== null) {
    const list: Child[] = Array.isArray(children) ? children : [children];
    for (const child of list) {
      if (child === undefined || child === null) continue;
      if (typeof child === 'string') {
        node.appendChild(document.createTextNode(child));
      } else {
        node.appendChild(child);
      }
    }
  }
  return node;
}

export function mount(root: HTMLElement, node: Node): void {
  root.replaceChildren(node);
}

export function clear(root: HTMLElement): void {
  root.replaceChildren();
}
