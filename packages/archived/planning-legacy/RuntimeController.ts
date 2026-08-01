/**
 * RuntimeController — 影子控制句柄
 *
 * 提供给 IPlanningExtension.onRuntimeEvent 的控制器。
 * 匹配 PlanTypes.ts 中 IRuntimeController 接口定义：
 *   - pause() / resume()
 *   - patchDAG(patch): Promise<boolean>  （异步）
 *   - getDeviationCount(sessionId): number
 *
 * 使用 DAGEngine 已有公开方法（removeNode / addNode / insertAfter / rerouteNode），
 * 无需修改 DAGEngine 内部逻辑。
 */

import type { DAGPatch, IRuntimeController, DAGPatchOperation } from './types.js';

/**
 * RuntimeController — 运行时影子控制句柄
 */
export class RuntimeController implements IRuntimeController {
  private _dagEngine: any | null; // DAGEngine-like duck-typed service
  private _sessionId: string;
  private _isPaused = false;
  private _pauseCount = 0;

  constructor(dagEngine: any | null, sessionId: string) {
    this._dagEngine = dagEngine;
    this._sessionId = sessionId;
  }

  pause(): void {
    this._pauseCount++;
    this._isPaused = true;
  }

  async patchDAG(patch: DAGPatch): Promise<boolean> {
    if (!this._dagEngine) {
      console.warn(`[RuntimeController] session=${this._sessionId} DAGEngine 不可用`);
      return false;
    }

    let allSuccess = true;
    for (const op of patch.operations) {
      try {
        const success = await this.applyOperation(op);
        if (!success) {
          console.warn(`[RuntimeController] 操作失败: ${op.type} ${op.nodeId}`);
          allSuccess = false;
        }
      } catch (err) {
        console.error(`[RuntimeController] 操作异常: ${op.type} ${op.nodeId}: ${err.message}`);
        allSuccess = false;
      }
    }
    return allSuccess;
  }

  resume(): void {
    if (this._pauseCount > 0) this._pauseCount--;
    if (this._pauseCount === 0) this._isPaused = false;
  }

  getDeviationCount(sessionId: string): number {
    return 0; // 代理到 DeviationGuard
  }

  getDAGStatus(): { nodeCount: number; completedCount: number; pendingCount: number; isPaused: boolean } {
    if (!this._dagEngine) {
      return { nodeCount: 0, completedCount: 0, pendingCount: 0, isPaused: this._isPaused };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eng: any = this._dagEngine;
    const nodes: any[] = eng?.getAllNodes?.() ?? [];
    const nodeCount = nodes.length;
    const completedCount = nodes.filter(n => (n.status as string) === 'success' || (n.status as string) === 'failed' || (n.status as string) === 'skipped').length;
    const pendingCount = nodes.filter(n => (n.status as string) === 'pending' || (n.status as string) === 'ready').length;
    return { nodeCount, completedCount, pendingCount, isPaused: this._isPaused };
  }

  get isPaused(): boolean { return this._isPaused; }

  private async applyOperation(op: DAGPatchOperation): Promise<boolean> {
    const engine = this._dagEngine;
    const nodeId = op.nodeId;
    const payload = op.payload;

    switch (op.type) {
      case 'remove_node': {
        const node = engine.getNode(nodeId);
        if (!node) return false;
        if (node.status !== 'pending' && node.status !== 'ready') {
          console.warn(`[RuntimeController] 节点 ${nodeId} 状态为 ${node.status}，不可删除`);
          return false;
        }
        return engine.removeNode(nodeId);
      }

      case 'add_node': {
        if (!payload?.newNode) {
          console.warn(`[RuntimeController] add_node ${nodeId} 缺少 newNode`);
          return false;
        }
        return engine.addNode(payload.newNode);
      }

      case 'insert_after': {
        if (!payload?.afterNodeId || !payload?.newNode) {
          console.warn(`[RuntimeController] insert_after ${nodeId} 缺少 afterNodeId/newNode`);
          return false;
        }
        return engine.insertAfter(payload.afterNodeId, payload.newNode);
      }

      case 'reroute': {
        return engine.rerouteNode(nodeId, payload?.alternateNodeId);
      }

      default:
        console.warn(`[RuntimeController] 未知操作类型: ${op.type}`);
        return false;
    }
  }
}
