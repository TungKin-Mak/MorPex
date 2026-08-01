/**
 * brain/types.ts — Brain 层共享类型定义
 *
 * 集中管理 Brain 模块（CrossDepartmentKnowledgeSynthesizer、ReflectionEngine、MetaLearner 等）的类型定义，
 * 避免循环依赖和分散定义。
 *
 * @packageDocumentation
 */

// ── CrossDepartmentKnowledgeSynthesizer ──

/** 知识片段——从某个部门检索到的一条知识 */
export interface KnowledgeFragment {
  content: string;
  confidence: number;
  sourceDept: string;
  source: string;
  retrievedAt: number;
}

/** 融合结果——跨部门知识融合的输出 */
export interface SynthesisResult {
  fusedKnowledge: string;
  confidence: number;
  sourceDepts: string[];
  suggestedActions: string[];
  timestamp: number;
}

/** 模式迁移结果 */
export interface MigrationResult {
  success: boolean;
  error?: string;
  targetDept: string;
  adaptedPattern: { id: string; title: string; description: string; steps: string[]; successRate: number } | null;
  confidence?: number;
}

/** 知识融合引擎配置 */
export interface KnowledgeSynthesisConfig {
  /** 知识片段最低置信度阈值 */
  minConfidence: number;
  /** 最多参考源部门数 */
  maxSourceDepts: number;
  /** 是否启用自动模式迁移（实验性） */
  enableAutoMigration: boolean;
  /** 缓存 TTL（毫秒） */
  ttlMs: number;
}

// ── CrossDepartmentArbitrationEngine ──

/** 跨部门冲突——两个或多个部门的计划存在资源或依赖冲突 */
export interface Conflict {
  id: string;
  type: 'resource' | 'dependency' | 'priority' | 'schedule';
  description: string;
  involvedDepts: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  resolution?: string;
}

/** 仲裁结果 */
export interface ArbitrationResult {
  resolved: boolean;
  conflicts: Conflict[];
  resolution: string;
  recommendedPolicy: 'priority' | 'cost' | 'risk';
  timestamp: number;
}

// ── 跨部门仲裁引擎配置 ──

export interface ArbitrationConfig {
  /** 默认仲裁策略 */
  defaultPolicy: 'priority' | 'cost' | 'risk';
  /** 是否自动仲裁（true=自动，false=仅检测上报） */
  autoResolve: boolean;
  /** 严重级别阈值：达到此级别才触发仲裁 */
  minSeverity: 'low' | 'medium' | 'high';
}

// ── Evolution ──

/** 进化触发器配置 */
export interface ActiveEvolutionConfig {
  /** 连续失败 N 次触发 */
  consecutiveFailureThreshold: number;
  /** 质量评分连续低于阈值触发 */
  qualityThreshold: number;
  /** 检查间隔（毫秒） */
  checkIntervalMs: number;
  /** 是否启用自动触发 */
  enabled: boolean;
}

/** 模式迁移引擎配置 */
export interface PatternMigrationConfig {
  /** 最小置信度要求 */
  minConfidence: number;
  /** 是否启用自动迁移 */
  autoMigrate: boolean;
  /** 迁移后置信度衰减系数 */
  confidenceDecay: number;
}
