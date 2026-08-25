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

/**
 * Disposer — 可逆效果回卷函数（vNext·参考 deepseek-harness reversible-effects）
 *
 * 调用即回卷；返回 boolean 表示本次回卷是否全部成功（幂等：重复调用应安全）。
 */
export type Disposer = () => boolean;

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
   *
   * 返回 {@link Disposer}（可逆效果·vNext）：调用返回的 disposer 即撤销本次注册。
   * 保持旧行为兼容：不接管 disposer 的调用点不受影响（registrations 由调用方决定何时回卷）。
   */
  static register(primitive: ActionPrimitive): Disposer {
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
    return () => {
      // 幂等语义：重复撤销视为成功（净效果已达成），返回恒 true。
      // 保证 registerMultiple 聚合回滚不因双调误报失败；需精确布尔请直用 unregister()。
      DomainPrimitiveRegistry.unregister(primitive.name);
      return true;
    };
  }

  /**
   * registerMultiple — 批量注册
   *
   * 返回批量 disposer：调用时按注册顺序正序回卷（每个失败不影响其余，汇总结果）。
   */
  static registerMultiple(primitives: ActionPrimitive[]): Disposer {
    const disposers = primitives.map((p) => DomainPrimitiveRegistry.register(p));
    return () => {
      let all = true;
      for (const d of disposers) {
        try {
          all = d() && all;
        } catch (err) {
          all = false;
          console.warn('[DomainPrimitiveRegistry] ⚠️ 批量回卷一项失败:', err);
        }
      }
      return all;
    };
  }

  /**
   * effect — 统一「可逆效果」入口（参考 deepseek-harness reversible-effects 理念）
   *
   * 将一组注册 disposer 收集为一个可整体回卷的效果：
   *   1. register / registerMultiple 等注册动作产生 disposer
   *   2. 用 effect(...disposers) 收集
   *   3. 调用返回的 dispose() 时按 LIFO（后进先出）回卷全部注册并记录
   *
   * 与 PluginSystem（插件级生命周期）分工：本方法管理「原语/注册级」效果回卷；
   * 插件整体生命周期仍归 PluginSystem（initialize→start→stop + 依赖拓扑）。
   *
   * @example
   *   const dispose = DomainPrimitiveRegistry.effect(
   *     DomainPrimitiveRegistry.register(new MyDomainAction()),
   *   );
   *   // ... 插件卸载 / 演化回滚时：
   *   dispose();
   */
  static effect(...disposers: Disposer[]): Disposer {
    return () => {
      let all = true;
      // LIFO：后注册先回卷，与依赖顺序（后注册者可能依赖先注册者）对称
      for (let i = disposers.length - 1; i >= 0; i--) {
        const d = disposers[i];
        if (!d) continue;
        try {
          all = d() && all;
        } catch (err) {
          all = false;
          console.warn('[DomainPrimitiveRegistry] ⚠️ 效果回卷一项失败:', err);
        }
      }
      console.log(`[DomainPrimitiveRegistry] ♻️ 效果已回卷（${disposers.length} 项注册）`);
      return all;
    };
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
