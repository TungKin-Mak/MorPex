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

import type { ForcedQueryGuard } from '../ontology/ForcedQueryGuard.js';

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

  // 无引用 = 0.5（中性，可能不需要引用）
  // 全部有效 = 1
  // 有缺失 = 0
  let referenceScore: number;
  if (referencedCount === 0) {
    referenceScore = 0.5;
  } else {
    referenceScore = valid ? 1 : 0;
  }

  return {
    queryScore,
    referenceScore,
    callCount,
    referencedCount,
    missingIds: missing,
  };
}
