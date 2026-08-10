/**
 * gateBinding — 副作用原语的运行时 Gate 绑定（Wave 4）
 *
 * 评估规则①：所有 Primitive.execute() 必须持有有效 KnowledgeContextPackage。
 * 落地策略（与 ArtifactRegistry tier-3 渐进先例一致）：
 *   - 调用方提供了 gateContext        → requireKnowledgeContext 强制校验（无效即抛 GateContextRequiredError）
 *   - 破坏性/副作用操作且缺 gateContext → GateContextRequiredError（硬拦截，禁止继续）
 *   - 只读操作且缺 gateContext        → WARN 计数（可观测，不静默），供历史调用方渐进迁移
 *
 * 偏差说明（诚实）：UnifiedExecutionEngine 的 auto 简单任务路径（executeAuto →
 * DomainPrimitiveRegistry.execute）目前不携带 Gate 上下文，故只读操作放行（WARN），
 * 破坏性操作被硬拦——这正是"知识优先 + 副作用隔离"想要的默认行为。
 */

import {
  GateContextRequiredError,
  requireKnowledgeContext,
  type KnowledgeContextPackage,
} from '../../../gate/context.js';

// ═══ 去黑盒化（黑盒④/⑯ 门禁判定留痕）：统一记录入口 ═══
import { getSharedDeblackboxRecorder } from '../../observability/deblackbox/DeblackboxRecorder.js';

export const PrimitiveGate = {
  /** 只读操作缺 Gate 凭证的累计次数（可观测，不静默） */
  ungatedReadonlyCalls: 0,

  /** 只读操作：有凭证 → 强校验；无凭证 → WARN 计数放行 */
  gateReadonly(operation: string, pkg?: KnowledgeContextPackage | null): void {
    if (pkg) {
      requireKnowledgeContext(pkg, operation);
      recordGateDecision(operation, pkg, {
        verdict: 'allow',
        readonly: true,
        reason: '只读操作持有凭证，强校验通过',
      });
      return;
    }
    PrimitiveGate.ungatedReadonlyCalls += 1;
    console.warn(
      `[PrimitiveGate] ⚠️ 只读操作 ${operation} 无 KnowledgeContextPackage（累计 ${PrimitiveGate.ungatedReadonlyCalls} 次）`,
    );
    recordGateDecision(operation, null, {
      verdict: 'allow-readonly-fallback',
      readonly: true,
      reason: `只读操作无凭证 WARN 放行（性能优先，累计 ${PrimitiveGate.ungatedReadonlyCalls} 次）`,
    });
  },

  /** 破坏性/副作用操作：有凭证 → 强校验；无凭证 → 硬拦截抛错 */
  gateDestructive(operation: string, pkg?: KnowledgeContextPackage | null): void {
    if (pkg) {
      requireKnowledgeContext(pkg, operation);
      recordGateDecision(operation, pkg, {
        verdict: 'allow',
        destructive: true,
        reason: '破坏性操作持有凭证，强校验通过',
      });
      return;
    }
    recordGateDecision(operation, null, {
      verdict: 'block',
      destructive: true,
      isError: true,
      reason: '破坏性/副作用操作缺凭证，硬拦截（禁止继续）',
    });
    throw new GateContextRequiredError(
      operation,
      '破坏性/副作用操作必须持有有效 KnowledgeContextPackage（缺失直接拒绝，禁止继续）',
    );
  },
};

/** 去黑盒化：记录门禁判定决策单（L1 永久，异常全记） */
function recordGateDecision(
  operation: string,
  pkg: KnowledgeContextPackage | null,
  meta: { verdict: string; readonly?: boolean; destructive?: boolean; isError?: boolean; reason: string },
): void {
  try {
    getSharedDeblackboxRecorder().record({
      category: 'gate.decision',
      source: 'primitive-gate',
      executionId: pkg?.executionId ?? 'kernel',
      level: 'L1',
      isError: meta.isError,
      summary: {
        operation,
        verdict: meta.verdict,
        readonly: meta.readonly === true,
        destructive: meta.destructive === true,
        hasKnowledgePackage: pkg !== null && pkg !== undefined,
        riskTier: pkg?.riskTier ?? 'unknown',
        retrievedCount: pkg?.retrievedIds?.length ?? 0,
        reason: meta.reason,
        decision: meta.verdict,
        reasoning: meta.reason,
      },
    });
  } catch (err) {
    console.warn('[PrimitiveGate] ⚠️ 门禁判定记录失败（忽略）:', err instanceof Error ? err.message : String(err));
  }
}
