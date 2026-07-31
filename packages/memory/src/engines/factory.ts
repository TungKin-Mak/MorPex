/**
 * engines/factory — 引擎工厂
 *
 * 默认 cognee（本地 API server）；engineKind='mock' 或 env COGNEE_URL 未配置时可用 mock 降级。
 * 低耦合：上层只拿到 MemoryEngine 接口。
 */

import { CogneeClient } from './cognee/client.js';
import { CogneeEngine } from './cognee/CogneeEngine.js';
import { MockEngine } from './mock/MockEngine.js';
import type { MemoryEngine } from '../memory-types.js';

export interface EngineFactoryOptions {
  engineKind?: 'cognee' | 'mock';
  baseUrl?: string;
  apiKey?: string;
  userId?: string;
  timeoutMs?: number;
}

export function createEngine(opts: EngineFactoryOptions = {}): MemoryEngine {
  const kind = opts.engineKind ?? process.env.MEMORY_ENGINE ?? 'cognee';
  if (kind === 'mock') {
    return new MockEngine();
  }
  const client = new CogneeClient({
    baseUrl: opts.baseUrl ?? process.env.COGNEE_URL ?? 'http://localhost:8000',
    apiKey: opts.apiKey ?? process.env.COGNEE_API_KEY,
    userId: opts.userId ?? process.env.COGNEE_USER_ID,
    timeoutMs: opts.timeoutMs,
  });
  return new CogneeEngine(client);
}
