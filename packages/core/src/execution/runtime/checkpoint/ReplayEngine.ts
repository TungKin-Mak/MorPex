/**
 * ReplayEngine — 重放引擎
 *
 * 从检查点快照重放执行过程，支持 step-by-step 和 full-speed 模式。
 */
import type { ExecutionSnapshot, NodeState } from './CheckpointManager.js';
import { CheckpointManager } from './CheckpointManager.js';

export type ReplayEventType = 'node-start' | 'node-end' | 'node-skip' | 'error' | 'complete';

export interface ReplayEvent {
  type: ReplayEventType;
  nodeId: string;
  nodeName: string;
  timestamp: number;
  data?: unknown;
}

export class ReplayEngine {
  private checkpointManager: CheckpointManager;

  constructor(checkpointManager: CheckpointManager) {
    this.checkpointManager = checkpointManager;
  }

  /**
   * 从检查点重放执行
   * 返回 AsyncIterable 支持逐步消费
   */
  async *replay(
    snapshotId: string,
    stepByStep: boolean = false
  ): AsyncIterable<ReplayEvent> {
    const snapshot = await this.checkpointManager.load(snapshotId);
    if (!snapshot) {
      yield {
        type: 'error',
        nodeId: '',
        nodeName: '',
        timestamp: Date.now(),
        data: { error: `Snapshot "${snapshotId}" not found` },
      };
      return;
    }

    const nodes = snapshot.dagState.nodeStates;
    const edges = snapshot.dagState.edges;

    // 拓扑排序
    const sortedNodes = this.topologicalSort(nodes, edges);

    for (const node of sortedNodes) {
      // 跳过未执行的节点
      if (node.status === 'pending' || node.status === 'skipped') {
        yield {
          type: 'node-skip',
          nodeId: node.nodeId,
          nodeName: node.name,
          timestamp: node.startedAt ?? Date.now(),
          data: { reason: 'not_executed' },
        };
        continue;
      }

      // 节点开始
      yield {
        type: 'node-start',
        nodeId: node.nodeId,
        nodeName: node.name,
        timestamp: node.startedAt ?? Date.now(),
        data: { attempts: node.attempts },
      };

      if (stepByStep) {
        // step-by-step: 等待外部触发继续
        yield await this.waitForStep();
      }

      // 节点结束
      if (node.status === 'success') {
        yield {
          type: 'node-end',
          nodeId: node.nodeId,
          nodeName: node.name,
          timestamp: node.completedAt ?? Date.now(),
          data: { result: node.result },
        };
      } else if (node.status === 'failed') {
        yield {
          type: 'error',
          nodeId: node.nodeId,
          nodeName: node.name,
          timestamp: node.completedAt ?? Date.now(),
          data: { error: node.error },
        };
      }

      if (stepByStep) {
        yield await this.waitForStep();
      }
    }

    // 完成
    yield {
      type: 'complete',
      nodeId: '',
      nodeName: '',
      timestamp: Date.now(),
      data: { totalNodes: nodes.length },
    };
  }

  /**
   * 快速重放（直接返回事件数组）
   */
  async replayFast(snapshotId: string): Promise<ReplayEvent[]> {
    const events: ReplayEvent[] = [];
    for await (const event of this.replay(snapshotId, false)) {
      events.push(event);
    }
    return events;
  }

  private topologicalSort(nodes: NodeState[], edges: Array<{ from: string; to: string }>): NodeState[] {
    const nodeMap = new Map(nodes.map(n => [n.nodeId, n]));
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();

    for (const node of nodes) {
      inDegree.set(node.nodeId, 0);
      adjList.set(node.nodeId, []);
    }

    for (const edge of edges) {
      adjList.get(edge.from)?.push(edge.to);
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    }

    const queue: string[] = [];
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) queue.push(nodeId);
    }

    const sorted: NodeState[] = [];
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const node = nodeMap.get(nodeId);
      if (node) sorted.push(node);

      for (const neighbor of adjList.get(nodeId) || []) {
        const newDegree = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    return sorted;
  }

  private waitForStep(): Promise<ReplayEvent> {
    return new Promise(resolve => {
      // 在 step-by-step 模式下，这里会等待外部信号
      // 当前使用 setTimeout 模拟
      setTimeout(() => {
        resolve({
          type: 'node-end',
          nodeId: '__step__',
          nodeName: '__step__',
          timestamp: Date.now(),
          data: { step: 'continue' },
        });
      }, 100);
    });
  }
}
