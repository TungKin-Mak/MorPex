/**
 * memory-search-tool.ts — 记忆搜索工具 (Phase 11: Harness-aware)
 *
 * 优先通过 AgentHarness 搜索（上下文+记忆激活），回退到直接 MemoryRetriever 访问。
 */

import { Type } from '../adapters/pi-ai-types.js';
import type { AgentTool } from '../adapters/pi-types.js';
import type { MemoryRetriever } from '../../../memory/src/index.js';
import type { AgentHarness } from '../planes/agent-plane/AgentHarness.js';

const T: any = Type;
const searchMemorySchema = T.Object({
  query: T.String({ description: '搜索关键词或问题' }),
  category: T.Optional(T.String({
    description: '搜索类别: "docs" | "errors" | "plans" | "kg" | "all"(默认)',
  })),
});

function textContent(text: string) {
  return [{ type: 'text' as const, text }];
}

export function createMemorySearchTool(
  getRetriever: () => MemoryRetriever | null,
  harness?: AgentHarness | null,
): AgentTool {
  return {
    name: 'search_memory',
    label: '搜索记忆知识库',
    description:
      '在 MorPex 的记忆知识库中搜索信息。优先调用此工具查找已知信息。',
    parameters: searchMemorySchema,
    execute: async (_toolCallId: string, params: any): Promise<any> => {
      const query = params.query as string;
      const category = params.category ?? 'all';

      // Phase 11: Harness-first path
      if (harness?.isInitialized) {
        try {
          const result = harness.searchMemory(query, category);
          if (result?.found) {
            return {
              content: textContent(`🔍 记忆库找到(通过Harness):\n\n${(result.snippets || []).join('\n\n---\n\n')}`),
              details: { found: true, path: 'harness', source: result.source },
            };
          }
          return {
            content: textContent('未在记忆库中找到相关信息。请用你自己的知识回答。'),
            details: { found: false, path: 'harness' },
          };
        } catch (err: any) {
          // Fall through to fallback
        }
      }

      // Fallback: direct retriever access
      const retriever = getRetriever();
      if (!retriever) {
        return {
          content: textContent('⚠️ 记忆检索器未就绪，请用你自己的知识回答。'),
          details: { found: false, reason: 'retriever_not_ready' },
        };
      }

      try {
        let result: any;
        switch (category) {
          case 'errors': result = retriever.retrieveForError(query); break;
          case 'docs': result = retriever.retrieveForUncertainty(query); break;
          default: result = retriever.retrieveForTask(query); break;
        }
        if (!result?.found) {
          return {
            content: textContent(`未找到关于 "${query}" 的信息。请用你自己的知识回答。`),
            details: { found: false, category, query },
          };
        }
        return {
          content: textContent(`🔍 记忆库找到:\n\n${(result.snippets || []).join('\n\n---\n\n')}`),
          details: { found: true, category, source: result.source },
        };
      } catch (err: any) {
        return {
          content: textContent(`⚠️ 搜索记忆库时出错: ${err.message}。请用你自己的知识继续。`),
          details: { found: false, error: err.message },
        };
      }
    },
  };
}
