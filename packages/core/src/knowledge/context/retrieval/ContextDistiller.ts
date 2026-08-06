/**
 * ContextDistiller — 上下文摘要蒸馏器（会话 16i · RAG-lazy 装配：情境层摘要）
 *
 * 目的：历史/任务上下文在注入装配前压缩为短摘要（≤maxLen 字符），
 * 保留"目标 + 结果 + 关键决策 + 遗留风险"，丢弃过程细节——防 token 膨胀 + 保装配效果。
 *
 * 两级蒸馏：
 *   1. LLM 蒸馏（可选注入 generateText）：智能压缩，保留关键决策
 *   2. 确定性兜底（无 LLM / LLM 失败）：提取 目标/成功/失败/关键决策 标记行 + 截断
 *
 * @packageDocumentation
 */

export interface DistillerLLM {
  generateText: (opts: { prompt: string; temperature?: number; maxTokens?: number }) => Promise<{ text: string }>;
}

export interface ContextDistillerOptions {
  llm?: DistillerLLM;
  /** 目标摘要长度（字符，默认 200） */
  maxLen?: number;
}

/** 确定性关键标记（优先保留的行）：目标/结果/决策/风险 */
const KEY_MARKERS = [
  /【当前任务】/, /【目标】/, /目标[:：]/, /成功|完成|✅/, /失败|❌|✗/, /关键决策|决策/, /遗留风险|风险|⚠/, /产物|artifact|交付/, /建议/, /结论/,
];

export class ContextDistiller {
  private llm?: DistillerLLM;
  private maxLen: number;

  constructor(opts: ContextDistillerOptions = {}) {
    this.llm = opts.llm;
    this.maxLen = opts.maxLen ?? 200;
  }

  /**
   * distill — 压缩文本为 ≤maxLen 摘要
   */
  async distill(text: string, maxLen?: number): Promise<string> {
    const limit = maxLen ?? this.maxLen;
    if (!text) return '';
    if (text.length <= limit) return text;

    // 1) LLM 蒸馏（尽力而为，失败/不可用走兜底）
    if (this.llm) {
      try {
        const res = await this.llm.generateText({
          prompt: `请将以下任务上下文压缩为 ≤${Math.floor(limit / 2)} 字符的中文摘要，保留：目标、结果、关键决策、遗留风险。只输出摘要本身，不要解释。\n\n${text.slice(0, 3000)}`,
          temperature: 0,
          maxTokens: 256,
        });
        const t = (res.text ?? '').trim();
        if (t && t.length > 0) return t.length > limit ? t.slice(0, limit) : t;
      } catch {
        /* LLM 失败 → 确定性兜底 */
      }
    }

    // 2) 确定性兜底：提取关键标记行
    return this.extractKeyLines(text, limit);
  }

  /** 提取含关键标记的行 + 截断 */
  private extractKeyLines(text: string, limit: number): string {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const kept: string[] = [];
    for (const line of lines) {
      if (kept.join('\n').length >= limit) break;
      if (KEY_MARKERS.some(m => m.test(line))) {
        kept.push(line.slice(0, 160));
      }
    }
    // 无标记行命中 → 取开头
    const result = kept.length > 0 ? kept.join('\n') : text.slice(0, limit);
    return result.length > limit ? result.slice(0, limit) : result;
  }
}
