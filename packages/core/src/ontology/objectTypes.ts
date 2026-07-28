/**
 * objectTypes — 核心 Object Types 定义与校验
 *
 * 迭代2：定义并落地第一批核心 Object Types
 *   Mission / Goal / Artifact / Agent / Capability / SOP / Feedback / Department
 */

/**
 * 核心对象类型列表
 */
export const CORE_OBJECT_TYPES = [
  'Mission',
  'Goal',
  'Artifact',
  'Agent',
  'Capability',
  'SOP',
  'Feedback',
  'Department',
] as const;

export type CoreObjectType = (typeof CORE_OBJECT_TYPES)[number];

/**
 * 核心关系类型
 */
export const CORE_RELATIONS = [
  'requires',           // Mission requires Capability
  'produced_by',        // Artifact produced_by Agent
  'has_capability',     // Agent has Capability
  'belongs_to',         // Agent belongs_to Department
  'derived_from',       // SOP derived_from Mission
  'corrects',           // Feedback corrects Artifact
  'child_of',           // Goal child_of Goal
  'related_to',         // 通用关联
] as const;

export type CoreRelationType = (typeof CORE_RELATIONS)[number];

/**
 * 对象类型 Schema 定义
 */
export interface ObjectTypeSchema {
  type: string;
  requiredProperties: string[];
  optionalProperties?: string[];
  defaultStatus?: string;
}

/**
 * 默认 Schema 集合
 */
export const DEFAULT_SCHEMAS: ObjectTypeSchema[] = [
  {
    type: 'Mission',
    requiredProperties: ['title', 'status'],
    optionalProperties: ['goal', 'departmentId', 'priority'],
    defaultStatus: 'draft',
  },
  {
    type: 'Goal',
    requiredProperties: ['title'],
    optionalProperties: ['parentMissionId', 'domain', 'priority', 'status'],
    defaultStatus: 'active',
  },
  {
    type: 'Artifact',
    requiredProperties: ['title', 'status', 'missionId'],
    optionalProperties: ['contentRef', 'version', 'kind'],
    defaultStatus: 'draft',
  },
  {
    type: 'Agent',
    requiredProperties: ['name', 'status'],
    optionalProperties: ['role', 'reputation', 'departmentId'],
    defaultStatus: 'active',
  },
  {
    type: 'Capability',
    requiredProperties: ['name'],
    optionalProperties: ['inputSchema', 'cost', 'successRate'],
    defaultStatus: 'active',
  },
  {
    type: 'SOP',
    requiredProperties: ['name', 'steps'],
    optionalProperties: ['sourceMissionIds', 'successRate'],
    defaultStatus: 'draft',
  },
  {
    type: 'Feedback',
    requiredProperties: ['targetId', 'rating'],
    optionalProperties: ['expected', 'comment', 'source'],
    defaultStatus: 'recorded',
  },
  {
    type: 'Department',
    requiredProperties: ['name'],
    optionalProperties: ['description', 'type', 'status'],
    defaultStatus: 'active',
  },
];
