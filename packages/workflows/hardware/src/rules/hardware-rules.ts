/**
 * Hardware 领域合规规则（理想架构第 9 层 — No Domain Logic in Core）
 *
 * 从 core `verification/PolicyRuleRegistry` 迁移而来的硬件合规规则
 * （FCC / RoHS）。core 仅保留通用注册机制。
 */

import { PolicyRuleRegistry } from '@morpex/core';

/**
 * registerHardwareRules — 注册硬件领域合规规则（幂等）
 *
 * 由 bootstrapHardwareWorkflow 在启动时调用；core init() 不再播种这些领域规则。
 */
export function registerHardwareRules(): void {
  PolicyRuleRegistry.register('hardware', {
    id: 'fcc_check',
    domain: 'hardware',
    name: 'FCC 认证',
    description: '电子产品需要 FCC 认证',
    check: async () => ({ pass: false, message: '需要 FCC 认证 — 请联系合规部门' }),
    severity: 'ERROR',
  });
  PolicyRuleRegistry.register('hardware', {
    id: 'rohs_check',
    domain: 'hardware',
    name: 'RoHS 合规',
    description: '产品需符合 RoHS 有害物质限制',
    check: async () => ({ pass: false, message: '需要 RoHS 合规声明' }),
    severity: 'ERROR',
  });
}
