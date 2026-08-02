/**
 * lineageCompliance — L6 血缘健康评分（Lineage Health）
 *
 * Wave 3a（L6 做实）：评价层此前只有 EvaluationEngine/QualityScorer/ontologyCompliance，
 * 血缘（Lineage）实际分散在 knowledge/ 与 evolution/。本模块把「血缘健康度」纳入 L6 评价：
 *   - 复用 L2 knowledge/artifact/registry 的 ArtifactGraph + ArtifactLineage（L6 读 L2 数据，允许 import）
 *   - 维度：已批准节点占比 + 孤立节点比例 + 逐条违规清单
 *
 * 设计原则：L6 只评分与发事件（evaluation.scored / evaluation.low_score），
 * 不直接触发生产变更——低分由 L7 演化层通过事件消费。
 */

import { ArtifactLineage } from '../knowledge/artifact/registry/ArtifactLineage.js';
import { ArtifactGraph } from '../knowledge/artifact/registry/ArtifactGraph.js';
import type { ArtifactNode } from '../knowledge/artifact/registry/types.js';

/** 健康状态集合（registry ArtifactStatus：draft/pending_review/approved/rejected/archived/superseded） */
const HEALTHY_STATUSES = new Set(['approved']);

export interface LineageHealthScore {
  /** 综合健康分 0-1（批准占比 70% + 无孤立 30%） */
  score: number;
  /** 已批准节点 / 血缘可达节点总数 */
  committedRatio: number;
  /** 孤立节点数（无上游且无下游的请求节点） */
  orphanCount: number;
  /** 参与评分的血缘节点总数 */
  totalNodes: number;
  /** 违规清单（缺失节点 / 未批准 / 孤立） */
  violations: string[];
}

/**
 * scoreLineageHealth — 对一组 Artifact 的血缘子图评分
 *
 * @param graph       L2 ArtifactGraph（已装载节点与边）
 * @param artifactIds 待评分的 Artifact ID 列表
 */
export function scoreLineageHealth(
  graph: ArtifactGraph,
  artifactIds: string[],
): LineageHealthScore {
  const lineage = new ArtifactLineage(graph);
  const violations: string[] = [];
  const seen = new Set<string>();
  let approved = 0;
  let total = 0;
  let orphanCount = 0;

  const collect = (nodes: ArtifactNode[] | undefined): void => {
    for (const n of nodes ?? []) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      total += 1;
      if (HEALTHY_STATUSES.has(n.status)) approved += 1;
    }
  };

  for (const id of artifactIds) {
    const node = graph.getNode(id);
    if (!node) {
      violations.push(`Artifact ${id} 不在血缘图中`);
      continue;
    }
    const full = lineage.getFullLineage(id);
    collect(full.ancestors);
    collect(full.descendants);

    // getDependents/getDependencyChain 都包含节点自身，孤立判定需排除自身
    const realAncestors = full.ancestors.filter((n) => n.id !== id).length;
    const realDescendants = full.descendants.filter((n) => n.id !== id).length;
    if (realAncestors === 0 && realDescendants === 0) {
      orphanCount += 1;
      violations.push(`Artifact ${id} 是孤立节点（无上游/下游血缘）`);
    }
    if (node.status !== 'approved') {
      violations.push(`Artifact ${id} 未批准（status=${node.status}）`);
    }
  }

  const committedRatio = total === 0 ? 0 : approved / total;
  const orphanRatio = artifactIds.length === 0 ? 0 : orphanCount / artifactIds.length;
  const score = Math.max(0, Math.min(1, committedRatio * 0.7 + (1 - orphanRatio) * 0.3));

  return {
    score: Math.round(score * 100) / 100,
    committedRatio,
    orphanCount,
    totalNodes: total,
    violations,
  };
}
