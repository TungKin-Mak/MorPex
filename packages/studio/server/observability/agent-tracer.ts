/**
 * Agent Tracer — Agent 调度/协作自动追踪（Phase 2）
 *
 * 包裹 AgentScheduler.selectAgent 和 CollaborationManager.execute，
 * 通过 ModuleInvoker.call() 自动标记模块为 exercised 并记录 TraceSpan。
 *
 * 非侵入：方法劫持，不修改原有逻辑。
 */

import type { ExecutionTracer } from './execution-tracer.js';
import { RuntimeInvoker } from './runtime-invoker.js';

/**
 * instrumentAgentScheduler — 包裹 AgentScheduler.selectAgent
 */
export function instrumentAgentScheduler(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scheduler: any,
  tracer: ExecutionTracer,
): void {
  const origSelect = scheduler.selectAgent;
  if (typeof origSelect !== 'function') {
    console.warn(`  ├─ AgentTracer ⚠️ AgentScheduler.selectAgent 不是函数，跳过`);
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scheduler.selectAgent = async function (this: any, task: any) {
    const taskId = task?.taskId || 'unknown';
    return await RuntimeInvoker.call(
      'agent-scheduler',
      'selectAgent',
      () => origSelect.call(this, task),
      tracer.getContext(taskId) ?? null,
      task,
      'agent',
    );
  };


  console.log(`  ├─ AgentTracer ✅ agent-scheduler 已埋点`);
}

/**
 * instrumentCollaborationManager — 包裹 CollaborationManager.execute
 */
export function instrumentCollaborationManager(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  collabMgr: any,
  tracer: ExecutionTracer,
): void {
  const origExecute = collabMgr.execute || collabMgr.executePlan;
  if (typeof origExecute !== 'function') {
    console.warn(`  ├─ AgentTracer ⚠️ CollaborationManager.execute 不是函数，跳过`);
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  collabMgr.execute = async function (this: any, plan: any) {
    const taskId = plan?.missionId || 'unknown';
    return await RuntimeInvoker.call(
      'collaboration-manager',
      'execute',
      () => origExecute.call(this, plan),
      tracer.getContext(taskId) ?? null,
      plan,
      'agent',
    );
  };


  console.log(`  ├─ AgentTracer ✅ collaboration-manager 已埋点`);
}
