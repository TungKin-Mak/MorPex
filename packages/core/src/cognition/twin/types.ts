/**
 * Personal Twin Graph — 数据类型定义
 *
 * Phase 5 / MorPex v8: 用户孪生图谱的数据模型。
 *
 * 设计原则：
 *   1. 所有节点类型对应真实世界实体的认知形态
 *   2. 所有边类型对应真实世界关系和决策模式
 *   3. 置信度（confidence）标识系统对每个信息的把握程度
 *   4. 来源（source）标识信息来自显式输入、提取还是推理
 *
 * 节点类型：
 *   user       — 用户本体
 *   goal       — 用户目标（长期/短期）
 *   project    — 用户项目
 *   person     — 用户协作的人
 *   preference — 用户偏好（技术/沟通/工具等）
 *   decision   — 用户决策模式
 *   experience — 用户经历/经验
 *   workflow   — 用户工作流
 *
 * 边类型：
 *   likes       — 喜欢（user → preference/technology）
 *   prefers    — 偏好（user → preference）
 *   works_with — 协作（user → person）
 *   decides_by — 决策依据（decision → factor）
 *   belongs_to — 属于（goal/project → user）
 *   depends_on — 依赖（workflow → workflow, goal → goal）
 *   related_to — 关联（通用关系）
 *   experienced— 经历（user → experience）
 */

// ═══════════════════════════════════════════════════════════════
// TwinNodeType — 孪生节点类型
// ═══════════════════════════════════════════════════════════════

/** 孪生节点类型枚举 */
export type TwinNodeType =
  | 'user'
  | 'goal'
  | 'project'
  | 'person'
  | 'preference'
  | 'decision'
  | 'experience'
  | 'workflow';

// ═══════════════════════════════════════════════════════════════
// TwinEdgeType — 孪生关系类型
// ═══════════════════════════════════════════════════════════════

/** 孪生关系类型枚举 */
export type TwinEdgeType =
  | 'likes'
  | 'prefers'
  | 'works_with'
  | 'decides_by'
  | 'belongs_to'
  | 'depends_on'
  | 'related_to'
  | 'experienced';

// ═══════════════════════════════════════════════════════════════
// TwinNode — 孪生节点（基础接口）
// ═══════════════════════════════════════════════════════════════

/** 孪生节点 */
export interface TwinNode {
  /** 唯一标识 */
  id: string;
  /** 节点类型 */
  type: TwinNodeType;
  /** 人类可读名称 */
  label: string;
  /** 可选描述 */
  description?: string;
  /** 类型特定的属性 */
  properties: Record<string, unknown>;
  /** 置信度 0-1（系统对该信息的把握程度） */
  confidence: number;
  /** 来源（'explicit' | 'extracted' | 'inferred' 或自定义） */
  source: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 最后更新时间戳 */
  updatedAt: number;
  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// TwinEdge — 孪生关系边
// ═══════════════════════════════════════════════════════════════

/** 孪生关系边 */
export interface TwinEdge {
  /** 唯一标识 */
  id: string;
  /** 关系类型 */
  type: TwinEdgeType;
  /** 源节点 ID */
  sourceId: string;
  /** 目标节点 ID */
  targetId: string;
  /** 关系强度 0-1 */
  weight: number;
  /** 置信度 0-1 */
  confidence: number;
  /** 支持这一关系的证据列表 */
  evidence: string[];
  /** 创建时间戳 */
  createdAt: number;
  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// 类型特定的属性接口
// ═══════════════════════════════════════════════════════════════

/** 用户节点属性 */
export interface UserProperties {
  name: string;
  role?: string;
  industry?: string;
  expertiseAreas: string[];
  communicationStyle?: string;
  riskTolerance?: 'low' | 'medium' | 'high';
}

/** 目标节点属性 */
export interface GoalProperties {
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'active' | 'completed' | 'abandoned';
  deadline?: number;
  parentGoalId?: string;
  progress: number; // 0-100
}

/** 项目节点属性 */
export interface ProjectProperties {
  name: string;
  status: 'planning' | 'active' | 'completed' | 'paused';
  technologies: string[];
  teamSize?: number;
  deadline?: number;
}

/** 决策节点属性 */
export interface DecisionProperties {
  context: string;
  options: string[];
  chosen: string;
  reasoning: string;
  outcome?: string;
  factors: Record<string, number>; // factor → weight
}

/** 偏好节点属性 */
export interface PreferenceProperties {
  category: string; // 'technology', 'communication', 'work_style', 'tool' 等
  key: string;
  value: string;
  strength: 'weak' | 'moderate' | 'strong';
}

/** 工作流节点属性 */
export interface WorkflowProperties {
  name: string;
  steps: string[];
  frequency: 'once' | 'occasional' | 'regular' | 'daily';
  domain?: string;
  tools: string[];
}

/** 经历节点属性 */
export interface ExperienceProperties {
  summary: string;
  domain: string;
  duration?: number; // 时长（毫秒）
  outcome: 'success' | 'partial' | 'failure';
  lessons: string[];
}

// ═══════════════════════════════════════════════════════════════
// 查询与统计
// ═══════════════════════════════════════════════════════════════

/** 孪生图谱查询 */
export interface TwinQuery {
  nodeType?: TwinNodeType;
  edgeType?: TwinEdgeType;
  label?: string;
  tags?: string[];
  confidence?: { min?: number; max?: number };
  since?: number;
  until?: number;
  limit?: number;
}

/** 孪生图谱统计 */
export interface TwinStats {
  totalNodes: number;
  totalEdges: number;
  byNodeType: Record<string, number>;
  byEdgeType: Record<string, number>;
  averageConfidence: number;
}

/** 决策画像（高级查询结果） */
export interface DecisionProfile {
  riskTolerance: string;
  commonFactors: string[];
  recentDecisions: TwinNode[];
  decisionCount: number;
}

/** 子图结果 */
export interface SubgraphResult {
  nodes: TwinNode[];
  edges: TwinEdge[];
}

/** 洞察结果 */
export interface TwinInsight {
  type: 'preference' | 'pattern' | 'change' | 'recommendation';
  title: string;
  description: string;
  confidence: number;
  relatedNodeIds: string[];
}
