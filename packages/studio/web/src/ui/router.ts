/**
 * hash 路由：routes 表 { hash → 渲染函数 }，默认 #/console（会话对话为首页）。
 * 每个视图渲染后回调：返回 cleanup 函数则下次切换时调用
 * （用于停止轮询 / 关闭 SSE）。
 */
import type { ApiClient } from '../api/client.js';

export type ViewRenderer = (root: HTMLElement, api: ApiClient) => void | (() => void);

export interface Router {
  start: () => void;
  getCurrent: () => string;
}

const DEFAULT_ROUTE = 'console';

export function createRouter(
  routes: Record<string, ViewRenderer>,
  api: ApiClient,
  onRouteChange?: (route: string) => void,
): Router {
  let cleanup: (() => void) | undefined;

  function currentRoute(): string {
    const hash = window.location.hash.replace(/^#\/?/, '').trim();
    return hash || DEFAULT_ROUTE;
  }

  function render(): void {
    const root = document.getElementById('app');
    if (!root) return;

    // 先卸载上一个视图的副作用（轮询/SSE）
    if (cleanup) {
      try {
        cleanup();
      } catch (err) {
        console.warn('[router] 视图 cleanup 异常:', err);
      }
      cleanup = undefined;
    }

    const route = currentRoute();
    const renderer = routes[route] ?? routes[DEFAULT_ROUTE];
    const result = renderer(root, api);
    if (typeof result === 'function') cleanup = result;
    onRouteChange?.(routes[route] ? route : DEFAULT_ROUTE);
    // 会话 17h：把当前路由写到 body[data-route]，CSS 据此对 console 视图做全视口布局
    document.body.dataset.route = routes[route] ? route : DEFAULT_ROUTE;
  }

  window.addEventListener('hashchange', render);

  return {
    start: render,
    getCurrent: currentRoute,
  };
}
