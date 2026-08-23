/**
 * AgentSessionStore — 多 Agent 编排组件会话持久化（会话 4 · Session 化 · P1）
 *
 * 将总大脑 / step-agent / 执行肢升级为独立持久化 Session：
 * - 底层为 pi-agent-core JsonlSessionRepo（JSONL 落盘，进程重启不丢）
 * - 落盘布局：root/<encodeCwd(component)>/<ISO时间戳>_<sessionId>.jsonl
 *   （component 作为分组维度：'orchestrator' | 'step-agent' | 'executor'）
 * - Session 元数据携带 { component, goal, departmentId, ... }
 * - parentSessionPath 支持会话树/跨会话引用（下游 step 引用上游 step 会话）
 *
 * ⚠️ 架构边界：本文件不直接 import pi-agent-core —— 经 PiBridge 静态工厂
 * （createJsonlSessionRepo）创建 repo；Session 类型经 pi-types 的 MPSession（type-only）。
 *
 * @packageDocumentation
 */

import * as path from 'node:path';
import { PiBridge, type AgentSessionRepo } from '../../infrastructure/adapters/index.js';
import type { MPSession } from '../../infrastructure/adapters/index.js';

// ── 类型 ──

/** 编排组件（Session 分组维度） */
export type AgentComponent = 'orchestrator' | 'step-agent' | 'executor';

/** 会话句柄（调用方持有的最小引用） */
export interface AgentSessionHandle {
  sessionId: string;
  /** JSONL 文件绝对路径（跨会话引用/审计锚点） */
  path: string;
  /** pi-agent-core Session 实例（appendCustomEntry 等） */
  session: MPSession;
}

/** 会话元数据（list 返回） */
export interface AgentSessionMeta {
  id: string;
  path: string;
  createdAt: string;
  cwd: string;
  parentSessionPath?: string;
  metadata?: Record<string, unknown>;
}

/** 会话创建选项（T1 parent 链：parentSessionId 为 transcript_windows 的唯一权威父标识） */
export interface AgentSessionCreateOptions {
  component: AgentComponent;
  /** 自定义 id（缺省 repo 自动生成 uuidv7） */
  id?: string;
  goal?: string;
  departmentId?: string;
  /** 父会话路径（跨会话引用/会话树） */
  parentSessionPath?: string;
  /** 父会话 id（transcript_windows.parent_session_id 权威来源；缺省时由消费方按路径反查） */
  parentSessionId?: string;
  metadata?: Record<string, unknown>;
}

/** 会话创建回调信息（T1：studio 侧据此登记 transcript_windows 窗口） */
export interface AgentSessionCreatedInfo {
  sessionId: string;
  path: string;
  component: AgentComponent;
  parentSessionPath?: string;
  parentSessionId?: string;
  /** 创建时的元数据（T1：含 chatSessionId 时以 chat:<id> 为路由键登记，否则 agent:* 键） */
  metadata?: Record<string, unknown>;
}

// ── 窄接口（避免对 pi-agent-core 具体类型的强依赖）──

interface SessionLike {
  getMetadata(): Promise<{
    id: string;
    path: string;
    createdAt: string;
    cwd: string;
    parentSessionPath?: string;
    metadata?: Record<string, unknown>;
  }>;
  getEntries(options?: { afterEntrySeq?: number; limit?: number }): Promise<Array<Record<string, unknown>>>;
  appendCustomEntry(type: string, data?: unknown): Promise<string>;
  appendSessionName(name: string): Promise<string>;
  appendMessage(message: unknown): Promise<string>;
}

// ── AgentSessionStore ──

/**
 * AgentSessionStore — 编排组件持久化会话仓库
 */
export class AgentSessionStore {
  private readonly repo: AgentSessionRepo;
  private readonly root: string;

  /** T1 parent 链：会话创建后回调（由 studio 侧注入登记 transcript_windows；core 不依赖读模型） */
  onSessionCreated?: (info: AgentSessionCreatedInfo) => void;

  constructor(root = 'data/sessions/agent-sessions') {
    this.root = path.resolve(root);
    this.repo = PiBridge.createJsonlSessionRepo(this.root);
  }

  get rootPath(): string {
    return this.root;
  }

  /**
   * createSession — 创建组件会话（component 为分组维度，元数据携带 goal/departmentId）
   */
  async createSession(opts: AgentSessionCreateOptions): Promise<AgentSessionHandle> {
    const session = await this.repo.create({
      id: opts.id,
      cwd: opts.component,
      parentSessionPath: opts.parentSessionPath,
      metadata: {
        component: opts.component,
        goal: opts.goal,
        departmentId: opts.departmentId,
        ...opts.metadata,
      },
    });
    const meta = await (session as unknown as SessionLike).getMetadata();
    // T1 parent 链：通知外部读模型登记窗口（失败不影响主流程）
    try {
      this.onSessionCreated?.({
        sessionId: meta.id,
        path: meta.path,
        component: opts.component,
        parentSessionPath: opts.parentSessionPath,
        parentSessionId: opts.parentSessionId,
        metadata: opts.metadata,
      });
    } catch (err) {
      console.warn('[AgentSessionStore] ⚠️ onSessionCreated 回调失败（不影响会话创建）:', err instanceof Error ? err.message : String(err));
    }
    return {
      sessionId: meta.id,
      path: meta.path,
      session: session as MPSession,
    };
  }

  /**
   * open — 按元数据打开已存在会话（跨会话讨论：读取上游 step 会话记录）
   */
  async open(metadata: { path: string }): Promise<MPSession> {
    return this.repo.open(metadata as never) as unknown as MPSession;
  }

  /**
   * openHandle — 按路径打开既有会话并返回完整句柄（T0 多轮连续：同一 chat 会话复用同一本 orchestrator 账本）。
   * resume 语义：repo.open 后 pi 引擎自动重放全部 entries 为 LLM 上下文。
   */
  async openHandle(path: string): Promise<AgentSessionHandle> {
    const session = await this.repo.open({ path } as never) as unknown as SessionLike;
    const meta = await session.getMetadata();
    return { sessionId: meta.id, path: meta.path, session: session as unknown as MPSession };
  }

  /**
   * list — 列出会话（按组件过滤可选；按 createdAt 倒序）
   */
  async list(component?: AgentComponent): Promise<AgentSessionMeta[]> {
    const metas = await this.repo.list(component ? { cwd: component } : undefined);
    return (metas as unknown as AgentSessionMeta[]).map(m => ({
      id: m.id,
      path: m.path,
      createdAt: m.createdAt,
      cwd: m.cwd,
      parentSessionPath: m.parentSessionPath,
      metadata: m.metadata as Record<string, unknown> | undefined,
    }));
  }

  /**
   * fork — 从源会话派生新会话（parentSessionPath 指向源；继承源条目）
   */
  async fork(
    source: { path: string },
    opts: { component: AgentComponent; id?: string; metadata?: Record<string, unknown> },
  ): Promise<AgentSessionHandle> {
    const session = await this.repo.fork(source as never, {
      cwd: opts.component,
      id: opts.id,
      metadata: { component: opts.component, ...opts.metadata },
    });
    const meta = await (session as unknown as SessionLike).getMetadata();
    return {
      sessionId: meta.id,
      path: meta.path,
      session: session as MPSession,
    };
  }

  /**
   * appendMessage — 写入对话消息条目（进 LLM 上下文；T0 多轮连续：goal/最终交付物落账，resume 时回读注入分析）
   */
  async appendMessage(session: unknown, message: { role: 'user' | 'assistant'; content: string; timestamp?: number }): Promise<void> {
    if (!session) return;
    try {
      await (session as SessionLike).appendMessage(message);
    } catch (err) {
      console.warn(`[AgentSessionStore] ⚠️ appendMessage 失败: ${(err as Error).message}`);
    }
  }

  /**
   * appendCustom — 写入自定义条目（不进 LLM 上下文，适合记录分析/审计/结果）
   */
  async appendCustom(session: unknown, type: string, data: unknown): Promise<void> {
    if (!session) return;
    try {
      await (session as SessionLike).appendCustomEntry(type, data);
    } catch (err) {
      console.warn(`[AgentSessionStore] ⚠️ appendCustom(${type}) 失败: ${(err as Error).message}`);
    }
  }

  /**
   * appendSessionName — 设置会话显示名
   */
  async appendSessionName(session: unknown, name: string): Promise<void> {
    if (!session) return;
    try {
      await (session as SessionLike).appendSessionName(name);
    } catch { /* 非关键，忽略 */ }
  }

  /**
   * readEntries — 读取会话全部条目（治理/审计消费端；会话化治理 UI 数据源）
   *
   * 按 path 打开已持久化会话并读取所有条目，归一化为 JSON 可序列化纯对象：
   *   - message        → { type, id, parentId, timestamp, role, content }
   *   - custom         → { type, id, parentId, timestamp, customType, data }
   *   - custom_message → { type, id, parentId, timestamp, customType, content, display, details }
   *   - 其余           → 基础字段 + 已知扩展字段（thinking_level_change/model_change/...）
   *
   * 打开/读取失败 → 返回 []（不抛，消费端容错）。
   */
  async readEntries(path: string): Promise<Array<Record<string, unknown>>> {
    if (!path) return [];
    try {
      const session = await this.repo.open({ path } as never);
      const entries = await (session as unknown as SessionLike).getEntries();
      if (!Array.isArray(entries)) return [];
      return entries.map(normalizeEntry);
    } catch (err) {
      console.warn(`[AgentSessionStore] ⚠️ readEntries(${path}) 失败: ${(err as Error).message}`);
      return [];
    }
  }
}

// ── 条目归一化（治理/审计消费端）──

/**
 * normalizeEntry — pi-agent-core SessionTreeEntry → JSON 可序列化纯对象
 *
 * 基础字段 type/id/parentId/timestamp 恒保留；按 entry 类型提取业务字段：
 *   message → role/content（AgentMessage 文本）；custom → customType/data；
 *   custom_message → customType/content/display/details；其余类型保留已知扩展字段。
 */
function normalizeEntry(raw: Record<string, unknown>): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: raw.type ?? 'unknown',
    id: raw.id,
    parentId: raw.parentId ?? null,
    timestamp: raw.timestamp,
  };

  switch (raw.type) {
    case 'message': {
      const msg = (raw.message ?? {}) as Record<string, unknown>;
      // 17i.4：附带原始内容块数组（text/toolCall/toolResult），供前端实时渲染思考/工具调用/输出；
      //        content 保持 contentToText 纯文本（既有消费者不受影响，纯加法）。
      // 17i.9：附带 toolName/toolCallId（toolResult 消息的工具名在消息级，不在块级）——前端据此正确渲染工具结果。
      return {
        ...base,
        role: msg.role ?? 'unknown',
        content: contentToText(msg.content),
        ...(typeof msg.toolName === 'string' ? { toolName: msg.toolName } : {}),
        ...(typeof msg.toolCallId === 'string' ? { toolCallId: msg.toolCallId } : {}),
        ...(Array.isArray(msg.content) ? { contentBlocks: msg.content } : {}),
      };
    }
    case 'custom':
      return { ...base, customType: raw.customType, data: raw.data ?? undefined };
    case 'custom_message':
      return { ...base, customType: raw.customType, content: contentToText(raw.content), display: raw.display, details: raw.details };
    case 'thinking_level_change':
      return { ...base, thinkingLevel: raw.thinkingLevel };
    case 'model_change':
      return { ...base, provider: raw.provider, modelId: raw.modelId };
    case 'active_tools_change':
      return { ...base, activeToolNames: raw.activeToolNames };
    case 'label':
      return { ...base, targetId: raw.targetId, label: raw.label };
    case 'branch_summary':
      return { ...base, summary: raw.summary, details: raw.details };
    case 'compaction':
      return { ...base, summary: raw.summary, tokensBefore: raw.tokensBefore };
    default:
      // session_info / leaf / 未知类型：保留除内部结构外已知标量字段
      return base;
  }
}

/** 消息 content（文本或内容块数组）→ 纯文本 */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .map((c) => (typeof c.text === 'string' ? c.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}
