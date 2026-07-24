/**
 * Brain 模块类型定义
 */

export interface BrainReflectionState {
  /** 最近任务列表 */
  recentTasks?: Array<{
    goal: string;
    result: 'success' | 'failure';
    duration: number;
    taskId?: string;
  }>;
  /** 当前活跃计划的文字描述 */
  currentPlan?: string;
  /** 部门 ID */
  departmentId?: string;
  /** 记忆快照（最近的内容片段） */
  memorySnapshots?: string[];
  /** 状态时间戳 */
  timestamp: number;
}

export interface BrainReflectionResult {
  /** 洞察列表 */
  insights: Array<{
    type: 'risk' | 'improvement' | 'pattern' | 'warning';
    message: string;
    confidence: number;
  }>;
  /** 风险列表 */
  risks: string[];
  /** 改进建议 */
  suggestions: string[];
  /** 整体置信度 */
  confidence: number;
  /** 完成时间戳 */
  timestamp: number;
  /** 耗时（毫秒） */
  duration: number;
  /** 来源: 'llm' | 'statistical' */
  source: 'llm' | 'statistical';
}

export interface TaskRecord {
  taskId: string;
  goal: string;
  result: 'success' | 'failure';
  duration: number;
  departmentId?: string;
  planUsed?: string;
  capabilities?: string[];
  error?: string;
}

export interface UserFeedback {
  taskId: string;
  rating: number; // 1-5
  comments?: string;
  corrections?: string[];
  timestamp?: number;
}

export interface LearningResult {
  preferencesUpdated: string[];
  patternsLearned: string[];
  confidenceDelta: number;
  timestamp: number;
}

export interface UserPreference {
  key: string;
  weight: number;
  category: 'strategy' | 'style' | 'tool' | 'communication';
  lastUpdated: number;
  source: string;
}
