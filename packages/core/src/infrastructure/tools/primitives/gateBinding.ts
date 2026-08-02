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

export const PrimitiveGate = {
  /** 只读操作缺 Gate 凭证的累计次数（可观测，不静默） */
  ungatedReadonlyCalls: 0,

  /** 只读操作：有凭证 → 强校验；无凭证 → WARN 计数放行 */
  gateReadonly(operation: string, pkg?: KnowledgeContextPackage | null): void {
    if (pkg) {
      requireKnowledgeContext(pkg, operation);
      return;
    }
    PrimitiveGate.ungatedReadonlyCalls += 1;
    console.warn(
      `[PrimitiveGate] ⚠️ 只读操作 ${operation} 无 KnowledgeContextPackage（累计 ${PrimitiveGate.ungatedReadonlyCalls} 次）`,
    );
  },

  /** 破坏性/副作用操作：有凭证 → 强校验；无凭证 → 硬拦截抛错 */
  gateDestructive(operation: string, pkg?: KnowledgeContextPackage | null): void {
    if (pkg) {
      requireKnowledgeContext(pkg, operation);
      return;
    }
    throw new GateContextRequiredError(
      operation,
      '破坏性/副作用操作必须持有有效 KnowledgeContextPackage（缺失直接拒绝，禁止继续）',
    );
  },
};
