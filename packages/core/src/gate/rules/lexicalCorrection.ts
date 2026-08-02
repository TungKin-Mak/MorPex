/**
 * gate/rules/lexicalCorrection — 通用修正管线①：词法修正（Phase 2，保守版）
 *
 * 设计原则（保守，绝不破坏内容）：
 *   - 只处理"该违规规则的 allowedAction 非空 且 payload 是字符串 且违规片段可定位替换"的场景
 *   - 其余违规一律不动（correctedCount=0），交给语义修正（带约束 LLM 重试）
 *   - 任何异常/替换失败 → 返回原 proposal + correctedCount=0，绝不抛错
 *
 * 与语义修正（③）的关系：词法修正是"最便宜的快速通道"，能机械修的先修掉，
 * 修不掉再走 LLM 重试 —— 多领域下领域无需为每条规则配置 allowedAction（非核心）。
 */

import type { OntologyProposal } from '../types.js';
import type { RuleEntity, RuleViolation } from './types.js';

export interface LexicalCorrectionResult {
  /** 修正后的 proposal（未修正时与原对象相同引用） */
  proposal: OntologyProposal;
  /** 成功替换的违规条数（0 = 未修正） */
  correctedCount: number;
}

/**
 * lexicalCorrect — 尝试对违规输出做保守词法修正
 *
 * @param proposal  当前 proposal（normalizeProposal 之后）
 * @param violations 已命中的违规（通常仅 ERROR 违规传入）
 * @param rules     参与本次匹配的规则集（用于按 ruleId 找 allowedAction）
 */
export function lexicalCorrect(
  proposal: OntologyProposal,
  violations: RuleViolation[],
  rules: RuleEntity[],
): LexicalCorrectionResult {
  try {
    // 保守：仅 payload 为字符串时可安全做文本级替换
    if (typeof proposal.payload !== 'string') {
      return { proposal, correctedCount: 0 };
    }

    const rulesById = new Map<string, RuleEntity>(rules.map((r) => [r.id, r]));
    let payload: string = proposal.payload;
    let correctedCount = 0;

    for (const v of violations) {
      const rule = rulesById.get(v.ruleId);
      if (!rule || !rule.allowedAction) continue;
      // 防御：空片段不参与 split/join（避免拆散 payload）
      if (!v.matchedText) continue;

      // matchedText 为规范化片段（可能与原文本大小写/空白不同）；
      // 直接包含替换，定位不到则跳过该条（保守，不猜测修改）
      if (payload.includes(v.matchedText)) {
        payload = payload.split(v.matchedText).join(rule.allowedAction);
        correctedCount++;
      }
    }

    if (correctedCount === 0) {
      return { proposal, correctedCount: 0 };
    }

    return {
      // payload 与 proposal 同义字段同步更新，保证两种读取路径一致
      proposal: { ...proposal, payload, proposal: payload },
      correctedCount,
    };
  } catch {
    // 安全兜底：任何异常都不影响主流程
    return { proposal, correctedCount: 0 };
  }
}
