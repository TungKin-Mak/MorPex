/**
 * CompactionPolicy — 上下文压缩策略接口（策略模式）
 *
 * 定位：
 *   不是内联实现，而是策略接口。ContextPruner 作为具体实现之一，
 *   通过 CompactionPolicy 接口切换策略。
 *
 * 设计约束：
 *   - 策略可插拔：LLM Summary / 滑窗截断 / 混合
 *   - 不依赖 AgentHarness 或 pi 包
 *   - ContextPruner 持有 CompactionPolicy 引用
 *
 * 数据流：
 *   ContextPruner.prune(context) → compactionPolicy.compact(context, strategy)
 *     → 返回 CompactionResult { pruned, offloaded, tokenSaved }
 */

export type CompactionStrategy = 'summary' | 'sliding_window' | 'hybrid' | 'none';

export interface CompactionContext {
  /** 原始上下文文本 */
  content: string;
  /** 角色（system/user/assistant） */
  role: string;
  /** 元数据标签 */
  tags?: string[];
  /** token 预算上限（0 = 不限制） */
  tokenBudget?: number;
  /** 策略特定参数 */
  strategyParams?: Record<string, unknown>;
}

export interface CompactionResult {
  /** 压缩后的内容 */
  content: string;
  /** 实际使用的策略 */
  strategy: CompactionStrategy;
  /** 原始 token 数 */
  originalTokens: number;
  /** 压缩后 token 数 */
  compressedTokens: number;
  /** 节省的 token 数 */
  tokenSaved: number;
  /** 是否有内容被卸载到文件 */
  offloaded: boolean;
  /** 卸载的文件路径（如有） */
  offloadPath?: string;
}

/**
 * CompactionPolicy — 策略接口
 *
 * 所有压缩策略实现此接口。ContextPruner 接受 CompactionPolicy 实例，
 * 通过 strategy 参数切换行为。
 */
export interface CompactionPolicy {
  /** 策略名称 */
  readonly name: string;

  /**
   * compact — 执行上下文压缩
   * @param context 待压缩的上下文
   * @param strategy 压缩策略
   * @returns 压缩结果
   */
  compact(context: CompactionContext, strategy: CompactionStrategy): Promise<CompactionResult>;
}

// ═══════════════════════════════════════════════════════════════
// 内置实现：滑窗截断策略
// ═══════════════════════════════════════════════════════════════

export class SlidingWindowCompaction implements CompactionPolicy {
  readonly name = 'sliding_window';

  async compact(context: CompactionContext, strategy: CompactionStrategy): Promise<CompactionResult> {
    const originalTokens = estimateTokens(context.content);
    if (strategy === 'none' || !context.tokenBudget) {
      return {
        content: context.content,
        strategy,
        originalTokens,
        compressedTokens: originalTokens,
        tokenSaved: 0,
        offloaded: false,
      };
    }

    const budget = context.tokenBudget;
    const ratio = budget / Math.max(originalTokens, 1);

    if (ratio >= 1.0) {
      return {
        content: context.content,
        strategy,
        originalTokens,
        compressedTokens: originalTokens,
        tokenSaved: 0,
        offloaded: false,
      };
    }

    // 按比例截断：保留开头和结尾（中间摘要）
    const chars = context.content;
    const headRatio = 0.4; // 保留前 40%
    const tailRatio = 0.3; // 保留后 30%
    const headLen = Math.floor(chars.length * headRatio * ratio);
    const tailLen = Math.floor(chars.length * tailRatio * ratio);

    let compressed: string;
    if (headLen + tailLen >= chars.length) {
      compressed = chars;
    } else {
      const head = chars.slice(0, headLen);
      const tail = chars.slice(-tailLen);
      compressed = `${head}\n\n... [中间内容已压缩，原始 ${chars.length} 字符] ...\n\n${tail}`;
    }

    const compressedTokens = estimateTokens(compressed);
    return {
      content: compressed,
      strategy,
      originalTokens,
      compressedTokens,
      tokenSaved: originalTokens - compressedTokens,
      offloaded: false,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

/**
 * estimateTokens — 混合中英文 Token 估算
 *
 * 中文 ~1.5 字/token，英文 ~4 字符/token
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let chineseChars = 0;
  let otherChars = 0;
  for (const ch of text) {
    if (ch >= '\u4e00' && ch <= '\u9fff') chineseChars++;
    else otherChars++;
  }
  return Math.ceil(chineseChars / 1.5) + Math.ceil(otherChars / 4);
}

/**
 * estimateContextTokens — 批量估算上下文中各段落的 token 数
 */
export function estimateContextTokens(segments: Array<{ content: string }>): number {
  return segments.reduce((sum, seg) => sum + estimateTokens(seg.content), 0);
}
