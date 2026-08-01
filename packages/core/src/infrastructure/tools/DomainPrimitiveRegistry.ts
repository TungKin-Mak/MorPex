/**
 * DomainPrimitiveRegistry — 领域原语注册中心
 *
 * v16 Phase 4.7: 一人跨多领域虚拟公司的领域能力管理。
 * 统一管理所有领域原语（电商、硬件、内容等），
 * 根据任务描述自动匹配最合适的原语执行。
 *
 * 设计原则：
 *   - 热注册：原语可以在运行时动态注册/注销
 *   - 自动匹配：根据任务描述通过 canHandle 匹配
 *   - 部门隔离：原语执行时注入 deptId
 *   - 版本追踪：记录每个原语的调用统计
 *
 * 数据流：
 *   ToolFactory.generateToolForTask()
 *     → DomainPrimitiveRegistry.match(task)
 *     → DomainPrimitiveRegistry.execute(matchedPrimitive, params)
 *     → UnifiedExecutionEngine / ExecutionFabric
 *
 * @packageDocumentation
 */

import type { ActionPrimitive, ActionResult } from './primitives/types.js';

// ── Types ──

export interface PrimitiveRegistration {
  primitive: ActionPrimitive;
  registeredAt: number;
  callCount: number;
  successCount: number;
  lastCalledAt: number | null;
}

export interface PrimitiveMatchResult {
  primitive: ActionPrimitive;
  confidence: number;
  reason: string;
}

export interface PrimitiveStats {
  totalPrimitives: number;
  totalCalls: number;
  successRate: number;
  topPrimitives: Array<{
    name: string;
    callCount: number;
    successRate: number;
  }>;
}

// ── DomainPrimitiveRegistry ──

export class DomainPrimitiveRegistry {
  static name = 'DomainPrimitiveRegistry';
  static version = '1.0.0';

  private static primitives: Map<string, PrimitiveRegistration> = new Map();
  private static totalCalls = 0;

  /**
   * register — 注册一个领域原语
   */
  static register(primitive: ActionPrimitive): void {
    if (DomainPrimitiveRegistry.primitives.has(primitive.name)) {
      console.warn(`[DomainPrimitiveRegistry] ⚠️ 原语 "${primitive.name}" 已存在，覆盖注册`);
    }
    DomainPrimitiveRegistry.primitives.set(primitive.name, {
      primitive,
      registeredAt: Date.now(),
      callCount: 0,
      successCount: 0,
      lastCalledAt: null,
    });
    console.log(`[DomainPrimitiveRegistry] ✅ 原语 "${primitive.name}" 已注册 (共 ${DomainPrimitiveRegistry.primitives.size} 个)`);
  }

  /**
   * registerMultiple — 批量注册
   */
  static registerMultiple(primitives: ActionPrimitive[]): void {
    for (const p of primitives) DomainPrimitiveRegistry.register(p);
  }

  /**
   * unregister — 注销原语
   */
  static unregister(name: string): boolean {
    return DomainPrimitiveRegistry.primitives.delete(name);
  }

  /**
   * match — 根据任务描述匹配原语（按置信度降序）
   */
  static match(task: string): PrimitiveMatchResult[] {
    const results: PrimitiveMatchResult[] = [];
    for (const [, reg] of DomainPrimitiveRegistry.primitives) {
      try {
        const score = reg.primitive.canHandle(task);
        if (score > 0) {
          results.push({
            primitive: reg.primitive,
            confidence: score,
            reason: `原语 "${reg.primitive.name}" 匹配度 ${(score * 100).toFixed(0)}%`,
          });
        }
      } catch {
        // 单个匹配失败不影响整体
      }
    }
    results.sort((a, b) => b.confidence - a.confidence);
    return results;
  }

  /**
   * matchBest — 返回最佳匹配
   */
  static matchBest(task: string): PrimitiveMatchResult | undefined {
    return DomainPrimitiveRegistry.match(task)[0];
  }

  /**
   * execute — 通过名称执行原语
   */
  static async execute(
    name: string,
    params: Record<string, unknown>,
    context?: { departmentId?: string; userId?: string },
  ): Promise<ActionResult> {
    const reg = DomainPrimitiveRegistry.primitives.get(name);
    if (!reg) return { success: false, error: `原语 "${name}" 未注册` };

    DomainPrimitiveRegistry.totalCalls++;
    reg.callCount++;
    reg.lastCalledAt = Date.now();

    try {
      const result = await reg.primitive.execute(params, context);
      if (result.success) reg.successCount++;
      return result;
    } catch (err) {
      return { success: false, error: `原语 "${name}" 执行失败: ${(err as Error).message}` };
    }
  }

  static get(name: string): ActionPrimitive | undefined {
    return DomainPrimitiveRegistry.primitives.get(name)?.primitive;
  }

  static list(): ActionPrimitive[] {
    return [...DomainPrimitiveRegistry.primitives.values()].map(r => r.primitive);
  }

  static listNames(): string[] {
    return [...DomainPrimitiveRegistry.primitives.keys()];
  }

  static isRegistered(name: string): boolean {
    return DomainPrimitiveRegistry.primitives.has(name);
  }

  static getStats(): PrimitiveStats {
    const items = [...DomainPrimitiveRegistry.primitives.values()];
    const totalS = items.reduce((s, r) => s + r.successCount, 0);
    return {
      totalPrimitives: items.length,
      totalCalls: DomainPrimitiveRegistry.totalCalls,
      successRate: DomainPrimitiveRegistry.totalCalls > 0 ? totalS / DomainPrimitiveRegistry.totalCalls : 0,
      topPrimitives: items.sort((a, b) => b.callCount - a.callCount).slice(0, 10).map(r => ({
        name: r.primitive.name,
        callCount: r.callCount,
        successRate: r.callCount > 0 ? r.successCount / r.callCount : 0,
      })),
    };
  }

  static clear(): void {
    DomainPrimitiveRegistry.primitives.clear();
    DomainPrimitiveRegistry.totalCalls = 0;
    console.log('[DomainPrimitiveRegistry] 🗑️ 所有原语已清空');
  }
}
