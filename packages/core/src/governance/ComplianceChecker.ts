/**
 * ComplianceChecker — 合规检查引擎
 * v15: 按领域执行策略规则检查，返回 PASS/WARNING/BLOCK
 */
import { PolicyRuleRegistry } from './PolicyRuleRegistry.js';

export interface ComplianceResult {
  pass: boolean;
  level: 'PASS' | 'WARNING' | 'BLOCK';
  checks: Array<{ ruleId: string; name: string; pass: boolean; severity: string; message?: string }>;
  blockingIssues: string[];
}

export class ComplianceChecker {
  constructor() {
    PolicyRuleRegistry.init();
  }

  async check(domain: string, target: Record<string, unknown>): Promise<ComplianceResult> {
    const rules = PolicyRuleRegistry.getRules(domain);
    const results = await Promise.all(
      rules.map(async r => {
        const result = await r.check(target);
        return { ruleId: r.id, name: r.name, pass: result.pass, severity: r.severity, message: result.message };
      }),
    );

    const blocking = results.filter(r => !r.pass && r.severity === 'ERROR');
    const warnings = results.filter(r => !r.pass && r.severity === 'WARNING');
    const level: ComplianceResult['level'] = blocking.length > 0 ? 'BLOCK' : warnings.length > 0 ? 'WARNING' : 'PASS';

    return {
      pass: blocking.length === 0,
      level,
      checks: results,
      blockingIssues: blocking.map(b => `[${b.ruleId}] ${b.message || b.name}`),
    };
  }
}
