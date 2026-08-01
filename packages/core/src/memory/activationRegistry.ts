/**
 * memory/activationRegistry — MemoryActivationEngine 全局注册表（L7 深水区）
 *
 * 装配层（bootstrapUnified）创建引擎并注入统一记忆层数据源后注册到此处，
 * 供 StudioServer（RuntimeAPI / SessionManager）复用同一实例，
 * 避免各处 new 空引擎（旧 RuntimeAPI 行为：永远 No relevant memories）。
 *
 * 与 observability/ExerciseContext 的全局注册表模式一致。
 */

import type { MemoryActivationEngine } from './MemoryActivationEngine.js';

let globalEngine: MemoryActivationEngine | null = null;

/** 装配层注册（bootstrap 完成后调用；null 表示注销） */
export function setGlobalActivationEngine(engine: MemoryActivationEngine | null): void {
  globalEngine = engine;
}

/** 获取已装配的引擎（未装配返回 null，调用方自行兜底） */
export function getGlobalActivationEngine(): MemoryActivationEngine | null {
  return globalEngine;
}
