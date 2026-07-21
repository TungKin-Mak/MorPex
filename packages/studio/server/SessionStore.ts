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
 */

import * as fs from 'fs';
import * as path from 'path';

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
    try {
      const dir = path.dirname(this.sessionNamesPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.sessionNamesPath, JSON.stringify(Object.fromEntries(this.sessionNames), null, 2), 'utf-8');
    } catch (e) {
      console.warn(`[SessionNames] 保存失败: ${e.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 聊天历史
  // ═══════════════════════════════════════════════════════════════

  appendChatMessage(sessionId: string, message: {
    role: 'user' | 'system'; content: string; region?: string; status?: string; executionId?: string; timestamp?: number; dag?: any;
  }): void {
    if (!sessionId) return;
    const filePath = path.join(this.chatHistoryDir, `${sessionId}.jsonl`);
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(filePath, JSON.stringify({ ...message, timestamp: message.timestamp ?? Date.now() }) + '\n', 'utf-8');
    } catch (err) {
      console.error(`[ChatHistory] 写入失败: ${err.message}`);
    }
  }

  getChatHistory(sessionId: string): any[] {
    if (!sessionId) return [];
    const filePath = path.join(this.chatHistoryDir, `${sessionId}.jsonl`);
    try {
      if (!fs.existsSync(filePath)) return [];
      return fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 节点执行历史
  // ═══════════════════════════════════════════════════════════════

  appendTaskMessage(execId: string, taskId: string, msg: { role: string; content: string; timestamp?: number }): void {
    if (!execId || !taskId) return;
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
    if (!execId || !taskId) return [];
    const filePath = path.join(this.sessionsRoot, 'task-history', execId, `${taskId}.jsonl`);
    try {
      if (!fs.existsSync(filePath)) return [];
      return fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    } catch {
      return [];
    }
  }
}
