// ═══════════════════════════════════════════════════════════════
// Section 5: MetaPlanner 配置
// ═══════════════════════════════════════════════════════════════

/**
 * MetaPlannerConfig — MetaPlanner 配置
 */
export interface MetaPlannerConfig {
  /** 是否启用 */
  enabled: boolean;

  /** 最小相似度阈值（低于此值不使用模板） */
  similarityThreshold: number;

  /** 最少执行次数（低于此次数不信任模板） */
  minUsageThreshold: number;

  /** 最多返回的匹配模板数 */
  maxMatches: number;

  /** 是否自动将高分执行提炼为模板 */
  autoExtractTemplates: boolean;

  /** 提炼模板的最低评分阈值 */
  templateExtractionScoreThreshold: number;

  /** 计划经验存储路径 */
  experienceStorePath: string;

  /** 模板存储路径 */
  templateStorePath: string;

  /** 最大存储记录数 */
  maxRecords: number;

  /** 是否启用失败模式挖掘（用于自动优化） */
  enableFailurePatternMining: boolean;

  /** 失败模式最小出现次数（触发自动优化建议） */
  minFailurePatternCount: number;
}

/**
 * DEFAULT_META_PLANNER_CONFIG — 默认配置
 */
export const DEFAULT_META_PLANNER_CONFIG: MetaPlannerConfig = {
  enabled: true,
  similarityThreshold: 0.4,
  minUsageThreshold: 3,
  maxMatches: 5,
  autoExtractTemplates: true,
  templateExtractionScoreThreshold: 0.7,
  experienceStorePath: './data/planning/experiences/',
  templateStorePath: './data/planning/templates/',
  maxRecords: 10_000,
  enableFailurePatternMining: true,
  minFailurePatternCount: 3,
};

// ═══════════════════════════════════════════════════════════════
// Section 6: v2 扩展 - 战略拆解类型 (StrategicDeconstructor)
// ═══════════════════════════════════════════════════════════════

/**
 * Milestone — 层次化战略里程碑
 *
 * StrategicDeconstructor 将宏观意图拆解为高维度的里程碑骨架约束。
 * 每个里程碑代表一个逻辑阶段，包含目标领域、预期产物和优先级。
 */
export interface Milestone {
  /** 里程碑唯一 ID */
  id: string;

  /** 里程碑名称 */
  name: string;

  /** 里程碑描述 */
  description: string;

  /** 目标领域 */
  domain: string;

  /** 预期产物类型列表 */
  expectedArtifacts: string[];

  /** 优先级 (1-10, 越高越关键) */
  priority: number;

  /** 依赖的上游里程碑 ID 列表 */
  dependsOn: string[];

  /** 额外约束（如时间预算、最大节点数） */
  constraints?: Record<string, unknown>;

  /** 关联的 KnowledgeGraph 实体 ID（可选） */
  relatedEntityIds?: string[];

  /** 关联的 ArtifactRegistry 产物 ID（可选） */
  relatedArtifactIds?: string[];
}

