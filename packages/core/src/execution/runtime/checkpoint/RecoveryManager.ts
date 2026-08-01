/**
 * RecoveryManager — 执行恢复管理器
 *
 * 根据检查点快照生成恢复计划。
 * 确定哪些节点需要重试、哪些可以跳过、哪些正在执行中。
 */

import type { ExecutionSnapshot, NodeState } from './CheckpointManager.js';

export interface RecoveryAction {
  nodeId: string;
  action: 'retry' | 'skip' | 'continue' | 'failed';
  reason: string;
}

export interface RecoveryPlan {
  snapshotId: string;
  executionId: string;
  totalNodes: number;
  actions: RecoveryAction[];
  retryCount: number;
  skipCount: number;
  continueCount: number;
  failedCount: number;
  canRecover: boolean;
  blockingIssues: string[];
}

export class RecoveryManager {
  /**
   * 根据快照生成恢复计划
   */
  async recover(snapshot: ExecutionSnapshot): Promise<RecoveryPlan> {
    const actions: RecoveryAction[] = [];
    const blockingIssues: string[] = [];

    const nodeStates = snapshot.dagState.nodeStates;
    for (const node of nodeStates) {
      const action = this.determineAction(node);
      actions.push(action);
    }

    const retryCount = actions.filter((a) => a.action === 'retry').length;
    const skipCount = actions.filter((a) => a.action === 'skip').length;
    const continueCount = actions.filter((a) => a.action === 'continue').length;
    const failedCount = actions.filter((a) => a.action === 'failed').length;

    // Check if recovery is possible
    const canRecover = failedCount === 0 && blockingIssues.length === 0;

    if (!canRecover && failedCount > 0) {
      blockingIssues.push(`${failedCount} nodes are irrecoverably failed`);
    }

    return {
      snapshotId: snapshot.executionId,
      executionId: snapshot.executionId,
      totalNodes: nodeStates.length,
      actions,
      retryCount,
      skipCount,
      continueCount,
      failedCount,
      canRecover,
      blockingIssues,
    };
  }

  /**
   * 确定单个节点的恢复动作
   */
  private determineAction(
    node: NodeState,
  ): RecoveryAction {
    switch (node.status) {
      case 'success':
        return {
          nodeId: node.nodeId,
          action: 'skip',
          reason: 'Already completed successfully',
        };

      case 'skipped':
        return {
          nodeId: node.nodeId,
          action: 'skip',
          reason: 'Was skipped, will remain skipped',
        };

      case 'running':
        return {
          nodeId: node.nodeId,
          action: 'continue',
          reason: 'Was in-flight, will restart from ready',
        };

      case 'failed':
        // Check if retry attempts remain
        if (node.attempts < 3) {
          // Allow up to 3 attempts total
          return {
            nodeId: node.nodeId,
            action: 'retry',
            reason: `Failed after ${node.attempts} attempt(s), will retry`,
          };
        }
        return {
          nodeId: node.nodeId,
          action: 'failed',
          reason: `Exhausted ${node.attempts} retries, cannot recover`,
        };

      case 'pending':
      case 'ready':
        return {
          nodeId: node.nodeId,
          action: 'continue',
          reason: 'Was pending/ready, will execute',
        };

      default:
        return {
          nodeId: node.nodeId,
          action: 'continue',
          reason: `Unknown status "${node.status}", will treat as pending`,
        };
    }
  }

  /**
   * Get nodes that need retry
   */
  /**
   * Get failed node IDs from snapshot
   */
  getFailedNodes(snapshot: ExecutionSnapshot): string[] {
    return snapshot.dagState.nodeStates
      .filter(n => n.status === 'failed')
      .map(n => n.nodeId);
  }

  /**
   * Get completed node IDs from snapshot
   */
  getCompletedNodes(snapshot: ExecutionSnapshot): string[] {
    return snapshot.dagState.nodeStates
      .filter(n => n.status === 'success')
      .map(n => n.nodeId);
  }

  /**
   * Get pending node IDs from snapshot
   */
  getPendingNodes(snapshot: ExecutionSnapshot): string[] {
    return snapshot.dagState.nodeStates
      .filter(n => n.status === 'pending' || n.status === 'ready')
      .map(n => n.nodeId);
  }

  /**
   * Generate a summary of the recovery plan
   */
  summarize(plan: RecoveryPlan): string {
    const lines: string[] = [];
    lines.push(`Recovery Plan for ${plan.executionId}`);
    lines.push(`Total nodes: ${plan.totalNodes}`);
    lines.push(`Recoverable: ${plan.canRecover ? 'YES' : 'NO'}`);
    lines.push('');
    lines.push(`  Retry:    ${plan.retryCount}`);
    lines.push(`  Skip:     ${plan.skipCount}`);
    lines.push(`  Continue: ${plan.continueCount}`);
    lines.push(`  Failed:   ${plan.failedCount}`);
    lines.push('');

    if (plan.blockingIssues.length > 0) {
      lines.push('Blocking issues:');
      for (const issue of plan.blockingIssues) {
        lines.push(`  - ${issue}`);
      }
    }

    return lines.join('\n');
  }
}
