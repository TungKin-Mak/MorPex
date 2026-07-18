/**
 * EventStore — Event Sourcing 持久化
 *
 * 每次状态变迁追加一行 JSONL。重启时重放重建运行时状态。
 *
 * 事件类型（SourcingEvent 联合类型）：
 *   - tool_call_state_change: 工具调用状态变化
 *   - fsm_transition: FSM 状态转换
 *   - artifact_created/updated: 产物生命周期
 *   - negotiation_ticket_created/resolved: 协商工单
 *   - worker_spawned/terminated: Worker 生命周期
 *   - dag_node_status_change: DAG 节点状态
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { config } from '../../config/MorPexConfig.js';
import { readJSONLLines } from '../utils/jsonl.js';

// ═══════════════════════════════════════════════════════════════
// 事件类型定义
// ═══════════════════════════════════════════════════════════════

export type SourcingEvent =
  | { type: 'tool_call_state_change'; toolCallId: string; from: string; to: string; ts: number; execId: string }
  | { type: 'fsm_transition'; taskId: string; from: string; to: string; ts: number; execId: string }
  | { type: 'artifact_created'; artifactId: string; ts: number; execId: string; name?: string }
  | { type: 'artifact_updated'; artifactId: string; version: number; ts: number; execId: string }
  | { type: 'negotiation_ticket_created'; ticketId: string; ts: number; execId: string; sourceDomain?: string; targetDomain?: string }
  | { type: 'negotiation_ticket_resolved'; ticketId: string; status: string; ts: number; execId: string }
  | { type: 'worker_spawned'; toolCallId: string; ts: number; execId: string; toolName?: string }
  | { type: 'worker_terminated'; toolCallId: string; reason: string; ts: number; execId: string }
  | { type: 'dag_node_status_change'; nodeId: string; from: string; to: string; ts: number; execId: string };

// ═══════════════════════════════════════════════════════════════
// 重放状态
// ═══════════════════════════════════════════════════════════════

export interface ReplayState {
  /** 工具调用状态: toolCallId → currentState */
  toolCallStates: Map<string, string>;
  /** FSM 状态: taskId → currentState */
  fsmStates: Map<string, string>;
  /** 活跃 Artifact ID 集合 */
  activeArtifacts: Set<string>;
  /** 活跃工单: ticketId → status */
  activeTickets: Map<string, string>;
  /** 活跃 Worker: toolCallId → 状态 */
  activeWorkers: Map<string, string>;
  /** DAG 节点状态: nodeId → status */
  dagNodeStates: Map<string, string>;
  /** 事件总数 */
  totalEvents: number;
}

// ═══════════════════════════════════════════════════════════════
// EventStore 实现
// ═══════════════════════════════════════════════════════════════

export class EventStore {
  private logPath: string;
  private writeQueue: SourcingEvent[] = [];
  private processing = false;
  /** 内部缓冲池 */

  constructor(logPath?: string) {
    this.logPath = logPath ?? config.eventLogPath;
  }

  getLogPath(): string {
    return this.logPath;
  }

  /**
   * append — 追加事件到日志文件
   *
   * 异步非阻塞写入（fire-and-forget 队列）。
   */
  async append(event: SourcingEvent): Promise<void> {
    this.writeQueue.push(event);
    this.processQueue().catch(err => {
      console.error('[EventStore] 写入队列处理错误:', err);
    });
  }

  /**
   * appendSync — 确保写入完成（内部使用异步+等待队列排空）
   */
  async appendSync(event: SourcingEvent): Promise<void> {
    this.writeQueue.push(event);
    await this.processQueue();
  }

  /**
   * replay — 重放指定 executionId 的事件流
   *
   * 读取 JSONL 文件，过滤 executionId 匹配的事件，
   * 还原为 ReplayState（包括工具调用状态、FSM 状态等）。
   *
   * @param executionId - 执行 ID，不传则重放全部
   * @returns 重放后的运行时状态
   */
  async replay(executionId?: string): Promise<ReplayState> {
    const state: ReplayState = {
      toolCallStates: new Map(),
      fsmStates: new Map(),
      activeArtifacts: new Set(),
      activeTickets: new Map(),
      activeWorkers: new Map(),
      dagNodeStates: new Map(),
      totalEvents: 0,
    };

    try {
      const content = await fsp.readFile(this.logPath, 'utf-8');
      const events = readJSONLLines<SourcingEvent>(content);

      for (const event of events) {
        // 如果指定了 executionId，只重放匹配的事件
        if (executionId && event.execId !== executionId) continue;

        state.totalEvents++;
        this.applyEvent(state, event);
      }
    } catch (err: any) {
      // 文件不存在或无法读取 → 返回空状态
      if (err.code !== 'ENOENT') {
        console.warn('[EventStore] 重放失败:', err.message);
      }
    }

    return state;
  }

  /**
   * query — 查询指定 executionId 的所有原始事件
   */
  async query(executionId: string): Promise<SourcingEvent[]> {
    const results: SourcingEvent[] = [];

    try {
      const content = await fsp.readFile(this.logPath, 'utf-8');
      const events = readJSONLLines<SourcingEvent>(content);
      for (const event of events) {
        if (event.execId === executionId) {
          results.push(event);
        }
      }
    } catch {
      // 文件不存在返回空数组
    }

    return results;
  }

  /**
   * queryByType — 按事件类型查询
   */
  async queryByType(type: SourcingEvent['type'], limit: number = 100): Promise<SourcingEvent[]> {
    const results: SourcingEvent[] = [];

    try {
      const content = await fsp.readFile(this.logPath, 'utf-8');
      const events = readJSONLLines<SourcingEvent>(content);
      for (const event of events) {
        if (event.type === type) {
          results.push(event);
          if (results.length >= limit) break;
        }
      }
    } catch {
      // 文件不存在返回空数组
    }

    return results;
  }

  /**
   * getStats — 获取日志统计信息
   */
  async getStats(): Promise<{ totalEvents: number; fileSizeBytes: number; eventTypeCounts: Record<string, number> }> {
    const eventTypeCounts: Record<string, number> = {};
    let totalEvents = 0;

    try {
      const content = await fsp.readFile(this.logPath, 'utf-8');
      const events = readJSONLLines<SourcingEvent>(content);
      for (const event of events) {
        totalEvents++;
        eventTypeCounts[event.type] = (eventTypeCounts[event.type] ?? 0) + 1;
      }
    } catch {
      // 文件不存在
    }

    let fileSizeBytes = 0;
    try {
      const stat = await fsp.stat(this.logPath);
      fileSizeBytes = stat.size;
    } catch {
      // 文件不存在
    }

    return { totalEvents, fileSizeBytes, eventTypeCounts };
  }

  /**
   * clear — 清空日志文件
   */
  async clear(): Promise<void> {
    await fsp.writeFile(this.logPath, '', 'utf-8').catch(() => {});
    this.writeQueue = [];
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * applyEvent — 将单个事件应用到 ReplayState
   */
  private applyEvent(state: ReplayState, event: SourcingEvent): void {
    switch (event.type) {
      case 'tool_call_state_change':
        state.toolCallStates.set(event.toolCallId, event.to);
        break;

      case 'fsm_transition':
        state.fsmStates.set(event.taskId, event.to);
        break;

      case 'artifact_created':
        state.activeArtifacts.add(event.artifactId);
        break;

      case 'artifact_updated':
        state.activeArtifacts.add(event.artifactId);
        break;

      case 'negotiation_ticket_created':
        state.activeTickets.set(event.ticketId, 'PENDING');
        break;

      case 'negotiation_ticket_resolved':
        state.activeTickets.set(event.ticketId, event.status);
        break;

      case 'worker_spawned':
        state.activeWorkers.set(event.toolCallId, 'spawned');
        break;

      case 'worker_terminated':
        state.activeWorkers.set(event.toolCallId, `terminated:${event.reason}`);
        break;

      case 'dag_node_status_change':
        state.dagNodeStates.set(event.nodeId, event.to);
        break;
    }
  }

  /**
   * ensureDir — 确保日志目录存在（异步，防并发竞争）
   */
  private async ensureDir(): Promise<void> {
    const dir = path.dirname(this.logPath);
    try {
      await fsp.mkdir(dir, { recursive: true });
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err;
    }
  }

  /**
   * processQueue — 异步处理写入队列
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.writeQueue.length > 0) {
      const batch = this.writeQueue.splice(0, 50);
      await this.ensureDir();

      // 批量追加写入（直接 fs.appendFileSync，EventStore 层已做 50 条批处理）
      try {
        const lines = batch.map(e => JSON.stringify(e)).join('\n') + '\n';
        fs.appendFileSync(this.logPath, lines, 'utf-8');
      } catch (err) {
        console.error('[EventStore] 写入失败:', err);
      }
    }

    this.processing = false;
  }
}
