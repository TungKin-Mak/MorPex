/**
 * session-tools — T3 组织通信原语①②的服务端实现（权限矩阵 + 账本读取 + 留言落库）
 *
 * 职责（docs/SINGLE_TRANSCRIPT_DESIGN.md §4.5）：
 *   - 权限矩阵：上司→下属 全文 / 同树兄弟 摘要 / 经理↔经理 不可翻账 / 跨树 拒绝
 *     （沿 transcript_windows.parent_session_id 链判定；chat:* 键窗口 = 树根锚点）
 *   - sessionRead：读目标 jsonl（整文件逐行解析，账本为 KB~MB 级可接受；指针式坐标留给 history API）
 *     → 最小 sanitize（删 thinkingSignature/截断 thinking）——TODO(T2)：合入后换统一投影 projection.ts
 *   - sendMessage：写 agent_messages 一行 + 双方账本各追加存根 custom_message（display:true）
 *
 * 铁律：本文件不 import @earendil-works/*。
 */

import * as fs from 'node:fs';
import type { TranscriptStore, TranscriptWindowRow } from './TranscriptStore.js';
import { TranscriptIndexer } from './Indexer.js';
import type { AgentMessageStore } from './AgentMessageStore.js';

/** 会话树根解析：沿 parent 链向上，返回最顶层窗口（期望是 chat:* 键的 orchestrator/chat 窗口） */
function treeRoot(store: TranscriptStore, win: TranscriptWindowRow): TranscriptWindowRow {
  let cur = win;
  const seen = new Set<string>([cur.session_id]);
  while (cur.parent_session_id) {
    const parent = store.findWindowById(cur.parent_session_id);
    if (!parent || seen.has(parent.session_id)) break; // 断链/环防护：停在当前层
    cur = parent;
    seen.add(cur.session_id);
  }
  return cur;
}

function isDescendantOf(store: TranscriptStore, target: TranscriptWindowRow, ancestorId: string): boolean {
  let cur: TranscriptWindowRow | undefined = target;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.session_id)) {
    if (cur.session_id === ancestorId) return true;
    seen.add(cur.session_id);
    cur = cur.parent_session_id ? store.findWindowById(cur.parent_session_id) : undefined;
  }
  return false;
}

export type PermissionLevel = 'full' | 'summary' | 'message-only' | 'deny';

/**
 * 权限判定（§4.5 矩阵）。requester 与 target 均为已登记窗口。
 */
export function checkPermission(
  store: TranscriptStore,
  requester: TranscriptWindowRow,
  target: TranscriptWindowRow,
): PermissionLevel {
  // 上司→下属：target 在 requester 的子树内 → 全文
  if (isDescendantOf(store, target, requester.session_id)) return 'full';
  // 经理↔经理特例（§4.5）：独立树的两个 orchestrator —— 不可翻对方账本，但可留言
  const bothManager = requester.component === 'orchestrator' && target.component === 'orchestrator'
    && requester.session_key.startsWith('agent:') && target.session_key.startsWith('agent:');
  if (bothManager) return 'message-only';
  // 同树：兄弟工位互查摘要
  const sameTree = treeRoot(store, requester).session_id === treeRoot(store, target).session_id;
  if (sameTree) return 'summary';
  return 'deny';
}

// ── 最小 sanitize（TODO(T2)：换统一投影 projection.ts）──

interface MinimalContentBlock { type?: string; text?: string; thinking?: string; thinkingSignature?: string }
interface MinimalEntryLine { type?: string; message?: { role?: string; content?: unknown } }

/** 删 thinkingSignature、thinking 截断 2000 字符——与 §5.1 对齐的最小集 */
export function minimalSanitizeMessage(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.map((b: unknown) => {
    const block = b as MinimalContentBlock;
    if (block?.type === 'thinking') {
      const t = typeof block.thinking === 'string' ? block.thinking.slice(0, 2000) : block.thinking;
      return { ...block, thinking: t, thinkingSignature: undefined };
    }
    return b;
  });
}

/** 读整个账本 → 解析为消息数组（跳过残行）；只取 user/assistant 文本视图 */
export function readTranscriptMessages(filePath: string, opts: { mode: 'full' | 'summary' }): Array<{ role: string; text: string }> {
  if (!fs.existsSync(filePath)) throw new Error(`NOT_FOUND: 账本文件不存在 ${filePath}`);
  const raw = fs.readFileSync(filePath, 'utf8');
  const out: Array<{ role: string; text: string }> = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as MinimalEntryLine & { customType?: string };
      if (entry.type !== 'message' || !entry.message) continue;
      const role = String(entry.message.role ?? 'unknown');
      const content = minimalSanitizeMessage(entry.message.content);
      let text = '';
      if (typeof content === 'string') text = content;
      else if (Array.isArray(content)) {
        text = content.map((b: unknown) => {
          const blk = b as MinimalContentBlock;
          if (blk?.type === 'text' && typeof blk.text === 'string') return blk.text;
          if (blk?.type === 'thinking' && typeof blk.thinking === 'string') return `[思考] ${blk.thinking}`;
          if (blk?.type === 'toolCall') return '[工具调用]';
          return '';
        }).filter(Boolean).join('\n');
      }
      if (text.trim()) out.push({ role, text });
    } catch {
      /* 半行/坏行跳过（与 Indexer 同一容错语义） */
    }
  }
  if (opts.mode === 'summary') {
    // 摘要模式：每条截 300 字符 + 只保留最近 12 条
    const trimmed = out.slice(-12).map(m => ({ role: m.role, text: m.text.length > 300 ? `${m.text.slice(0, 300)}…` : m.text }));
    return trimmed;
  }
  return out;
}

// ── 工厂：给 primitiveAgentTools 的 bridge 实现 ──

export interface SessionToolsDeps {
  store: TranscriptStore;
  indexer: TranscriptIndexer;
  messageStore: AgentMessageStore;
  /** 写 custom_message 存根（接线层绑定 AgentSessionStore.appendCustomMessage + 目标账本 session 实例；
   *  目标会话未打开时允许不写——留言本体在表里，存根尽力而为） */
  appendStubTo?: (window: TranscriptWindowRow, customType: string, content: unknown, display: boolean) => Promise<void>;
}

export function createSessionToolsBridge(deps: SessionToolsDeps): {
  sessionRead: (requesterSessionPath: string, targetSessionId: string, mode: 'full' | 'summary') => Promise<string>;
  sendMessage: (requesterSessionPath: string, toSessionId: string, body: string) => Promise<string>;
} {
  const { store } = deps;

  const resolveWindowByRequester = (requesterSessionPath: string): TranscriptWindowRow => {
    const req = store.findWindowByFilePath(requesterSessionPath);
    if (!req) throw new Error('FORBIDDEN: 发起方会话未登记（无权限上下文）');
    return req;
  };

  return {
    async sessionRead(requesterSessionPath, targetSessionId, mode) {
      const req = resolveWindowByRequester(requesterSessionPath);
      const target = store.findWindowById(targetSessionId);
      if (!target) throw new Error(`NOT_FOUND: 目标会话未登记 ${targetSessionId}`);
      const perm = checkPermission(store, req, target);
      if (perm === 'deny') throw new Error('DENIED: 跨部门会话不可查阅');
      if (perm === 'message-only') throw new Error('DENIED: 经理之间不可翻对方账本，请用 send_message 留言');
      const effectiveMode = perm === 'summary' ? 'summary' : mode;
      const msgs = readTranscriptMessages(target.file_path, { mode: effectiveMode });
      const header = `[会话 ${targetSessionId}] component=${target.component ?? '?'} 共 ${msgs.length} 条（模式=${effectiveMode}）`;
      return `${header}\n${msgs.map(m => `[${m.role}] ${m.text}`).join('\n---\n')}`;
    },

    async sendMessage(requesterSessionPath, toSessionId, body) {
      const req = resolveWindowByRequester(requesterSessionPath);
      const to = store.findWindowById(toSessionId);
      if (!to) throw new Error(`NOT_FOUND: 目标会话未登记 ${toSessionId}`);
      const sameTree = treeRoot(store, req).session_id === treeRoot(store, to).session_id;
      const managerPair = req.component === 'orchestrator' && to.component === 'orchestrator'
        && req.session_key.startsWith('agent:') && to.session_key.startsWith('agent:');
      // 留言权限：同树任意成员，或经理↔经理特例；跨树非经理拒绝
      if (!sameTree && !managerPair) throw new Error('DENIED: 跨部门仅限经理级留言');

      const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      deps.messageStore.insert({ id, from_session: req.session_id, to_session: to.session_id, body });
      // 双存根（尽力而为：目标账本未打开时表记录仍在，收件方下次开账由路由层补拉 unread）
      for (const win of [req, to]) {
        await deps.appendStubTo?.(win, 'morpex.message_stub', {
          messageId: id,
          direction: win.session_id === req.session_id ? 'outgoing' : 'incoming',
          peer: win.session_id === req.session_id ? to.session_id : req.session_id,
          body: body.slice(0, 500),
          createdAt: Date.now(),
        }, true);
      }
      return `✅ 留言已送达会话 ${toSessionId}（messageId=${id}），对方下次开工时可见`;
    },
  };
}
