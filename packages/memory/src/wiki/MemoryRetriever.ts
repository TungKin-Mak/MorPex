/**
 * MemoryRetriever — Agent 记忆优先检索层
 *
 * Agent 做任何决策前调用此类的方法，遵循：
 *   MemoryWiki 优先 → LLM 回退
 *
 * 检索策略（按优先级）:
 *   1. docs 全文搜索 (memory_entries)
 *   2. 历史计划标签匹配 (plan_records)
 *   3. 历史错误修复 (error_logs)
 *   4. 知识图谱实体 (kg_entities)
 *
 * 使用:
 *   const retriever = new MemoryRetriever(wiki);
 *   const result = retriever.retrieveForTask("做一个单片机程序", ["单片机", "嵌入式"]);
 *   if (result.found) { prompt += result.context; }
 */

import type { MemoryWiki } from './MemoryWiki.js';

// ═══════════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════════

export interface RetrievalResult {
  /** 是否命中 */
  found: boolean;
  /** 检索来源 */
  source: 'docs' | 'past_plans' | 'error_logs' | 'kg' | 'none';
  /** 检索到的内容片段 */
  snippets: string[];
  /** 结构化的上下文（可直接注入 LLM prompt） */
  context: string;
}

export interface ErrorRetrievalResult {
  found: boolean;
  /** 相似的历史错误及修复方案 */
  similarErrors: Array<{
    errorType: string;
    errorMessage: string;
    retryCount: number;
    healingSucceeded: boolean;
    timestamp: number;
  }>;
  /** 修复建议 */
  suggestions: string[];
  context: string;
}

// ═══════════════════════════════════════════════════════════════
// Stopwords（不会产生有效检索结果的词）
// ═══════════════════════════════════════════════════════════════

const STOPWORDS = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人',
  '都', '一', '一个', '这个', '那个', '怎么', '如何', '什么',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
  'it', 'this', 'that', 'what', 'how', 'why', 'which', 'who',
  'to', 'for', 'of', 'in', 'on', 'at', 'by', 'with', 'from',
]);

// ═══════════════════════════════════════════════════════════════
// MemoryRetriever
// ═══════════════════════════════════════════════════════════════

export class MemoryRetriever {
  private wiki: MemoryWiki;

  constructor(wiki: MemoryWiki) {
    this.wiki = wiki;
  }

  /**
   * retrieveForTask — 任务启动前检索
   *
   * 搜索策略（按优先级）:
   *  1. docs 全文搜索 → 找相关技术文档
   *  2. plan_records 标签匹配 → 找相似任务的历史计划
   *  3. kg_entities 语义匹配 → 找相关知识图谱实体
   *
   * @param taskDescription - 用户输入的任务描述
   * @param tags - 提取的标签（如有）
   */
  retrieveForTask(taskDescription: string, tags?: string[]): RetrievalResult {
    const snippets: string[] = [];
    let source: RetrievalResult['source'] = 'none';
    const keywords = this.extractKeywords(taskDescription);
    const searchTerm = keywords[0] ?? taskDescription.slice(0, 30);

    // ① 检索文档知识库
    const docResults = this.wiki.sql(
      "SELECT content FROM memory_entries WHERE pool = 'main' AND content LIKE ? LIMIT 5",
      `%${searchTerm}%`
    ) as Array<{ content: string }>;

    if (docResults.length > 0) {
      source = 'docs';
      for (const r of docResults) {
        snippets.push(`[文档] ${r.content.slice(0, 500)}`);
      }
    }

    // ② 检索历史计划（标签匹配）
    if (tags && tags.length > 0) {
      const planResults = this.wiki.queryByTags('plan_records', tags, { limit: 5, orderBy: 'plan_score DESC' });
      if (planResults.length > 0) {
        if (source === 'none') source = 'past_plans';
        for (const r of planResults) {
          const d = r as Record<string, unknown>;
          snippets.push(
            `[历史计划] ${d.user_input ?? d.task_id} | 评分:${d.plan_score} | 方法:${d.s3_method} | 耗时:${d.duration_ms}ms`
          );
        }
      }
    }

    // ③ 检索知识图谱
    const kgResults = this.wiki.sql(
      "SELECT name, type, data_json FROM kg_entities WHERE name LIKE ? OR data_json LIKE ? LIMIT 3",
      `%${searchTerm}%`, `%${searchTerm}%`
    ) as Array<{ name: string; type: string; data_json: string }>;

    if (kgResults.length > 0) {
      if (source === 'none') source = 'kg';
      for (const r of kgResults) {
        snippets.push(`[知识图谱] ${r.name} (${r.type})`);
      }
    }

    return {
      found: snippets.length > 0,
      source,
      snippets: snippets.slice(0, 10),
      context: snippets.length > 0
        ? `\n【从记忆中检索到的相关上下文】\n${snippets.join('\n---\n')}\n【请结合以上上下文回答问题】\n`
        : '',
    };
  }

  /**
   * retrieveForError — 出错时检索历史修复方案
   *
   * @param errorMessage - 错误消息
   * @param errorType - 错误类型（可选）
   */
  retrieveForError(errorMessage: string, errorType?: string): ErrorRetrievalResult {
    const suggestions: string[] = [];

    // ① 按错误类型查历史
    let errorRows: Array<Record<string, unknown>>;
    if (errorType) {
      errorRows = this.wiki.getErrorLogs(errorType, 5);
    } else {
      errorRows = this.wiki.sql(
        "SELECT * FROM error_logs WHERE error_message LIKE ? ORDER BY timestamp DESC LIMIT 5",
        `%${errorMessage.slice(0, 50)}%`
      ) as Array<Record<string, unknown>>;
    }

    const similarErrors = errorRows.map(r => ({
      errorType: (r.error_type as string) ?? 'unknown',
      errorMessage: (r.error_message as string)?.slice(0, 200) ?? '',
      retryCount: (r.retry_count as number) ?? 0,
      healingSucceeded: (r.healing_succeeded as number) === 1,
      timestamp: (r.timestamp as number) ?? 0,
    }));

    // ② 分析修复模式
    if (similarErrors.length > 0) {
      const healedCount = similarErrors.filter(e => e.healingSucceeded).length;
      const avgRetries = Math.round(
        similarErrors.reduce((s, e) => s + e.retryCount, 0) / similarErrors.length
      );
      if (healedCount > 0) {
        suggestions.push(`历史上 ${healedCount}/${similarErrors.length} 个类似错误被自动修复，建议重试`);
      }
      suggestions.push(`历史平均重试 ${avgRetries} 次后解决`);
    }

    // ③ 查 docs 中的故障排除
    const docResults = this.wiki.sql(
      "SELECT content FROM memory_entries WHERE content LIKE ? LIMIT 3",
      `%${errorType ?? errorMessage.slice(0, 30)}%`
    ) as Array<{ content: string }>;

    if (docResults.length > 0) {
      suggestions.push('相关文档中有以下信息:');
      for (const r of docResults) {
        suggestions.push(r.content.slice(0, 300));
      }
    }

    return {
      found: similarErrors.length > 0 || docResults.length > 0,
      similarErrors,
      suggestions,
      context: similarErrors.length > 0
        ? `\n【从错误记忆中检索到的信息】\n找到 ${similarErrors.length} 个相似错误。${suggestions.join('; ')}\n【请参考以上信息进行修复】\n`
        : (docResults.length > 0
          ? `\n【从文档中检索到的相关信息】\n${docResults.map(r => r.content.slice(0, 300)).join('\n')}\n`
          : ''),
    };
  }

  /**
   * retrieveForUncertainty — LLM 不确定时检索
   *
   * @param question - LLM 不确定的问题
   */
  retrieveForUncertainty(question: string): RetrievalResult {
    const snippets: string[] = [];
    const searchTerm = question.slice(0, 60);

    // docs
    const docResults = this.wiki.sql(
      "SELECT content FROM memory_entries WHERE content LIKE ? LIMIT 5",
      `%${searchTerm}%`
    ) as Array<{ content: string }>;
    for (const r of docResults) {
      snippets.push(`[文档] ${r.content.slice(0, 500)}`);
    }

    // past plans
    const planResults = this.wiki.sql(
      "SELECT user_input, plan_score, s3_method FROM plan_records WHERE user_input LIKE ? LIMIT 3",
      `%${searchTerm}%`
    ) as Array<Record<string, unknown>>;
    for (const r of planResults) {
      snippets.push(`[历史任务] ${r.user_input} (评分:${r.plan_score})`);
    }

    return {
      found: snippets.length > 0,
      source: snippets.length > 0 ? 'docs' : 'none',
      snippets: snippets.slice(0, 10),
      context: snippets.length > 0
        ? `\n【从记忆中检索到的上下文】\n${snippets.join('\n---\n')}\n【请参考以上上下文】\n`
        : '',
    };
  }

  /**
   * retrieveForCode — 生成代码前检索相关上下文
   */
  retrieveForCode(taskDescription: string, language?: string): RetrievalResult {
    const snippets: string[] = [];
    const keywords = this.extractKeywords(taskDescription);

    for (const kw of keywords.slice(0, 3)) {
      const results = this.wiki.sql(
        "SELECT content FROM memory_entries WHERE content LIKE ? LIMIT 2",
        `%${kw}%`
      ) as Array<{ content: string }>;
      for (const r of results) {
        snippets.push(`[文档] ${r.content.slice(0, 500)}`);
      }
    }

    if (language) {
      const planResults = this.wiki.queryByTags('plan_records', [language, 'code'], { limit: 3 });
      for (const r of planResults) {
        const d = r as Record<string, unknown>;
        snippets.push(`[成功案例] ${d.user_input} | 方法:${d.s3_method} | 评分:${d.plan_score}`);
      }
    }

    return {
      found: snippets.length > 0,
      source: snippets.length > 0 ? 'docs' : 'none',
      snippets: snippets.slice(0, 10),
      context: snippets.length > 0
        ? `\n【代码生成前检索到的上下文】\n${snippets.join('\n---\n')}\n【请参考以上上下文生成代码】\n`
        : '',
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 工具
  // ═══════════════════════════════════════════════════════════════

  /**
   * 提取关键词（去停用词、去重、按长度排序）
   */
  private extractKeywords(text: string): string[] {
    const words = text
      .replace(/[，。！？、；：""''（）【】《》\n\r.,!?;:'"()\[\]{}<>]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2 && !STOPWORDS.has(w));
    return [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 5);
  }
}
