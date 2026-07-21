/**
 * Artifact Plugin — 交付物管理插件
 *
 * 管理 Agent 产出的实际交付物（Artifact Instance）。
 * 注意：只管理 Instance（实际产物），Blueprint（蓝图）属于 Planner。
 *
 * 事件协议：
 *   - 监听: 'artifact.register'         ← 注册新 Artifact
 *   - 监听: 'artifact.update'           ← 更新 Artifact
 *   - 监听: 'artifact.create_relation'  ← 创建关系
 *   - 监听: 'artifact.search'           ← 查询 Artifact
 *   - 广播: 'artifact.created'          → Artifact 创建
 *   - 广播: 'artifact.updated'          → Artifact 更新
 *   - 广播: 'artifact.status_changed'   → 状态变更
 *   - 广播: 'artifact.relation_created' → 关系创建
 */

import type {
  MorPexPlugin,
  PluginContext,
  EventBus,
  MorPexEvent,
} from '../../../common/types.js';
import { ArtifactRegistry } from './ArtifactRegistry.js';
import type { ArtifactPluginConfig, ArtifactInstance, ArtifactStatus } from './types.js';

/** 默认配置 */
const DEFAULT_CONFIG: Required<ArtifactPluginConfig> = {
  storage: { basePath: './data/artifacts' },
  maxVersions: 10,
  dataDir: './data/artifacts',
};

/**
 * ArtifactPlugin — 交付物管理插件
 */
export class ArtifactPlugin implements MorPexPlugin {
  name = 'artifact-plugin';
  version = '0.1.0';
  dependencies: string[] = [];

  private registry!: ArtifactRegistry;
  private eventBus!: EventBus;
  private identity!: { createEventId(): string };
  private config!: Required<ArtifactPluginConfig>;
  private unsubscribers: Array<() => void> = [];
  private initialized = false;

  async initialize(context: PluginContext): Promise<void> {
    this.eventBus = context.eventBus;
    this.identity = context.executionIdentity;

    const userConfig = (context.config?.artifact ?? {}) as ArtifactPluginConfig;
    this.config = {
      storage: { ...DEFAULT_CONFIG.storage, ...(userConfig.storage ?? {}) },
      maxVersions: userConfig.maxVersions ?? DEFAULT_CONFIG.maxVersions,
      dataDir: userConfig.dataDir ?? DEFAULT_CONFIG.dataDir,
    };

    this.registry = new ArtifactRegistry(this.config);

    // 注册表回调 → EventBus（持久化由 ArtifactRegistry._scheduleAutoSave 自动处理）
    this.registry.onArtifactCreated = (artifact) => {
      this.emitEvent('artifact.created', { artifact });
    };

    this.registry.onArtifactUpdated = (artifact, prevVersion) => {
      this.emitEvent('artifact.updated', { artifact, prevVersion });
    };

    this.registry.onArtifactStatusChanged = (artifactId, status, prevStatus) => {
      this.emitEvent('artifact.status_changed', { artifactId, status, prevStatus });
    };

    this.registry.onRelationCreated = (relation) => {
      this.emitEvent('artifact.relation_created', { relation });
    };

    this.initialized = true;
    console.log('[ArtifactPlugin] 已初始化');
  }

  async start(): Promise<void> {
    if (!this.initialized) {
      throw new Error('[ArtifactPlugin] 请在 start() 前调用 initialize()');
    }

    // 从磁盘恢复数据（由 ArtifactRegistry 统一管理）
    try {
      const loaded = await this.registry.loadFromDisk();
      if (loaded.artifacts > 0 || loaded.relations > 0) {
        console.log(`[ArtifactPlugin] 从存储恢复了 ${loaded.artifacts} 个 Artifact, ${loaded.relations} 个关系`);
      }
    } catch (err: unknown) {
      console.warn('[ArtifactPlugin] 存储恢复失败:', (err as Error).message);
    }

    // 监听注册请求
    this.unsubscribers.push(
      this.eventBus.on('artifact.register', (event: MorPexEvent) => {
        const data = event.payload as any;
        if (data?.name && data?.content) {
          const artifact = ArtifactRegistry.createArtifact({
            name: data.name,
            type: data.type ?? 'other',
            content: data.content,
            sourceNodeId: data.sourceNodeId,
            createdBy: data.createdBy,
            metadata: data.metadata,
          });
          this.registry.register(artifact);
        }
      }),
    );

    // 监听更新请求
    this.unsubscribers.push(
      this.eventBus.on('artifact.update', (event: MorPexEvent) => {
        const { artifactId, content, changeLog, status } = event.payload ?? {};
        const artifact = this.registry.get(artifactId);
        if (artifact) {
          let updated = artifact;
          if (content !== undefined) {
            updated = ArtifactRegistry.updateContent(updated, content);
          }
          if (status) {
            updated = ArtifactRegistry.changeStatus(updated, status as ArtifactStatus);
          }
          this.registry.update(updated, changeLog);
        }
      }),
    );

    // 监听关系创建
    this.unsubscribers.push(
      this.eventBus.on('artifact.create_relation', (event: MorPexEvent) => {
        const { from, to, type } = event.payload ?? {};
        if (from && to && type) {
          try { this.registry.createRelation(from, to, type); } catch { /* ignore */ }
        }
      }),
    );

    // 监听查询
    this.unsubscribers.push(
      this.eventBus.on('artifact.search', (event: MorPexEvent) => {
        const query = event.payload?.query ?? {};
        const results = this.registry.search(query);
        this.emitEvent('artifact.search_results', { query, results });
      }),
    );

    console.log('[ArtifactPlugin] 已启动，正在监听 artifact.* 事件');
  }

  async stop(): Promise<void> {
    for (const unsub of this.unsubscribers) {
      try { unsub(); } catch { /* ignore */ }
    }
    this.unsubscribers = [];
    this.registry.clear();
    console.log('[ArtifactPlugin] 已停止');
  }

  /** 获取注册中心 */
  getRegistry(): ArtifactRegistry {
    return this.registry;
  }

  private emitEvent(type: string, payload: any): void {
    const event: MorPexEvent = {
      id: this.identity.createEventId(),
      type,
      timestamp: Date.now(),
      executionId: 'artifact-plugin',
      source: 'artifact-plugin',
      payload,
    };
    this.eventBus.emit(event);
  }
}
