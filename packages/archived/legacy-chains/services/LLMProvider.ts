/**
 * LLMProvider — LLM 调用函数注册中心 (v2: AsyncLocalStorage)
 *
 * v1 (Phase 2): 全局单例 — 简单但不支持多 Kernel 实例隔离
 * v2 (Phase 5): AsyncLocalStorage — 请求级上下文隔离，零侵入
 *
 * 设计约束：
 *   - 每个 Kernel/MorPex 实例通过 AsyncLocalStorage.run() 绑定自己的 callLLM
 *   - 消费端 LLMProvider.get() 从当前异步上下文获取，无需传参
 *   - 向后兼容：仍保留 set()/get() 全局降级路径（单实例场景）
 *   - 测试友好：reset() 清理上下文
 */

import { AsyncLocalStorage } from 'async_hooks';

/** LLM 调用函数签名 */
export type LLMCaller = (prompt: string, systemPrompt?: string) => Promise<string>;

/** 异步上下文存储：每个执行链路独立的 LLM 调用函数 */
const _storage = new AsyncLocalStorage<LLMCaller>();

/** 全局降级单例（向后兼容） */
let _globalFallback: LLMCaller | null = null;

/**
 * LLMProvider — 注册中心 (v2)
 */
export const LLMProvider = {
  /**
   * set — 注册全局 LLM 调用函数（降级路径）
   *
   * 单实例场景下使用。多实例场景请使用 run()。
   * 重复注册会发出警告。
   */
  set(caller: LLMCaller): void {
    if (_globalFallback) {
      console.warn('[LLMProvider] ⚠️ 重复注册全局降级，正在覆盖');
    }
    _globalFallback = caller;
    console.log('[LLMProvider] ✅ 全局 LLM 调用函数已注册（降级路径）');
  },

  /**
   * get — 获取当前上下文的 LLM 调用函数
   *
   * 优先级：
   *   1. AsyncLocalStorage 上下文（多实例隔离）
   *   2. 全局降级单例（向后兼容）
   *
   * 如果都未注册，抛出异常。
   */
  get(): LLMCaller {
    // 优先从当前异步上下文获取
    const ctxCaller = _storage.getStore();
    if (ctxCaller) return ctxCaller;

    // 降级到全局单例
    if (_globalFallback) return _globalFallback;

    throw new Error(
      '[LLMProvider] LLM 调用函数未注册。' +
      '请确保在启动时调用 LLMProvider.set(caller) 或使用 LLMProvider.run(caller, fn)。',
    );
  },

  /**
   * run — 在指定 LLM 配置的异步上下文中执行函数
   *
   * 多 Kernel 实例场景的标准用法：
   * ```typescript
   * LLMProvider.run(deepseekCaller, () => {
   *   // 此上下文内所有 LLMProvider.get() 返回 deepseekCaller
   *   await kernel1.start();
   * });
   * ```
   *
   * @param caller - 当前上下文的 LLM 调用函数
   * @param fn - 在此上下文中执行的函数
   * @returns fn 的返回值
   */
  run<T>(caller: LLMCaller, fn: () => T): T {
    return _storage.run(caller, fn);
  },

  /**
   * isRegistered — 检查是否已注册（上下文或全局）
   */
  isRegistered(): boolean {
    return _storage.getStore() !== undefined || _globalFallback !== null;
  },

  /**
   * reset — 重置（主要用于测试）
   */
  reset(): void {
    _globalFallback = null;
    // AsyncLocalStorage 无需手动清理 — 随上下文自动销毁
  },
};
