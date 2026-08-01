/**
 * Ontology — 轻量本体层类型定义
 *
 * 迭代1：包装现有 MetadataGraph，暴露 4 个 ontology 工具给 LLM
 */

export type ObjectId = string;

/**
 * RiskTier — Ontology Gate 风险分级（vNext+ Graded Ontology Gate）
 *
 * 分级强制 + 可降级（理想架构优化 vNext+）：
 *   - tier-0  Critical（资金/对外发布/架构变更/演化提案）
 *     → 强制两阶段 + 引用校验 + 同步 Verification，禁止缓存
 *   - tier-1  Standard（规划、正式 Artifact）
 *     → 两阶段；允许 Ontology 快照缓存（短 TTL）
 *   - tier-2  Draft / Internal（草稿、内部反思）
 *     → 尽力查询；无结果可进入 ControlledExploration
 *       （必须记录 QueryMiss 事件，驱动 Evolution）
 */
export type RiskTier = 'tier-0' | 'tier-1' | 'tier-2';

/**
 * QueryMissSignal — 知识缺失信号（QueryMiss is Signal）
 *
 * 无结果不能静默失败，必须产生可观测的 feedback 信号驱动演化。
 */
export interface QueryMissSignal {
  /** 触发缺失时的风险分级 */
  tier: RiskTier;
  /** 查询目标 */
  goal: string;
  /** 缺失原因 */
  reason: 'no_results' | 'reference_validation_failed' | 'parse_failed';
  /** tier-2 是否进入受控探索（ControlledExploration） */
  controlledExploration: boolean;
  /** 缺失发生时间 */
  timestamp: number;
}

export interface OntologyObject {
  id: ObjectId;
  type: string;
  properties: Record<string, unknown>;
  status?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface OntologyRelation {
  id: string;
  from: ObjectId;
  to: ObjectId;
  type: string;
  properties?: Record<string, unknown>;
  createdAt: number;
}

export interface QueryFilter {
  type?: string | string[];
  properties?: Record<string, unknown>;
  status?: string | string[];
  limit?: number;
  relations?: string[];
}

export interface RetrievedFact {
  object: OntologyObject;
  relations: OntologyRelation[];
}

export interface QueryTrace {
  toolCalls: Array<{
    name: string;
    args: unknown;
    resultSummary: string;
    at: number;
  }>;
  retrievedObjectIds: Set<string>;
}

export interface OntologyProposal {
  /** 动作类型（LLM 建议的操作分类） */
  action_type?: string;
  /** 提案载荷（具体的执行计划 / 方案内容） */
  payload?: unknown;
  /** 引用的 Ontology 对象 ID 列表 */
  referenced_object_ids: string[];
  /** 置信度 0-1 */
  confidence?: number;
  /** 缺失信息列表 */
  missing_info?: string[];
  /** 是否需要人工审批 */
  needs_human_review?: boolean;
  /** 推理过程 */
  reasoning?: string;
  /** 原始 LLM 输出 */
  raw?: unknown;
  /** 提案内容（与 payload 同义，LLM 输出中常用） */
  proposal?: unknown;
  /**
   * ControlledExploration 标志（Tier-2 draft 降级）
   * 无可用事实时置 true，表示允许在受控范围内探索而非硬崩。
   */
  controlled_exploration?: boolean;
  /** QueryMiss 信号：本次 Gate 查询未命中任何可用事实 */
  query_miss?: boolean;
  /** 本次 Gate 执行采用的风险分级 */
  risk_tier?: RiskTier;
}
