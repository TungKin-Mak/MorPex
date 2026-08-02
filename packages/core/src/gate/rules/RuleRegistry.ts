/**
 * gate/rules/RuleRegistry — 规则注册表（core 机制，领域插件注入内容）
 *
 * 仿 governance/PolicyRuleRegistry 静态注册表模式：
 *   - core 仅提供 register / 查询机制，零领域逻辑
 *   - 领域插件在 bootstrap 时调用 register 注入规则（core 零领域依赖链路）
 *   - pending 状态规则不参与匹配（getActiveRules 只返回 active）
 *
 * ⚠️ 静态注册表为进程内存储（Phase 1 MVP）；
 *    Phase 2 可迁移 L2 ontology（OntologyService.upsertObject + objectTypes 'Rule'）。
 */

import type { RuleEntity, RuleStatus } from './types.js';

export class RuleRegistry {
  private static rules: Map<string, RuleEntity> = new Map();
  private static byDomain: Map<string, string[]> = new Map();

  /**
   * register — 注册一条规则（同 id 覆盖；幂等）
   */
  static register(domain: string, rule: RuleEntity): void {
    const entity: RuleEntity = { ...rule, id: rule.id || `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, domain };
    RuleRegistry.rules.set(entity.id, entity);
    const ids = RuleRegistry.byDomain.get(domain) ?? [];
    if (!ids.includes(entity.id)) ids.push(entity.id);
    RuleRegistry.byDomain.set(domain, ids);
  }

  /**
   * registerMany — 批量注册（领域 bootstrap 常用）
   */
  static registerMany(domain: string, rules: RuleEntity[]): void {
    for (const r of rules) RuleRegistry.register(domain, r);
  }

  /**
   * getActiveRules — 获取生效规则
   *
   * @param domain 可选；不传返回全部 active（Phase 1 运行时无可靠 domain 信号，
   *               runOntologyGroundedReasoning 按全局匹配；Phase 2 按 domain 路由）
   */
  static getActiveRules(domain?: string): RuleEntity[] {
    const ids = domain ? (RuleRegistry.byDomain.get(domain) ?? []) : [...RuleRegistry.rules.keys()];
    return ids
      .map((id) => RuleRegistry.rules.get(id))
      .filter((r): r is RuleEntity => !!r && r.status === 'active');
  }

  /** getRule — 按 id 取规则 */
  static getRule(id: string): RuleEntity | undefined {
    return RuleRegistry.rules.get(id);
  }

  /** getAll — 全部规则（含 pending/disabled，治理用） */
  static getAll(): RuleEntity[] {
    return [...RuleRegistry.rules.values()];
  }

  /**
   * setStatus — 状态流转（pending→active 人工确认；active→disabled 关闭误报规则）
   */
  static setStatus(id: string, status: RuleStatus): void {
    const rule = RuleRegistry.rules.get(id);
    if (rule) RuleRegistry.rules.set(id, { ...rule, status });
  }

  /** isRuleActive — 是否生效 */
  static isRuleActive(id: string): boolean {
    const r = RuleRegistry.rules.get(id);
    return !!r && r.status === 'active';
  }

  /** clear — 清空注册表（测试隔离用） */
  static clear(): void {
    RuleRegistry.rules.clear();
    RuleRegistry.byDomain.clear();
  }
}
