/**
 * Cognitive Runtime Loop — 类型定义
 *
 * Phase 6 / MorPex v8.5: 认知循环的统一上下文与阶段类型。
 *
 * CognitiveLoop 是整个系统的统一入口编排器，
 * 将 Interaction → Cognition → Mission → Learning 串联为一个闭环。
 */

import type { IncomingMessage } from '../../interaction/types.js';
import type { Mission, MissionResult } from '../mission/types.js';
import type { BehaviorProfile } from '../../cognition/twin/BehaviorTwin.js';
import type { DecisionProfile } from '../../cognition/decision/types.js';
import type { PreferenceProfile } from '../../cognition/twin/PreferenceModel.js';

/**
 * CognitiveContext — 一次认知循环的完整上下文
 *
 * 每个阶段产生的数据都累积在此，供后续阶段消费。
 */
export interface CognitiveContext {
  /** 原始用户消息 */
  message: IncomingMessage;

  /** 意图检测结果 */
  intent: DetectedIntent;

  /** 匹配的用户目标 ID 列表 */
  matchedGoals: string[];

  /** 行为画像 */
  behaviorProfile: BehaviorProfile | null;

  /** 决策画像 */
  decisionProfile: DecisionProfile | null;

  /** 偏好画像 */
  preferenceProfile: PreferenceProfile | null;

  /** 创建的 Mission */
  mission: Mission | null;

  /** Mission 执行结果 */
  result: MissionResult | null;

  /** v8.8: 验证结果（VerificationEngine 输出） */
  verificationResult?: { score: number; errors: string[] };

  /** 循环开始时间 */
  startedAt: number;

  /** 循环完成时间 */
  completedAt?: number;

  /** 当前阶段 */
  phase: CognitivePhase;

  /** 执行过程中的错误（非抛出的异常） */
  errors: string[];
}

/**
 * CognitivePhase — 认知循环的各阶段
 *
 * 按顺序流转，每个阶段都会 emit 对应事件。
 * v8.6: 新增 'evolution' 和 'persistence' 阶段。
 */
export type CognitivePhase =
  | 'context_assembly'
  | 'intent_detection'
  | 'goal_matching'
  | 'twin_retrieval'
  | 'mission_creation'
  | 'planning'
  | 'execution'
  | 'learning'
  | 'evolution'
  | 'persistence'
  | 'pipeline_start'
  | 'completed'
  | 'failed';

/**
 * DetectedIntent — 意图检测结果
 *
 * 从用户消息中提取的结构化意图。
 */
export interface DetectedIntent {
  /** 提取的目标描述 */
  goal: string;

  /** 关键词列表 */
  keywords: string[];

  /** 检测到的领域 */
  domain?: string;

  /** 置信度 (0-1) */
  confidence: number;

  /** 是否为新目标（无匹配现有 Goal） */
  isNewGoal: boolean;

  /** 建议的目标层级 */
  suggestedGoalLevel?: 'project' | 'milestone';
}

/**
 * LoopStats — 认知循环统计
 */
export interface LoopStats {
  totalLoops: number;
  successfulLoops: number;
  failedLoops: number;
  averageDurationMs: number;
  learningEvents: number;
  twinUpdates: number;
}


// ═══════════════════════════════════════════════════════════
// ★ v8.5 人控开关：Workflow 候选 + Behavior 漂移
// ═══════════════════════════════════════════════════════════

/** 工作流候选（待人工审批） */
export interface WorkflowCandidateEntry {
  id: string;
  name: string;
  description: string;
  confidence: number;
  /** ★ v8.6: WorkflowSimulator 仿真质量评分 (0-1) */
  qualityScore?: number;
  /** ★ v8.6: 仿真是否通过 */
  simulationPassed?: boolean;
  steps: number;
  sourceMissionIds: string[];
  detectedAt: number;
  status: 'pending' | 'approved' | 'denied';
  approvedBy?: string;
  approvedAt?: number;
}

/** 行为漂移记录（待人工确认） */
export interface BehaviorDriftEntry {
  id: string;
  detectedAt: number;
  changes: string[];
  previousProfile: Record<string, unknown>;
  currentProfile: Record<string, unknown>;
  status: 'pending' | 'accepted' | 'rejected';
  confirmedBy?: string;
  confirmedAt?: number;
}

// ═══════════════════════════════════════════════════════════════
// ★ v8.7 TwinCandidate + Evidence Aggregation
// ═══════════════════════════════════════════════════════════════

/** TwinCandidate — 孪生画像变更候选（需证据充分才自动生效） */
export interface TwinCandidate {
  id: string
  field: string           // 哪个字段被建议修改
  oldValue: string
  newValue: string
  evidence: string[]      // 支持证据（Mission IDs, Event IDs）
  evidenceCount: number   // 多少数据点支持
  confidence: number      // 0-1
  status: 'pending' | 'approved' | 'rejected'
  createdAt: number
  approvedBy?: string
  approvedAt?: number
}

/** EvidenceAggregation — 证据聚合结果 */
export interface EvidenceAggregation {
  field: string
  observations: { value: string; sourceEvent: string; timestamp: number }[]
  currentValue: string
  suggestedValue: string
  voteCount: number           // 多少观察同意此变更
  totalObservations: number   // 总观察数
  consensusRatio: number      // voteCount / totalObservations
}
