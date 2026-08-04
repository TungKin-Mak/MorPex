/**
 * knowledge/context/ContextArchive — 上下文档案召回（功能③ 历史抽离·完整快照召回）
 *
 * 设计（用户主导）：任务身份 ID 是上下文生命周期主键——
 *   装配（currentTask → taskRef）→ 执行 → 抽离（完整快照带 taskRef 入 EventStore）
 *   → 召回（按 taskRef 精确检索，同会话多任务可分，防"抽离后信息丢失"）。
 *
 * 权威存储：EventStore 的 `context.snapshot` 事件（MorPexRuntime Mission 完成时写入，
 * payload.taskRef = missionId 作为任务主键）。
 * ContextPersistence 是装配过程快照（另一存储），如需可单独 loadByTaskRef。
 *
 * 不新增层：纯查询工具，挂 knowledge/context，复用 IEventStore。
 */

import type { IEventStore } from '../../infrastructure/protocol/events/store/IEventStore.js';
import type { ExecutionContext } from './ContextBuilder.js';

/** ContextPersistence 最小接口（解耦：统一召回不依赖具体实现） */
export interface TaskSnapshotReader {
  loadByTaskRef(taskRef: string): ExecutionContext[];
}

/** 已归档的任务上下文快照（与 MorPexRuntime context.snapshot payload 对齐） */
export interface ArchivedContext {
  taskRef: string;
  missionId: string;
  goal: string;
  domain?: string;
  result?: 'success' | 'failure';
  workflow?: unknown;
  team?: { departments: string[]; members: number };
  capabilitiesCount?: number;
  budget?: { allocated: number; spent: number };
  risk?: string;
  artifacts?: string[];
  startedAt?: number;
  duration?: number;
  score?: number;
  archivedAt: number;
}

/**
 * loadByTaskRef — 按任务身份 ID 精确召回完整快照（最新一条）
 *
 * @param eventStore EventStore（context.snapshot 权威存储）
 * @param taskRef    任务身份 ID（goalId/planId/taskId/missionId 任一）
 * @returns 匹配的最新快照；无匹配/无 eventStore 返回 null
 */
export async function loadByTaskRef(
  eventStore: IEventStore | null | undefined,
  taskRef: string,
): Promise<ArchivedContext | null> {
  if (!eventStore || !taskRef) return null;
  try {
    const events = await eventStore.query({ type: 'context.snapshot' });
    const match = events
      .map((e) => e.payload as Partial<ArchivedContext>)
      .filter((p) => p.taskRef === taskRef)
      .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))[0];
    return (match as ArchivedContext | undefined) ?? null;
  } catch (err) {
    console.warn(`[ContextArchive] ⚠️ 按 taskRef=${taskRef} 召回失败（非阻断）:`, (err as Error).message);
    return null;
  }
}

/**
 * listTaskRefs — 列出全部已归档任务身份 ID（治理/观测用）
 */
export async function listTaskRefs(eventStore: IEventStore | null | undefined): Promise<string[]> {
  if (!eventStore) return [];
  try {
    const events = await eventStore.query({ type: 'context.snapshot' });
    return [...new Set(events.map((e) => (e.payload as Partial<ArchivedContext>).taskRef).filter(Boolean))] as string[];
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// 统一召回接口（功能③ Phase 2：两存储合并）
//   EventStore 权威快照（context.snapshot，Mission 完成时抽离）
//   + ContextPersistence 装配快照（SQLite，装配过程留存）
// ═══════════════════════════════════════════════════════════════

export interface MergedTaskContext {
  taskRef: string;
  /** EventStore 权威快照（最新一条；无则 null） */
  archived: ArchivedContext | null;
  /** ContextPersistence 装配快照（可能多条，按时间倒序） */
  snapshots: ExecutionContext[];
  /** 合并摘要（治理/观测用） */
  summary: {
    source: 'event-store' | 'persistence' | 'both' | 'none';
    snapshotCount: number;
    latestAt?: number;
  };
}

/**
 * loadMerged — 统一召回：按任务身份 ID 合并两存储的上下文快照
 *
 * 召回顺序：先 EventStore 权威快照（完整抽离形态），再 ContextPersistence 装配快照。
 * 任一存储不可用（null/异常）→ 该侧为空，不阻断另一侧。
 */
export async function loadMerged(
  eventStore: IEventStore | null | undefined,
  persistence: TaskSnapshotReader | null | undefined,
  taskRef: string,
): Promise<MergedTaskContext> {
  const archived = await loadByTaskRef(eventStore, taskRef);

  let snapshots: ExecutionContext[] = [];
  try {
    if (persistence && taskRef) {
      snapshots = persistence.loadByTaskRef(taskRef);
    }
  } catch (err) {
    console.warn(`[ContextArchive] ⚠️ 装配快照按 taskRef=${taskRef} 召回失败（非阻断）:`, (err as Error).message);
  }

  const source = archived
    ? (snapshots.length > 0 ? 'both' : 'event-store')
    : (snapshots.length > 0 ? 'persistence' : 'none');
  const times = [
    archived?.archivedAt,
    ...snapshots.map((s) => (s as { assembledAt?: number }).assembledAt),
  ].filter((t): t is number => typeof t === 'number');

  return {
    taskRef,
    archived,
    snapshots,
    summary: {
      source,
      snapshotCount: snapshots.length + (archived ? 1 : 0),
      latestAt: times.length > 0 ? Math.max(...times) : undefined,
    },
  };
}
