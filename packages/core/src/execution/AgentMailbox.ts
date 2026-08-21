/**
 * AgentMailbox — 跨部门/工位真交流（P2）
 *
 * 设计契约：docs/design/space-model.md §4
 * 背景：引擎 step-agent 是异步的（每步骤独立会话，跑完即结束，不会"挂机等消息"）。
 * 因此 AgentMailbox 的"对方回复"由 **LLM 扮演目标角色生成**：
 *   发送方 step-agent（或外部）调 `mail` 原语 → 本服务用 LLM 扮演 `to` 角色
 *   （部门 persona / 工位 persona）生成回复 → 返回给发送方继续执行。
 *   消息落盘 data/mailbox/<spaceId>.jsonl + 发 agent.message / agent.message.received 事件，
 *   供前端只读旁观（Q2=A：自动 + 旁观）。
 *
 * 与 UserAskService / PlanGateService / ApprovalGate 同构：request→wait promise→resolve；
 * 差异：回复方是 LLM 扮演（角色模拟），不是真实用户。
 */

import type { EventBus } from '../infrastructure/common/EventBus.js';
import type { SpaceService } from '../governance/control-plane/SpaceService.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type MailActor = string; // 'station:<agentType>' | 'dept:<workflowId>' | 'agent:<name>'

export interface MailMessage {
  id: string;
  /** 发送方角色：'station:xxx' | 'dept:xxx' | 'agent:xxx' */
  from: string;
  /** 目标角色（LLM 扮演回复）：'station:xxx' | 'dept:xxx' */
  to: string;
  /** 归属 Space（dept_xxx；无则 'general'） */
  spaceId?: string;
  /** 关联任务 id（executionId / missionId，有则带） */
  taskId?: string;
  /** 触发它的任务目标（供 LLM 扮演注入上下文） */
  goal?: string;
  question: string;
  reply?: string;
  status: 'pending' | 'replied' | 'timeout';
  createdAt: number;
  repliedAt?: number;
  /** 落盘时的更新标记（同 id 的最新行覆盖旧行） */
  __updated?: boolean;
}

export interface AgentMailboxOptions {
  dataRoot?: string;
  /** 默认等待回复超时（毫秒；默认 60s）。超时按「未回复继续」处理，不卡死任务。 */
  defaultTimeoutMs?: number;
}

interface PendingRecord {
  msg: MailMessage;
  resolve: (reply: string) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export class AgentMailbox {
  private dataRoot: string;
  private mailboxDir: string;
  private eventBus: EventBus | null = null;
  private llmFn: ((system: string, prompt: string) => Promise<string>) | null = null;
  private spaceService: SpaceService | null = null;
  private pending = new Map<string, PendingRecord>();
  private seq = 0;
  private defaultTimeoutMs: number;

  constructor(opts: AgentMailboxOptions = {}) {
    this.dataRoot = path.resolve(opts.dataRoot ?? path.join(process.cwd(), 'data'));
    this.mailboxDir = path.join(this.dataRoot, 'mailbox');
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    try {
      fs.mkdirSync(this.mailboxDir, { recursive: true });
    } catch (err) {
      console.warn('[AgentMailbox] ⚠️ 邮箱目录创建失败:', (err as Error).message);
    }
  }

  setEventBus(bus: EventBus): void { this.eventBus = bus; }
  setLLM(fn: (system: string, prompt: string) => Promise<string>): void { this.llmFn = fn; }
  setSpaceService(svc: SpaceService): void { this.spaceService = svc; }

  /**
   * 发送并等待回复（阻塞，promise resolve 时返回对方回复文本）。
   * 回复由 LLM 扮演 `to` 角色生成；LLM 不可用/失败 → 模板兜底；超时 → 'timeout' 状态 + 兜底文本。
   * 绝不 throw：任何异常都降级为"按不知道继续"，不使任务失败。
   */
  sendAndWait(opts: {
    from: string;
    to: string;
    question: string;
    spaceId?: string;
    taskId?: string;
    goal?: string;
    timeoutMs?: number;
  }): Promise<string> {
    const id = `mail_${Date.now()}_${++this.seq}`;
    const msg: MailMessage = {
      id,
      from: opts.from,
      to: opts.to,
      spaceId: opts.spaceId,
      taskId: opts.taskId,
      goal: opts.goal,
      question: opts.question,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.append(msg);
    this.emit('agent.message', msg, {});
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
    const self = this;
    return new Promise<string>((resolve) => {
      const timer = setTimeout(() => {
        const rec = self.pending.get(id);
        if (!rec) return;
        self.pending.delete(id);
        const done: MailMessage = { ...msg, status: 'timeout', repliedAt: Date.now() };
        self.patchStore(done);
        self.emit('agent.message.timeout', done, {});
        resolve('[mail 超时] 未在限时内收到回复，按「不知道」继续');
      }, timeoutMs);
      self.pending.set(id, { msg, resolve, timer });
      void self.fulfill(id);
    });
  }

  /** 异步扮演目标角色生成回复 → 更新落盘 + 事件 + resolve。 */
  private async fulfill(id: string): Promise<void> {
    const rec = this.pending.get(id);
    if (!rec) return;
    const { msg, resolve, timer } = rec;
    const reply = await this.generateReply(msg);
    clearTimeout(timer);
    this.pending.delete(id);
    const done: MailMessage = { ...msg, reply, status: 'replied', repliedAt: Date.now() };
    this.patchStore(done);
    this.emit('agent.message.received', done, { reply });
    resolve(reply);
  }

  private async generateReply(msg: MailMessage): Promise<string> {
    const persona = this.resolvePersona(msg);
    if (!this.llmFn) return this.fallbackReply();
    const system = [
      `你是 MorPex 的${persona}。`,
      '你正在协助团队完成一项任务。请以该角色的专业视角，回答同事发来的咨询问题。',
      '要求：直接给出答案或建议，2-4 句话，不要用 Markdown、列表或符号。',
      '不知道或不在你职责范围内，如实说「不确定」，不要编造。',
    ].join('\n');
    const prompt = `咨询问题：${msg.question}` + (msg.goal ? `\n相关任务背景：${msg.goal}` : '');
    try {
      const text = (await this.llmFn(system, prompt)).trim();
      return text || this.fallbackReply();
    } catch (err) {
      console.warn(`[AgentMailbox] ⚠️ 角色回复生成失败（模板兜底）: ${err instanceof Error ? err.message : String(err)}`);
      return this.fallbackReply();
    }
  }

  private fallbackReply(): string {
    return '收到，我核实一下，稍后给你准确答复。';
  }

  /** 解析 to 角色的人设：dept:xxx → SpaceService 部门经理 persona；station:xxx → 通用工位人设。 */
  private resolvePersona(msg: MailMessage): string {
    const to = msg.to;
    const goal = msg.goal ? `「${msg.goal}」` : '';
    if (to.startsWith('dept:')) {
      const wfId = to.slice('dept:'.length).trim();
      const sp = this.spaceService?.getDepartmentSpace(wfId);
      if (sp?.managerPersona) return sp.managerPersona;
      return `${wfId || '相关'}部门经理`;
    }
    if (to.startsWith('station:')) {
      const st = to.slice('station:'.length).trim() || '专业工位';
      return `专业工位「${st}」${goal ? `（正在协作完成 ${goal}）` : ''}`;
    }
    return `角色「${to || '合作伙伴'}」`;
  }

  private emit(type: string, msg: MailMessage, _extra: Record<string, unknown>): void {
    this.eventBus?.emit({
      id: `evt_${msg.id}`,
      type,
      timestamp: Date.now(),
      executionId: msg.taskId ?? `mail_${msg.id}`,
      source: 'agent-mailbox',
      payload: { ...msg },
    });
  }

  // ── 落盘（data/mailbox/<spaceId>.jsonl，逐行 JSON）──
  private fileFor(spaceId?: string): string {
    const safe = (spaceId ?? 'general').replace(/[^A-Za-z0-9_-]/g, '_');
    return path.join(this.mailboxDir, `${safe}.jsonl`);
  }

  private append(msg: MailMessage): void {
    try {
      fs.appendFileSync(this.fileFor(msg.spaceId), JSON.stringify(msg) + '\n', 'utf-8');
    } catch (err) {
      console.warn('[AgentMailbox] ⚠️ 落盘失败:', (err as Error).message);
    }
  }

  /** 更新某条消息：追加一行同 id（__updated 标记），读取时同 id 取最新行。 */
  private patchStore(done: MailMessage): void {
    try {
      fs.appendFileSync(this.fileFor(done.spaceId), JSON.stringify({ ...done, __updated: true }) + '\n', 'utf-8');
    } catch (err) {
      console.warn('[AgentMailbox] ⚠️ 落盘更新失败:', (err as Error).message);
    }
  }

  /** 查询某 Space 的邮箱消息（磁盘最新合并内存 pending；按时间升序返回最近 limit 条）。 */
  listForSpace(spaceId?: string, limit = 200): MailMessage[] {
    const file = this.fileFor(spaceId);
    const out: MailMessage[] = [];
    try {
      if (fs.existsSync(file)) {
        const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const m = JSON.parse(line) as MailMessage;
            const idx = out.findIndex((x) => x.id === m.id);
            if (idx >= 0) out[idx] = m;
            else out.push(m);
          } catch { /* 容错：损坏行跳过 */ }
        }
      }
    } catch { /* 忽略 */ }
    // 合并内存 pending（磁盘最新行可能滞后于内存实时状态）
    for (const { msg } of this.pending.values()) {
      const idx = out.findIndex((x) => x.id === msg.id);
      if (idx >= 0) out[idx] = { ...out[idx], status: msg.status, from: msg.from, to: msg.to, question: msg.question };
    }
    return out.slice(-limit);
  }

  /** 全量待回复（供调试/端点）。 */
  getPending(): MailMessage[] {
    return [...this.pending.values()].map((r) => r.msg);
  }
}

/** ═══ 模块级实例：StepAgentExecutor / StudioServer / bootstrap 共用（UserAskService 同构）═══ */
let mailboxInstance: AgentMailbox | null = null;
export function setMailboxInstance(m: AgentMailbox | null): void { mailboxInstance = m; }
export function getMailbox(): AgentMailbox | null { return mailboxInstance; }

/** 角色可读描述（日志/报告用）。 */
export function describeMailActor(actor: string): string {
  if (actor.startsWith('dept:')) return `${actor.slice(5) || '部门'}（部门）`;
  if (actor.startsWith('station:')) return `工位「${actor.slice(8) || '?'}」`;
  return actor;
}