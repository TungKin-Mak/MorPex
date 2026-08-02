/**
 * Software 领域自定义检测器示例（功能② Phase 2 — DetectorRegistry 领域注入链路）
 *
 * 演示"领域注入自定义检测器"：
 *   - core 只提供 RuleDetector 接口 + DetectorRegistry 注册机制（零领域依赖）
 *   - 领域在 bootstrap 时 registerDetector + RuleRegistry.register 规则
 *   - RuleEnforcementGuard.check 分派：core 内置查不到 → 回退 DetectorRegistry
 *
 * ForbiddenEvalDetector：禁止代码中出现 eval( / Function( 动态执行调用。
 * 文本级轻量实现（演示链路，不引 AST 依赖）；完整 AST/tsc/eslint 适配器为后续增强。
 */

import { DetectorRegistry, RuleRegistry, type RuleDetector, type RuleEntity } from '@morpex/core';
import type { OntologyProposal } from '@morpex/core';

const DOMAIN = 'software';
const DETECTOR_TYPE = 'custom:no-eval';

/** ForbiddenEvalDetector — 检测 eval/Function 动态执行（安全规则） */
const ForbiddenEvalDetector: RuleDetector = {
  type: DETECTOR_TYPE as RuleEntity['ruleType'],
  check(proposal: OntologyProposal, rule: RuleEntity) {
    const payload = proposal.payload ?? proposal.proposal;
    if (typeof payload !== 'string' || !payload) return null;

    // 文本级匹配：eval( / Function( 调用（不区分大小写，防止 eval( 变形）
    const m = payload.match(/\b(eval|Function)\s*\(/i);
    if (!m) return null;

    return {
      ruleId: rule.id,
      severity: rule.severity,
      matchedText: m[0],
      target: rule.target,
      description: rule.description,
    };
  },
};

/**
 * registerSoftwareDetectors — 注册自定义检测器 + 规则（幂等，bootstrap 调用）
 */
export function registerSoftwareDetectors(): void {
  // 1. 注入自定义检测器（同 type 覆盖，幂等）
  DetectorRegistry.registerDetector(DETECTOR_TYPE, ForbiddenEvalDetector);

  // 2. 注册规则（默认 pending：待人工确认生效，不跨域误伤）
  RuleRegistry.register(DOMAIN, {
    id: 'no_dynamic_code_exec',
    title: '禁止动态代码执行',
    tier: 'tier-1',
    domain: DOMAIN,
    severity: 'ERROR',
    ruleType: DETECTOR_TYPE,
    target: 'proposal.payload',
    disallowedPattern: '',
    priority: 90,
    status: 'pending',
    source: 'manual',
    description: '生成的代码禁止出现 eval() / Function() 动态执行调用（安全风险）',
  });

  console.log(`[Workflow:software] ✅ 自定义检测器已注入（${DETECTOR_TYPE}）+ 规则 pending 待确认`);
}
