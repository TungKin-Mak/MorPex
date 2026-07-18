/**
 * knowledge-graph-skill — 知识图谱查询 AgentTool
 *
 * 将 KnowledgeGraph 封装为 AgentTool，
 * 使 Agent 可以通过 tool_call 查询全局知识图谱。
 *
 * 遵循迁移铁律 0.2（类型来源法则）：所有类型从 pi 包获取。
 */

import { Type } from '../adapters/pi-ai-types.js';
import type { AgentTool } from '../adapters/pi-types.js';
import { KnowledgeGraph } from '../planes/knowledge-plane/knowledge/KnowledgeGraph.js';

/**
 * 创建知识图谱查询工具
 *
 * @param kg - KnowledgeGraph 实例
 * @returns AgentTool
 */
export function createKnowledgeGraphSkill(kg: KnowledgeGraph): AgentTool {
  return {
    name: 'query_knowledge_graph',
    label: '查询知识图谱',
    description: '查询全局知识图谱，搜索相关实体和关系。传入搜索关键词，返回匹配的实体列表。',
    parameters: Type.Object({
      query: Type.String({ description: '搜索关键词' }),
      maxResults: Type.Optional(Type.Number({ default: 10, description: '最大返回结果数' })),
    }),
    execute: async (_toolCallId: string, params: unknown, _signal?: AbortSignal, _onUpdate?: any) => {
      const p = params as { query: string; maxResults?: number };
      try {
        const results = kg.searchEntities({
          text: p.query,
          limit: p.maxResults ?? 10,
        });

        const summary = results.map(e =>
          `- [${e.type}] ${e.name}${e.description ? ': ' + e.description : ''}`
        ).join('\n');

        const output = results.length > 0
          ? `找到 ${results.length} 个相关实体:\n${summary}`
          : '未找到匹配的实体。';

        return {
          content: [{ type: 'text' as const, text: output }],
          details: { success: true, count: results.length, query: p.query },
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `查询知识图谱失败: ${err.message}` }],
          details: { success: false, error: err.message },
        };
      }
    },
  };
}
