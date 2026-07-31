/**
 * gate/domain — 公司知识域判定
 *
 * 默认保守：未显式声明 domain 一律视为公司知识域（强制检索）。
 * 仅明确 'general' 才放行通用生成路径（可选仍做检索增强）。
 */

export function isCompanyKnowledgeDomain(domain?: string): boolean {
  if (!domain) return true; // 缺省 → 公司域（强制）
  return domain !== 'general';
}

/** 需要"图优先、episodic 不当事实"的强规则域（编程/产品/公司事实） */
export function requiresGraphFacts(domain?: string): boolean {
  if (!domain) return true;
  return ['company', 'product', 'code', 'ecommerce', 'ops'].includes(domain);
}
