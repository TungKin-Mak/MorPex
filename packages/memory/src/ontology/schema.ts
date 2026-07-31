/**
 * ontology/schema — 公司本体白名单（薄约定层）
 *
 * 作用（不重复、低耦合）：
 * - 约束 LLM 自动抽取/写入的实体与关系只能落在统一词表内 → 防污染、保证图可检索
 * - 是固定小表（一次性约定），非人工维护配置；领域细节靠 agent 自动抽取实体
 * - 与现有 SystemMetadataGraph 的 EntityType（运行时对象图）职责不同，二者并存
 */

// ── 实体类型白名单（固定公司级 + 编程最小集）─────────────────────────

export const ENTITY_TYPES = [
  // 公司级
  'Product', 'Feature', 'Client', 'Project',
  'ExperiencePattern', 'Rule', 'Person',
  // 编程领域最小集（强规则）
  'Module', 'API', 'File', 'Version', 'Bug', 'Incident',
  // 通用补充
  'Tool', 'Dataset',
] as const;

export type CompanyEntityType = (typeof ENTITY_TYPES)[number];

// ── 关系类型白名单 ────────────────────────────────────────────────────

export const RELATION_TYPES = [
  // 公司级
  'HAS_FEATURE', 'COMPATIBLE_WITH', 'OWNED_BY', 'SERVES',
  'APPLIES_TO', 'DERIVED_FROM',
  // 编程领域（强规则多跳）
  'DEPENDS_ON', 'CALLS', 'IMPLEMENTS', 'BELONGS_TO',
  'SOLVED_BY', 'BROKEN_IN', 'FIXED_IN',
  // 通用
  'RELATED_TO', 'USES',
] as const;

export type CompanyRelationType = (typeof RELATION_TYPES)[number];

// ── 领域 → 允许的实体/关系（图优先检索时缩小搜索范围）────────────────

export const DOMAIN_ONTOLOGY: Record<string, { entities: string[]; relations: string[] }> = {
  code: {
    entities: ['Module', 'API', 'File', 'Version', 'Bug', 'Incident', 'ExperiencePattern'],
    relations: ['DEPENDS_ON', 'CALLS', 'IMPLEMENTS', 'BELONGS_TO', 'SOLVED_BY', 'BROKEN_IN', 'FIXED_IN'],
  },
  product: {
    entities: ['Product', 'Feature', 'Version', 'Client', 'Rule'],
    relations: ['HAS_FEATURE', 'COMPATIBLE_WITH', 'SERVES', 'APPLIES_TO'],
  },
  company: {
    entities: ['Product', 'Client', 'Project', 'ExperiencePattern', 'Rule', 'Person', 'Tool'],
    relations: ['HAS_FEATURE', 'SERVES', 'APPLIES_TO', 'DERIVED_FROM', 'OWNED_BY', 'RELATED_TO', 'USES'],
  },
};

export function isEntityType(t: string): t is CompanyEntityType {
  return (ENTITY_TYPES as readonly string[]).includes(t);
}

export function isRelationType(t: string): t is CompanyRelationType {
  return (RELATION_TYPES as readonly string[]).includes(t);
}

export function entitiesForDomain(domain?: string): string[] {
  return DOMAIN_ONTOLOGY[domain ?? 'company']?.entities ?? [...ENTITY_TYPES];
}

export function relationsForDomain(domain?: string): string[] {
  return DOMAIN_ONTOLOGY[domain ?? 'company']?.relations ?? [...RELATION_TYPES];
}
