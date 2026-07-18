/**
 * memory-search-tool.ts — 将 MemoryWiki 暴露为 LLM 可随时调用的 search_memory 工具
 *
 * LLM 在任务执行中可以主动调用:
 *   search_memory({ query: "STM32 GPIO 寄存器地址" })
 *   search_memory({ query: "串口超时", category: "errors" })
 *   search_memory({ query: "部署流程", category: "docs" })
 *
 * 设计: 工具驱动检索 — LLM 决定何时搜、搜什么，而不是固定管道阶段。
 */

import { Type } from '../adapters/pi-ai-types.js';
import type { Static } from '../adapters/pi-ai-types.js';
import type { TSchema } from '../adapters/pi-ai-types.js';
import type { AgentTool, AgentToolResult } from '../adapters/pi-types.js';
import type { MemoryRetriever } from '../../../memory/src/index.js';

// ═══════════════════════════════════════════════════════════════
// 工具定义
// ═══════════════════════════════════════════════════════════════

const searchMemorySchema = Type.Object({
  query: Type.String({ description: '搜索关键词或问题。例如: "STM32 GPIO 寄存器", "如何部署到K8s", "数据库迁移步骤"' }),
  category: Type.Optional(Type.String({
    description: '搜索类别: "docs"(文档) | "errors"(错误修正) | "plans"(历史计划) | "kg"(知识图谱) | "all"(全部, 默认)',
  })),
});

type SearchMemoryParams = Static<typeof searchMemorySchema>;

/** 文本辅助 */
function textContent(text: string) {
  return [{ type: 'text' as const, text }];
}

/**
 * createMemorySearchTool — 创建 search_memory 工具
 *
 * @param getRetriever - 懒加载获取 MemoryRetriever（工具创建时可能还未初始化）
 */
export function createMemorySearchTool(
  getRetriever: () => MemoryRetriever | null
): AgentTool<typeof searchMemorySchema> {
  return {
    name: 'search_memory',
    label: '搜索记忆知识库',
    description:
      '在 MorPex 的记忆知识库中搜索信息。' +
      '当你需要查找技术文档、过去的成功经验、错误修复方案、或任何不确定的信息时，优先调用此工具。' +
      '如果搜索无结果，再用你自己的知识回答。' +
      '\n\n' +
      '类别说明:\n' +
      '- "docs": 搜索架构文档、开发指南、API 参考等\n' +
      '- "errors": 搜索历史错误记录及修复方案\n' +
      '- "plans": 搜索过去的任务执行计划和评分\n' +
      '- "kg": 搜索知识图谱中的实体和关系\n' +
      '- "all": 搜索全部（默认）',
    parameters: searchMemorySchema,
    execute: async (_toolCallId: string, params: SearchMemoryParams): Promise<AgentToolResult<any>> => {
      const retriever = getRetriever();
      if (!retriever) {
        return {
          content: textContent('⚠️ 记忆检索器未就绪，请用你自己的知识回答。'),
          details: { found: false, reason: 'retriever_not_ready' },
        };
      }

      const category = params.category ?? 'all';
      const query = params.query;

      try {
        // 按类别检索
        switch (category) {
          case 'errors': {
            const result = retriever.retrieveForError(query);
            if (!result.found) {
              return {
                content: textContent(`未找到关于 "${query}" 的历史错误记录。请用你自己的知识处理此错误。`),
                details: { found: false, category: 'errors', query },
              };
            }
            return {
              content: textContent(
                `🔍 找到 ${result.similarErrors.length} 个相似错误:\n\n` +
                result.similarErrors.map((e, i) =>
                  `${i + 1}. [${e.errorType}] ${e.errorMessage}\n   重试:${e.retryCount}次 | 修复成功:${e.healingSucceeded ? '是' : '否'}`
                ).join('\n\n') +
                (result.suggestions.length > 0 ? '\n\n💡 建议:\n' + result.suggestions.join('\n') : '')
              ),
              details: { found: true, category: 'errors', count: result.similarErrors.length },
            };
          }

          case 'docs': {
            const result = retriever.retrieveForUncertainty(query);
            if (!result.found) {
              return {
                content: textContent(`未在文档中找到关于 "${query}" 的信息。请用你自己的知识回答。`),
                details: { found: false, category: 'docs', query },
              };
            }
            return {
              content: textContent(
                `📚 从文档中找到相关信息:\n\n${result.snippets.join('\n\n---\n\n')}`
              ),
              details: { found: true, category: 'docs', count: result.snippets.length },
            };
          }

          case 'plans': {
            const result = retriever.retrieveForTask(query);
            if (!result.found) {
              return {
                content: textContent(`未找到关于 "${query}" 的历史任务计划。`),
                details: { found: false, category: 'plans', query },
              };
            }
            return {
              content: textContent(
                `📋 从历史计划中找到相关信息:\n\n${result.snippets.join('\n\n---\n\n')}`
              ),
              details: { found: true, category: 'plans', count: result.snippets.length },
            };
          }

          case 'kg': {
            const result = retriever.retrieveForTask(query);
            // KG 结果混在 retrieveForTask 的 kg 部分
            if (!result.found || !result.snippets.some(s => s.startsWith('[知识图谱]'))) {
              return {
                content: textContent(`知识图谱中未找到关于 "${query}" 的实体。`),
                details: { found: false, category: 'kg', query },
              };
            }
            return {
              content: textContent(
                `🕸️ 知识图谱中找到:\n\n${result.snippets.filter(s => s.startsWith('[知识图谱]')).join('\n')}`
              ),
              details: { found: true, category: 'kg' },
            };
          }

          default: { // 'all'
            const result = retriever.retrieveForTask(query);
            if (!result.found) {
              return {
                content: textContent(`未在记忆库中找到关于 "${query}" 的信息。请用你自己的知识回答。`),
                details: { found: false, category: 'all', query },
              };
            }
            return {
              content: textContent(
                `🔍 从记忆库中找到相关信息 (来源: ${result.source}):\n\n${result.snippets.join('\n\n---\n\n')}`
              ),
              details: { found: true, category: 'all', source: result.source, count: result.snippets.length },
            };
          }
        }
      } catch (err: any) {
        return {
          content: textContent(`⚠️ 搜索记忆库时出错: ${err.message}。请用你自己的知识继续。`),
          details: { found: false, error: err.message },
        };
      }
    },
  };
}
