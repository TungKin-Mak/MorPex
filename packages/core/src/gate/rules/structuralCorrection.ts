/**
 * structuralCorrection — 通用修正管线②结构层（Phase 2 第二批）
 *
 * 与词法修正（lexicalCorrection，机械替换）互补：结构修正面向"AST/编译/类型校验后
 * 自动修复"（eslint --fix 式）。core 只提供：
 *   - StructuralCorrector 接口（契约）
 *   - StructuralCorrectionRegistry 注册机制（领域插件注入，如 software eslint/tsc 适配器）
 *   - applyStructuralCorrection 引擎内统一入口（词法修正后挂载，见 runOntologyGroundedReasoning）
 *
 * 架构边界：core 零领域依赖——eslint/tsc 适配器由 packages/workflows/software 等
 * 领域插件在 bootstrap 时 registerCorrector 注入（与 DetectorRegistry 同模式）。
 *
 * @packageDocumentation
 */

import type { OntologyProposal } from '../types.js';
import type { RuleEntity, RuleViolation } from './types.js';

// ── 契约 ──

/**
 * StructuralCorrector — 结构修正器契约
 *
 * 领域插件实现此接口并注册（StructuralCorrectionRegistry.registerCorrector）。
 * 引擎在词法修正后、降级/LLM 重试前调用 applyStructuralCorrection：
 *   能处理的违规规则 → correct() 产出修正后的 proposal → 引擎重新 check → 合规放行。
 */
export interface StructuralCorrector {
  /** 修正器标识（日志/审计用；如 'eslint' / 'tsc'） */
  readonly type: string;
  /** 是否能处理该规则（按 rule.ruleType / rule.id / domain 判断） */
  canHandle(rule: RuleEntity): boolean;
  /**
   * 执行结构修正。
   * @param proposal   当前提案（可直接原地改引用或返回新对象）
   * @param violations 本轮 ERROR 违规（只含本修正器能处理规则的相关违规）
   * @param rules      全部 active 规则（上下文参考）
   * @returns 修正后的 proposal + 修正计数（0 = 未能修正，引擎继续升级路径）
   */
  correct(
    proposal: OntologyProposal,
    violations: RuleViolation[],
    rules: RuleEntity[],
  ): Promise<{ proposal: OntologyProposal; correctedCount: number; note?: string }>;
}

// ── 注册表 ──

/** StructuralCorrectionRegistry — 结构修正器注册表（领域插件注入） */
export class StructuralCorrectionRegistry {
  private static correctors: Map<string, StructuralCorrector> = new Map();

  /** registerCorrector — 注册修正器（同 type 覆盖，幂等） */
  static registerCorrector(type: string, corrector: StructuralCorrector): void {
    StructuralCorrectionRegistry.correctors.set(type, corrector);
  }

  /** getCorrectors — 全部已注册修正器（注入顺序） */
  static getCorrectors(): StructuralCorrector[] {
    return [...StructuralCorrectionRegistry.correctors.values()];
  }

  /** has — 是否已注册 */
  static has(type: string): boolean {
    return StructuralCorrectionRegistry.correctors.has(type);
  }

  /** clear — 清空注册表（测试隔离用） */
  static clear(): void {
    StructuralCorrectionRegistry.correctors.clear();
  }
}

// ── 引擎统一入口 ──

export interface StructuralCorrectionResult {
  proposal: OntologyProposal;
  correctedCount: number;
  notes: string[];
}

/**
 * applyStructuralCorrection — 引擎统一入口
 *
 * 对违规涉及的规则，逐个尝试已注册修正器（canHandle 命中则 correct）。
 * 所有修正器都不适用/未修正 → 原样返回（correctedCount=0，引擎继续降级/LLM 重试路径）。
 *
 * ⚠️ 防抖：单次调用最多修正 maxPasses 轮（每轮重新筛选仍违规的规则），
 * 防止修正器循环改写导致死循环。
 */
export async function applyStructuralCorrection(
  proposal: OntologyProposal,
  errorViolations: RuleViolation[],
  rules: RuleEntity[],
  maxPasses = 2,
): Promise<StructuralCorrectionResult> {
  const correctors = StructuralCorrectionRegistry.getCorrectors();
  if (correctors.length === 0) {
    return { proposal, correctedCount: 0, notes: [] };
  }

  const notes: string[] = [];
  let correctedCount = 0;
  let current = proposal;

  // 违规涉及的可处理规则（按规则去重）
  const relevantRuleIds = new Set(errorViolations.map(v => v.ruleId));
  const relevantRules = rules.filter(r => relevantRuleIds.has(r.id));

  for (let pass = 0; pass < maxPasses; pass++) {
    let passCorrected = 0;
    for (const corrector of correctors) {
      const handled = relevantRules.filter(r => corrector.canHandle(r));
      if (handled.length === 0) continue;

      // 只传本修正器可处理规则的违规
      const handledIds = new Set(handled.map(r => r.id));
      const violations = errorViolations.filter(v => handledIds.has(v.ruleId));
      if (violations.length === 0) continue;

      try {
        const result = await corrector.correct(current, violations, rules);
        if (result.correctedCount > 0) {
          current = result.proposal;
          passCorrected += result.correctedCount;
          if (result.note) notes.push(`[${corrector.type}] ${result.note}`);
        }
      } catch (err) {
        // 修正器异常不阻断（升级路径兜底）
        console.warn(`[StructuralCorrection] ⚠️ 修正器 ${corrector.type} 执行失败: ${(err as Error).message}`);
      }
    }
    if (passCorrected === 0) break;
    correctedCount += passCorrected;
  }

  return { proposal: current, correctedCount, notes };
}
