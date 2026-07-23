/**
 * FSM Tracer — 状态机构造转换自动追踪（Phase 2）
 *
 * 劫持 FSM 的 onTransition 事件/方法，自动记录状态转换。
 * 支持 MissionRuntime、ExecutionFSM 以及任何有 setState/transition 方法的 FSM。
 *
 * 非侵入：通过事件监听或方法包裹，不修改 FSM 内部逻辑。
 */

import type { ExecutionTracer } from './execution-tracer.js';

/**
 * instrumentFSM — 为 FSM 实例注入转换追踪
 *
 * @param fsmInstance - 任何有 setState/setCurrentState/transition 方法或 on('transition') 事件的实例
 * @param fsmName     - FSM 名（对应 DEFAULT_MODULES 中的 name）
 * @param tracer      - ExecutionTracer 实例
 */
export function instrumentFSM(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fsmInstance: any,
  fsmName: string,
  tracer: ExecutionTracer,
): void {
  // 方式 1: 通过 EventEmitter.on('transition') 监听
  if (typeof fsmInstance.on === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fsmInstance.on('transition', (data: { from: string; to: string; trigger?: string; taskId?: string }) => {
      const taskId = data.taskId || fsmInstance._executionId || fsmInstance._missionId || 'unknown';
      tracer.traceFSMTransition(taskId, fsmName, data.from, data.to, data.trigger || 'auto');
    });
  }

  // 方式 2: 包裹 setState/setCurrentState/transition 方法
  const origMethod = fsmInstance.setState || fsmInstance.setCurrentState || fsmInstance.transition;
  if (typeof origMethod === 'function') {
    const wrapped = function (this: unknown, ...args: unknown[]) {
      const _self = this as Record<string, unknown>;
      const oldState: string = _self._currentState as string || _self.state as string || 'unknown';
      const newState: string = typeof args[0] === 'string' ? args[0] : 'unknown';
      const trigger: string = (typeof args[1] === 'string' ? args[1] : args.length > 1 ? String(args[1]) : 'auto');
      const taskId: string = _self._executionId as string || _self._missionId as string || 'unknown';

      const result = origMethod.apply(this, args);

      tracer.traceFSMTransition(taskId, fsmName, oldState, newState, trigger);
      return result;
    };

    if (fsmInstance.setState) fsmInstance.setState = wrapped;
    else if (fsmInstance.setCurrentState) fsmInstance.setCurrentState = wrapped;
    else if (fsmInstance.transition) fsmInstance.transition = wrapped;
  }

  console.log(`  ├─ FSMTracer ✅ ${fsmName} 已埋点`);
}
