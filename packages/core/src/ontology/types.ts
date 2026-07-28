/**
 * Ontology — 轻量本体层类型定义
 *
 * 迭代1：包装现有 MetadataGraph，暴露 4 个 ontology 工具给 LLM
 */

export type ObjectId = string;

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
}
