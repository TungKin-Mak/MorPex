/**
 * gate/modelVisibleLog — Model-Visible 宣言（运行时不变量）
 *
 * 参考 deepseek-harness 的 "Model-visible means logged" 设计：
 *   任何进入模型上下文的材料，必须可从一个持久化记录点重建。
 *
 * 本模块是**断言层**——持久化底座（ContextPersistence SQLite 快照 /
 * DeblackboxRecorder 决策单 / AgentSessionStore JSONL）已经存在，
 * 本模块补的是「运行时强制校验」：谁组装了模型可见材料，谁负责签发
 * ModelVisibleEntry；随后用 resolver 从真实持久化点取回内容验证可重建。
 *
 * 语义（宪法级，不做 WARN）：
 *   - 断言失败 → 抛 ModelVisibleNotLoggedError，业务代码不能再继续
 *   - 与 gate/context.ts 的 GateContextRequiredError 同一强度
 *   - 绝不静默：能取回 = 通过；取不回 = 抛错
 *
 * 降级路径（真实存在）：
 *   - ContextPersistence 配置且快照在 → 优先（SQLite 持久）
 *   - persistence 未配置 / 快照缺失 → 回退 DeblackboxRecorder 决策单
 *   - 两者都取不回 → 抛错（这才是硬约束触发点）
 *
 * @packageDocumentation
 */

import type { ContextPersistence } from '../knowledge/context/ContextPersistence.js';
import type { DeblackboxRecorder } from '../infrastructure/observability/deblackbox/DeblackboxRecorder.js';

// ── 类型 ──

/** 模型可见材料类别 */
export type ModelVisibleKind =
  | 'context-package'   // RAG-lazy 四层装配的 focusedSummary（ContextAssemblyEngine 签发）
  | 'user-message'
  | 'tool-result'
  | 'system-prompt'
  | 'llm-request';

/** 一次「模型可见材料 → 持久化点」的定位条目 */
export interface ModelVisibleEntry {
  /** 条目唯一 ID（mvl_ 前缀） */
  id: string;
  /** 持久化定位符：'context-snapshot:{contextId}:{version}' | 'deblackbox:{category}:{executionId}' */
  contentKey: string;
  kind: ModelVisibleKind;
  /** 签发时间（ms） */
  loggedAt: number;
  /** 描述持久化源（'context-snapshots' | 'deblackbox-recorder' | 'session-jsonl'） */
  replayedFrom: string;
}

/** resolver 解析结果 */
export interface ModelVisibleResolved {
  found: boolean;
  /** 重建的模型可见文本（非空才视为通过） */
  content?: string;
  /** 实际命中的存储（'context-snapshots' | 'deblackbox-recorder'） */
  store?: string;
}

/** resolver：按 entry 从持久化点取回真实内容 */
export type ModelVisibleResolver = (entry: ModelVisibleEntry) => ModelVisibleResolved;

// ── 错误 ──

/** Model-Visible 宣言失败：模型可见材料无法从持久化点重建（宪法级不变量） */
export class ModelVisibleNotLoggedError extends Error {
  constructor(kind: ModelVisibleKind, contentKey: string, detail?: string) {
    const suffix = detail ? `：${detail}` : '';
    super(`[Model-Visible 宣言] kind=${kind} 的模型可见材料无法从持久化点重建（contentKey=${contentKey}）${suffix}`);
    this.name = 'ModelVisibleNotLoggedError';
  }
}

// ── contentKey 编解码 ──

const CONTEXT_SNAPSHOT_PREFIX = 'context-snapshot:';
const DEBLACKBOX_PREFIX = 'deblackbox:';

export interface ContextSnapshotKey {
  contextId: string;
  version: number;
}

export function encodeContextSnapshotKey(contextId: string, version: number): string {
  return `${CONTEXT_SNAPSHOT_PREFIX}${contextId}:${version}`;
}

export function parseContextSnapshotKey(contentKey: string): ContextSnapshotKey | null {
  if (!contentKey.startsWith(CONTEXT_SNAPSHOT_PREFIX)) return null;
  const rest = contentKey.slice(CONTEXT_SNAPSHOT_PREFIX.length);
  // 格式：{contextId}:{version}（contextId 内不出现冒号）
  const sep = rest.lastIndexOf(':');
  if (sep <= 0) return null;
  const version = Number(rest.slice(sep + 1));
  if (!Number.isInteger(version)) return null;
  return { contextId: rest.slice(0, sep), version };
}

export interface DeblackboxKey {
  category: string;
  executionId: string;
}

export function encodeDeblackboxKey(category: string, executionId: string): string {
  return `${DEBLACKBOX_PREFIX}${category}:${executionId}`;
}

export function parseDeblackboxKey(contentKey: string): DeblackboxKey | null {
  if (!contentKey.startsWith(DEBLACKBOX_PREFIX)) return null;
  const rest = contentKey.slice(DEBLACKBOX_PREFIX.length);
  const sep = rest.lastIndexOf(':');
  if (sep <= 0) return null;
  return { category: rest.slice(0, sep), executionId: rest.slice(sep + 1) };
}

// ── Entry 工厂 ──

function newId(seed: string): string {
  return `mvl_${seed}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 上下文包条目：指向 ContextPersistence 快照（或降级 deblackbox） */
export function createContextPackageEntry(opts: {
  contextId: string;
  version: number;
  executionId: string;
}): ModelVisibleEntry {
  const contentKey = encodeContextSnapshotKey(opts.contextId, opts.version);
  return {
    id: newId(opts.contextId),
    contentKey,
    kind: 'context-package',
    loggedAt: Date.now(),
    replayedFrom: 'context-snapshots',
  };
}

/** 降级条目：指向 DeblackboxRecorder 决策单（context.retrieval 等） */
export function createDeblackboxEntry(opts: {
  category: string;
  executionId: string;
}): ModelVisibleEntry {
  const contentKey = encodeDeblackboxKey(opts.category, opts.executionId);
  return {
    id: newId(opts.category),
    contentKey,
    kind: 'context-package',
    loggedAt: Date.now(),
    replayedFrom: 'deblackbox-recorder',
  };
}

// ── Resolver ──

/** ContextPersistence 快照 resolver：只认 context-snapshot:* 键 */
export function contextPersistenceResolver(
  persistence: ContextPersistence,
): ModelVisibleResolver {
  return (entry: ModelVisibleEntry): ModelVisibleResolved => {
    const key = parseContextSnapshotKey(entry.contentKey);
    if (!key) return { found: false };
    try {
      const ctx = persistence.loadVersion(key.contextId, key.version);
      if (!ctx) return { found: false };
      const content = ctx.focusedSummary ?? '';
      if (!content) return { found: false };
      return { found: true, content, store: 'context-snapshots' };
    } catch (err) {
      // 快照查询异常（如表缺失）→ 视为不可重建，交由组合 resolver 降级
      console.warn('[modelVisibleLog] ⚠️ 快照查询异常（走降级路径）:', err instanceof Error ? err.message : String(err));
      return { found: false };
    }
  };
}

/** DeblackboxRecorder resolver：只认 deblackbox:{category}:{executionId} 键 */
export function deblackboxResolver(recorder: DeblackboxRecorder): ModelVisibleResolver {
  return (entry: ModelVisibleEntry): ModelVisibleResolved => {
    const key = parseDeblackboxKey(entry.contentKey);
    if (!key) return { found: false };
    try {
      const rec = recorder.getRecent(key.category, 50)
        .find((r) => (r.executionId ?? 'kernel') === key.executionId);
      if (!rec) return { found: false };
      const content = JSON.stringify(rec.summary ?? {});
      if (!content) return { found: false };
      return { found: true, content, store: 'deblackbox-recorder' };
    } catch (err) {
      console.warn('[modelVisibleLog] ⚠️ deblackbox 解析异常（不可重建）:', err instanceof Error ? err.message : String(err));
      return { found: false };
    }
  };
}

/** 组合 resolver：按序尝试多个 resolver，首个命中的为准 */
export function composeResolvers(...resolvers: ModelVisibleResolver[]): ModelVisibleResolver {
  return (entry: ModelVisibleEntry): ModelVisibleResolved => {
    for (const resolver of resolvers) {
      const result = resolver(entry);
      if (result.found && result.content) return result;
    }
    return { found: false };
  };
}

// ── 核心断言 ──

/**
 * assertModelVisibleLogged — 断言模型可见材料可从持久化点重建（宪法级）
 *
 * @param entry    模型可见条目（由装配/请求签发）
 * @param resolver 从持久化点取回真实内容的解析器
 * @returns 原条目（便于链式使用）；断言失败抛 ModelVisibleNotLoggedError
 */
export function assertModelVisibleLogged(
  entry: ModelVisibleEntry,
  resolver: ModelVisibleResolver,
): ModelVisibleEntry {
  const resolved = resolver(entry);
  if (!resolved.found || !resolved.content) {
    throw new ModelVisibleNotLoggedError(entry.kind, entry.contentKey);
  }
  return entry;
}

/**
 * reconstructContext — 从持久化点重建模型可见文本
 *
 * 用于「可恢复即正确」铁律（刷新/重启后可重建当前视图与关键状态）与回放验证。
 * 取不回 → 抛 ModelVisibleNotLoggedError（与断言同强度，不做静默空串兜底）。
 */
export function reconstructContext(
  entry: ModelVisibleEntry,
  resolver: ModelVisibleResolver,
): string {
  const resolved = resolver(entry);
  if (!resolved.found || !resolved.content) {
    throw new ModelVisibleNotLoggedError(entry.kind, entry.contentKey, 'reconstructContext 无法重建');
  }
  return resolved.content;
}