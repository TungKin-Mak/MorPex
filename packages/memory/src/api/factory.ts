/**
 * api/factory — MemoryApi 工厂
 *
 * 便捷入口：createMemoryApi() → 统一记忆层（引擎可从 env 配置）。
 */

import type { MemoryApiOptions } from './MemoryApi.js';
import { MemoryApi } from './MemoryApi.js';
import type { MemoryEngine } from '../memory-types.js';
import { createEngine, type EngineFactoryOptions } from '../engines/factory.js';

export interface CreateMemoryApiOptions extends EngineFactoryOptions {
  engine?: MemoryEngine;
  confirmationDbPath?: string;
  autoWriteConfidence?: number;
  dataset?: string;
  scope?: string;
}

export function createMemoryApi(opts: CreateMemoryApiOptions = {}): MemoryApi {
  const engine = opts.engine ?? createEngine(opts);
  const apiOpts: MemoryApiOptions = {
    engine,
    confirmationDbPath: opts.confirmationDbPath,
    autoWriteConfidence: opts.autoWriteConfidence,
    dataset: opts.dataset,
    scope: opts.scope,
  };
  return new MemoryApi(apiOpts);
}
