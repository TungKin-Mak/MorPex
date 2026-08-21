/**
 * 仪表盘视图：health / status / execution-stats / governance / ontology 5 张卡片。
 * 5s 轮询；视图卸载（路由切换）时 clearInterval。
 * 任一请求失败只在该卡片内显示错误，不影响其它卡片、不白屏。
 */
import type { ApiClient } from '../api/client.js';
import { el } from '../ui/dom.js';
import { badge, card, errorBox, jsonPre, kvRow, spinner } from '../ui/widgets.js';

function fmtUptime(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h}h ${m}m ${ss}s`;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 把异步加载结果渲染进卡片 body：先 spinner，失败显示 errorBox；视图卸载后丢弃在途结果。 */
async function loadInto(
  body: HTMLElement,
  loader: () => Promise<HTMLElement>,
  isDisposed: () => boolean,
): Promise<void> {
  body.replaceChildren(spinner());
  try {
    const node = await loader();
    if (isDisposed()) return; // 视图已卸载：丢弃在途结果，避免写入分离 DOM
    body.replaceChildren(node);
  } catch (err) {
    if (isDisposed()) return;
    body.replaceChildren(errorBox(`请求失败：${errMsg(err)}`));
  }
}

export function renderDashboard(root: HTMLElement, api: ApiClient): () => void {
  const grid = el('div', { class: 'grid' });
  let disposed = false;

  // ── 卡片 1：health ──
  const healthBody = el('div');
  grid.appendChild(card('健康 Health', healthBody));
  async function loadHealth(): Promise<HTMLElement> {
    const h = await api.getHealth();
    return el('div', null, [
      kvRow('runtime', h.runtime),
      kvRow('uptime', fmtUptime(h.uptime)),
      kvRow('bootedAt', h.bootedAt),
      kvRow('状态', badge(h.ok ? 'ok' : 'down', !!h.ok)),
    ]);
  }

  // ── 卡片 2：status ──
  const statusBody = el('div');
  grid.appendChild(card('状态 Status', statusBody));
  async function loadStatus(): Promise<HTMLElement> {
    const s = await api.getStatus();
    return el('div', null, [
      kvRow('phase', s.phase),
      kvRow('departments', String(s.departments)),
      kvRow('artifacts', String(s.artifacts)),
      kvRow('controlPlane.goal', badge(s.controlPlane.goal ? 'on' : 'off', !!s.controlPlane.goal)),
      kvRow('controlPlane.policies', String(s.controlPlane.policies)),
    ]);
  }

  // ── 卡片 3：execution-stats ──
  const statsBody = el('div');
  grid.appendChild(card('执行统计 Execution Stats', statsBody));
  async function loadStats(): Promise<HTMLElement> {
    const r = await api.getExecutionStats();
    const st = r.stats;
    return el('div', null, [
      kvRow('总成功率', `${(st.execution.totalSuccessRate * 100).toFixed(1)}%`),
      kvRow('步骤空参率', `${(st.steps.emptyParamRate * 100).toFixed(1)}%`),
      kvRow('装配平均耗时', `${st.assembly.avgDurationMs} ms`),
      kvRow('装配次数', String(st.assembly.count)),
      kvRow('成本 tokens', String(st.cost.totalTokens)),
      kvRow('成本金额', `¥${st.cost.totalCost}`),
    ]);
  }

  // ── 卡片 4：governance ──
  const govBody = el('div');
  grid.appendChild(card('治理 Governance', govBody));
  async function loadGovernance(): Promise<HTMLElement> {
    const g = await api.getGovernance();
    return el('div', null, [
      kvRow('ok', badge(String(g.ok), !!g.ok)),
      kvRow('health', g.health != null ? jsonPre(g.health, true) : 'null'),
      kvRow('cost', g.cost != null ? jsonPre(g.cost, true) : 'null'),
      kvRow('delivery', g.delivery != null ? jsonPre(g.delivery, true) : 'null'),
    ]);
  }

  // ── 卡片 5：ontology ──
  const ontoBody = el('div');
  grid.appendChild(card('本体 Ontology', ontoBody));
  async function loadOntology(): Promise<HTMLElement> {
    const o = await api.getOntologyStats();
    return el('div', null, [
      kvRow('guard', badge(o.guard ? 'enabled' : 'disabled', !!o.guard)),
      kvRow('service', badge(o.service ? 'ready' : 'down', !!o.service)),
    ]);
  }

  // ── 轮询 ──
  let timer: number | undefined;

  async function refresh(): Promise<void> {
    void loadInto(healthBody, loadHealth, () => disposed);
    void loadInto(statusBody, loadStatus, () => disposed);
    void loadInto(statsBody, loadStats, () => disposed);
    void loadInto(govBody, loadGovernance, () => disposed);
    void loadInto(ontoBody, loadOntology, () => disposed);
  }

  root.replaceChildren(el('div', { class: 'view dashboard-view' }, grid));
  void refresh();
  timer = window.setInterval(() => void refresh(), 5000);

  return () => {
    disposed = true;
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
  };
}
