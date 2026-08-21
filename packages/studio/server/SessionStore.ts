/**
 * SessionStore — 会话持久化管理器
 *
 * 职责：
 *   1. 聊天历史 JSONL 文件的读写
 *   2. 节点执行历史 JSONL 文件的读写
 *   3. 会话名称的持久化
 *
 * 从 StudioServer 提取，消除文件 I/O 与 HTTP 路由的耦合。
 *
 * ★ v3.2 重命名：原 SessionManager 拆分，
 *   新的 SessionManager 负责 pi Session 生命周期管理。
 *
 * ★ 会话 17h：成为会话唯一真相源（listSessions 从磁盘水合 / deleteSession 幂等删除），
 *   全方法加 SESSION_ID_RE 白名单防路径穿越（%2F 解码穿越）。
 */

import * as fs from 'fs';
import * as path from 'path';

/** 会话/执行 ID 白名单（防路径穿越：Express 会解码 %2F 为 /，无白名单可删任意 jsonl）。 */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export class SessionStore {
  private sessionsRoot: string;
  private sessionNamesPath: string;
  private chatHistoryDir: string;
  private sessionNames: Map<string, string> = new Map();

  constructor(sessionsRoot?: string) {
    this.sessionsRoot = path.resolve(sessionsRoot || './data/sessions');
    this.sessionNamesPath = path.join(this.sessionsRoot, 'session-names.json');
    this.chatHistoryDir = path.join(this.sessionsRoot, 'chat-history');
    this.loadSessionNames();
  }

  private isValidSessionId(id: string): boolean {
    return typeof id === 'string' && SESSION_ID_RE.test(id);
  }

  // ═══════════════════════════════════════════════════════════════
  // 会话名称
  // ═══════════════════════════════════════════════════════════════

  private loadSessionNames(): void {
    try {
      if (fs.existsSync(this.sessionNamesPath)) {
        const raw = fs.readFileSync(this.sessionNamesPath, 'utf-8');
        const data = JSON.parse(raw);
        if (data && typeof data === 'object') this.sessionNames = new Map(Object.entries(data));
      }
    } catch (e) {
      console.warn(`[SessionNames] 加载失败: ${e.message}`);
    }
  }

  getSessionName(sessionId: string): string | undefined {
    return this.sessionNames.get(sessionId);
  }

  setSessionName(sessionId: string, name: string): void {
    this.sessionNames.set(sessionId, name);
    this.saveSessionNames();
  }

  private saveSessionNames(): void {
    try {
      const dir = path.dirname(this.sessionNamesPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.sessionNamesPath, JSON.stringify(Object.fromEntries(this.sessionNames), null, 2), 'utf-8');
    } catch (e) {
      console.warn(`[SessionNames] 保存失败: ${e.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 会话列表 / 删除（会话唯一真相源：以 chat-history 目录为准）
  // ═══════════════════════════════════════════════════════════════

  /**
   * listSessions — 从磁盘扫描全部有聊天记录的会话（id = chat-history/*.jsonl）。
   * 名称从 session-names.json 取，createdAt 取文件 mtime；按 createdAt 降序。
   * 空会话（无 jsonl）不在此列——属预期行为（无价值，前端下次发送时自动新建）。
   */
  listSessions(): Array<{ id: string; name?: string; createdAt: number }> {
    try {
      if (!fs.existsSync(this.chatHistoryDir)) return [];
      const items = fs
        .readdirSync(this.chatHistoryDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => {
          const id = f.slice(0, -'.jsonl'.length);
          let createdAt = 0;
          try {
            createdAt = fs.statSync(path.join(this.chatHistoryDir, f)).mtimeMs;
          } catch {
            /* mtime 不可得则 0 */
          }
          return { id, name: this.sessionNames.get(id), createdAt };
        })
        .sort((a, b) => b.createdAt - a.createdAt);
      return items;
    } catch (e) {
      console.warn(`[SessionStore] 会话列表读取失败: ${e.message}`);
      return [];
    }
  }

  /**
   * deleteSession — 删除会话的聊天历史 jsonl 与名称条目（幂等）。
   * @returns 是否发生了删除（文件或名称条目任一存在即 true）。
   */
  deleteSession(sessionId: string): boolean {
    if (!this.isValidSessionId(sessionId)) return false;
    let deleted = false;
    const filePath = path.join(this.chatHistoryDir, `${sessionId}.jsonl`);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deleted = true;
      }
    } catch (e) {
      console.warn(`[SessionStore] 删除聊天历史失败: ${e.message}`);
    }
    if (this.sessionNames.delete(sessionId)) {
      this.saveSessionNames();
      deleted = true;
    }
    return deleted;
  }

  // ═══════════════════════════════════════════════════════════════
  // 聊天历史
  // ═══════════════════════════════════════════════════════════════

  appendChatMessage(sessionId: string, message: {
    role: 'user' | 'system'; content: string; region?: string; status?: string; executionId?: string; timestamp?: number; dag?: any;
    /** P1 部门 Space：消息归属（chat=闲聊 / task=任务）；旧消息无字段默认 chat */
    kind?: 'chat' | 'task';
    /** P1 部门 Space：所属空间（hq=总部 / dept_xxx=部门）；无字段旧消息归 hq */
    spaceId?: string;
    /** P1 部门 Space：任务线程 id（=missionId） */
    threadId?: string;
    /** P1 部门 Space：部门 id */
    departmentId?: string;
  }): void {
    if (!this.isValidSessionId(sessionId)) return;
    const filePath = path.join(this.chatHistoryDir, `${sessionId}.jsonl`);
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(filePath, JSON.stringify({ ...message, timestamp: message.timestamp ?? Date.now() }) + '\n', 'utf-8');
    } catch (err) {
      console.error(`[ChatHistory] 写入失败: ${err.message}`);
    }
  }

  /**
   * P1 部门 Space：回填最后一条无 threadId 的用户消息（executeGoal 返回 missionId/mode 后补充归属）。
   * 重写 jsonl 对应行（文件小，可接受）。找不到匹配则静默跳过。
   */
  patchLastUserMessage(sessionId: string, patch: { threadId?: string; spaceId?: string; departmentId?: string; kind?: 'chat' | 'task' }): void {
    if (!this.isValidSessionId(sessionId)) return;
    const filePath = path.join(this.chatHistoryDir, `${sessionId}.jsonl`);
    try {
      if (!fs.existsSync(filePath)) return;
      const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i]) continue;
        try {
          const msg = JSON.parse(lines[i]);
          if (msg.role === 'user' && !msg.threadId) {
            msg.threadId = patch.threadId ?? msg.threadId;
            msg.spaceId = patch.spaceId ?? msg.spaceId;
            msg.departmentId = patch.departmentId ?? msg.departmentId;
            msg.kind = patch.kind ?? msg.kind;
            lines[i] = JSON.stringify(msg);
            fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
            return;
          }
        } catch { /* 跳过损坏行 */ }
      }
    } catch (err) {
      console.error(`[ChatHistory] 回填失败: ${(err as Error).message}`);
    }
  }
  getChatHistory(sessionId: string): any[] {
    if (!this.isValidSessionId(sessionId)) return [];
    const filePath = path.join(this.chatHistoryDir, `${sessionId}.jsonl`);
    try {
      if (!fs.existsSync(filePath)) return [];
      const out: any[] = [];
      for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
        if (!line) continue;
        try {
          out.push(JSON.parse(line));
        } catch {
          /* 单行损坏跳过，不影响其余历史 */
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 节点执行历史
  // ═══════════════════════════════════════════════════════════════

  appendTaskMessage(execId: string, taskId: string, msg: { role: string; content: string; timestamp?: number }): void {
    if (!this.isValidSessionId(execId) || !this.isValidSessionId(taskId)) return;
    const dir = path.join(this.sessionsRoot, 'task-history', execId);
    const filePath = path.join(dir, `${taskId}.jsonl`);
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(filePath, JSON.stringify({ ...msg, timestamp: msg.timestamp ?? Date.now() }) + '\n', 'utf-8');
    } catch {
      /* 非关键 I/O */
    }
  }

  getTaskMessages(execId: string, taskId: string): any[] {
    if (!this.isValidSessionId(execId) || !this.isValidSessionId(taskId)) return [];
    const filePath = path.join(this.sessionsRoot, 'task-history', execId, `${taskId}.jsonl`);
    try {
      if (!fs.existsSync(filePath)) return [];
      return fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    } catch {
      return [];
    }
  }
}
