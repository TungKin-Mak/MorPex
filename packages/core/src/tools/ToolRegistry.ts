import { EventBus } from '../common/EventBus.js';

// ── Types ──

export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required: string[];
  };
  category?: string;
}

export interface RegisteredTool {
  id: string;
  schema: ToolSchema;
  codeTemplate: string;
  stats: {
    successCount: number;
    failureCount: number;
    avgDuration: number;
    lastUsed: number;
  };
  version: number;
  createdAt: number;
}

// ── ToolRegistry ──

export class ToolRegistry {
  private static tools: Map<string, RegisteredTool> = new Map();
  private static eventBus: EventBus | null = null;

  static init(eventBus: EventBus): void {
    ToolRegistry.eventBus = eventBus;
  }

  static async register(schema: ToolSchema, codeTemplate: string): Promise<string> {
    const toolId = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const tool: RegisteredTool = {
      id: toolId,
      schema,
      codeTemplate,
      stats: {
        successCount: 0,
        failureCount: 0,
        avgDuration: 0,
        lastUsed: 0,
      },
      version: 1,
      createdAt: Date.now(),
    };

    ToolRegistry.tools.set(toolId, tool);

    if (ToolRegistry.eventBus) {
      ToolRegistry.eventBus.emit({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'tools.registry.registered',
        timestamp: Date.now(),
        executionId: 'tools',
        source: 'tool-registry',
        payload: { toolId, name: schema.name, category: schema.category },
      });
    }

    return toolId;
  }

  static get(toolId: string): RegisteredTool | undefined {
    return ToolRegistry.tools.get(toolId);
  }

  static findByName(name: string): RegisteredTool | undefined {
    return [...ToolRegistry.tools.values()].find(t => t.schema.name === name);
  }

  static list(category?: string): RegisteredTool[] {
    const all = [...ToolRegistry.tools.values()];
    return category ? all.filter(t => t.schema.category === category) : all;
  }

  static updateStats(toolId: string, success: boolean, duration: number): void {
    const tool = ToolRegistry.tools.get(toolId);
    if (!tool) return;

    if (success) tool.stats.successCount++;
    else tool.stats.failureCount++;

    const total = tool.stats.successCount + tool.stats.failureCount;
    tool.stats.avgDuration = total > 1
      ? (tool.stats.avgDuration * (total - 1) + duration) / total
      : duration;
    tool.stats.lastUsed = Date.now();

    if (ToolRegistry.eventBus) {
      ToolRegistry.eventBus.emit({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'tools.registry.stats_updated',
        timestamp: Date.now(),
        executionId: 'tools',
        source: 'tool-registry',
        payload: { toolId, success, duration, totalCalls: total },
      });
    }
  }

  static getTopTools(limit: number = 5): RegisteredTool[] {
    return [...ToolRegistry.tools.values()]
      .sort((a, b) => {
        const aRate = a.stats.successCount / Math.max(1, a.stats.successCount + a.stats.failureCount);
        const bRate = b.stats.successCount / Math.max(1, b.stats.successCount + b.stats.failureCount);
        return bRate - aRate;
      })
      .slice(0, limit);
  }

  static clear(): void {
    ToolRegistry.tools.clear();
  }

  static getStats(): { totalTools: number; totalCalls: number } {
    let totalCalls = 0;
    for (const tool of ToolRegistry.tools.values()) {
      totalCalls += tool.stats.successCount + tool.stats.failureCount;
    }
    return { totalTools: ToolRegistry.tools.size, totalCalls };
  }

  /**
   * getQualityReport — 获取工具质量报告
   * v13: 基于注册工具的调用统计生成质量报告
   */
  static getQualityReport(): {
    topTools: Array<{ name: string; successRate: number; callCount: number }>;
    worstTools: Array<{ name: string; successRate: number; callCount: number }>;
    recommendations: string[];
    overallStats: { totalTools: number; totalCalls: number; avgSuccessRate: number };
  } {
    const toolsList = [...ToolRegistry.tools.values()];
    const recommendations: string[] = [];
    const withRate = toolsList.map(t => ({
      name: t.schema.name,
      successRate: t.stats.successCount + t.stats.failureCount > 0
        ? t.stats.successCount / (t.stats.successCount + t.stats.failureCount)
        : 0,
      callCount: t.stats.successCount + t.stats.failureCount,
    }));
    const sorted = [...withRate].sort((a, b) => b.successRate - a.successRate);
    const topTools = sorted.slice(0, 5).filter(t => t.callCount > 0);
    const worstTools = [...withRate]
      .filter(t => t.callCount >= 2)
      .sort((a, b) => a.successRate - b.successRate)
      .slice(0, 5);
    if (worstTools.length > 0 && worstTools[0].successRate < 0.5) {
      recommendations.push(`工具 "${worstTools[0].name}" 成功率仅 ${Math.round(worstTools[0].successRate * 100)}%`);
    }
    if (toolsList.length === 0) {
      recommendations.push('暂无注册工具，建议通过 ToolFactory 创建');
    }
    const totalCalls = withRate.reduce((s, t) => s + t.callCount, 0);
    const avgSuccessRate = totalCalls > 0
      ? withRate.reduce((s, t) => s + t.successRate * t.callCount, 0) / totalCalls
      : 0;
    return { topTools, worstTools, recommendations, overallStats: { totalTools: toolsList.length, totalCalls, avgSuccessRate } };
  }
}
