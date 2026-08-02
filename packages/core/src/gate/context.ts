/**
 * gate/context — 运行时 Gate 上下文 + Tier 写入守卫 + 提案状态守卫
 *
 * Wave 3b：把「文档宪法」升级为「运行时硬拦截」。
 * 目标入口（四处）：
 *   1. Primitive.execute()           — 已有 ForcedQueryGuard 强制查询（tier-0/1 缺失即拒）
 *   2. Artifact 注册/发布            — ArtifactRegistry.register/update（本模块 TierWriteGuard）
 *   3. Evolution Proposal 创建       — EvolutionProposal.create（tier-0/1 必须持有包）
 *   4. Evolution Proposal 晋升       — EvolutionSandbox.approveAndApply（必须持有包，缺失抛错）
 *
 * 设计原则：
 *   - 缺包即抛错（GateContextRequiredError），业务代码无法吞掉后继续
 *   - Tier 规则由 L2 写入接口在运行时拒绝，而不是靠文档约定
 *   - 历史无 Tier 声明的写入走 tier-3 + WARN 计数（可观测，不静默）
 */

import type { RiskTier } from './types.js';

/** Knowledge Authority Tier — 知识权威分级（写入侧，与查询 RiskTier 区分） */
export type KnowledgeAuthorityTier = 'tier-0' | 'tier-1' | 'tier-2' | 'tier-3';

/**
 * KnowledgeContextPackage — 一次 Gate 查询的有效凭证
 * 由 runOntologyGroundedReasoning 签发（gate 结果自带 queryTrace + referenceCheck）。
 */
export interface KnowledgeContextPackage {
  executionId: string;
  riskTier: RiskTier;
  /** 实际 ontology 工具调用次数（≥1 才算有效查询） */
  queryCallCount: number;
  /** 已检索到的对象 ID 集合 */
  retrievedIds: string[];
  referenceCheck: {
    valid: boolean;
    missing: string[];
    knownCount: number;
  };
  issuedAt: number;
}

/** Gate 硬拦截错误：缺失/无效知识上下文，调用方禁止继续 */
export class GateContextRequiredError extends Error {
  constructor(operation: string, detail: string) {
    super(`[Gate 硬拦截] ${operation} 必须持有有效 KnowledgeContextPackage：${detail}`);
    this.name = 'GateContextRequiredError';
  }
}

/** Tier 写入拒绝错误：L2 写入接口运行时拒绝违规覆盖 */
export class TierWriteRejectedError extends Error {
  constructor(operation: string, detail: string) {
    super(`[Tier 写入守卫] ${operation} 被拒绝：${detail}`);
    this.name = 'TierWriteRejectedError';
  }
}

/**
 * requireKnowledgeContext — 硬拦截：包缺失/无效直接抛错，禁止继续
 *
 * @param pkg         Gate 上下文包（可为 undefined）
 * @param operation   操作名（错误信息定位用）
 * @param minCallCount 最少 ontology 查询次数（默认 1）
 */
export function requireKnowledgeContext(
  pkg: KnowledgeContextPackage | null | undefined,
  operation: string,
  minCallCount = 1,
): KnowledgeContextPackage {
  if (!pkg) {
    throw new GateContextRequiredError(operation, '缺失 Gate 上下文');
  }
  if (pkg.queryCallCount < minCallCount) {
    throw new GateContextRequiredError(
      operation,
      `ontology 查询次数 ${pkg.queryCallCount} < 要求 ${minCallCount}`,
    );
  }
  if (!pkg.referenceCheck.valid) {
    throw new GateContextRequiredError(
      operation,
      `引用校验失败，缺失 ID: ${pkg.referenceCheck.missing.join(', ')}`,
    );
  }
  return pkg;
}

/** Tier 写入守卫上下文 */
export interface TierWriteContext {
  /** 已存在 artifact 的权威级（无则 undefined → 视为 tier-3） */
  existing?: KnowledgeAuthorityTier;
  /** 本次写入声明的权威级 */
  incoming: KnowledgeAuthorityTier;
  /** 仅 L7 已晋升结果可为 true（晋升写 Tier-2 的前置条件） */
  promotedByEvolution?: boolean;
  /** 操作名（错误信息定位用） */
  operation: string;
}

/**
 * TierWriteGuard — Knowledge Authority 写入规则（运行时硬拒绝）
 *   - Tier-3 禁止覆盖 Tier-0/1
 *   - 只有 L7 已晋升结果（promotedByEvolution=true）才能写 Tier-2
 */
export const TierWriteGuard = {
  assertWriteAllowed(ctx: TierWriteContext): void {
    const { existing, incoming, promotedByEvolution, operation } = ctx;

    if (
      existing &&
      (existing === 'tier-0' || existing === 'tier-1') &&
      incoming === 'tier-3'
    ) {
      const existingName = existing === 'tier-0' ? 'Tier-0' : 'Tier-1';
      throw new TierWriteRejectedError(operation, `Tier-3 禁止覆盖 ${existingName}`);
    }

    if (incoming === 'tier-2' && !promotedByEvolution) {
      throw new TierWriteRejectedError(
        operation,
        '只有 L7 已晋升结果（promotedByEvolution=true）才能写 Tier-2',
      );
    }
  },
};

/** 提案状态守卫：未审批状态只能是 pending（DRAFT/PENDING_REVIEW） */
export const ProposalStatusGuard = {
  assertNotPromoted(status: string, operation: string): void {
    if (status === 'APPROVED' || status === 'IMPLEMENTED') {
      throw new GateContextRequiredError(
        operation,
        `未审批提案状态只能是 pending，当前=${status}`,
      );
    }
  },
};
