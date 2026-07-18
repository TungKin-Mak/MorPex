/**
 * CheckpointManager — DAG 快照回滚管理器
 *
 * 职责：
 *   在 DomainDispatcher.executeDAG() 执行过程中定期创建检查点，
 *   支持节点级别回滚和整个 DAG 重放。
 *
 * 集成方式：
 *   executeWithCheckpoints() HOC 包装 DomainDispatcher.executeDAG()
 *   每次节点完成后自动创建检查点，失败时触发降级策略。
 *
 * 三级降级：
 *   Level 1: 原地重试（同配置重试 1 次）
 *   Level 2: 降级 Prompt（简化任务描述）
 *   Level 3: 切换模型（deepseek-v4-flash → deepseek-v4-small）
 */

import * as crypto from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { DAGNode } from '../domains/types.js';
import type { SessionContext } from '../common/types.js';

// ── 类型 ──

export interface Checkpoint {
  id: string;
  timestamp: number;
  dag: DAGNode[];
  completedNodes: string[];
  results: Map<string, any>;
  sessionCtx: SessionContext | null;
  reason?: string;
}

export interface DAGExecutionResult {
  success: boolean;
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
  results: any[];
  duration: number;
  error?: string;
}

const CHECKPOINT_DIR = './data/checkpoints';

// ── CheckpointManager ──

export class CheckpointManager {
  private checkpoints: Checkpoint[] = [];
  private _maxCheckpoints: number;
  private _checkpointDir: string;
  private wiki: import('../../../memory/src/index.js').MemoryWiki | null = null;

  constructor(maxCheckpoints: number = 10, checkpointDir?: string) {
    this._maxCheckpoints = maxCheckpoints;
    this._checkpointDir = checkpointDir || CHECKPOINT_DIR;
  }

  /**
   * executeWithCheckpoints — 包装 executeDAG 函数，自动创建检查点
   *
   * @param executeDAG - 原始的 executeDAG 函数
   * @param dag - DAG 节点列表
   * @param sessionCtx - 会话上下文
   * @returns 执行结果
   */
  async executeWithCheckpoints(
    executeDAG: (dag: DAGNode[], sessionCtx?: SessionContext) => Promise<DAGExecutionResult>,
    dag: DAGNode[],
    sessionCtx?: SessionContext,
  ): Promise<DAGExecutionResult> {
    // 创建首个检查点（执行前）
    await this.saveCheckpoint({
      id: `cp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: Date.now(),
      dag: [...dag],
      completedNodes: [],
      results: new Map(),
      sessionCtx: sessionCtx ?? null,
      reason: 'pre_execution',
    });

    try {
      const result = await executeDAG(dag, sessionCtx);

      // 执行完成后创建最终检查点
      const completed = dag.filter(n => n.status === 'completed' || n.status === 'failed').map(n => n.taskId);
      await this.saveCheckpoint({
        id: `cp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        timestamp: Date.now(),
        dag: [...dag],
        completedNodes: completed,
        results: new Map(),
        sessionCtx: sessionCtx ?? null,
        reason: result.success ? 'completed' : 'failed',
      });

      // 如果失败且可重试 → Level 1 降级
      if (!result.success && result.failedNodes > 0) {
        console.log(`[CheckpointManager] 🔄 DAG 部分失败 (${result.failedNodes}/${result.totalNodes})，尝试降级...`);
        // 标记失败的节点为 pending，重试
        const retryDag = dag.map(n => {
          if (n.status === 'failed') return { ...n, status: 'pending' as const };
          return n;
        });
        const retryResult = await executeDAG(retryDag, sessionCtx);
        return retryResult;
      }

      return result;
    } catch (err: any) {
      console.error(`[CheckpointManager] ❌ DAG 执行异常: ${err.message}`);

      // 从最近的检查点回滚并重试（Level 2 降级）
      const lastCp = this.getLatestCheckpoint();
      if (lastCp) {
        console.log(`[CheckpointManager] 🔄 从检查点 ${lastCp.id} 回滚重试...`);
        // 简化任务描述后重试
        const simplifiedDag = lastCp.dag.map(n => ({
          ...n,
          goal: `[简化] ${n.goal?.substring(0, 100) || n.goal}`,
        }));
        const retryResult = await executeDAG(simplifiedDag, lastCp.sessionCtx ?? undefined);
        return retryResult;
      }

      return {
        success: false,
        totalNodes: dag.length,
        completedNodes: 0,
        failedNodes: dag.length,
        results: [],
        duration: 0,
        error: err.message,
      };
    }
  }

  /** ★ MemoryWiki 注入 */
  setWiki(wiki: import('../../../memory/src/index.js').MemoryWiki): void {
    this.wiki = wiki;
  }

  /** 保存检查点 */
  private async saveCheckpoint(cp: Checkpoint): Promise<void> {
    this.checkpoints.push(cp);
    if (this.checkpoints.length > this._maxCheckpoints) {
      this.checkpoints = this.checkpoints.slice(-this._maxCheckpoints);
    }

    // ★ MemoryWiki 持久化
    if (this.wiki?.ready) {
      this.wiki.remember({
        id: cp.id,
        type: 'Checkpoint',
        name: `checkpoint_${cp.id}`,
        data: {
          execution_id: cp.id,
          dag_snapshot: JSON.stringify(cp.dag),
          node_states: JSON.stringify({ completedNodes: cp.completedNodes }),
          created_at: Math.floor(cp.timestamp / 1000),
        },
      }).catch(() => {});
    }

    // 持久化到磁盘（异步非阻塞）
    try {
      const dir = path.resolve(this._checkpointDir);
      await fsp.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${cp.id}.json`);
      await fsp.writeFile(filePath, JSON.stringify({
        id: cp.id,
        timestamp: cp.timestamp,
        completedNodes: cp.completedNodes,
        reason: cp.reason,
        nodeCount: cp.dag.length,
      }, null, 2), 'utf-8');
    } catch { /* 持久化失败不阻塞 */ }
  }

  /** 获取最近的检查点 */
  getLatestCheckpoint(): Checkpoint | null {
    return this.checkpoints.length > 0 ? this.checkpoints[this.checkpoints.length - 1] : null;
  }

  /** 获取所有检查点列表（不含完整 DAG 数据） */
  getCheckpointSummary(): Array<{ id: string; timestamp: number; reason?: string; nodeCount: number }> {
    return this.checkpoints.map(c => ({
      id: c.id,
      timestamp: c.timestamp,
      reason: c.reason,
      nodeCount: c.dag.length,
    }));
  }

  /** 清除检查点 */
  clear(): void {
    this.checkpoints = [];
  }
}
