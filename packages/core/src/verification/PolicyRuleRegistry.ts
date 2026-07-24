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
    PolicyRuleRegistry.register('e-commerce', {
      id: 'restricted_category', domain: 'e-commerce', name: '受限分类检查',
      description: '检查商品是否在 Amazon 受限分类中',
      check: async (t) => ({ pass: !['weapons', 'drugs', 'animals'].includes((t.category as string) || '') }),
      severity: 'ERROR',
    });
    PolicyRuleRegistry.register('e-commerce', {
      id: 'trademark_check', domain: 'e-commerce', name: '商标检查',
      description: '检查标题/描述是否包含注册商标',
      check: async (t) => ({ pass: !/(TM|®|™)/.test((t.title as string) || '') }),
      severity: 'WARNING',
    });
    PolicyRuleRegistry.register('hardware', {
      id: 'fcc_check', domain: 'hardware', name: 'FCC 认证',
      description: '电子产品需要 FCC 认证',
      check: async () => ({ pass: false, message: '需要 FCC 认证 — 请联系合规部门' }),
      severity: 'ERROR',
    });
    PolicyRuleRegistry.register('hardware', {
      id: 'rohs_check', domain: 'hardware', name: 'RoHS 合规',
      description: '产品需符合 RoHS 有害物质限制',
      check: async () => ({ pass: false, message: '需要 RoHS 合规声明' }),
      severity: 'ERROR',
    });
  }
}
