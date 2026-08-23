/**
 * ChatTranscriptService — 档案管理员（T1）
 *
 * 职责（docs/SINGLE_TRANSCRIPT_DESIGN.md §4.1）：
 *   - resolve(chatSessionId)：同一 chat 会话复用同一本 orchestrator 账本
 *     查 transcript_windows.session_key = `chat:<id>` → 有且文件在 → resume；
 *     无 → 经注入的 createOrchestratorSession 回调新建（pi 细节留在调用方，铁律：本模块不 import @earendil-works/*）
 *   - 旧 chat-orch-map.json（T0 遗留）自动迁移：启动时载入内存并改名 .imported，resolve 时懒迁移入库
 *   - indexNow：回合收尾后触发抄写员增量索引
 *
 * T0 接缝替换：StudioServer 的 chatOrchMapPath/loadChatOrchPaths/persistChatOrchPaths 三方法整体废弃。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TranscriptStore, TranscriptWindowRow } from './TranscriptStore.js';
import { TranscriptIndexer } from './Indexer.js';

export interface ChatWindowRef {
  sessionId: string;
  path: string;
}

export interface ChatTranscriptServiceOptions {
  store: TranscriptStore;
  indexer: TranscriptIndexer;
  /** 打开既有账本拿真实 sessionId（调用方接到 AgentSessionStore.openHandle） */
  openHandle: (path: string) => Promise<ChatWindowRef>;
  /** 新建一本 orchestrator 账本（调用方接到 AgentSessionStore.createSession） */
  createOrchestratorSession: (chatSessionId: string) => Promise<ChatWindowRef>;
  /** T2 回合记录：向账本追加一条自定义条目（调用方接到 AgentSessionStore.appendCustom，不进 LLM 上下文） */
  appendCustomEntry?: (ledgerPath: string, type: string, data: unknown) => Promise<void>;
}

export class ChatTranscriptService {
  constructor(private opts: ChatTranscriptServiceOptions) {}

  /**
   * resolve — 返回该 chat 会话绑定的 orchestrator 账本；失败返回 undefined（降级为旧行为：每轮新建会话）。
   * 幂等：重复 resolve 同一会话返回同一窗口。
   */
  async resolveOrchestratorPath(chatSessionId: string): Promise<ChatWindowRef | undefined> {
    const key = `chat:${chatSessionId}`;
    try {
      // ① 已登记且文件在 → 直接复用（顺带懒对账索引）
      const row = this.opts.store.findWindowByKey(key);
      if (row) {
        if (fs.existsSync(row.file_path)) {
          try {
            this.opts.indexer.indexFile(row.session_id, row.file_path);
          } catch {
            /* 索引失败不影响主流程（降级保底：投影可直读 jsonl） */
          }
          return { sessionId: row.session_id, path: row.file_path };
        }
        // 文件丢了 → 注销窗口走重建
        console.warn(`[Transcript] ⚠️ 会话 ${chatSessionId} 登记的账本文件丢失，重建: ${row.file_path}`);
      }

      // ② 全新会话 → 新建账本 + 登记
      const created = await this.opts.createOrchestratorSession(chatSessionId);
      this.opts.store.upsertWindow({
        session_id: created.sessionId,
        session_key: key,
        file_path: created.path,
        component: 'orchestrator',
        reason: 'initial',
      });
      console.log(`[Transcript] 🔖 会话 ${chatSessionId} 绑定 orchestrator 账本: ${created.path}`);
      return created;
    } catch (err) {
      console.warn('[Transcript] ⚠️ resolve 失败（本轮降级为新建会话）:', err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }

  /** 回合收尾后触发增量索引（幂等，失败静默——真相源永远在 jsonl） */
  indexNow(sessionId: string, jsonlPath: string): void {
    try {
      this.opts.indexer.indexFile(sessionId, jsonlPath);
    } catch (err) {
      console.warn('[Transcript] ⚠️ 索引失败（不影响主流程）:', err instanceof Error ? err.message : String(err));
    }
  }

  /** 供 history 类接口使用：按 sessionKey 取窗口 */
  findWindow(chatSessionId: string): TranscriptWindowRow | undefined {
    return this.opts.store.findWindowByKey(`chat:${chatSessionId}`);
  }

  /**
   * resetSession — T4 管理面：重开会话（不物理删）。
   * 旧窗口转 archived；新账本以 reason:'reset' 登记，previous_session_id 链接旧窗口。
   * LLM 上下文自然断裂（新 jsonl 无历史条目），审计链经 previous_session_id 保留。
   */
  async resetSession(chatSessionId: string): Promise<ChatWindowRef | undefined> {
    const key = `chat:${chatSessionId}`;
    try {
      const old = this.opts.store.findWindowByKey(key);
      let prevId: string | null = null;
      if (old) {
        this.opts.store.setStatus(old.session_id, 'archived');
        prevId = old.session_id;
      }
      const created = await this.opts.createOrchestratorSession(chatSessionId);
      this.opts.store.upsertWindow({
        session_id: created.sessionId,
        session_key: key,
        file_path: created.path,
        component: 'orchestrator',
        reason: 'reset',
        previous_session_id: prevId,
      });
      console.log(`[Transcript] ♻️ 会话 ${chatSessionId} 已重开: 新窗口 ${created.sessionId}${prevId ? ` ← ${prevId}` : ''}`);
      return created;
    } catch (err) {
      console.warn('[Transcript] ⚠️ reset 失败:', err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }

  /** T2：会话列表（chat_index 速查行）；供 /api/sessions 合并 legacy 扫描 */
  listChatSessions(): Array<{ id: string; name?: string; createdAt: number; preview?: string; messageCount?: number; source: 'transcript' }> {
    try {
      return this.opts.store.listChatIndex().map((r) => ({
        id: r.chat_session_id,
        createdAt: r.updated_at,
        preview: r.preview ?? undefined,
        messageCount: r.message_count,
        source: 'transcript' as const,
      }));
    } catch {
      return [];
    }
  }

  /**
   * appendDisplayTurn — T2 回合记录：每轮对话收尾往账本追加一条 morpex.turn 自定义条目。
   *
   * 为什么不是两条 message 条目：任务模式下 OrchestratorAgent 已入账 goal(user)+交付物(assistant)
   * 服务 LLM 上下文；展示层需要的是 naturalReport（拟人化总结）而非截断的 raw deliverable——
   * 用 custom 条目承载展示语义（appendCustom 不进 LLM 上下文，零污染），投影层唯一放行它（§5.1）。
   *
   * 返回回合收尾水位 lastSeq（SSE 对账游标）；无窗口/失败返回 undefined（降级为旧 chat-history 写入）。
   */
  async appendDisplayTurn(
    chatSessionId: string,
    turn: { userText: string; assistantText: string; kind: 'chat' | 'task'; threadId?: string; spaceId?: string },
  ): Promise<{ lastSeq: number } | undefined> {
    if (!this.opts.appendCustomEntry) return undefined;
    const win = this.findWindow(chatSessionId);
    if (!win || !fs.existsSync(win.file_path)) return undefined;
    try {
      await this.opts.appendCustomEntry(win.file_path, 'morpex.turn', {
        user: turn.userText,
        assistant: turn.assistantText,
        kind: turn.kind,
        threadId: turn.threadId,
        spaceId: turn.spaceId,
        timestamp: Date.now(),
      });
      this.indexNow(win.session_id, win.file_path);
      const lastSeq = this.opts.store.getWatermark(win.session_id)?.last_seq ?? 0;
      this.opts.store.upsertChatIndex({
        chat_session_id: chatSessionId,
        last_seq: lastSeq,
        last_role: 'assistant',
        preview: turn.assistantText.replace(/\s+/g, ' ').trim().slice(0, 120) || null,
        updated_at: Date.now(),
      });
      return { lastSeq };
    } catch (err) {
      console.warn('[Transcript] ⚠️ 回合记录写入失败（降级为旧 chat-history）:', err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }

  /**
   * registerComponentSession — T1 parent 链：登记 step/executor 等组件会话窗口。
   * 由 StudioServer 把 AgentSessionStore.onSessionCreated 接到这里；core 不依赖读模型。
   * 父标识优先用回调携带的 parentSessionId，缺省按 parentSessionPath 反查（老账本兑底）。
   */
  registerComponentSession(info: {
    sessionId: string;
    path: string;
    component: string;
    parentSessionPath?: string;
    parentSessionId?: string;
    metadata?: Record<string, unknown>;
  }): void {
    try {
      const parentId = info.parentSessionId
        ?? (info.parentSessionPath ? this.opts.store.findWindowByFilePath(info.parentSessionPath)?.session_id : undefined)
        ?? null;
      // 路由键：绑定到 chat 会话的 orchestrator（metadata.chatSessionId 存在）用 chat:<id> 键——
      // 本方法在 createSession 内部同步触发，早于 resolveOrchestratorPath 自己的 upsert；
      // 若此处用 agent:* 键抢占 session_id，chat:<id> 键将因主键冲突永不生效（双重登记 bug，T1 审计修复）
      const chatId = typeof info.metadata?.chatSessionId === 'string' ? info.metadata.chatSessionId : undefined;
      const sessionKey = chatId ? `chat:${chatId}` : `agent:${info.component}:${info.sessionId}`;
      this.opts.store.upsertWindow({
        session_id: info.sessionId,
        session_key: sessionKey,
        file_path: info.path,
        component: info.component,
        parent_session_id: parentId,
        reason: 'initial',
      });
    } catch (err) {
      console.warn('[Transcript] ⚠️ 组件会话登记失败（不影响主流程）:', err instanceof Error ? err.message : String(err));
    }
  }

}
