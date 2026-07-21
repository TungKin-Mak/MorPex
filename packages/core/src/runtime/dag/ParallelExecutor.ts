/**
 * ParallelExecutor — 并行执行器
 *
 * 并发执行多个 TaskNode，处理执行结果和错误。
 */
import { TaskNode, type TaskExecutionResult } from './TaskNode.js';

export interface ParallelExecResult {
  nodeId: string;
  success: boolean;
  output?: unknown;
  error?: string;
  duration: number;
}

export class ParallelExecutor {
  /**
   * 并发执行所有节点
   */
  async executeAll(nodes: TaskNode[], context: unknown): Promise<Map<string, TaskExecutionResult>> {
    const results = new Map<string, TaskExecutionResult>();
    const promises = nodes.map(node =>
      node.execute(context).then(result => {
        results.set(node.id, result);
        return { nodeId: node.id, result };
      })
    );

    await Promise.allSettled(promises);
    return results;
  }

  /**
   * 限制并发数的执行
   */
  async executeWithConcurrency(
    nodes: TaskNode[],
    context: unknown,
    limit: number = 4
  ): Promise<Map<string, TaskExecutionResult>> {
    const results = new Map<string, TaskExecutionResult>();
    const queue = [...nodes];

    const worker = async () => {
      while (queue.length > 0) {
        const node = queue.shift()!;
        const result = await node.execute(context);
        results.set(node.id, result);
      }
    };

    const workers = Array(Math.min(limit, nodes.length))
      .fill(null)
      .map(() => worker());

    await Promise.allSettled(workers);
    return results;
  }

  /**
   * 获取执行统计
   */
  static getSummary(results: Map<string, TaskExecutionResult>): {
    total: number;
    success: number;
    failed: number;
    avgDuration: number;
  } {
    const values = [...results.values()];
    const success = values.filter(r => r.success).length;
    const failed = values.filter(r => !r.success).length;
    const avgDuration = values.length > 0
      ? Math.round(values.reduce((sum, r) => sum + r.duration, 0) / values.length)
      : 0;

    return { total: values.length, success, failed, avgDuration };
  }
}
