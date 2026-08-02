/**
 * gate/rules/rulePersistence — 规则存取与状态流转（规则维护闭环的写侧）
 *
 * Phase 1 MVP：以 RuleRegistry 静态注册表为存储（进程内）。
 * ⚠️ Phase 2 计划：迁移 L2 ontology（OntologyService.upsertObject + objectTypes 'Rule'），
 *    使规则获得 tier/版本/血缘/持久化 —— 本模块接口保持稳定，迁移只换实现。
 */

import { RuleRegistry } from './RuleRegistry.js';
import type { RuleEntity } from './types.js';

export const rulePersistence = {
  /**
   * saveRule — 保存规则（提炼产物 pending / 人工规则直接 active 均可）
   */
  saveRule(domain: string, rule: RuleEntity): void {
    RuleRegistry.register(domain, rule);
  },

  /**
   * confirmRule — 人工确认提炼规则生效（pending → active，关键安全阀）
   * @returns 是否成功（规则不存在返回 false）
   */
  confirmRule(id: string): boolean {
    const rule = RuleRegistry.getRule(id);
    if (!rule) return false;
    RuleRegistry.setStatus(id, 'active');
    return true;
  },

  /**
   * disableRule — 人工关闭误报规则（active/pending → disabled）
   */
  disableRule(id: string): boolean {
    const rule = RuleRegistry.getRule(id);
    if (!rule) return false;
    RuleRegistry.setStatus(id, 'disabled');
    return true;
  },
};
