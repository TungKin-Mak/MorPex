/**
 * Personal Brain — Memory Layer Type Definitions
 *
 * Phase 6 / MorPex v8: 5 层记忆体系的数据模型。
 *
 * 记忆分层:
 *   working    — 工作记忆（短期、会话级）
 *   episodic   — 情景记忆（事件、经历）
 *   semantic   — 语义记忆（事实、知识）
 *   preference — 偏好记忆（用户喜好）
 *   workflow   — 工作流记忆（已学习的工作流程）
 *
 * 设计原则:
 *   - 每层记忆有不同的生命周期和访问模式
 *   - 所有记忆条目共享 MemoryEntry 基础结构
 *   - 特殊类型通过继承扩展（WorkflowMemoryEntry, DecisionMemoryEntry 等）
 *   - 置信度和重要性区分"有多确定"和"有多重要"
 */

// ═══════════════════════════════════════════════════════════════
// 记忆层标识
// ═══════════════════════════════════════════════════════════════

/** 记忆层类型 */
export type MemoryLayer = 'working' | 'episodic' | 'semantic' | 'preference' | 'workflow';

/**
 * 所有记忆层列表（按生命周期排序：短期→长期）
 */
export const ALL_LAYERS: readonly MemoryLayer[] = [
  'working',
  'episodic',
  'semantic',
  'preference',
  'workflow',
] as const;

/**
 * 每层记忆的 TTL（毫秒），-1 表示永久
 */
export const LAYER_TTL: Record<MemoryLayer, number> = {
  working: 30 * 60 * 1000,     // 30 分钟
  episodic: 7 * 24 * 60 * 60 * 1000,  // 7 天
  semantic: -1,                  // 永久
  preference: -1,                // 永久
  workflow: -1,                  // 永久
};

// ═══════════════════════════════════════════════════════════════
// 基础记忆条目
// ═══════════════════════════════════════════════════════════════

/**
 * MemoryEntry — 记忆条目基础结构
 *
 * 所有记忆层共享此结构。
 * 特殊记忆类型通过扩展字段承载额外信息。
 */
export interface MemoryEntry {
  /** 唯一标识 */
  id: string;

  /** 所属记忆层 */
  layer: MemoryLayer;

  /** 记忆内容（文本摘要） */
  content: string;

  /** 扩展元数据 */
  metadata: Record<string, unknown>;

  /** 重要性 0-1（越高越不会被遗忘） */
  importance: number;

  /** 置信度 0-1（系统对此记忆的确定程度） */
  confidence: number;

  /** 创建时间戳 */
  createdAt: number;

  /** 最后访问时间戳 */
  lastAccessedAt: number;

  /** 访问次数 */
  accessCount: number;

  /** 标签 */
  tags: string[];

  /** 向量嵌入（可选，用于相似度搜索） */
  embedding?: number[];
}

// ═══════════════════════════════════════════════════════════════
// 特殊记忆类型
// ═══════════════════════════════════════════════════════════════

/**
 * WorkflowMemoryEntry — 工作流记忆（workflow 层）
 *
 * 从已完成 Mission 中提取的工作流程模式。
 */
export interface WorkflowMemoryEntry extends MemoryEntry {
  layer: 'workflow';

  /** 工作流结构 */
  workflow: {
    /** 工作流名称 */
    name: string;
    /** 执行步骤 */
    steps: string[];
    /** 所属领域（可选） */
    domain?: string;
    /** 使用的工具列表 */
    tools: string[];
    /** 执行频率 */
    frequency: 'once' | 'occasional' | 'regular' | 'daily';
    /** 来源 Mission ID 列表 */
    sourceMissions: string[];
  };
}

/**
 * DecisionMemoryEntry — 决策记忆（semantic 层）
 *
 * 用户的关键决策记录，用于学习决策模式。
 */
export interface DecisionMemoryEntry extends MemoryEntry {
  /** 存储在 semantic 层中 */
  layer: 'semantic';

  /** 决策结构 */
  decision: {
    /** 决策上下文 */
    context: string;
    /** 候选选项 */
    options: string[];
    /** 最终选择 */
    chosen: string;
    /** 决策理由 */
    reasoning: string;
    /** 决策因素及其权重 */
    factors: Record<string, number>;
    /** 决策结果（可选） */
    outcome?: string;
  };
}

/**
 * PreferenceMemoryEntry — 偏好记忆（preference 层）
 */
export interface PreferenceMemoryEntry extends MemoryEntry {
  layer: 'preference';

  /** 偏好结构 */
  preference: {
    /** 偏好类别（如 technology, communication, work_style） */
    category: string;
    /** 偏好键名 */
    key: string;
    /** 偏好值 */
    value: string;
    /** 偏好强度 */
    strength: 'weak' | 'moderate' | 'strong';
  };
}

// ═══════════════════════════════════════════════════════════════
// 记忆查询类型
// ═══════════════════════════════════════════════════════════════

/**
 * MemoryQuery — 记忆查询参数
 */
export interface MemoryQuery {
  /** 搜索文本 */
  text: string;
  /** 目标层（为空则搜索所有层） */
  layers?: MemoryLayer[];
  /** 标签过滤 */
  tags?: string[];
  /** 最低重要性 */
  minImportance?: number;
  /** 结果数量上限 */
  limit?: number;
  /** 时间范围 */
  since?: number;
  until?: number;
}

/**
 * MemoryQueryResult — 记忆查询结果
 */
export interface MemoryQueryResult {
  entries: MemoryEntry[];
  total: number;
  query: MemoryQuery;
}

// ═══════════════════════════════════════════════════════════════
// 统计
// ═══════════════════════════════════════════════════════════════

/**
 * BrainStats — Personal Brain 统计
 */
export interface BrainStats {
  totalEntries: number;
  byLayer: Record<MemoryLayer, number>;
  totalImportance: number;
  averageConfidence: number;
  oldestEntry: number;
  newestEntry: number;
}
