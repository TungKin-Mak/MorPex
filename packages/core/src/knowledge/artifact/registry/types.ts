/**
 * Artifact Plugin — 类型定义
 *
 * Artifact Model: Blueprint 和 Instance 的共同抽象。
 * Artifact Instance: 实际交付物（由 Agent 产出）。
 */

// ── Artifact 类型 ──

/** 产物类型 */
export type ArtifactType =
  | 'code' | 'document' | 'config' | 'schema' | 'report'
  | 'image' | 'video_script' | 'structured_data' | 'plan' | 'other';

// ── Artifact 状态 ──

/** 产物状态 */
export type ArtifactStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived' | 'superseded';

// ── Artifact Model ──

/** Artifact Meta Model — Blueprint 和 Instance 的共同抽象 */
export interface ArtifactModel {
  /** 模型类型 */
  type: ArtifactType;
  /** 描述 */
  description?: string;
  /** 数据 schema（字段定义） */
  schema?: Record<string, unknown>;
  /** 验证规则 */
  validationRules?: string[];
  /** 生命周期钩子 */
  lifecycle?: {
    onCreate?: string[];
    onApprove?: string[];
    onArchive?: string[];
  };
}

// ── Artifact Instance ──

/** Artifact Instance — 实际交付物 */
export interface ArtifactInstance {
  /** 唯一 ID */
  id: string;
  /** 产物名称 */
  name: string;
  /** 产物类型 */
  type: ArtifactType;
  /** 内容（字符串或结构化数据） */
  content: any;
  /** 来源 DAG 节点 ID */
  sourceNodeId?: string;
  /** 来源工具调用 ID */
  sourceToolCallId?: string;
  /** 版本号 */
  version: number;
  /** 状态 */
  status: ArtifactStatus;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 创建者 */
  createdBy?: string;
  /** 元数据 */
  metadata?: Record<string, any>;
}

// ── Artifact 版本 ──

/** Artifact 版本记录 */
export interface ArtifactVersion {
  /** 版本 ID */
  id: string;
  /** 所属 Artifact ID */
  artifactId: string;
  /** 版本号 */
  version: number;
  /** 内容快照 */
  content: any;
  /** 变更说明 */
  changeLog?: string;
  /** 创建时间 */
  createdAt: number;
  /** 创建者 */
  createdBy?: string;
}

// ── Artifact 增强属性（Phase 3 — Artifact Intelligence）──

/** 产物能力标记 */
export interface ArtifactCapability {
  name: string;
  type: 'transform' | 'analyze' | 'generate' | 'validate' | 'orchestrate';
  description: string;
  confidence: number; // 0-1
}

/** 产物依赖 */
export interface ArtifactDependency {
  artifactId: string;
  type: 'import' | 'extends' | 'references' | 'generates';
  version?: string;
  optional?: boolean;
}

/** 产物使用记录 */
export interface ArtifactUsageRecord {
  timestamp: number;
  action: 'created' | 'read' | 'updated' | 'deployed' | 'evaluated';
  context: string;
  result?: string;
  duration?: number;
}

/** Artifact Node — 增强版产物节点（含语义属性） */
export interface ArtifactNode {
  id: string;
  name: string;
  type: ArtifactType;
  status: ArtifactStatus;
  version: string;
  creator: string;
  description: string;
  capabilities: ArtifactCapability[];
  dependencies: ArtifactDependency[];
  successRate: number; // 0-1
  usageHistory: ArtifactUsageRecord[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, any>;
}

/** Artifact Edge — 产物关系边 */
export interface ArtifactEdge {
  from: string;
  to: string;
  type: 'dependency' | 'derivation' | 'supersedes' | 'references';
  weight?: number;
}

/** 血缘查询 */
export interface LineageQuery {
  artifactId: string;
  direction: 'upstream' | 'downstream' | 'both';
  maxDepth?: number;
  types?: ArtifactType[];
}

/** 血缘路径 */
export interface LineagePath {
  nodes: ArtifactNode[];
  edges: ArtifactEdge[];
  depth: number;
}

/** 评估结果 */
export interface ArtifactEvaluation {
  artifactId: string;
  score: number; // 0-1
  dimensions: {
    completeness: number;
    consistency: number;
    usability: number;
    performance?: number;
  };
  issues: string[];
  recommendations: string[];
  evaluatedAt: number;
}

/** Embedding 向量 */
export interface ArtifactEmbedding {
  artifactId: string;
  vector: number[];
  model: string;
  dimensions: number;
  createdAt: number;
}

// ── Artifact 图谱关系（原有）──

/** Artifact 关系类型 */
export type ArtifactRelation = 'parent' | 'child' | 'supersedes' | 'superseded_by' | 'depends_on';

/** Artifact 关系 */
export interface ArtifactRelationRecord {
  from: string;
  to: string;
  type: ArtifactRelation;
  createdAt: number;
}

// ── Artifact Registry ──

/** 注册中心查询选项 */
export interface ArtifactQuery {
  type?: ArtifactType;
  status?: ArtifactStatus;
  name?: string;
  createdBy?: string;
  limit?: number;
  offset?: number;
}

// ── 存储 ──

/** 存储后端的选项 */
export interface ArtifactStorageConfig {
  /** 存储基路径 */
  basePath?: string;
  /** 是否启用内容索引 */
  enableIndex?: boolean;
}

// ── 插件配置 ──

/** Artifact Plugin 配置 */
export interface ArtifactPluginConfig {
  storage?: ArtifactStorageConfig;
  /** 最大版本保留数（默认 10） */
  maxVersions?: number;
  /** 持久化数据目录（默认 ./data/artifacts） */
  dataDir?: string;
}
