/**
 * gate/rules/detectors — 规则检测器注册表（Phase 2：Detector 接口正式化）
 *
 * 规范驱动（多领域通用）：
 *   - core 提供检测器机制与内置检测器（Regex / ApiWhitelist），领域提供规则内容
 *   - 领域专属检测器（AST/编译/Lint，如 tsc/eslint 适配器）在后续阶段经同一
 *     RuleDetector 接口注册（core 零领域依赖，接口即契约）
 *   - 能"数据化"的匹配（正则/白名单前缀）引擎内置；不能的（AST 逻辑）走接口由领域实现
 *
 * 内置检测器：
 *   - RegexDetector（'regex'）     ：规范化+正则+别名匹配（Phase 1 逻辑迁移）
 *   - ApiWhitelistDetector（'whitelist'）：API 白名单前缀校验（Phase 2，MCU 平台错配场景）
 *   - 'semantic'（LLM 语义复核）暂缺 → Phase 3
 */

import type { OntologyProposal } from '../types.js';
import type { RuleEntity, RuleTarget, RuleType, RuleViolation } from './types.js';
import { normalizePattern, normalizeText } from './normalize.js';

/** RuleDetector — 检测器契约（core 机制 / 领域可经此接口注入专属检测器） */
export interface RuleDetector {
  /** 检测器类型（对应 RuleEntity.ruleType） */
  readonly type: RuleType;
  /** 对单条规则执行检测；命中返回 violation，未命中返回 null（不抛错） */
  check(proposal: OntologyProposal, rule: RuleEntity): RuleViolation | null;
}

/** extractTargetText — 按 target 提取 proposal 的检查文本 */
export function extractTargetText(proposal: OntologyProposal, target: RuleTarget): string {
  switch (target) {
    case 'proposal.payload': {
      const p = proposal.payload ?? proposal.proposal;
      if (typeof p === 'string') return p;
      if (p !== undefined && p !== null) return JSON.stringify(p);
      return '';
    }
    case 'proposal.action_type':
      return proposal.action_type ?? '';
    case 'proposal.raw':
      if (typeof proposal.raw === 'string') return proposal.raw;
      return proposal.raw ? JSON.stringify(proposal.raw) : '';
  }
}

/**
 * RegexDetector — 黑名单正则 + 别名检测（Phase 1 逻辑迁移）
 *
 * 匹配语义（与 normalize.ts 一致）：target 文本与 disallowedPattern/aliases
 * 均经规范化（NFKC+小写+去空白），规则隐含"不区分大小写、无空白"。
 */
export const RegexDetector: RuleDetector = {
  type: 'regex',
  check(proposal, rule) {
    const text = extractTargetText(proposal, rule.target);
    if (!text) return null;

    const matched = matchText(normalizeText(text), rule);
    if (!matched) return null;

    return {
      ruleId: rule.id,
      severity: rule.severity,
      matchedText: matched,
      target: rule.target,
      description: rule.description,
    };
  },
};

/**
 * matchText — 对规范化文本执行匹配（正则 + 别名）
 *
 * @returns 命中的规范化片段；未命中返回 null
 */
function matchText(normText: string, rule: RuleEntity): string | null {
  // 1. aliases 精确包含（规范化后）
  for (const alias of rule.aliases ?? []) {
    const normAlias = normalizeText(alias);
    if (normAlias && normText.includes(normAlias)) return normAlias;
  }

  // 2. disallowedPattern 正则（规范化后 + 'i' 防御）
  if (rule.disallowedPattern) {
    try {
      const re = new RegExp(normalizePattern(rule.disallowedPattern), 'i');
      const m = normText.match(re);
      if (m && m[0]) return m[0];
    } catch {
      // 非法正则 → 跳过该规则（防误伤），不硬崩
    }
  }

  return null;
}

/**
 * ApiWhitelistDetector — API 白名单前缀校验（Phase 2，MCU 平台错配场景）
 *
 * 检测逻辑（纯文本扫描，结构层 AST 版留后续阶段）：
 *   - 提取目标文本中"厂商风格 API token"：`\b[A-Z][A-Za-z0-9]*_[A-Za-z0-9_]*\b`
 *     （含下划线且首字母大写，如 IOCP_W / LL_GPIO_WritePin / HAL_GPIO_Init）
 *   - 取第一个 `_` 前的片段为前缀；前缀不在 allowedApiPrefixes 内 → 违规
 *     （如 IOCP 平台出现 LL_GPIO_WritePin → 前缀 LL 不在白名单 → 命中）
 *   - 纯小写/无下划线标识符不参与（防误报）；无白名单 → 不匹配不抛错
 */
export const ApiWhitelistDetector: RuleDetector = {
  type: 'whitelist',
  check(proposal, rule) {
    const prefixes = rule.allowedApiPrefixes;
    if (!prefixes || prefixes.length === 0) return null;

    const text = extractTargetText(proposal, rule.target);
    if (!text) return null;

    // 前缀比较：大小写不敏感（厂商前缀风格多样，避免误伤）
    const normWhitelist = prefixes.map((p) => p.toLowerCase());
    const tokenRe = /\b[A-Z][A-Za-z0-9]*_[A-Za-z0-9_]*\b/g;

    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(text)) !== null) {
      const token = m[0];
      const prefix = token.split('_')[0];
      if (!normWhitelist.includes(prefix.toLowerCase())) {
        return {
          ruleId: rule.id,
          severity: rule.severity,
          matchedText: token,
          target: rule.target,
          description: `疑似非本平台 API：${token}（前缀 ${prefix} 不在白名单 ${prefixes.join('/')}）`,
        };
      }
    }

    return null;
  },
};

/** detectorRegistry — 内置检测器注册表（按 ruleType 分派） */
export const detectorRegistry: Partial<Record<RuleType, RuleDetector>> = {
  regex: RegexDetector,
  whitelist: ApiWhitelistDetector,
  // semantic: Phase 3 —— LLM 语义复核检测器（届时经接口注入）
};
