/**
 * WriteGate — 记忆写闸门
 *
 * 控制哪些记忆值得持久化，防止低价值信息污染向量数据库。
 * 支持 gate-log.jsonl 日志记录，用于 L5 反思分析。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { MemoryItem, WriteDecision } from '../types.js';

export class WriteGate {
  private threshold: number;
  private rejectedCount = 0;
  private totalDecisions = 0;
  private logPath: string | null = null;

  constructor(threshold: number = 2, logDir?: string) {
    this.threshold = threshold;
    if (logDir) {
      this.logPath = path.join(logDir, 'gate-log.jsonl');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
    }
  }

  decide(item: Omit<MemoryItem, 'id' | 'createdAt' | 'lastAccessedAt' | 'accessCount'>): WriteDecision {
    this.totalDecisions++;

    let decision: WriteDecision;

    // importance 5: 关键决策，直接通过
    if (item.importance >= 5) {
      decision = { action: 'store', reason: `critical importance (${item.importance})` };
    }
    // importance 4: 重要，检查标签
    else if (item.importance === 4) {
      if (item.tags && item.tags.length > 0) {
        decision = { action: 'store', reason: 'important with tags' };
      } else {
        decision = { action: 'store', reason: 'important' };
      }
    }
    // importance 3: 普通，闸门检查
    else if (item.importance === 3) {
      if (this.threshold <= 2) {
        decision = { action: 'store', reason: 'normal, gate open' };
      } else if (item.tags && item.tags.length >= 2) {
        decision = { action: 'promote', reason: 'normal with enough tags, promoted' };
      } else {
        this.rejectedCount++;
        decision = { action: 'reject', reason: `importance 3 below threshold ${this.threshold}` };
      }
    }
    // importance 1-2: 低优先级
    else {
      this.rejectedCount++;
      decision = { action: 'reject', reason: `low importance (${item.importance}), rejected` };
    }

    // 记录闸门日志
    this.logDecision(item, decision);

    return decision;
  }

  /** 记录闸门决策到 gate-log.jsonl */
  private logDecision(
    item: Omit<MemoryItem, 'id' | 'createdAt' | 'lastAccessedAt' | 'accessCount'>,
    decision: WriteDecision,
  ): void {
    if (!this.logPath) return;
    try {
      const entry = {
        timestamp: Date.now(),
        action: decision.action,
        reason: decision.reason,
        importance: item.importance,
        contentPreview: (item.content ?? '').substring(0, 100),
        tags: item.tags ?? [],
        source: item.metadata?.source ?? 'unknown',
      };
      fs.appendFileSync(this.logPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch { /* 日志写入失败不阻塞主流程 */ }
  }

  getStats() {
    return {
      threshold: this.threshold,
      rejectedCount: this.rejectedCount,
      totalDecisions: this.totalDecisions,
      rejectRate: this.totalDecisions > 0
        ? (this.rejectedCount / this.totalDecisions * 100).toFixed(1) + '%'
        : '0%',
    };
  }

  setThreshold(t: number) { this.threshold = t; }
  getThreshold() { return this.threshold; }
}
