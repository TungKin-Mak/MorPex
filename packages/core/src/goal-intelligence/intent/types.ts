/**
 * Intent Plugin — 类型定义
 *
 * 意图理解 + 澄清系统的核心类型。
 */

// ── 意图类型 ──

/** 用户意图分类 */
export type IntentType = 'directive' | 'query' | 'ambiguous' | 'chat';

/** 领域识别 */
export type Domain = 'software' | 'video' | 'ecommerce' | 'general';

// ── 意图解析结果 ──

/** 意图解析结果 */
export interface IntentResult {
  /** 原始用户输入 */
  rawInput: string;
  /** 意图分类 */
  type: IntentType;
  /** 置信度 0-1 */
  confidence: number;
  /** 识别到的领域 */
  domain: Domain;
  /** 提取的目标描述（结构化后的用户目标） */
  goal: string;
  /** 关键实体提取 */
  entities?: Record<string, string[]>;
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
}

// ── 澄清问题 ──

/** 澄清问题 */
export interface ClarificationQuestion {
  id: string;
  /** 问题文本 */
  question: string;
  /** 问题类型 */
  type: 'choice' | 'open' | 'confirm';
  /** 选项（choice 类型时） */
  options?: string[];
  /** 问题对应的意图维度 */
  targets: Array<'goal' | 'domain' | 'scope' | 'constraint'>;
}

// ── 澄清会话 ──

/** 澄清会话状态 */
export interface ClarificationSession {
  id: string;
  /** 原始输入 */
  rawInput: string;
  /** 已提出的问题 */
  questions: ClarificationQuestion[];
  /** 已收集的答案 */
  answers: Map<string, string>;
  /** 当前状态 */
  state: 'pending' | 'active' | 'resolved' | 'abandoned';
  /** 创建时间 */
  createdAt: number;
  /** 最后活动时间 */
  lastActivity: number;
  /** 重试次数 */
  retryCount: number;
}

// ── 意图事件（EventBus 广播用） ──

/** 意图解析事件载荷 */
export interface IntentResolvedPayload {
  intent: IntentResult;
  processingTime: number;
}

/** 意图需澄清事件载荷 */
export interface IntentNeedsClarificationPayload {
  sessionId: string;
  rawInput: string;
  questions: ClarificationQuestion[];
}

/** 意图被拒事件载荷 */
export interface IntentRejectedPayload {
  rawInput: string;
  reason: string;
  confidence: number;
}

/** 澄清已恢复事件载荷 */
export interface IntentClarifiedPayload {
  sessionId: string;
  originalInput: string;
  finalIntent: IntentResult;
}

// ── 配置 ──

/** Intent Plugin 配置 */
export interface IntentPluginConfig {
  /** 直接执行阈值（默认 0.85） */
  directThreshold?: number;
  /** 需澄清阈值（默认 0.6） */
  clarifyThreshold?: number;
  /** 最大澄清轮次（默认 3） */
  maxClarificationRounds?: number;
  /** 澄清超时（毫秒，默认 120000） */
  clarificationTimeout?: number;
  /** LLM 模型名 */
  model?: string;
}

// ── Intent Resolver 上下文 ──

/** Intent Resolver 依赖 */
export interface IntentResolverDeps {
  /** 可选：领域提示词 */
  domainHints?: string[];
  /** LLM 调用函数 */
  callLLM?: (prompt: string) => Promise<string>;
}
