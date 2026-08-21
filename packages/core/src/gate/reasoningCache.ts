/**
 * reasoningCache — Grounded Reasoning 结果缓存（自 runOntologyGroundedReasoning 拆分）
 *
 * 只缓存简单目标（goal < 80 字符），缓存 5 分钟；tier-0 禁缓存；LRU 50 条；
 * 规则指纹并入 key（规则变更→指纹变→旧缓存天然失效）。
 */
import { RuleRegistry } from './rules/RuleRegistry.js';
import type { RiskTier } from './types.js';
import type { GroundedReasoningResult } from './runOntologyGroundedReasoning.js';

/**
 * 简单 LRU 缓存：key = goal_hash, value = GroundedReasoningResult
 * 只缓存简单目标（goal < 80 字符），缓存时间 5 分钟
 */
const groundingCache = new Map<string, { result: GroundedReasoningResult; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟
const CACHE_MAX_SIZE = 50;

export function getCacheKey(goal: string, scenario?: string, riskTier?: RiskTier): string {
  // 只对短目标启用缓存
  if (goal.length > 80) return '';
  // tier-0 禁止缓存：资金/对外发布/架构变更必须强制两阶段 + 同步验证
  if (riskTier === 'tier-0') return '';
  // Phase 2（D）：规则指纹并入 key —— 规则变更 → fingerprint 变 → 旧缓存天然失效，
  // 避免"命中旧缓存跳过新规则检查"（规则更新后旧缓存可能携带违规结果）
  const ruleFingerprint = RuleRegistry.fingerprint();
  const fpPart = ruleFingerprint ? `::rules:${ruleFingerprint}` : '';
  return `${riskTier || 'tier-1'}::${scenario || ''}::${goal}${fpPart}`;
}

export function getCachedResult(key: string): GroundedReasoningResult | null {
  const entry = groundingCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    groundingCache.delete(key);
    return null;
  }
  return entry.result;
}

/**
 * countTokens — LLM 调用 token 计数（Phase 2 第二批：精确计费）
 * 真实 usage.total 优先；缺失时回退估算 ceil((prompt+text)/4)（兼容旧 piBridge 结构）。
 */
export function countTokens(
  res: { text: string; usage?: { input?: number; output?: number; total?: number } } | null | undefined,
  promptText: string,
): number {
  if (typeof res?.usage?.total === 'number' && res.usage.total > 0) return res.usage.total;
  return Math.ceil((promptText.length + (res?.text?.length ?? 0)) / 4);
}

export function setCachedResult(key: string, result: GroundedReasoningResult): void {
  if (!key) return;
  // LRU 淘汰
  if (groundingCache.size >= CACHE_MAX_SIZE) {
    const oldest = [...groundingCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) groundingCache.delete(oldest[0]);
  }
  groundingCache.set(key, { result, timestamp: Date.now() });
}
