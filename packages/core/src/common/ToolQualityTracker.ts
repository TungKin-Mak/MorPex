/**
 * ToolQualityTracker — 工具质量追踪器
 *
 * Phase 4.6 / 架构打磨 — Tools 提升
 *
 * 追踪每个工具/连接器的调用质量指标：
 *   - 调用次数
 *   - 成功率
 *   - 平均延迟
 *   - 最后调用时间
 *   - 错误分布
 *
 * 基于历史数据提供简单的"最佳工具推荐"。
 *
 * 设计原则：
 *   - 纯内存运行（不持久化，重启重置）
 *   - 线程安全（简单计数器，无锁）
 *   - 轻量级（O(1) 记录，O(n) 查询）
 *
 * 使用方式：
 *   const tracker = new ToolQualityTracker();
 *   tracker.recordCall('shell', true, 120);
 *   tracker.recordCall('shell', false, 3000, 'timeout');
 *   const stats = tracker.getStats();
 *   const best = tracker.getBestTool('read_file');
 */

export interface ToolStats {
  toolName: string;
  callCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  lastUsed: number;
  commonErrors: Array<{ error: string; count: number }>;
}

export class ToolQualityTracker {
  /** per-tool 统计数据 */
  private tools: Map<string, {
    callCount: number;
    successCount: number;
    failureCount: number;
    totalLatency: number;
    minLatency: number;
    maxLatency: number;
    lastUsed: number;
    errors: Map<string, number>;
  }> = new Map();

  /**
   * recordCall — 记录一次工具调用
   *
   * @param toolName - 工具名（如 'shell', 'fs_read', 'llm_deepseek'）
   * @param success - 是否成功
   * @param latencyMs - 延迟（毫秒）
   * @param error - 错误信息（失败时）
   */
  recordCall(toolName: string, success: boolean, latencyMs: number, error?: string): void {
    let entry = this.tools.get(toolName);
    if (!entry) {
      entry = {
        callCount: 0,
        successCount: 0,
        failureCount: 0,
        totalLatency: 0,
        minLatency: Infinity,
        maxLatency: 0,
        lastUsed: 0,
        errors: new Map(),
      };
      this.tools.set(toolName, entry);
    }

    entry.callCount++;
    if (success) entry.successCount++;
    else {
      entry.failureCount++;
      if (error) {
        const count = (entry.errors.get(error) ?? 0) + 1;
        entry.errors.set(error, count);
      }
    }
    entry.totalLatency += latencyMs;
    entry.minLatency = Math.min(entry.minLatency, latencyMs);
    entry.maxLatency = Math.max(entry.maxLatency, latencyMs);
    entry.lastUsed = Date.now();
  }

  /**
   * getStats — 获取所有工具统计
   */
  getStats(): ToolStats[] {
    const result: ToolStats[] = [];

    for (const [toolName, entry] of this.tools) {
      const commonErrors: Array<{ error: string; count: number }> = [];
      for (const [error, count] of entry.errors) {
        commonErrors.push({ error, count });
      }
      commonErrors.sort((a, b) => b.count - a.count);

      result.push({
        toolName,
        callCount: entry.callCount,
        successCount: entry.successCount,
        failureCount: entry.failureCount,
        successRate: entry.callCount > 0 ? entry.successCount / entry.callCount : 0,
        avgLatency: entry.callCount > 0 ? Math.round(entry.totalLatency / entry.callCount) : 0,
        minLatency: entry.minLatency === Infinity ? 0 : entry.minLatency,
        maxLatency: entry.maxLatency,
        lastUsed: entry.lastUsed,
        commonErrors: commonErrors.slice(0, 5),
      });
    }

    result.sort((a, b) => b.callCount - a.callCount);
    return result;
  }

  /**
   * getToolStats — 获取指定工具统计
   */
  getToolStats(toolName: string): ToolStats | undefined {
    return this.getStats().find(s => s.toolName === toolName);
  }

  /**
   * getBestTool — 基于历史成功率推荐最佳工具
   *
   * @param taskKeywords - 任务关键词（如 'file', 'shell', 'read'）
   * @returns 工具名，如果数据不足返回 undefined
   */
  getBestTool(taskKeywords: string): string | undefined {
    const candidates = this.getStats()
      .filter(s => s.callCount >= 3) // 至少 3 次调用才有统计意义
      .filter(s => s.toolName.toLowerCase().includes(taskKeywords.toLowerCase()))
      .sort((a, b) => b.successRate - a.successRate);

    return candidates[0]?.toolName;
  }

  /**
   * getBestToolByCapability — 基于能力名推荐工具
   *
   * @param capability - 能力名（如 'shell', 'fs', 'code'）
   * @returns 工具名，如果数据不足返回 undefined
   */
  getBestToolByCapability(capability: string): string | undefined {
    const candidates = this.getStats()
      .filter(s => s.callCount >= 2)
      .filter(s => {
        const name = s.toolName.toLowerCase();
        const cap = capability.toLowerCase();
        return name.includes(cap) || name.includes(cap.replace(/_/g, ''));
      })
      .sort((a, b) => b.successRate - a.successRate || b.callCount - a.callCount);

    return candidates[0]?.toolName;
  }

  /**
   * reset — 重置所有统计
   */
  reset(): void {
    this.tools.clear();
  }

  /**
   * connectToRegistry — 连接 ToolRegistry，自动同步统计
   *
   * v13: 监听 tools.registry.stats_updated 事件，
   * 将 ToolQualityTracker 的统计数据同步到 ToolRegistry。
   *
   * @param eventBus - EventBus 实例
   */
  connectToRegistry(eventBus: { on: (event: string, handler: (event: any) => void) => void }): void {
    eventBus.on('tools.registry.stats_updated', (event: any) => {
      const p = event.payload;
      if (!p?.toolId) return;
      // 同步记录到本地追踪
      this.recordCall(p.toolId, p.success, p.duration);
    });
  }

  /**
   * getSummary — 获取汇总信息
   */
  getSummary(): { totalCalls: number; totalSuccess: number; totalFailures: number; overallSuccessRate: number; trackedTools: number } {
    let totalCalls = 0;
    let totalSuccess = 0;
    let totalFailures = 0;

    for (const entry of this.tools.values()) {
      totalCalls += entry.callCount;
      totalSuccess += entry.successCount;
      totalFailures += entry.failureCount;
    }

    return {
      totalCalls,
      totalSuccess,
      totalFailures,
      overallSuccessRate: totalCalls > 0 ? totalSuccess / totalCalls : 0,
      trackedTools: this.tools.size,
    };
  }
}
