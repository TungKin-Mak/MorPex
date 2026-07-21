/**
 * Knowledge Graph Plugin — 知识图谱插件
 *
 * 整合 Agent / Task / Artifact / Decision / Memory 的统一视图。
 * 自动从各数据源导入实体，提供跨源查询和路径发现。
 *
 * 事件协议：
 *   - 监听: 'knowledge.import.artifact'  ← 从 Artifact Plugin 导入
 *   - 监听: 'knowledge.import.memory'    ← 从 Memory Plugin 导入
 *   - 监听: 'knowledge.import.execution' ← 从 Execution Graph 导入
 *   - 监听: 'knowledge.search'           ← 搜索实体
 *   - 监听: 'knowledge.path'             ← 路径查询
 *   - 监听: 'knowledge.neighborhood'     ← 邻域查询
 *   - 广播: 'knowledge.entity_added'     → 实体添加
 *   - 广播: 'knowledge.relation_added'   → 关系添加
 *   - 广播: 'knowledge.search_results'   → 搜索结果
 *   - 广播: 'knowledge.path_result'      → 路径结果
 *   - 广播: 'knowledge.stats'            → 统计
 */

import type {
  MorPexPlugin,
  PluginContext,
  EventBus,
  MorPexEvent,
} from '../../../common/types.js';
import { KnowledgeGraph } from './KnowledgeGraph.js';
import type { KnowledgePluginConfig, KnowledgeQuery, RelationType } from './types.js';

/** 默认配置 */
const DEFAULT_CONFIG: Required<KnowledgePluginConfig> = {
  maxEntities: 1000,
  dataDir: './data/knowledge',
};

/**
 * KnowledgeGraphPlugin — 知识图谱插件
 */
export class KnowledgeGraphPlugin implements MorPexPlugin {
  name = 'knowledge-graph-plugin';
  version = '0.1.0';
  dependencies = ['artifact-plugin', 'memory-plugin'];

  private graph!: KnowledgeGraph;
  private eventBus!: EventBus;
  private identity!: { createEventId(): string };
  private config!: Required<KnowledgePluginConfig>;
  private unsubscribers: Array<() => void> = [];
  private initialized = false;

  async initialize(context: PluginContext): Promise<void> {
    this.eventBus = context.eventBus;
    this.identity = context.executionIdentity;
    this.config = {
      maxEntities: (context.config?.knowledge as any)?.maxEntities ?? DEFAULT_CONFIG.maxEntities,
      dataDir: (context.config?.knowledge as any)?.dataDir ?? DEFAULT_CONFIG.dataDir,
    };

    const dataDir = (context.config?.knowledge as any)?.dataDir ?? './data/knowledge';
    this.graph = new KnowledgeGraph({ maxEntities: this.config.maxEntities, dataDir });

    // 引擎回调 → EventBus
    this.graph.onEntityAdded = (entity) => {
      this.emitEvent('knowledge.entity_added', { entity });
    };
    this.graph.onRelationAdded = (relation) => {
      this.emitEvent('knowledge.relation_added', { relation });
    };

    this.initialized = true;
    console.log('[KnowledgeGraphPlugin] 已初始化');
  }

  async start(): Promise<void> {
    if (!this.initialized) {
      throw new Error('[KnowledgeGraphPlugin] 请在 start() 前调用 initialize()');
    }

    // 从磁盘加载已有实体和关系（Cognee 风格持久化）
    await this.graph.loadFromDisk();

    // 监听导入请求
    this.unsubscribers.push(
      this.eventBus.on('knowledge.import.artifact', async (event: MorPexEvent) => {
        const data = event.payload as any;
        if (data?.id && data?.name) {
          const entity = await this.graph.importFromArtifact(data);
          this.emitEvent('knowledge.imported', { source: 'artifact', entity });

          // 自动关联到相关目标实体
          if (data.goalEntityId) {
            this.graph.addRelation({
              source: entity.id,
              target: data.goalEntityId,
              type: 'part_of',
              metadata: { autoImported: true },
            });
          }
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('knowledge.import.memory', (event: MorPexEvent) => {
        const data = event.payload as any;
        if (data?.id) {
          const entity = this.graph.importFromMemory(data);
          this.emitEvent('knowledge.imported', { source: 'memory', entity });
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('knowledge.import.execution', (event: MorPexEvent) => {
        const data = event.payload as any;
        if (data?.id) {
          const entity = this.graph.importFromExecution(data);
          this.emitEvent('knowledge.imported', { source: 'execution', entity });
        }
      }),
    );

    // 监听查询
    this.unsubscribers.push(
      this.eventBus.on('knowledge.search', (event: MorPexEvent) => {
        const query = (event.payload?.query ?? event.payload) as KnowledgeQuery;
        if (query) {
          const entities = this.graph.searchEntities(query);
          const relations = this.graph.searchRelations(query);
          this.emitEvent('knowledge.search_results', { query, entities, relations });
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('knowledge.path', (event: MorPexEvent) => {
        const { from, to } = event.payload ?? {};
        if (from && to) {
          const path = this.graph.findPath(from, to);
          this.emitEvent('knowledge.path_result', { from, to, path });
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('knowledge.neighborhood', (event: MorPexEvent) => {
        const { entityId, depth } = event.payload ?? {};
        if (entityId) {
          const hood = this.graph.getNeighborhood(entityId, depth ?? 1);
          this.emitEvent('knowledge.neighborhood_result', { entityId, ...hood });
        }
      }),
    );

    // 监听统计
    this.unsubscribers.push(
      this.eventBus.on('knowledge.get_stats', () => {
        this.emitEvent('knowledge.stats', { stats: this.graph.getStats() });
      }),
    );

    // Phase 12: Cross-sync bridge — listen for artifact.created and auto-import
    this.unsubscribers.push(
      this.eventBus.on('artifact.created', async (event: MorPexEvent) => {
        const data = event.payload as any;
        if (data?.artifactId || data?.artifact?.id) {
          const artifact = data.artifact || { id: data.artifactId, name: data.name, type: data.type };
          try {
            await this.graph.importFromArtifact(artifact);
            this.emitEvent('knowledge.imported', { source: 'artifact-auto-sync', entity: artifact });
          } catch { /* skip failed imports */ }
        }
      }),
    );

    // Also listen for artifact.updated to update knowledge graph
    this.unsubscribers.push(
      this.eventBus.on('artifact.updated', async (event: MorPexEvent) => {
        const data = event.payload as any;
        if (data?.artifactId || data?.artifact?.id) {
          const artifact = data.artifact || { id: data.artifactId, name: data.name, type: data.type };
          try {
            await this.graph.importFromArtifact(artifact);
          } catch { /* skip */ }
        }
      }),
    );

    console.log('[KnowledgeGraphPlugin] 已启动，正在监听 knowledge.* + artifact.* 事件');
  }

  async stop(): Promise<void> {
    for (const unsub of this.unsubscribers) {
      try { unsub(); } catch { /* ignore */ }
    }
    this.unsubscribers = [];
    this.graph.clear();
    console.log('[KnowledgeGraphPlugin] 已停止');
  }

  /** 获取图谱引擎 */
  getGraph(): KnowledgeGraph {
    return this.graph;
  }

  private emitEvent(type: string, payload: any): void {
    const event: MorPexEvent = {
      id: this.identity.createEventId(),
      type,
      timestamp: Date.now(),
      executionId: 'knowledge-graph-plugin',
      source: 'knowledge-graph-plugin',
      payload,
    };
    this.eventBus.emit(event);
  }
}
