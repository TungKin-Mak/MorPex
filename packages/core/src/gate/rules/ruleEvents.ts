/**
 * gate/rules/ruleEvents — 规则中断更正事件（仿 gate/ontologyEvents 模式）
 *
 * 事件命名空间：gate.rule.*（字符串字面量，不走 EventType 枚举 —— 与 ontology.* 一致）
 * 用途：违规/降级可观测 + 审计 + 演化队列消费。
 */

import type { BaseEvent } from '../../infrastructure/protocol/events/BaseEvent.js';

/** 规则事件类型常量 */
export const RuleEventTypes = {
  /** 规则违规（ERROR 重试失败 / WARNING 记录） */
  Violation: 'gate.rule.violation',
  /** 规则被临时降级（连续命中防误报卡死） */
  Downgraded: 'gate.rule.downgraded',
} as const;

export type RuleEventType = (typeof RuleEventTypes)[keyof typeof RuleEventTypes];

/** RuleViolationEvent — 规则违规事件 */
export interface RuleViolationEvent extends BaseEvent {
  type: 'gate.rule.violation';
  payload: {
    executionId: string;
    missionId?: string;
    goal: string;
    ruleId: string;
    ruleDomain: string;
    severity: 'ERROR' | 'WARNING';
    matchedText: string;
    target: string;
    description: string;
    /** 重试是否已用尽（true=转人工） */
    retriesExhausted: boolean;
    /** 命中的关键词（keyword 规则，可选） */
    keyword?: string;
    /** 语义判断理由（keyword 规则触发时，可选） */
    semanticReason?: string;
    /** 语义判断修正建议（keyword 规则触发时，可选） */
    semanticSuggestion?: string;
    timestamp: number;
  };
}

/** RuleDowngradedEvent — 规则临时降级事件 */
export interface RuleDowngradedEvent extends BaseEvent {
  type: 'gate.rule.downgraded';
  payload: {
    executionId: string;
    missionId?: string;
    goal: string;
    ruleId: string;
    ruleDomain: string;
    reason: 'consecutive_hits';
    hitCount: number;
    timestamp: number;
  };
}

/**
 * createRuleViolationEvent — 创建规则违规事件
 */
export function createRuleViolationEvent(
  executionId: string,
  input: {
    missionId?: string;
    goal: string;
    ruleId: string;
    ruleDomain: string;
    severity: 'ERROR' | 'WARNING';
    matchedText: string;
    target: string;
    description: string;
    retriesExhausted: boolean;
    keyword?: string;
    semanticReason?: string;
    semanticSuggestion?: string;
  },
): RuleViolationEvent {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'gate.rule.violation',
    timestamp: Date.now(),
    executionId,
    source: 'rule-enforcement',
    payload: {
      executionId,
      missionId: input.missionId,
      goal: input.goal,
      ruleId: input.ruleId,
      ruleDomain: input.ruleDomain,
      severity: input.severity,
      matchedText: input.matchedText,
      target: input.target,
      description: input.description,
      retriesExhausted: input.retriesExhausted,
      keyword: input.keyword,
      semanticReason: input.semanticReason,
      semanticSuggestion: input.semanticSuggestion,
      timestamp: Date.now(),
    },
  };
}

/**
 * createRuleDowngradedEvent — 创建规则临时降级事件
 */
export function createRuleDowngradedEvent(
  executionId: string,
  input: {
    missionId?: string;
    goal: string;
    ruleId: string;
    ruleDomain: string;
    hitCount: number;
  },
): RuleDowngradedEvent {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'gate.rule.downgraded',
    timestamp: Date.now(),
    executionId,
    source: 'rule-enforcement',
    payload: {
      executionId,
      missionId: input.missionId,
      goal: input.goal,
      ruleId: input.ruleId,
      ruleDomain: input.ruleDomain,
      reason: 'consecutive_hits',
      hitCount: input.hitCount,
      timestamp: Date.now(),
    },
  };
}
