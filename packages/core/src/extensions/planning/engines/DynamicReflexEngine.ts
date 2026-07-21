/**
 * DynamicReflexEngine — 动态反射与重规划引擎（v2.5）
 *
 * RUNTIME REFLEX EXCEPTION SYSTEM:
 *   1. Intercept STATE_DEVIATION and SELF_HEALING_FAILED events
 *   2. Pause WorkflowEngine via IRuntimeController
 *   3. Check deviationCount: if > 3, ABORT → global fail-safe
 *   4. If valid, re-route context into the 7-Stage Pipeline for patching
 *   5. Apply hotPatch via DAGEngine
 *   6. Resume execution
 *
 * 设计原则：
 *   - 非侵入式：只调用 DAGEngine 公开方法
 *   - 安全：只对 pending/ready 节点操作
 *   - 可追溯：每次干预写入 JSONL
 *   - 防熔断：通过 DeviationGuard 防止无限重规划
 */

import type { IPlanningExtension } from './IPlanningExtension.js';
import type {
  RuntimeEventContext,
  RuntimeEventResult,
  IRuntimeController,
  DAGPatch,
  DAGPatchOperation,
  DeviationEvent,
  MemoryBusLogEntry,
  DeviationRecord,
} from '../types.js';
import type { DAGNode as DAGEngineNode } from '../../../planes/runtime-kernel/dag/types.js';

/** 偏差防护守卫接口 */
interface DeviationGuardInterface {
  isAllowed(sessionId: string): boolean;
  recordDeviation(record: DeviationRecord): number;
  getDeviationCount(sessionId: string): number;
  isCircuitBroken(sessionId: string): boolean;
  reset(sessionId: string): void;
  appendLog(entry: MemoryBusLogEntry): Promise<void>;
  getRemainingRetries(sessionId: string): number;
  markPatchApplied(sessionId: string, eventId: string, patchId: string): void;
  appendTraceLog(entry: MemoryBusLogEntry): Promise<void>;
}

/**
 * Maximum deviation count before triggering global fail-safe (Rule 4: >3 abort)
 */
const MAX_DEVIATION_BEFORE_ABORT = 3;

/**
 * ReplanPipelineFn — Callback to trigger the 7-stage planning pipeline
 * for runtime re-planning.
 */
export type ReplanPipelineFn = (
  sessionId: string,
  executionId: string,
  failureContext: Record<string, unknown>,
) => Promise<{ dag: any; patch: DAGPatch | null } | null>;

export class DynamicReflexEngine implements IPlanningExtension {
  public readonly name = 'DynamicReflexEngine';
  public readonly version = '2.5.0';
  public readonly priority = 50;
  public enabled = true;

  private guard: DeviationGuardInterface | null = null;
  private unsubscribers: Array<() => void> = [];
  private eventTimestamps = new Map<string, number>();

  /** Callback to trigger the full 7-stage re-planning pipeline */
  private replanPipeline: ReplanPipelineFn | null = null;

  constructor(config?: {
    guard?: DeviationGuardInterface;
    enabled?: boolean;
    replanPipeline?: ReplanPipelineFn;
  }) {
    if (config?.guard) this.guard = config.guard;
    if (config?.enabled !== undefined) this.enabled = config.enabled;
    if (config?.replanPipeline) this.replanPipeline = config.replanPipeline;
  }

  /**
   * setReplanPipeline — Configure the re-planning callback after construction
   */
  setReplanPipeline(fn: ReplanPipelineFn): void {
    this.replanPipeline = fn;
  }

  async onPrePlan(): Promise<any> { return {}; }
  async onPostPlan(): Promise<any> { return {}; }

  async onRuntimeEvent(
    event: RuntimeEventContext,
    controller: IRuntimeController,
  ): Promise<RuntimeEventResult> {
    if (!this.enabled) {
      return { handled: false, action: 'ignored', reason: '引擎未启用' };
    }

    const { sessionId, executionId } = event;
    const deviationEvent: DeviationEvent = event.event;
    const eventType = deviationEvent.type;
    const payload = deviationEvent.payload;

    // ────────────────────────────────────────────────────────────────
    // Step 1: 检查 DeviationGuard 熔断阈值
    // ────────────────────────────────────────────────────────────────
    if (this.guard && !this.guard.isAllowed(sessionId)) {
      const remaining = this.guard.getRemainingRetries(sessionId);
      return {
        handled: false,
        action: 'circuit_broken',
        reason: `会话已熔断（剩余 ${remaining} 次），交由 Self-Healing Runtime 兜底`,
      };
    }

    // ────────────────────────────────────────────────────────────────
    // Step 2: 评估严重程度
    // ────────────────────────────────────────────────────────────────
    const severity = this.calculateSeverity(eventType, payload);
    if (severity < 0.3) {
      return { handled: true, action: 'ignored', reason: `严重度 ${severity.toFixed(2)}，无需干预` };
    }

    // ────────────────────────────────────────────────────────────────
    // Step 3: 计算受影响节点
    // ────────────────────────────────────────────────────────────────
    const affectedNodes = this.calculateAffectedNodes(payload);
    if (affectedNodes.length === 0) {
      return { handled: true, action: 'ignored', reason: '无待执行受影响节点' };
    }

    // ────────────────────────────────────────────────────────────────
    // Step 4: 检查 deviationCount — 如果 > 3，全局熔断
    // ────────────────────────────────────────────────────────────────
    const deviationCount = this.guard?.getDeviationCount(sessionId) ?? 0;
    if (deviationCount >= MAX_DEVIATION_BEFORE_ABORT) {
      console.warn(
        `[DynamicReflexEngine] 会话 ${sessionId} deviationCount=${deviationCount} >= ${MAX_DEVIATION_BEFORE_ABORT}：` +
        `触发全局熔断，交由 Self-Healing Runtime 兜底保护`,
      );
      return {
        handled: false,
        action: 'circuit_broken',
        reason: `全局熔断：偏差计数 ${deviationCount} 超过 ${MAX_DEVIATION_BEFORE_ABORT} 上限`,
      };
    }

    // ────────────────────────────────────────────────────────────────
    // Step 5: 尝试通过 7-Stage Pipeline 进行完整重规划（如果可用）
    // ────────────────────────────────────────────────────────────────
    if (this.replanPipeline && (eventType === 'STATE_DEVIATION' || eventType === 'SELF_HEALING_FAILED')) {
      controller.pause();

      try {
        console.log(`[DynamicReflexEngine] 触发 7-Stage 重规划管道 (deviation=${deviationCount + 1})...`);

        // 调用 MetaPlanner 的 7-Stage Pipeline
        const replanResult = await this.replanPipeline(sessionId, executionId, {
          eventType,
          failedNodeId: payload.failedNodeId,
          failureReason: payload.failureReason ?? payload.reason,
          affectedNodes,
          deviationCount,
          severity,
        });

        if (replanResult && replanResult.patch) {
          // 应用 pipeline 生成的补丁
          let patchSuccess = false;
          try {
            patchSuccess = await controller.patchDAG(replanResult.patch);
          } catch (err: unknown) {
            console.error(`[DynamicReflexEngine] 7-Stage patchDAG 异常: ${(err as Error).message}`);
          }

          // 记录偏差
          if (this.guard) {
            const devRecord: DeviationRecord = {
              sessionId,
              eventId: `dev_${executionId}_${Date.now()}`,
              type: eventType,
              description: `7-Stage replan: ${replanResult.patch.reason}`,
              timestamp: Date.now(),
              triggeredReplan: patchSuccess,
              patchId: patchSuccess ? replanResult.patch.patchId : undefined,
            };
            this.guard.recordDeviation(devRecord);
          }

          controller.resume();

          return {
            handled: patchSuccess,
            action: patchSuccess ? '7stage_replan_patched' : '7stage_replan_failed',
            patch: patchSuccess ? replanResult.patch : undefined,
            reason: patchSuccess
              ? `7-Stage 重规划: 补丁 ${replanResult.patch.patchId} 已应用`
              : `7-Stage 重规划: 补丁应用失败`,
          };
        }

        controller.resume();
        console.log('[DynamicReflexEngine] 7-Stage 重规划未产生补丁，降级到局部修补');
      } catch (err: unknown) {
        controller.resume();
        console.error(`[DynamicReflexEngine] 7-Stage 重规划异常: ${(err as Error).message}，降级到局部修补`);
      }
    }

    // ────────────────────────────────────────────────────────────────
    // Step 6 (Fallback): 生成局部 DAGPatch（原有逻辑）
    // ────────────────────────────────────────────────────────────────
    const patch = this.generatePatch(eventType, executionId, affectedNodes, payload);
    if (!patch || patch.operations.length === 0) {
      return { handled: true, action: 'ignored', reason: '无需修补操作' };
    }

    // Step 7: 暂停 → 应用补丁 → 恢复
    controller.pause();
    let patchSuccess = false;
    try {
      patchSuccess = await controller.patchDAG(patch);
    } catch (err: unknown) {
      console.error(`[DynamicReflexEngine] patchDAG 异常: ${(err as Error).message}`);
    } finally {
      controller.resume();
    }

    // Step 8: 记录偏差
    if (this.guard) {
      const devRecord: DeviationRecord = {
        sessionId,
        eventId: `dev_${executionId}_${Date.now()}`,
        type: eventType,
        description: patch.reason,
        timestamp: Date.now(),
        triggeredReplan: patchSuccess,
        patchId: patchSuccess ? patch.patchId : undefined,
      };
      this.guard.recordDeviation(devRecord);
    }

    return {
      handled: patchSuccess,
      action: patchSuccess ? 'patched' : 'rerouted',
      patch: patchSuccess ? patch : undefined,
      reason: patchSuccess
        ? `补丁 ${patch.patchId} 已应用（${patch.operations.length} 个操作）`
        : `补丁应用失败，受影响节点: ${affectedNodes.join(', ')}`,
    };
  }

  unsubscribe(): void {
    for (const unsub of this.unsubscribers) { try { unsub(); } catch {} }
    this.unsubscribers = [];
  }

  private calculateSeverity(eventType: string, payload: Record<string, unknown>): number {
    const base: Record<string, number> = {
      STATE_DEVIATION: 0.6,
      SELF_HEALING_FAILED: 0.9,
      NODE_FAILED: 0.7,
      ARTIFACT_MISSING: 0.4,
      CONTEXT_EXCEEDED: 0.5,
    };
    const baseScore = base[eventType] ?? 0.3;
    const retryBoost = ((payload.retryCount as number) ?? 0) * 0.1;
    return Math.min(1, baseScore + retryBoost);
  }

  private calculateAffectedNodes(payload: Record<string, unknown>): string[] {
    const set = new Set<string>();
    const ids = [
      payload.failedNodeId,
      ...(Array.isArray(payload.failedNodes) ? payload.failedNodes : []),
      payload.affectedNodeId,
    ].filter(Boolean) as string[];
    ids.forEach(id => set.add(id));
    return [...set];
  }

  private generatePatch(
    eventType: string,
    executionId: string,
    affectedNodes: string[],
    payload: Record<string, unknown>,
  ): DAGPatch | null {
    const operations: DAGPatchOperation[] = [];

    switch (eventType) {
      case 'STATE_DEVIATION':
        for (const nodeId of affectedNodes) {
          operations.push({
            type: 'reroute',
            nodeId,
            payload: { alternateNodeId: payload.alternateNodeId as string | undefined },
          });
        }
        break;

      case 'SELF_HEALING_FAILED': {
        const fnId = payload.failedNodeId as string | undefined;
        if (fnId && affectedNodes.includes(fnId)) {
          operations.push({ type: 'remove_node', nodeId: fnId });
        }
        break;
      }

      case 'NODE_FAILED': {
        const fnId = payload.failedNodeId as string | undefined;
        if (fnId) {
          operations.push({ type: 'reroute', nodeId: fnId, payload: { alternateNodeId: payload.alternateNodeId as string | undefined } });
        }
        break;
      }

      case 'ARTIFACT_MISSING': {
        const missingArtifact = payload.artifactType as string | undefined;
        const depNode = payload.dependentNodeId as string | undefined;
        if (missingArtifact && depNode) {
          operations.push({
            type: 'insert_after',
            nodeId: `gen_${missingArtifact}_${Date.now()}`,
            payload: {
              afterNodeId: depNode,
              newNode: {
                id: `gen_${missingArtifact}_${Date.now()}`,
                name: `Generate ${missingArtifact}`,
                agentType: 'artifact_generator',
                description: `Auto-generated: produce missing ${missingArtifact}`,
                deps: [depNode],
                status: 'pending',
                priority: 8,
                retryCount: 0,
                maxRetries: 3,
              } as DAGEngineNode,
            },
          });
        }
        break;
      }

      default:
        return null;
    }

    if (operations.length === 0) return null;

    return {
      patchId: `patch_${executionId}_${Date.now()}`,
      reason: `DynamicReflexEngine 响应 ${eventType}: ${(payload.reason as string) ?? '自动修正'}`,
      timestamp: Date.now(),
      operations,
      affectedNodes,
    };
  }
}
