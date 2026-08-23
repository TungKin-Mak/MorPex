/**
 * 矽杰微开发部视图（四件套之"部门" UI 入口）
 *
 * 展示：部门 Space 信息（来自 /api/spaces 的 dept_xjmcu）+ 本部门任务列表与进度。
 * 数据源：api.getSpaces() + api.getTasks()——零新增后端端点。
 * 手册执行进度（backjumps/skipped/当前步骤）随 task.progress metadata 事件透出，
 * 由 TaskStateProjector 落 data/tasks/<missionId>.json，本视图经 getTasks 消费。
 */
import type { ApiClient } from '../api/client.js';
import { el } from '../ui/dom.js';
import { badge, card, errorBox, kvRow, spinner } from '../ui/widgets.js';

const DEPT_SPACE_ID = 'dept_xjmcu';
const DEPT_NAME = '矽杰微开发部';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN');
}

export function renderDepartmentXJMcu(root: HTMLElement, api: ApiClient): () => void {
  const grid = el('div', { class: 'grid' });
  let disposed = false;

  // ── 卡片 1：部门信息（Space 树中的矽杰微开发部）──
  const deptBody = el('div');
  grid.appendChild(card(`部门空间 ${DEPT_NAME}`, deptBody));
  async function loadDept(): Promise<HTMLElement> {
    const r = await api.getSpaces();
    const dept = r.tree?.departments.find((d) => d.id === DEPT_SPACE_ID || d.workflowId === 'xjmcu');
    if (!dept) return errorBox('未找到矽杰微开发部（xjmcu 工作流未安装或 Space 未扫描）');
    return el('div', null, [
      kvRow('Space', `${dept.name} (${dept.id})`),
      kvRow('工作流', String(dept.workflowId ?? '-')),
      kvRow('职责', String(dept.routeHint ?? dept.managerPersona ?? '-').slice(0, 120)),
      kvRow('能力', (dept.capabilities ?? []).join('、') || '-'),
      kvRow('状态', badge('已接入', true)),
    ]);
  }

  // ── 卡片 2：本部门任务（手册 7 步执行进度）──
  const tasksBody = el('div');
  grid.appendChild(card('任务进度（手册步骤）', tasksBody));
  async function loadTasks(): Promise<HTMLElement> {
    const r = await api.getTasks();
    const all = r.tasks ?? [];
    if (all.length === 0) return el('div', null, [el('p', null, ['暂无任务——在部门中下达 MCU 开发需求即开始'])]);
    const rows = all.slice(0, 20).map((t) =>
      el('div', { class: 'kv-row' }, [
        el('strong', null, [t.goal.slice(0, 60)]),
        ` · ${t.progress} · ${fmtTime(t.updatedAt)} `,
        badge(t.status, t.status === 'completed'),
      ]),
    );
    return el('div', null, rows);
  }

  // ── 刷新循环（10s；卸载即停，防分离 DOM 写入）──
  async function refresh(): Promise<void> {
    for (const [body, loader] of [
      [deptBody, loadDept],
      [tasksBody, loadTasks],
    ] as const) {
      body.replaceChildren(spinner());
      try {
        const node = await loader();
        if (disposed) return;
        body.replaceChildren(node);
      } catch (err) {
        if (disposed) return;
        body.replaceChildren(errorBox(`请求失败：${errMsg(err)}`));
      }
    }
  }
  void refresh();
  const timer = setInterval(() => void refresh(), 10000);

  root.replaceChildren(
    el('h2', null, [`🏭 ${DEPT_NAME}`]),
    el('p', null, ['固件开发七步手册：需求澄清 → 选型 → datasheet → 原理图 → 编码 → 编译 → 仿真 → 交付']),
    grid,
  );

  return () => {
    disposed = true;
    clearInterval(timer);
  };
}
