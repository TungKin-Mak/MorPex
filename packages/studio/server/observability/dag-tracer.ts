/**
 * DAG Tracer — DomainDispatcher 自动调用追踪（Phase 2）
 *
 * 劫持 DomainDispatcher 的 onNodeStart/onNodeComplete/onNodeFail 回调，
 * 自动创建/结束 TraceContext，通过 ModuleInvoker 标记模块为 exercised。
 *
 * 非侵入：只替换回调函数，不修改 DomainDispatcher 内部逻辑。
 */

import type { ExecutionTracer } from './execution-tracer.js';

// ── Instrumentation ──

/**
 * instrumentDAGDispatcher — 为 DomainDispatcher 注入追踪回调
 *
 * 替换 onNodeStart → 创建 TraceContext
 * 替换 onNodeComplete → 结束 TraceContext
 * 替换 onNodeFail → 错误结束 TraceContext
 *
 * 保留原有的回调链（先执行追踪，再调用原始回调）。
 */
export function instrumentDAGDispatcher(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispatcher: any,
  tracer: ExecutionTracer,
): void {
  // 保存原始回调
  const origNodeStart = dispatcher.onNodeStart;
  const origNodeComplete = dispatcher.onNodeComplete;
  const origNodeFail = dispatcher.onNodeFail;

  // ── onNodeStart: 开始追踪 ──
  dispatcher.onNodeStart = (node: { taskId: string; domain: string; goal: string }) => {
    const taskId = node.taskId;
    if (!tracer.getContext(taskId)) {
      tracer.startTask({
        taskId,
        input: { nodeId: node.taskId, domain: node.domain, goal: node.goal },
      });
    }
    // 调用原始回调（如果有）
    origNodeStart?.(node);
  };

  // ── onNodeComplete: 结束追踪 ──
  dispatcher.onNodeComplete = (result: { taskId: string; output?: unknown; status?: string }) => {
    const taskId = result.taskId;
    tracer.endTask(taskId, result.output);
    origNodeComplete?.(result);
  };

  // ── onNodeFail: 错误结束追踪 ──
  dispatcher.onNodeFail = (node: { taskId: string; domain: string }, error: string) => {
    const taskId = node.taskId;
    tracer.endTask(taskId, undefined, new Error(error));
    origNodeFail?.(node, error);
  };

  console.log(`  ├─ DAGTracer ✅ DomainDispatcher 已埋点`);
}
