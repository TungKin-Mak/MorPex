/**
 * Knowledge Graph — 类型定义
 *
 * 统一知识图谱：整合 Agent / Task / Artifact / Decision / Memory
 * 为上层提供跨数据源的查询接口。
 *
 * 扩展了 Cognee 风格的实体/关系类型，支持认知图谱（Cognitive Graph）。
 */

// ── 实体类型 ──

/** 知识图谱实体类型 */
export type EntityType =
  // 原有
  | 'agent'       // Agent
  | 'task'        // DAG 任务节点
  | 'artifact'    // Artifact Instance
  | 'decision'    // 关键决策点
  | 'memory'      // 记忆条目
  | 'execution'   // 执行记录
  | 'goal'        // 目标
  // Cognee 风格扩展 — 认知维度
  | 'concept'       // 抽象概念
  | 'technology'    // 技术/工具
  | 'person'         // 人物
  | 'organization'   // 组织
  | 'process'        // 流程
  | 'skill'          // 技能
  | 'document'       // 文档
  | 'chunk'          // 文档切片（用于追溯）
  | 'chat_session'   // 聊天会话
  | 'checkpoint';    // 检查点

// ── 关系类型 ──

/** 知识图谱关系类型 */
export type RelationType =
  // 原有
  | 'triggers'        // A 触发 B
  | 'produces'        // 产生（Agent → Artifact）
  | 'depends_on'      // 依赖
  | 'supersedes'      // 取代
  | 'related_to'      // 相关
  | 'part_of'         // 属于
  | 'decides'         // 决策
  | 'remembers'       // 记忆关联
  // Cognee 风格扩展 — 认知维度
  | 'used_by'         // 被使用（technology ← agent）
  | 'describes'       // 描述（document → concept）
  | 'contradicts'     // 矛盾（纠正关系）
  | 'evolved_from'    // 演化自（知识版本链）
  | 'references'      // 引用（chunk → entity）
  | 'contains'        // 包含（document → chunk）
  | 'implements'      // 实现（process → artifact）
  | 'generated_by';   // 由...生成（artifact → execution）

// ── 实体 ──

/** 知识图谱实体 */
export interface KnowledgeEntity {
  id: string;
  /** 所属领域（Phase 12: 跨领域知识图谱） */
  domainId?: string;
  type: EntityType;
  name: string;
  description?: string;
  /** 关联的外部系统 ID（Artifact ID / Memory ID / Execution ID 等） */
  refId?: string;
  /** 时间戳 */
  timestamp: number;
  /** 标签 */
  tags: string[];
  /** 元数据 */
  metadata?: Record<string, any>;
}

// ── 关系 ──

/** 知识图谱关系 */
export interface KnowledgeRelation {
  id: string;
  source: string;       // 源实体 ID
  target: string;       // 目标实体 ID
  type: RelationType;
  /** 关系权重 0-1 */
  weight: number;
  /** 创建时间 */
  createdAt: number;
  /** 元数据 */
  metadata?: Record<string, any>;
}

// ── 查询 ──

/** 知识图谱查询 */
export interface KnowledgeQuery {
  /** 按实体类型过滤 */
  entityType?: EntityType;
  /** 按关系类型过滤 */
  relationType?: RelationType;
  /** 按标签过滤 */
  tags?: string[];
  /** 文本搜索 */
  text?: string;
  /** 按时间范围 */
  since?: number;
  until?: number;
  /** 最大结果数 */
  limit?: number;
}

// ── 查询结果 ──

/** 路径查询结果 */
export interface KnowledgePath {
  entities: KnowledgeEntity[];
  relations: KnowledgeRelation[];
  totalWeight: number;
}

// ── 统计 ──

/** 知识图谱统计 */
export interface KnowledgeStats {
  totalEntities: number;
  totalRelations: number;
  byEntityType: Record<string, number>;
  byRelationType: Record<string, number>;
}

// ── 配置 ──

export interface KnowledgePluginConfig {
  /** 最大保留实体数 */
  maxEntities?: number;
  /** 持久化数据目录 */
  dataDir?: string;
}
