/**
 * projection — 翻译官：账本条目 → UI 消息（T2）
 *
 * 职责（docs/SINGLE_TRANSCRIPT_DESIGN.md §5.1 sanitize 规则表）：
 *   - 唯一放行的"对话面"= morpex.turn 自定义条目（回合记录：用户原话 + 最终展示文本）。
 *     原始 message 条目（goal/交付物/思考链/工具调用）是编排内部信封，默认过滤——
 *     它们服务 LLM 上下文；UI 显示语义由回合记录承载（保住 naturalReport 展示质量，
 *     且不被 4000 字符截断的 raw deliverable 替换）。
 *   - thinkingSignature 必删（Anthropic 加密载荷，永不下发前端）。
 *   - thinking 默认不下发；?thinking=1 显式开启时才附带原始 assistant 条目（截断 2000 字符）。
 *   - redacted / 内部信封（custom[非 morpex.turn]/label/session_info/model_change/
 *     thinking_level_change）/ display=false 的 custom_message / toolResult(默认) 一律过滤。
 *
 * 输入 = readEntryAt 按 byte_offset 读回的解析条目 + seq（Indexer 物理行号，SSE 对账游标同源）。
 */

/** UI 消息形状（与旧 chat-history 消费方兼容：role user/其余、content、timestamp，外加 seq 游标） */
export interface ProjectedMessage {
  seq: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  kind?: string;
  threadId?: string;
  spaceId?: string;
  /** 仅 ?thinking=1 时出现（截断 2000 字符）；signature 永不出现 */
  thinking?: string;
}

function asStr(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

export interface ProjectOptions {
  /** 显式开启才下发原始 assistant 条目及其思考链（截断）；默认 false */
  thinking?: boolean;
  /** 调试模式：附带 toolResult 条目；默认 false */
  tools?: boolean;
}

const THINKING_LIMIT = 2000;

/** 单条账本条目 → 0~n 条 UI 消息。entry 形状见 pi SessionTreeEntry（此处按鸭子类型解析，不 import pi）。 */
export function projectEntry(entry: unknown, seq: number, opts: ProjectOptions = {}): ProjectedMessage[] {
  if (typeof entry !== 'object' || entry === null) return [];
  const e = entry as Record<string, unknown>;
  const type = typeof e.type === 'string' ? e.type : '';

  // ── 对话面：回合记录（唯一默认放行项）。pi 的 appendCustomEntry 写 data 字段（非 content）──
  if (type === 'custom' && e.customType === 'morpex.turn') {
    const c = (e.data ?? e.content ?? {}) as Record<string, unknown>;
    const out: ProjectedMessage[] = [];
    const ts = typeof c.timestamp === 'number' ? c.timestamp : undefined;
    if (typeof c.user === 'string' && c.user.trim()) {
      out.push({ seq, role: 'user', content: c.user, timestamp: ts, kind: asKind(c.kind), threadId: asStr(c.threadId), spaceId: asStr(c.spaceId) });
    }
    if (typeof c.assistant === 'string' && c.assistant.trim()) {
      out.push({ seq, role: 'assistant', content: c.assistant, timestamp: ts, kind: asKind(c.kind), threadId: asStr(c.threadId), spaceId: asStr(c.spaceId) });
    }
    return out;
  }

  // ── 可显示自定义事件（审批卡片历史渲染，T7 遗留缺口补全）；display=false 过滤 ──
  //    request/decision 各自成卡（顺序天然相邻），前端按 kind='approval' 渲染只读卡片
  if (type === 'custom_message') {
    const ct = typeof e.customType === 'string' ? e.customType : '';
    if (!ct.startsWith('morpex.approval')) return [];
    if (e.display === false) return [];
    const c = (e.content ?? {}) as Record<string, unknown>;
    const ts = typeof e.timestamp === 'number' ? e.timestamp : undefined;
    let text: string;
    if (ct === 'morpex.approval_decision') {
      const d = asStr(c.decision);
      const mark = d === 'approve' ? '✅ 已批准' : d === 'timeout' ? '⏱ 超时未批（自动拒绝）' : '❌ 已拒绝';
      const by = asStr(c.decidedBy);
      text = `${mark}${by ? ` · ${by}` : ''} · 工单 ${asStr(c.requestId) ?? '?'}`;
    } else {
      const tool = asStr(c.tool) ?? '未知工具';
      const args = asStr(c.argsSummary);
      text = `🔐 审批请求：${tool}${args ? ` · ${args}` : ''}`;
    }
    return [{ seq, role: 'system', content: text, timestamp: ts, kind: 'approval' }];
  }

  // ── 原始 message 条目：默认是内部信封；仅显式开启时按规则部分放行 ──
  if (type === 'message') {
    const msg = (e.message ?? {}) as Record<string, unknown>;
    const role = typeof msg.role === 'string' ? msg.role : '';
    const ts = typeof e.timestamp === 'number' ? e.timestamp : undefined;

    if (role === 'toolResult') return opts.tools ? [{ seq, role: 'system', content: previewText(msg.content), kind: 'tool' }] : [];

    if (role === 'assistant') {
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      let text = '';
      let thinking: string | undefined;
      for (const b of blocks) {
        if (typeof b !== 'object' || b === null) continue;
        const blk = b as Record<string, unknown>;
        // thinkingSignature：必删，任何路径都不外发（加密载荷）
        if (blk.type === 'thinking' && opts.thinking) {
          thinking = truncate(typeof blk.thinking === 'string' ? blk.thinking : '', THINKING_LIMIT);
        }
        if (blk.type === 'text' && typeof blk.text === 'string') text += blk.text;
        // redacted 块：整块剥除（安全过滤载荷），无条件
      }
      if (!opts.thinking) return []; // 默认不放行 raw assistant（对话面由 morpex.turn 承载）
      if (!text && !thinking) return [];
      return [{ seq, role: 'assistant', content: text, timestamp: ts, ...(thinking ? { thinking } : {}) }];
    }
    return []; // user goal 等内部条目过滤（对话面用回合记录里的原话）
  }

  // 其余（custom 非 turn/label/session_info/model_change/thinking_level_change/reset/compaction…）全滤
  return [];
}

/** 一批索引行 → 投影消息（rows 已按 seq 升序）。读取正文走 readAt（字节域唯一入口）。 */
export function projectEvents(
  rows: Array<{ seq: number; byte_offset: number; byte_length: number }>,
  jsonlPath: string,
  readFn: (p: string, off: number, len: number) => unknown,
  opts: ProjectOptions = {},
): ProjectedMessage[] {
  const out: ProjectedMessage[] = [];
  for (const r of rows) {
    const entry = readFn(jsonlPath, r.byte_offset, r.byte_length);
    out.push(...projectEntry(entry, r.seq, opts));
  }
  return out.sort((a, b) => a.seq - b.seq);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
function asKind(v: unknown): string | undefined {
  return v === 'chat' || v === 'task' ? v : undefined;
}
function previewText(content: unknown): string {
  if (typeof content === 'string') return truncate(content.replace(/\s+/g, ' ').trim(), 300);
  return '[toolResult]';
}
