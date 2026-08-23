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
  /** T0 遗留映射文件路径（存在则自动迁移）；不传则跳过 */
  legacyMapPath?: string;
}

export class ChatTranscriptService {
  private legacy: Map<string, string> | null = null;

  constructor(private opts: ChatTranscriptServiceOptions) {
    this.importLegacyIfNeeded();
  }

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

      // ② T0 遗留映射懒迁移：老绑定 → 打开拿真实 id → 入库
      const legacyPath = this.legacy?.get(chatSessionId);
      if (legacyPath && fs.existsSync(legacyPath)) {
        const ref = await this.opts.openHandle(legacyPath);
        this.opts.store.upsertWindow({
          session_id: ref.sessionId,
          session_key: key,
          file_path: ref.path,
          component: 'orchestrator',
          reason: 'initial',
        });
        this.legacy?.delete(chatSessionId);
        console.log(`[Transcript] 🔖 会话 ${chatSessionId} 迁移旧绑定 → 窗口 ${ref.sessionId}`);
        return ref;
      }
      this.legacy?.delete(chatSessionId); // 老绑定文件已不存在，清掉

      // ③ 全新会话 → 新建账本 + 登记
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

  /** T0 遗留 chat-orch-map.json → 内存 Map 并改名 .imported（数据不丢：若懒迁移完成前崩溃，重启会从 .imported 重新载入） */
  private importLegacyIfNeeded(): void {
    if (!this.opts.legacyMapPath) return;
    const main = this.opts.legacyMapPath;
    const imported = `${main}.imported`;
    // 主文件不存在时回退读 .imported（上次启动改名后、懒迁移未完就崩的场景，避免旧绑定永久孤儿化）
    const source = fs.existsSync(main) ? main : fs.existsSync(imported) ? imported : null;
    if (!source) return;
    try {
      const raw = JSON.parse(fs.readFileSync(source, 'utf-8')) as Record<string, string>;
      this.legacy = new Map(Object.entries(raw).map(([k, v]) => [k, String(v)]));
      if (source === main) fs.renameSync(main, imported);
      console.log(`[Transcript] 📦 已载入旧 chat-orch-map（${this.legacy.size} 条，源=${path.basename(source)}），待懒迁移`);
    } catch (err) {
      console.warn('[Transcript] ⚠️ 旧 chat-orch-map 载入失败（跳过，不影响新架构）:', err instanceof Error ? err.message : String(err));
    }
  }
}
