/**
 * PromptStrategyRegistry — 提示词/策略库（会话 16e · 进化提案落地通道）
 *
 * 演化产物的"落地目标"：可学习事件（空参/安全拦截/高重试）→ 应用为策略 hint，
 * 存于此版本化注册表，装配/执行路径读取后影响后续行为（防再犯）。
 *
 * 特性：
 *   - 版本化：每次 setHint 递增版本（可追溯）
 *   - 可回滚：setHint 返回旧值，removeHint 恢复——配合 EvolutionSandbox.revert
 *   - 只存策略文本，不执行（纯数据，可序列化）
 *
 * @packageDocumentation
 */

export type StrategyType = 'empty-param' | 'safety-block' | 'high-retry';

export interface AppliedStrategy {
  type: StrategyType;
  hint: string;
  version: number;
  appliedAt: number;
}

export class PromptStrategyRegistry {
  private strategies = new Map<StrategyType, AppliedStrategy>();

  /** 获取某类型当前策略 hint（未应用 → null） */
  getHint(type: StrategyType): string | null {
    return this.strategies.get(type)?.hint ?? null;
  }

  /**
   * 应用策略（版本化）。返回旧值（供回滚恢复）；首次应用返回 null。
   */
  setHint(type: StrategyType, hint: string): { old: string | null } {
    const prev = this.strategies.get(type);
    const version = (prev?.version ?? 0) + 1;
    this.strategies.set(type, { type, hint, version, appliedAt: Date.now() });
    return { old: prev?.hint ?? null };
  }

  /** 移除策略（回滚）。返回被移除的值；不存在返回 null。 */
  removeHint(type: StrategyType): string | null {
    const cur = this.strategies.get(type);
    if (!cur) return null;
    this.strategies.delete(type);
    return cur.hint;
  }

  /** 全部已应用策略（供装配注入 / 观测） */
  all(): AppliedStrategy[] {
    return [...this.strategies.values()].sort((a, b) => b.version - a.version);
  }

  count(): number {
    return this.strategies.size;
  }
}
