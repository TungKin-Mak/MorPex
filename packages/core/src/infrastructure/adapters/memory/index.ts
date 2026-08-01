/**
 * Memory Adapter Bridge — 统一 memory 包接入层
 *
 * ═══════════════════════════════════════════════════════════════════
 * ARCHITECTURAL BOUNDARY
 *   Only files in packages/core/src/infrastructure/adapters/ may directly import
 *   from the memory package.
 *
 *   All L2/L3/L4 core modules MUST import memory types and instances
 *   through this bridge, never via relative paths to memory/src/.
 * ═══════════════════════════════════════════════════════════════════
 *
 * 遵循规则：
 *   0.2 (类型来源法则): 基于 memory 包扩展类型
 *   0.4 (删除优先法则): 复用已有 MemoryWiki/MemoryRetriever 实现
 *
 * ⚠️ 这是 packages/core 内唯一允许 import packages/memory 的地方
 *
 * @module adapters/memory
 */

// ── 核心类型（从 wiki 子模块导入，注意 memory 包使用别名）──
export type {
  WikiMemoryItem,
  WikiMemoryRelation,
  WikiQueryOptions,
  WikiQueryResult,
  VectorHit,
  GraphNode,
  MemoryWikiConfig,
} from '../../../../../memory/src/index.js';

export type {
  RetrievalResult,
  ErrorRetrievalResult,
} from '../../../../../memory/src/index.js';

// ── 通用 Memory 类型 ──
export type {
  WriteDecision,
  MemoryStats,
  MemoryStorageAdapter,
  MemorySystemConfig,
  MemoryItem,
  MemoryQuery,
  MemoryType,
} from '../../../../../memory/src/index.js';

// ── DocWatcher / DocTopology 类型 ──
export type { DocWatcherConfig } from '../../../../../memory/src/index.js';

// ── 核心类 ──
import { MemoryWiki as _MemoryWiki } from '../../../../../memory/src/index.js';
import { MemoryRetriever as _MemoryRetriever } from '../../../../../memory/src/index.js';

// 重导出类（带类型安全）
export type MemoryWikiInstance = _MemoryWiki;
export type MemoryRetrieverInstance = _MemoryRetriever;

// 直接重导出类实例（供运行时使用）
export { MemoryWiki } from '../../../../../memory/src/index.js';
export { MemoryRetriever } from '../../../../../memory/src/index.js';
export { DocWatcher } from '../../../../../memory/src/index.js';
export { DocTopology } from '../../../../../memory/src/index.js';

// ── 工厂函数 ──

/**
 * createMemoryWiki — 创建 MemoryWiki 实例（统一工厂）
 *
 * L3/L4 层所有 MemoryWiki 创建必须通过此函数。
 */
export function createMemoryWiki(config?: _MemoryWikiConfig): _MemoryWiki {
  return new _MemoryWiki(config);
}

// Type-only import for factory signature
type _MemoryWikiConfig = import('../../../../../memory/src/index.js').MemoryWikiConfig;

// ═══════════════════════════════════════════════════════════════════
// 统一记忆层（MemoryAPI + cognee 引擎）—— 记忆系统统一改造新增
// 只增不改：保留上方旧导出，新增统一记忆层桥接
// ═══════════════════════════════════════════════════════════════════

// ── 统一记忆层实例与工厂 ──
export { createMemoryApi } from '../../../../../memory/src/index.js';
export { MemoryApi } from '../../../../../memory/src/index.js';
export type { MemoryApiOptions } from '../../../../../memory/src/index.js';
export { createEngine } from '../../../../../memory/src/index.js';
export type { EngineFactoryOptions } from '../../../../../memory/src/index.js';
export { CogneeEngine, MockEngine, CogneeClient } from '../../../../../memory/src/index.js';

// ── 统一记忆层类型 ──
export type {
  MemoryAPI,
  MemoryEngine,
  MemoryHit,
  MemoryQueryRequest,
  MemoryQueryResult,
  MemoryQuerySource,
  NeedHumanReason,
  UpsertEntityInput,
  UpsertResult,
  ConfirmTicket,
  ConfirmDecision,
  ReflectResult,
} from '../../../../../memory/src/index.js';

// ── 本体白名单 + 校验 ──
export {
  ENTITY_TYPES, RELATION_TYPES, DOMAIN_ONTOLOGY,
  isEntityType, isRelationType, entitiesForDomain, relationsForDomain,
  validateUpsert,
} from '../../../../../memory/src/index.js';

// ── 门禁（强制检索 / L2 隔离）──
export { ForceRetriever, buildEvidenceContext, CONFIDENCE_HUMAN_THRESHOLD } from '../../../../../memory/src/index.js';
export { isCompanyKnowledgeDomain, requiresGraphFacts } from '../../../../../memory/src/index.js';

export type { CogneeConfig } from '../../../../../memory/src/index.js';

/**
 * createMemoryRetriever — 创建 MemoryRetriever 实例
 */
export function createMemoryRetriever(wiki: _MemoryWiki): _MemoryRetriever {
  return new _MemoryRetriever(wiki);
}

// ── JSONLWriter (统一写入器) ──
export { JSONLWriter } from '../../../../../memory/src/index.js';
export type { CompactorConfig } from '../../../../../memory/src/index.js';
export { JSONLCompactor } from '../../../../../memory/src/index.js';
export { LogRotator } from '../../../../../memory/src/index.js';
export type { LogRotatorConfig } from '../../../../../memory/src/index.js';

// ═══════════════════════════════════════════════════════════════════
// MemoryBridge — 静态单例桥接器
// ═══════════════════════════════════════════════════════════════════

/**
 * MemoryBridge — 静态单例，提供 Memory 实例的统一访问点
 *
 * StudioServer 通过此桥接器注入实例，L3/L4 代码通过静态方法访问。
 * 避免了构造函数注入链的复杂性和循环依赖。
 *
 * 用法:
 *   // 启动时初始化（一次性）
 *   MemoryBridge.initialize({ wiki, retriever });
 *
 *   // 运行时使用
 *   const wiki = MemoryBridge.getWiki();
 */
export class MemoryBridge {
  private static _wiki: _MemoryWiki | null = null;
  private static _retriever: _MemoryRetriever | null = null;
  private static _initialized = false;

  /** initialize — 注入 Memory 实例（仅调用一次） */
  static initialize(deps: {
    wiki: _MemoryWiki;
    retriever: _MemoryRetriever;
  }): void {
    if (MemoryBridge._initialized) {
      console.warn('[MemoryBridge] 重复初始化，跳过');
      return;
    }
    MemoryBridge._wiki = deps.wiki;
    MemoryBridge._retriever = deps.retriever;
    MemoryBridge._initialized = true;
  }

  static getWiki(): _MemoryWiki {
    if (!MemoryBridge._wiki) throw new Error('[MemoryBridge] wiki 未初始化');
    return MemoryBridge._wiki;
  }

  static getRetriever(): _MemoryRetriever {
    if (!MemoryBridge._retriever) throw new Error('[MemoryBridge] retriever 未初始化');
    return MemoryBridge._retriever;
  }

  static isInitialized(): boolean {
    return MemoryBridge._initialized;
  }

  /**
   * getBus — 返回与 MemoryBus 兼容的适配器（向后兼容）
   *
   * 返回的对象实现了 MemoryBus 的 recall/remember API，
   * 内部委托给 MemoryWiki / MemoryRetriever。
   */
  static getBus(): {
    recall: (query: { text: string; topK?: number }) => Promise<{ items: Array<{ content: string; source?: string; tags?: string[]; importance?: number }> }>;
    remember: (payload: { content: string; source?: string; tags?: string[]; importance?: number }) => Promise<void>;
    on?: (event: string, handler: (...args: any[]) => void) => () => void;
  } | null {
    if (!MemoryBridge._initialized) return null;
    return {
      async recall(query: { text: string; topK?: number }) {
        const retriever = MemoryBridge.getRetriever();
        const result = await retriever.retrieveForTask(query.text, []);
        return {
          items: (result.snippets ?? []).map((s: string, i: number) => ({
            content: s,
            source: result.source ?? 'memory',
            tags: [],
            importance: 3 - i * 0.5,
          })),
        };
      },
      async remember(payload: { content: string; source?: string; tags?: string[]; importance?: number }) {
        const wiki = MemoryBridge.getWiki();
        await wiki.remember({
          id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'MemoryEntry',
          name: `Memory: ${payload.content.substring(0, 80)}`,
          data: payload,
        });
      },
    };
  }

  /** reset — 重置单例（仅用于测试） */
  static reset(): void {
    MemoryBridge._wiki = null;
    MemoryBridge._retriever = null;
    MemoryBridge._initialized = false;
  }
}
