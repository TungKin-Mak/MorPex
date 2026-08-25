/**
 * 规则链路提示词资产（P1 缺口 #3·内联 prompt 收编示范批）
 *
 * 从 RuleExtractor.ts / gate/runOntologyGroundedReasoning.ts(semanticJudgement)
 * 内联模板**逐字抽离**（只做资产化，不做文案调优——两件事分开才可回滚）。
 * 修改措辞请直接改本文件；调优记录建议同步 SESSION_LOG。
 *
 * 设计约束：零依赖（无 import）→ 无循环依赖风险；纯字符串/纯函数 → 命名导出可 tree-shaking，未引用分支可被打包器剔除。
 * 覆盖范围（规则合规两条 LLM 链）：
 *   ① 规则提炼：人工审核反馈 → RuleEntity（RuleExtractor）
 *   ② 语义复核：keyword 命中后的第二级 LLM 判断（runOntologyGroundedReasoning.semanticJudgement）
 *
 * 剩余待收编清单见 SESSION_LOG「当前待办」（ReflectionEngine / CompanyFacade 等 12 文件）。
 */

// ═══ ① 规则提炼（原 gate/rules/RuleExtractor.ts 内联）═══

/**
 * RULE_EXTRACT_SYSTEM_PROMPT — 规则提炼系统提示
 *
 * 要求 LLM 把人工审核反馈提炼为一条"禁止性规则"（严格 JSON 输出）。
 */
export const RULE_EXTRACT_SYSTEM_PROMPT = `你是规则提炼器。把人工审核反馈提炼为一条"禁止性规则"。
输出严格 JSON，不要多余文字：
{
  "description": "规则的人话描述（一句话，审计/重试用）",
  "disallowedPattern": "禁止出现的模式（正则；简单禁词用 | 连接多个词，如 Apple|iPhone）",
  "aliases": ["常见代称/变体，如 苹果耳机、air pods"]
}
要求：disallowedPattern 与 aliases 都只提炼"违反反馈意图"的禁止项，不要扩大范围（如反馈只说竞品A，就不要禁所有品牌）。`;

/**
 * buildRuleExtractUserPrompt — 规则提炼 User Prompt
 *
 * @param feedback - 人工审核反馈原话
 * @param domain - 目标领域
 */
export const buildRuleExtractUserPrompt = (feedback: string, domain: string): string =>
  `人工审核反馈：${feedback}\n领域：${domain}`;

// ═══ ② 语义复核（原 gate/runOntologyGroundedReasoning.ts · semanticJudgement 内联）═══

/**
 * SEMANTIC_JUDGEMENT_SYSTEM_PROMPT — 语义复核系统提示
 *
 * ⚠️ 该字符串被 __tests__/gate/rules/semantic-judgement.test.ts 用于区分语义调用，
 *    修改措辞须同步测试常量。
 */
export const SEMANTIC_JUDGEMENT_SYSTEM_PROMPT =
  '你是规则合规审查员。根据规则要求判断内容是否合规。';

/**
 * buildSemanticJudgementUserPrompt — 语义复核 User Prompt
 *
 * @param ruleDescription - 规则 description（自然语言要求）
 * @param keyword - 命中的关键词
 * @param snippet - 输出中涉及关键词的片段（±80 字符上下文）
 */
export const buildSemanticJudgementUserPrompt = (
  ruleDescription: string,
  keyword: string,
  snippet: string,
): string =>
  [
    `规则要求：${ruleDescription}`,
    '',
    `以下输出涉及关键词「${keyword}」：`,
    snippet,
    '',
    '请判断这段输出对该关键词相关内容的处理是否满足规则要求。',
    '若可能违规/需修正 → triggered=true，并给出理由与修正建议；否则 triggered=false。',
    '只输出 JSON：{"triggered":boolean,"reason":"...","suggestion":"..."}',
  ].join('\n');
