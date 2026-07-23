/**
 * Tool Tracer — 工具执行自动追踪（Phase 2）
 *
 * 包裹 SandboxManager.execute 和 VerificationEngine.verify，
 * 通过 ModuleInvoker.call() 自动标记模块为 exercised 并记录 TraceSpan。
 *
 * 非侵入：方法劫持，不修改原有逻辑。
 */

import type { ExecutionTracer } from './execution-tracer.js';
import { RuntimeInvoker } from './runtime-invoker.js';

/**
 * instrumentSandbox — 包裹 SandboxManager 的执行方法
 *
 * 兼容 SandboxManager.execute / run / exec 三种方法名。
 */
export function instrumentSandbox(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sandbox: any,
  tracer: ExecutionTracer,
): void {
  const origExecute = sandbox.execute || sandbox.run || sandbox.exec;
  if (typeof origExecute !== 'function') {
    console.warn(`  ├─ ToolTracer ⚠️ SandboxManager.execute 不是函数，跳过`);
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sandbox.execute = async function (this: any, toolName: string, input: any, ctx?: any) {
    const taskId = ctx?.taskId || input?.taskId || 'unknown';
    return await RuntimeInvoker.call(
      'sandbox-manager',
      `tool:${toolName}`,
      () => origExecute.call(this, toolName, input, ctx),
      tracer.getContext(taskId) ?? null,
      { toolName, input },
      'tool',
    );
  };
  console.log(`  ├─ ToolTracer ✅ sandbox-manager 已埋点`);
}

/**
 * instrumentVerifier — 包裹 VerificationEngine 的验证方法
 */
export function instrumentVerifier(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  verifier: any,
  tracer: ExecutionTracer,
): void {
  const origVerify = verifier.verify || verifier.run || verifier.evaluate;
  if (typeof origVerify !== 'function') {
    console.warn(`  ├─ ToolTracer ⚠️ VerificationEngine.verify 不是函数，跳过`);
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  verifier.verify = async function (this: any, ...args: any[]) {
    const taskId = args[0]?.taskId || args[0]?.missionId || 'unknown';
    return await RuntimeInvoker.call(
      'verification-engine',
      'verify',
      () => origVerify.apply(this, args),
      tracer.getContext(taskId) ?? null,
      args[0],
    );
  };
  console.log(`  ├─ ToolTracer ✅ verification-engine 已埋点`);
}
