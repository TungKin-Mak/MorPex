/**
 * ontologyCompliance — Ontology 查询合规评分
 *
 * 迭代1：在现有 EvaluationEngine 基础上增加两维：
 *   - queryScore：是否执行了 ontology 查询
 *   - referenceScore：引用的 ID 是否都来自已检索集合
 *
 * 用法：
 *   const { queryScore, referenceScore } = scoreOntologyCompliance(guard, executionId, referencedIds);
 *   // 将分数注入 evaluation 报告的额外维度
 */

import type { ForcedQueryGuard } from '../gate/ForcedQueryGuard.js';

// ═══════════════════════════════════════════════════════════════
// vNext+ 增强：评估「引用覆盖率 / 无引用生成 / QueryMiss」维度
//   与现有 5 维评分衔接（ontologyCompliance 作为额外维度注入）
// ═══════════════════════════════════════════════════════════════

export interface OntologyComplianceScore {
  /** 查询合规分：0（未查询）或 1（已查询） */
  queryScore: number;
  /** 引用合规分：0（无引用/引用缺失）到 1（全部有效） */
  referenceScore: number;
  /** 工具调用次数 */
  callCount: number;
  /** 引用的 ID 总数 */
  referencedCount: number;
  /** 缺失的 ID（引用了但未检索） */
  missingIds: string[];
  /** vNext+: 是否检测到 QueryMiss（查询执行但未检索到任何事实） */
  queryMissDetected: boolean;
  /** vNext+: 实际检索到的对象数 */
  retrievedCount: number;
  /** vNext+: 引用覆盖率 = referencedCount 中有效比例（0-1） */
  coverageRatio: number;
}

/**
 * scoreOntologyCompliance — 计算 Ontology 查询合规评分
 *
 * @param guard - ForcedQueryGuard 实例
 * @param executionId - 执行 ID
 * @param referencedIds - proposal 中引用的对象 ID 列表
 * @returns OntologyComplianceScore
 */
export function scoreOntologyCompliance(
  guard: ForcedQueryGuard,
  executionId: string,
  referencedIds: string[],
): OntologyComplianceScore {
  const trace = guard.getTrace(executionId);
  const callCount = trace?.toolCalls.length ?? 0;
  const queryScore = callCount > 0 ? 1 : 0;

  const { valid, missing } = guard.validateReferences(executionId, referencedIds);
  const referencedCount = referencedIds.length;

  // vNext+: QueryMiss 检测 — 查询执行过但未检索到任何对象 ID
  const retrievedCount = guard.getRetrievedIds(executionId).length;
  const queryMissDetected = callCount > 0 && retrievedCount === 0;

  // vNext+: 引用覆盖率 — 有效引用 / 总引用
  const coverageRatio = referencedCount > 0
    ? (referencedCount - missing.length) / referencedCount
    : 0;

  // 无引用 = 0.5（中性，可能不需要引用）
  // 全部有效 = 1
  // 有缺失 = 0
  // vNext+: QueryMiss（查了但没检索到事实）= 0.2（知识缺口，提示补知识）
  let referenceScore: number;
  if (referencedCount === 0) {
    referenceScore = queryMissDetected ? 0.2 : 0.5;
  } else {
    referenceScore = valid ? 1 : 0;
  }

  return {
    queryScore,
    referenceScore,
    callCount,
    referencedCount,
    missingIds: missing,
    queryMissDetected,
    retrievedCount,
    coverageRatio,
  };
}
