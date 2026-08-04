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

export interface AgentSessionCreateOptions {
  component: AgentComponent;
  /** 自定义 id（缺省 repo 自动生成 uuidv7） */
  id?: string;
  goal?: string;
  departmentId?: string;
  /** 父会话路径（跨会话引用/会话树） */
  parentSessionPath?: string;
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
}
