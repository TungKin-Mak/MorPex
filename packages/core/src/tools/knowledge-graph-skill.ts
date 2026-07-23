/**
 * knowledge-graph-skill — 知识图谱查询 AgentTool (Phase 11: Harness-aware)
 *
 * 优先通过 AgentHarness 查询（上下文+权限），回退到直接 KnowledgeGraph 访问。
 */

import { Type } from '../adapters/pi-ai-types.js';
import type { AgentTool } from '../adapters/pi-types.js';
import { KnowledgeGraph } from '../planes/knowledge-plane/knowledge/KnowledgeGraph.js';
import type { AgentHarness } from '../planes/agent-plane/AgentHarness.js';

export function createKnowledgeGraphSkill(
  kg: KnowledgeGraph,
  harness?: AgentHarness | null,
): AgentTool {
  return {
    name: 'query_knowledge_graph',
    label: '查询知识图谱',
    description: '查询全局知识图谱，搜索相关实体和关系。',
    parameters: Type.Object({
      query: Type.String({ description: '搜索关键词' }),
      maxResults: (Type as any).Optional(Type.Number({ description: '最大返回结果数' })),
    }),
    execute: async (_toolCallId: string, params: unknown, _signal?: AbortSignal, _onUpdate?: any) => {
      const p = params as { query: string; maxResults?: number };
      try {
        // Phase 11: Harness-first path
        if (harness?.isInitialized) {
          const results = harness.queryKnowledge(p.query, p.maxResults ?? 10);
          const summary = results.map((e: Record<string, any>) =>
            `- [${e.type}] ${e.name}${e.description ? ': ' + e.description : ''}`
          ).join('\n');
          const output = results.length > 0
            ? `找到 ${results.length} 个相关实体(通过Harness):\n${summary}`
            : '未找到匹配的实体。';
          return {
            content: [{ type: 'text' as const, text: output }],
            details: { success: true, count: results.length, query: p.query, path: 'harness' },
          };
        }
        // Fallback: direct graph access
        const results = kg.searchEntities({ text: p.query, limit: p.maxResults ?? 10 });
        const summary = results.map(e =>
          `- [${e.type}] ${e.name}${e.metadata?.description ? ': ' + e.metadata.description : ''}`
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
