/**
 * 渲染层入口：装配 ApiClient + hash 路由 + 顶部 tab 高亮 + 挂载 4 视图。
 * 视图与后端完全解耦——只经 src/api/client.ts 的 HTTP/SSE 消费 StudioServer。
 */
import './styles.css';
import 'highlight.js/styles/github-dark.css';
import { api } from './api/client.js';
import { createRouter } from './ui/router.js';
import { renderArtifacts } from './views/artifacts.js';
import { renderConsole } from './views/console.js';
import { renderDashboard } from './views/dashboard.js';
import { renderDepartmentXJMcu } from './views/department-xjmcu.js';
import { renderEvents } from './views/events.js';

/** 高亮顶部导航中与当前路由匹配的 tab。 */
function activateTab(route: string): void {
  const nav = document.getElementById('nav-tabs');
  if (!nav) return;
  for (const a of nav.querySelectorAll<HTMLAnchorElement>('a[data-route]')) {
    a.classList.toggle('active', a.dataset.route === route);
  }
}

function main(): void {
  const router = createRouter(
    {
      dashboard: renderDashboard,
      console: renderConsole,
      events: renderEvents,
      artifacts: renderArtifacts,
      xjmcu: renderDepartmentXJMcu,
    },
    api,
    activateTab,
  );
  router.start();
}

main();
