/**
 * memory-search-tool.ts — 记忆搜索工具 (Phase 11: Harness-aware)
 *
 * 优先通过 AgentHarness 搜索（上下文+记忆激活），回退到直接 MemoryRetriever 访问。
 */

import { Type } from '../../infrastructure/adapters/pi-ai-types.js';
import type { AgentTool } from '../../infrastructure/adapters/pi-types.js';
import type { MemoryRetriever } from '../../../../memory/src/index.js';

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
  memoryApi?: import('../../infrastructure/adapters/memory/index.js').MemoryApi | null,
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

      // ═══ 统一入口：经 MemoryAPI（强制检索 + need_human，防幻觉）═══
      if (memoryApi) {
        try {
          const r = await memoryApi.query({ text: query, limit: 8 });
          if (r.need_human || r.hits.length === 0) {
            return {
              content: textContent(
                `⚠️ 记忆中无此记录或置信不足（${r.reason ?? 'QueryMiss'}）。不能臆测，请明确告知用户并询问补充。`,
              ),
              details: { found: false, need_human: true, reason: r.reason, source: r.source },
            };
          }
          return {
            content: textContent(`🔍 记忆库找到(统一记忆层, ${r.source}):\n\n${r.hits.map((h) => h.content).join('\n\n---\n\n')}`),
            details: { found: true, path: 'memory_api', source: r.source },
          };
        } catch (_err: any) {
          // 统一层异常 → 回退到直接 MemoryRetriever 访问
        }
      }

      // （原 Phase 11 Harness-first 路径已随 execution/harness 移除，运行时 harness 恒未注入）
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
