/**
 * PolicyRuleRegistry — 合规策略规则注册中心
 * v15: 按领域注册可扩展的合规检查规则
 */
export interface PolicyRule {
  id: string;
  domain: string;
  name: string;
  description: string;
  check: (target: Record<string, unknown>) => Promise<{ pass: boolean; message?: string }>;
  severity: 'ERROR' | 'WARNING' | 'INFO';
}

export class PolicyRuleRegistry {
  private static rules: Map<string, PolicyRule[]> = new Map();

  static register(domain: string, rule: PolicyRule): void {
    const existing = PolicyRuleRegistry.rules.get(domain) || [];
    existing.push(rule);
    PolicyRuleRegistry.rules.set(domain, existing);
  }

  static getRules(domain: string): PolicyRule[] {
    return PolicyRuleRegistry.rules.get(domain) || [];
  }

  static init(): void {
    // ═══ No Domain Logic in Core ═══
    // 领域合规规则已移至对应 Workflow 插件注册
    // （packages/workflows/<domain>/src/rules/），core 仅保留注册机制。
    // 由各插件 bootstrap 在启动时调用 PolicyRuleRegistry.register() 注入领域规则。
  }
}
