/**
 * PlanGateService — 规划方案确认门（17i.22）
 *
 * 交互模式（默认）：编排器产出规划方案后**暂停**，发 plan.ready 事件（含方案文件路径），
 * 前端在聊天里汇报「方案已做好，文件 xxx.md，如需继续请回复」+「继续执行」按钮，
 * 用户确认（POST /api/plan/:id/continue）后继续 DAG 执行。
 *
 * Goal 模式：setAutoExecute(true) 后跳过暂停，方案即产即执行（全自动）。
 *
 * 与 ask_user / ApprovalGate 同构：request（暂停+事件）→ wait（promise）→ decide（endpoint）。
 */
import type { EventBus } from '../infrastructure/common/EventBus.js';
import { recordDecision, resolveDecision } from '../execution/DecisionStore.js';

export interface PlanConfirmRequest {
  id: string;
  goal: string;
  planFile: string;
  stepNames: string[];
  resolve: () => void;
}

const pending = new Map<string, PlanConfirmRequest>();
let planEventBus: EventBus | null = null;
let autoExecute = false;

/** 进程级设置 EventBus（发 plan.ready 事件）。 */
export function setPlanEventBus(bus: EventBus | null): void {
  planEventBus = bus;
}

/** 设置 Goal 模式（true=全自动，跳过方案确认）。由 chat/send 按每次请求设置。 */
export function setAutoExecute(v: boolean): void {
  autoExecute = !!v;
}

/** 当前是否 Goal 模式。 */
export function isAutoExecute(): boolean {
  return autoExecute;
}

/**
 * 请求方案确认：Goal 模式立即返回（不暂停）；否则阻塞直到 confirmPlan（**不设超时**，17i.22·用户要求）。
 * @returns 是否实际等待了确认（goal 模式返回 false）
 */
export function requestPlanConfirm(
  id: string,
  goal: string,
  planFile: string,
  stepNames: string[],
): Promise<boolean> {
  if (autoExecute) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    pending.set(id, {
      id,
      goal,
      planFile,
      stepNames,
      resolve: () => {
        pending.delete(id);
        resolve(true);
      },
    });
    planEventBus?.emit({
      id: `evt_plan_${id}`,
      type: 'plan.ready',
      timestamp: Date.now(),
      executionId: id,
      source: 'plan-gate',
      payload: { planId: id, goal, planFile, stepNames },
    });
    // P-B：未决决策持久化（后端重启可恢复；/api/decisions/pending 继续可用）
    recordDecision({ id, kind: 'plan', goal, title: '确认执行方案', question: `规划方案已就绪，是否继续执行「${goal.slice(0, 40)}」？`, meta: { planFile, stepNames } });
  });
}

/** 用户确认继续 → resolve 阻塞中的请求。 */
export function confirmPlan(id: string): boolean {
  const req = pending.get(id);
  if (!req) {
    resolveDecision(id); // 17k.7：底层 Map 无（重启后）→ 也清持久化
    return false;
  }
  resolveDecision(id); // P-B：标记已决议
  req.resolve();
  return true;
}

/** 查询待确认方案。 */
export function getPendingPlans(): Array<{ id: string; goal: string; planFile: string; stepNames: string[] }> {
  return [...pending.values()].map((p) => ({ id: p.id, goal: p.goal, planFile: p.planFile, stepNames: p.stepNames }));
}
