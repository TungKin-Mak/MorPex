/**
 * gate/rules — 规则中断更正模块 barrel
 *
 * 功能② Phase 1：确定性规则匹配 + 中断 + 带约束重试 + 连续命中降级。
 */

export * from './types.js';
export { RuleRegistry } from './RuleRegistry.js';
export { normalizeText, normalizePattern } from './normalize.js';
export { check as ruleEnforcementCheck } from './RuleEnforcementGuard.js';
export type { RuleCheckResult } from './types.js';
export { RuleEventTypes } from './ruleEvents.js';
export type { RuleViolationEvent, RuleDowngradedEvent } from './ruleEvents.js';
export { createRuleViolationEvent, createRuleDowngradedEvent } from './ruleEvents.js';
export { extractRule } from './RuleExtractor.js';
export type { RuleExtractorLLM, RuleExtractInput } from './RuleExtractor.js';
export { rulePersistence } from './rulePersistence.js';
