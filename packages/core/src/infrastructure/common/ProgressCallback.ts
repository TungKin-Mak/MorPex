/**
 * ProgressCallback — 结构化进度回调系统
 *
 * Phase 4.6 / 架构打磨 — Action/Brain 提升
 *
 * 为所有执行模块提供统一的进度回调接口。
 * 替代原有的 EventBus "广播后祈祷" 模式。
 *
 * 设计原则：
 *   - 可选注入：所有模块的 ProgressCallback 均为可选，不传则无回调
 *   - 与 EventBus 共存：回调用于同步编程模式，EventBus 用于异步广播
 *   - 进度 0-100：调用方可以计算百分比
 *   - 线程安全：回调是同步调用，调用方自行决定是否异步
 *
 * 使用方式：
 *   const cb: ProgressCallback = (event) => {
 *     console.log(`${event.progress}%: ${event.message}`);
 *   };
 *   await subAgentFork.spawnFleet(deptId, tasks, { onProgress: cb });
 */

export type ProgressEventType =
  | 'task.assigned'
  | 'task.started'
  | 'task.progress'
  | 'task.completed'
  | 'task.failed'
  | 'subtask.spawned'
  | 'subtask.completed'
  | 'subtask.failed'
  | 'llm.called'
  | 'llm.response'
  | 'brain.learning'
  | 'brain.insight'
  | 'tool.called'
  | 'tool.completed'
  | 'planning.started'
  | 'planning.completed';

export interface ProgressEvent {
  type: ProgressEventType;
  timestamp: number;
  taskId?: string;
  departmentId?: string;
  message: string;
  /** 0-100 进度百分比 */
  progress: number;
  metadata?: Record<string, unknown>;
}

export type ProgressCallback = (event: ProgressEvent) => void;

/**
 * makeProgressEvent — 快速创建进度事件
 */
export function makeProgressEvent(
  type: ProgressEventType,
  message: string,
  progress: number,
  meta?: {
    taskId?: string;
    departmentId?: string;
    metadata?: Record<string, unknown>;
  },
): ProgressEvent {
  return {
    type,
    timestamp: Date.now(),
    message,
    progress: Math.max(0, Math.min(100, progress)),
    taskId: meta?.taskId,
    departmentId: meta?.departmentId,
    metadata: meta?.metadata,
  };
}
