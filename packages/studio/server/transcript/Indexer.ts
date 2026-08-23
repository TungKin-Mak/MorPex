/**
 * Indexer — 抄写员：jsonl 账本 → SQLite 指针索引（T1）
 *
 * 职责（docs/SINGLE_TRANSCRIPT_DESIGN.md §4.4）：
 *   - 水位线增量：只处理上次抄到的字节之后的新完整行
 *   - 半行防护：只认"以换行结尾且 JSON.parse 通过"的行（jsonl 追加写天然 crash-safe 到最后一条完整行）
 *   - 幂等：(session_id, seq) 主键 upsert；重复 reconcile 无副作用
 *   - 回缩重建：文件变小（compact 重写等）→ 清空该会话索引全量重建
 *
 * seq 语义：物理行号（1-based，单调递增）。与 pi entry 的逻辑序一致（追加式文件行序 = 条目序），
 * 且与 byte_offset 水位互为冗余校验。投影层/SSE 游标统一使用该 seq。
 */

import * as fs from 'node:fs';
import type { TranscriptStore } from './TranscriptStore.js';

/** 从一条 jsonl 行提取 (kind, role, preview)；解析失败返回 null（半行/坏行跳过） */
export function classifyEntryLine(line: string): { kind: string; role: string | null; preview: string | null } | null {
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof entry !== 'object' || entry === null) return null;
  const e = entry as Record<string, unknown>;
  const type = typeof e.type === 'string' ? e.type : '';

  if (type === 'message') {
    const msg = e.message as Record<string, unknown> | undefined;
    const role = typeof msg?.role === 'string' ? msg.role : null;
    const kind = role === 'user' || role === 'assistant' ? 'chat' : 'internal';
    return { kind, role, preview: extractPreview(msg?.content) };
  }
  if (type === 'custom_message') {
    const ct = typeof e.customType === 'string' ? e.customType : '';
    const kind = ct.startsWith('morpex.approval') ? 'approval' : 'internal';
    const display = e.display !== false;
    return { kind: display ? kind : 'internal', role: null, preview: extractPreview(e.content) };
  }
  // T2：morpex.turn 回合记录（appendCustomEntry 写 type='custom' + data 字段）→ 对话面
  if (type === 'custom' && e.customType === 'morpex.turn') {
    const d = (e.data ?? {}) as Record<string, unknown>;
    return { kind: 'chat', role: 'assistant', preview: extractPreview(d.assistant ?? d) };
  }
  return { kind: 'internal', role: null, preview: null };
}

function extractPreview(content: unknown): string | null {
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .map((b) => (typeof b === 'object' && b !== null && typeof (b as Record<string, unknown>).text === 'string' ? (b as Record<string, unknown>).text : ''))
      .join('');
  }
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text.slice(0, 120) : null;
}

export interface IndexResult {
  indexed: number;   // 本次新增索引条数
  skipped: boolean;  // 文件不存在等（无害跳过）
}

export class TranscriptIndexer {
  constructor(private store: TranscriptStore) {}

  /** 增量索引一个账本文件。幂等；文件回缩自动全量重建。 */
  indexFile(sessionId: string, jsonlPath: string): IndexResult {
    if (!fs.existsSync(jsonlPath)) return { indexed: 0, skipped: true };

    const st = fs.statSync(jsonlPath);
    const wm = this.store.getWatermark(sessionId);
    const startBytes = wm?.indexed_bytes ?? 0;

    // 回缩检测：文件比水位还小 → 内容被重写，全量重建
    if (st.size < startBytes) {
      this.store.deleteEvents(sessionId);
      this.store.clearWatermark(sessionId);
      return this.indexFile(sessionId, jsonlPath);
    }

    // 只读上次水位之后的字节；只处理到最后一个换行为止（尾部半行留给下次）。
    // 内存边界：一次性读入「水位之后的新增字节」，正常增量仅 KB 级；全量重建时 ≈ 文件大小。
    // 本仓库账本预期 MB 级（纯文本对话+工具输出），64MB 以内安全；若未来单文件超此量级再改分块读（届时先改测试）。
    const fd = fs.openSync(jsonlPath, 'r');
    try {
      const length = st.size - startBytes;
      if (length <= 0) return { indexed: 0, skipped: false };
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, startBytes);
      const lastNl = buf.lastIndexOf(0x0a);
      if (lastNl < 0) return { indexed: 0, skipped: false }; // 一个完整行都没有

      let seq = wm?.last_seq ?? 0;
      let offset = startBytes;
      let indexed = 0;
      let cursor = 0;
      // 批量事务：全量重建时避免逐条隐式事务（WAL 下逐条 fsync）；失败整体回滚，水位不前进、下次重抄（幂等）
      const batched = this.store.withTransaction(() => {
        while (cursor < lastNl) {
          const nl = buf.indexOf(0x0a, cursor);
          const end = nl < 0 ? lastNl : nl; // nl 必命中（lastNl 是最后一个 \n）
          const line = buf.subarray(cursor, end).toString('utf-8');
          if (line.trim().length > 0) {
            const cls = classifyEntryLine(line);
            if (cls) {
              seq += 1;
              const added = this.store.insertEventIgnore({
                session_id: sessionId,
                seq,
                byte_offset: offset,
                byte_length: end - cursor + 1, // 含换行符
                kind: cls.kind,
                role: cls.role,
                preview: cls.preview,
              });
              if (added) indexed += 1;
            }
          }
          offset += end - cursor + 1;
          cursor = end + 1;
        }
        this.store.setWatermark(sessionId, offset, seq);
        return indexed;
      });
      return { indexed: batched, skipped: false };
    } finally {
      fs.closeSync(fd);
    }
  }

  /** 全量重建（删库重来）；用于 compact 后或手动修复 */
  rebuild(sessionId: string, jsonlPath: string): IndexResult {
    this.store.deleteEvents(sessionId);
    this.store.clearWatermark(sessionId);
    return this.indexFile(sessionId, jsonlPath);
  }
}
