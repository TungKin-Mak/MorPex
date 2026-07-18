/**
 * HistoryStore — 执行历史持久化存储
 *
 * 保存:
 *   - 创业循环 (cycle runs)
 *   - 任务执行 (task runs)
 *   - 会话消息 (chat sessions)
 *   - 执行元数据 (execution traces)
 *
 * 每个文件独立 JSONL，按日期分片。
 *
 * data/
 * ├── history/
 * │   ├── cycles.jsonl        ← 创业循环记录
 * │   ├── tasks.jsonl         ← 任务执行记录
 * │   ├── executions.jsonl    ← 执行元数据
 * │   └── chat-sessions.jsonl ← 会话消息
 * ├── mirror/
 * │   ├── events.jsonl        ← Mirror 运行时事件
 * │   ├── executions.jsonl    ← Mirror 执行轨迹
 * │   └── snapshots.jsonl     ← Mirror 上下文快照
 * └── sessions/               ← pi-agent-core 会话文件
 *     └── *.jsonl
 */

import * as fs from 'fs';
import * as path from 'path';
import { MemoryWiki } from '../wiki/index.js';

// ── 类型 ──

export interface CycleRecord {
  id: string;
  type: 'cycle';
  domain: string;
  trend: string;
  prompt?: string;
  status: 'started' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
  startedAt: number;
  completedAt?: number;
  duration?: number;
  tasks?: Array<{ id: string; name: string; agentType: string; status: string }>;
}

export interface TaskRecord {
  id: string;
  type: 'task';
  executionId: string;
  taskName: string;
  taskType: string;
  input?: string;
  output?: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  agentId?: string;
  startedAt: number;
  completedAt?: number;
  duration?: number;
}

export interface ExecutionRecord {
  id: string;
  type: 'execution';
  executionId: string;
  action: string;
  source: string;
  status: string;
  input?: any;
  output?: any;
  error?: string;
  startedAt: number;
  completedAt?: number;
  duration?: number;
}

export type HistoryRecord = CycleRecord | TaskRecord | ExecutionRecord;

// ── HistoryStore ──

export class HistoryStore {
  private basePath: string;
  private cycles: CycleRecord[] = [];
  private tasks: TaskRecord[] = [];
  private executions: ExecutionRecord[] = [];
  private wiki: MemoryWiki | null = null;

  constructor(basePath: string = './data/history') {
    this.basePath = path.resolve(basePath);
  }

  async initialize(): Promise<void> {
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
    // 加载已有数据
    this.cycles = await this._loadFile<CycleRecord>('cycles.jsonl');
    this.tasks = await this._loadFile<TaskRecord>('tasks.jsonl');
    this.executions = await this._loadFile<ExecutionRecord>('executions.jsonl');
    console.log(`[History] ✅ 已加载: ${this.cycles.length} cycles, ${this.tasks.length} tasks, ${this.executions.length} executions`);
  }

  private async _loadFile<T>(filename: string): Promise<T[]> {
    const filePath = path.join(this.basePath, filename);
    if (!fs.existsSync(filePath)) return [];
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return content.split('\n').filter(Boolean).map(line => JSON.parse(line)) as T[];
    } catch {
      return [];
    }
  }

  // JSONL 写入已下线 — 数据通过 MemoryWiki/SQLite 持久化

  // ── Cycle ──

  addCycle(record: Omit<CycleRecord, 'type'>): CycleRecord {
    const full: CycleRecord = { ...record, type: 'cycle' };
    this.cycles.push(full);
    return full;
  }

  updateCycle(id: string, updates: Partial<CycleRecord>): CycleRecord | undefined {
    const idx = this.cycles.findIndex(c => c.id === id);
    if (idx === -1) return undefined;
    this.cycles[idx] = { ...this.cycles[idx], ...updates };
    return this.cycles[idx];
  }

  getCycles(limit: number = 20): CycleRecord[] {
    return this.cycles.slice(-limit).reverse();
  }

  // ── Task ──

  addTask(record: Omit<TaskRecord, 'type'>): TaskRecord {
    const full: TaskRecord = { ...record, type: 'task' };
    this.tasks.push(full);
    return full;
  }

  updateTask(id: string, updates: Partial<TaskRecord>): TaskRecord | undefined {
    const idx = this.tasks.findIndex(t => t.id === id);
    if (idx === -1) return undefined;
    this.tasks[idx] = { ...this.tasks[idx], ...updates };
    return this.tasks[idx];
  }

  getTasks(limit: number = 50): TaskRecord[] {
    return this.tasks.slice(-limit).reverse();
  }

  /** ★ MemoryWiki 注入 */
  setWiki(wiki: MemoryWiki): void {
    this.wiki = wiki;
  }

  getTasksByExecution(executionId: string): TaskRecord[] {
    // ★ SQLite 优先（通过 MemoryWiki 高层 API）
    if (this.wiki?.ready) {
      try {
        const rows = this.wiki.queryByField('history_records', 'execution_id', executionId) as Record<string, unknown>[];
        if (rows.length > 0) {
          return rows.map(r => ({
            id: r.id as string,
            type: 'task' as const,
            executionId: r.execution_id as string,
            taskName: (r.task_id as string) ?? '',
            taskType: 'task',
            status: 'success' as const,
            startedAt: ((r.created_at ?? Date.now()) as number) * 1000,
          }));
        }
      } catch { /* fallback */ }
    }
    return this.tasks.filter(t => t.executionId === executionId);
  }

  // ── Execution ──

  addExecution(record: Omit<ExecutionRecord, 'type'>): ExecutionRecord {
    const full: ExecutionRecord = { ...record, type: 'execution' };
    this.executions.push(full);
    return full;
  }

  updateExecution(id: string, updates: Partial<ExecutionRecord>): ExecutionRecord | undefined {
    const idx = this.executions.findIndex(e => e.id === id);
    if (idx === -1) return undefined;
    this.executions[idx] = { ...this.executions[idx], ...updates };
    return this.executions[idx];
  }

  getExecutions(limit: number = 20): ExecutionRecord[] {
    return this.executions.slice(-limit).reverse();
  }

  // ── 统计 ──

  getStats() {
    return {
      totalCycles: this.cycles.length,
      totalTasks: this.tasks.length,
      totalExecutions: this.executions.length,
      lastCycle: this.cycles[this.cycles.length - 1] || null,
    };
  }

  // ── 生命周期 ──

  close(): void {
    // 数据已实时写入，无需额外操作
    this.cycles = [];
    this.tasks = [];
    this.executions = [];
  }
}
