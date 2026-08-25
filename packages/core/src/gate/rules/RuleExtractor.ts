/**
 * gate/rules/RuleExtractor — 审核反馈 → LLM 提炼规则（规则维护闭环）
 *
 * 用户核心需求：人工审核 LLM 输出时顺口说一句（"文案别出现竞品名字"），
 * 系统提炼成 RuleEntity（status='pending'），人工确认后生效（见 rulePersistence.confirmRule）。
 *
 * 安全阀：提炼 ≠ 生效 —— 产物永远是 pending，须人工确认才 active；
 * 提炼失败（JSON 解析失败）→ 返回兜底占位规则（disallowedPattern=''，仍 pending），不硬崩。
 */

import type { RuleEntity } from './types.js';
import {
  RULE_EXTRACT_SYSTEM_PROMPT,
  buildRuleExtractUserPrompt,
} from './rule-prompts.js';

/** LLM 接口（与 runOntologyGroundedReasoning 的 piBridge 同构） */
export interface RuleExtractorLLM {
  generateText(params: {
    system?: string;
    prompt: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ text: string }>;
}

/** 提炼输入：人工反馈原话 + 目标领域 */
export interface RuleExtractInput {
  feedback: string;
  domain: string;
}

/**
 * extractRule — 提炼规则（返回 pending 规则，须人工确认）
 */
export async function extractRule(input: RuleExtractInput, llm: RuleExtractorLLM): Promise<RuleEntity> {
  const base: RuleEntity = {
    id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tier: 'tier-1',
    domain: input.domain,
    severity: 'ERROR',
    ruleType: 'regex',
    target: 'proposal.payload',
    disallowedPattern: '',
    priority: 100,
    status: 'pending',
    source: 'review_extraction',
    description: input.feedback,
    extractedFrom: input.feedback,
  };

  try {
    const res = await llm.generateText({
      system: RULE_EXTRACT_SYSTEM_PROMPT,
      prompt: buildRuleExtractUserPrompt(input.feedback, input.domain),
      temperature: 0.2,
    });
    const parsed = parseExtractionJson(res.text);
    if (!parsed) return base; // 解析失败 → 兜底 pending 占位

    return {
      ...base,
      description: parsed.description || input.feedback,
      disallowedPattern: parsed.disallowedPattern ?? '',
      aliases: Array.isArray(parsed.aliases) ? parsed.aliases.filter((a): a is string => typeof a === 'string') : [],
    };
  } catch {
    return base; // LLM 调用失败 → 兜底 pending 占位，交给人工
  }
}

/** 提取最外层平衡 JSON 并解析（复用与 runOntologyGroundedReasoning 相同的健壮策略） */
function parseExtractionJson(raw: string): { description?: string; disallowedPattern?: string; aliases?: string[] } | null {
  const startIdx = raw.indexOf('{');
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(raw.substring(startIdx, i + 1));
          return {
            description: typeof parsed.description === 'string' ? parsed.description : undefined,
            disallowedPattern: typeof parsed.disallowedPattern === 'string' ? parsed.disallowedPattern : undefined,
            aliases: Array.isArray(parsed.aliases) ? parsed.aliases : undefined,
          };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
