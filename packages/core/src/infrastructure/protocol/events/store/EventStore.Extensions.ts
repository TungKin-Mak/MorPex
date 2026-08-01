/**
 * EventStore Cognitive Extensions — 认知决策事件流支持
 *
 * v8.6: 为 EventStore 添加 DecisionEvent 支持。
 * 与 Execution History 并行存储，共同构成完整的事件溯源审计线索。
 *
 * 设计原则:
 *   - DecisionEvent 与 BaseEvent 分开存储（不同文件、不同索引）
 *   - 但共享同一个 EventStore 实例的数据目录
 *   - 查询时可分别查询或关联查询
 */

import type { DecisionEvent, DecisionEventQuery } from '../DecisionEvent.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * EventStoreCognitiveMixin — 可混入 EventStore 的认知事件方法
 *
 * 使用方式:
 *   const store = new EventStore(config);
 *   Object.assign(store, EventStoreCognitiveMixin);
 */
export const EventStoreCognitiveMixin = {
  /** 决策事件存储目录（相对 dataDir） */
  _decisionDir: 'decisions',

  /** 内存中的决策事件列表 */
  _decisions: [] as DecisionEvent[],

  /**
   * appendDecision — 记录一条认知决策事件
   *
   * @param decision - 决策事件
   */
  async appendDecision(this: any, decision: DecisionEvent): Promise<void> {
    this._decisions.push(decision);

    // 异步持久化到 JSONL
    const decisionDir = path.join(this.dataDir, this._decisionDir);
    await fs.promises.mkdir(decisionDir, { recursive: true }).catch(() => {});
    const line = JSON.stringify(decision) + '\n';
    await fs.promises.appendFile(
      path.join(decisionDir, 'decisions.jsonl'),
      line,
      'utf-8'
    ).catch((err: Error) => {
      console.warn('[EventStore] DecisionEvent append failed:', err.message);
    });
  },

  /**
   * getDecisionHistory — 获取指定执行上下文的决策历史
   *
   * @param executionId - 执行 ID（可模糊匹配）
   * @returns 匹配的 DecisionEvent 列表
   */
  getDecisionHistory(this: any, executionId?: string): DecisionEvent[] {
    if (!executionId) return [...this._decisions];
    return this._decisions.filter(
      (d: DecisionEvent) => d.id.startsWith(executionId) || d.evidence.includes(executionId)
    );
  },

  /**
   * getDecisionsByQuery — 按条件查询决策历史
   *
   * @param query - 查询参数
   * @returns 匹配的 DecisionEvent 列表（按时间倒序）
   */
  getDecisionsByQuery(this: any, query: DecisionEventQuery): DecisionEvent[] {
    let results = [...this._decisions];

    if (query.since !== undefined) {
      results = results.filter(d => d.timestamp >= query.since!);
    }
    if (query.until !== undefined) {
      results = results.filter(d => d.timestamp <= query.until!);
    }
    if (query.decision) {
      results = results.filter(d => d.decision === query.decision);
    }
    if (query.twinVersion !== undefined) {
      results = results.filter(d => d.twinVersion === query.twinVersion);
    }

    // 按时间倒序
    results.sort((a, b) => b.timestamp - a.timestamp);

    if (query.limit && query.limit > 0) {
      results = results.slice(0, query.limit);
    }

    return results;
  },

  /**
   * loadDecisions — 从 JSONL 加载决策事件
   */
  async loadDecisions(this: any): Promise<void> {
    const decisionPath = path.join(this.dataDir, this._decisionDir, 'decisions.jsonl');
    try {
      const content = await fs.promises.readFile(decisionPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      this._decisions = lines.map(line => JSON.parse(line));
      console.log(`[EventStore] Loaded ${this._decisions.length} decision events`);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[EventStore] Load decisions error:', (err as Error).message);
      }
    }
  },
};
