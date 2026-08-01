import { queryCompanyKnowledge } from '../../knowledge/memory/CompanyKnowledge.js';

/**
 * ontologyTools — Ontology LLM 工具定义 + 执行器
 *
 * 迭代1：暴露 4 个 ontology_* 工具给 LLM
 *   - ontology_queryObjects
 *   - ontology_getObject
 *   - ontology_getRelated
 *   - ontology_getCurrentState
 */

import type { OntologyService } from '../../knowledge/ontology/OntologyService.js';
import type { ForcedQueryGuard } from '../../gate/ForcedQueryGuard.js';

/**
 * ontologyToolDefinitions — 工具定义（用于注入 LLM tool calling）
 */
export const ontologyToolDefinitions = [
  {
    name: 'ontology_queryObjects',
    description:
      '查询 Ontology 中的真实对象与关系。在进行任何实质性推理前必须至少调用一次 ontology 相关工具。',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '对象类型，如 Mission、Artifact、Agent、Capability' },
        filters: { type: 'object', description: '属性过滤条件' },
        relations: {
          type: 'array',
          items: { type: 'string' },
          description: '需要一并返回的关系类型',
        },
        limit: { type: 'number', description: '最大返回条数' },
      },
      required: ['type'],
    },
  },
  {
    name: 'ontology_getObject',
    description: '按 ID 获取单个真实对象',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '对象 ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'ontology_getRelated',
    description: '获取与某对象通过指定关系相连的对象',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '源对象 ID' },
        relationType: { type: 'string', description: '关系类型，如 created_by、depends_on、used_by' },
      },
      required: ['id', 'relationType'],
    },
  },
  {
    name: 'ontology_getCurrentState',
    description: '获取 Mission 当前真实状态',
    parameters: {
      type: 'object',
      properties: {
        missionId: { type: 'string', description: 'Mission ID' },
      },
      required: ['missionId'],
    },
  },
  {
    name: 'ontology_queryCompanyKnowledge',
    description:
      '查询公司知识记忆（产品/规则/经验/客户等，实体-关系图优先）。' +
      '涉及公司事实时必须调用；结果含 need_human 标记，为 true 时不得用模型自身知识补全，必须询问用户。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '查询内容，如“报表产品定价”' },
        domain: { type: 'string', description: 'company | product | code | 运营 | ...（缺省 company）' },
        entityTypes: { type: 'array', items: { type: 'string' }, description: '限定实体类型（可选）' },
        limit: { type: 'number', description: '最大返回条数' },
      },
      required: ['text'],
    },
  },
] as const;

/**
 * createOntologyToolExecutor — 创建 ontology 工具执行器
 *
 * 每个工具调用自动通过 ForcedQueryGuard 记录追踪。
 *
 * @param ontology - OntologyService 实例
 * @param guard - ForcedQueryGuard 实例
 * @param executionId - 当前执行 ID
 * @returns 工具执行函数 (name, args) => Promise<unknown>
 */
export function createOntologyToolExecutor(
  ontology: OntologyService,
  guard: ForcedQueryGuard,
  executionId: string,
) {
  return async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    let result: unknown;

    switch (name) {
      case 'ontology_queryObjects':
        result = await ontology.queryObjects({
          type: args.type as string,
          properties: args.filters as Record<string, unknown> | undefined,
          relations: args.relations as string[] | undefined,
          limit: args.limit as number | undefined,
        });
        break;

      case 'ontology_getObject':
        result = await ontology.getObject(String(args.id));
        break;

      case 'ontology_getRelated':
        result = await ontology.getRelated(String(args.id), String(args.relationType));
        break;

      case 'ontology_getCurrentState':
        result = await ontology.getCurrentState(String(args.missionId));
        break;

      case 'ontology_queryCompanyKnowledge':
        result = await queryCompanyKnowledge({
          text: String(args.text ?? ''),
          domain: args.domain as string | undefined,
          entityTypes: args.entityTypes as string[] | undefined,
          limit: args.limit as number | undefined,
        });
        break;

      default:
        throw new Error(`[OntologyTools] 未知工具: ${name}`);
    }

    guard.recordToolCall(executionId, name, args, result);
    return result;
  };
}
