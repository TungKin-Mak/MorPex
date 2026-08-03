/**
 * ArtifactFacade — 产物门面（v16 生命周期升级）
 * v16: 全生命周期管理 Created→Validating→Reviewing→Approved→Released→Deployed→Retired
 * + Lineage 追踪
 */
import { EventBus } from '../../infrastructure/common/EventBus.js';
import { EventType } from '../../infrastructure/protocol/events/EventType.js';
import type { ArtifactNode, ArtifactLineageEntry } from '../../infrastructure/protocol/contracts/artifact-lifecycle.js';
import type { ArtifactStatus } from '../../infrastructure/protocol/contracts/artifact-lifecycle.js';
import { systemMetadataGraph } from '../../knowledge/graph/SystemMetadataGraph.js';
import type { IEventStore } from '../../infrastructure/protocol/events/store/IEventStore.js';

export class ArtifactFacade {
  private artifacts: Map<string, ArtifactNode> = new Map();
  private eventBus: EventBus;
  private store?: { save: (artifact: any) => void; transition: (id: string, to: string) => boolean };
  private eventStore?: IEventStore;

  constructor(eventBus: EventBus) {
    if (!eventBus) throw new Error('[ArtifactFacade] EventBus 是必填参数');
    this.eventBus = eventBus;
  }

  setPersistentStore(store: { save: (artifact: ArtifactNode) => void; transition: (id: string, to: string) => boolean }): void {
    this.store = store;
  }

  /**
   * setEventStore — 注入 EventStore 作为真相源
   */
  setEventStore(store: IEventStore): void {
    this.eventStore = store;
  }

  /**
   * restoreFromEvents — 从 EventStore 事件重建产物状态
   * 遍历 ARTIFACT_CREATED / ARTIFACT_UPDATED 事件恢复所有产物
   */
  async restoreFromEvents(eventStore: IEventStore): Promise<void> {
    this.artifacts.clear();

    const createdEvents = await eventStore.query({ type: EventType.ARTIFACT_CREATED });
    for (const evt of createdEvents) {
      const p = evt.payload as { artifactId?: string; type?: string; name?: string; version?: number; sourceTask?: string } | undefined;
      if (p?.artifactId) {
        const node: ArtifactNode = {
          id: p.artifactId,
          type: p.type || 'document',
          name: p.name || p.artifactId,
          version: p.version || 1,
          status: 'CREATED',
          sourceTask: p.sourceTask || '',
          lineage: [],
          createdAt: evt.timestamp,
          updatedAt: evt.timestamp,
          metadata: {},
        };
        this.artifacts.set(node.id, node);
      }
    }

    // 应用状态转换事件（按时间顺序回放）
    const updatedEvents = await eventStore.query({ type: EventType.ARTIFACT_UPDATED });
    updatedEvents.sort((a, b) => a.timestamp - b.timestamp);
    for (const evt of updatedEvents) {
      const p = evt.payload as { artifactId?: string; status?: import('../../infrastructure/protocol/contracts/artifact-lifecycle.js').ArtifactLifecycleStatus } | undefined;
      if (p?.artifactId) {
        const art = this.artifacts.get(p.artifactId);
        if (art) {
          art.status = p.status || art.status;
          art.updatedAt = evt.timestamp;
        }
      }
    }

    console.log(`[ArtifactFacade] ✅ 从 EventStore 重建: ${this.artifacts.size} 个产物`);
  }

  create(name: string, type: string, sourceTask: string, metadata?: Record<string, unknown>): ArtifactNode {
    const node: ArtifactNode = {
      id: `art_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type, name, version: 1, status: 'CREATED', sourceTask,
      lineage: [], createdAt: Date.now(), updatedAt: Date.now(),
      metadata: metadata || {},
    };
    this.artifacts.set(node.id, node);
    if (this.store) this.store.save(node);
    // EventStore 写入
    if (this.eventStore) {
      this.eventStore.append({
        id: `evt_${node.id}_created`,
        type: EventType.ARTIFACT_CREATED,
        timestamp: Date.now(),
        executionId: sourceTask || node.id,
        source: 'artifact-facade',
        payload: { artifactId: node.id, name, type, status: node.status, sourceTask },
      }).catch((err: Error) => console.warn('[ArtifactFacade] EventStore append failed:', err.message));
    }
    systemMetadataGraph.registerEntity(node.id, 'artifact', name, { type, sourceTask, version: 1 });
    if (sourceTask) systemMetadataGraph.addRelation(sourceTask, node.id, 'generated_by');
    this.emit(EventType.ARTIFACT_CREATED, node);
    return node;
  }

  transition(id: string, to: ArtifactStatus): boolean {
    const art = this.artifacts.get(id);
    if (!art) return false;
    const from = art.status; // ⬅️ 捕获旧状态
    const valid = ArtifactFacade.VALID_TRANSITIONS[from] || [];
    if (!valid.includes(to)) return false;
    art.status = to;
    art.updatedAt = Date.now();
    art.lineage.push({
      from: art.id,
      relation: `${from.toLowerCase()}_to_${to.toLowerCase()}` as ArtifactLineageEntry['relation'],
      timestamp: Date.now(),
    });
    // EventStore 写入
    if (this.eventStore) {
      this.eventStore.append({
        id: `evt_${id}_${Date.now()}`,
        type: EventType.ARTIFACT_UPDATED,
        timestamp: Date.now(),
        executionId: id,
        source: 'artifact-facade',
        payload: { artifactId: id, status: to, from }, // ⬅️ from 是旧状态
      }).catch((err: Error) => console.warn('[ArtifactFacade] EventStore append failed:', err.message));
    }
    this.emit(EventType.ARTIFACT_UPDATED, art);
    if (this.store) this.store.transition(id, to);
    return true;
  }

  addLineage(id: string, entry: ArtifactLineageEntry): void {
    const art = this.artifacts.get(id);
    if (art) art.lineage.push(entry);
  }

  getLineage(id: string): ArtifactLineageEntry[] {
    return this.artifacts.get(id)?.lineage || [];
  }

  getByTask(taskId: string): ArtifactNode[] {
    return [...this.artifacts.values()].filter(a => a.sourceTask === taskId);
  }

  get(id: string): ArtifactNode | undefined {
    return this.artifacts.get(id);
  }

  /** createFromTask — 向后兼容: 委托给 create */
  async createFromTask(taskId: string, content: unknown, type: string): Promise<ArtifactNode> {
    const name = typeof content === 'object' && content !== null
      ? (content as Record<string,unknown>).name as string || taskId
      : taskId;
    return this.create(name, type, taskId, { content });
  }

  getAll(): ArtifactNode[] {
    return [...this.artifacts.values()];
  }

  private emit(type: string, payload: unknown): void {
    this.eventBus!.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 4)}`,
      type, timestamp: Date.now(),
      executionId: (payload as { sourceTask?: string })?.sourceTask || 'artifact',
      source: 'artifact-facade',
      payload,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // Artifact Blueprint 支持 (Phase 1-5)
  // ═══════════════════════════════════════════════════════════

  private blueprints: Map<string, import('./ArtifactBlueprint.js').ArtifactBlueprint> = new Map();

  setBlueprints(bps: import('./ArtifactBlueprint.js').ArtifactBlueprint[]): void {
    bps.forEach(bp => this.blueprints.set(bp.id, bp));
  }

  getPendingBlueprints(): import('./ArtifactBlueprint.js').ArtifactBlueprint[] {
    return [...this.blueprints.values()].filter(b => b.status === 'PENDING');
  }

  getNextReadyBlueprint(): import('./ArtifactBlueprint.js').ArtifactBlueprint | undefined {
    return [...this.blueprints.values()].find(
      b => b.status === 'PENDING' && b.dependsOn.every(d => this.blueprints.get(d)?.status === 'COMPLETED'),
    );
  }

  markBlueprintCompleted(id: string): void {
    const bp = this.blueprints.get(id);
    if (bp) bp.status = 'COMPLETED';
  }

  getAllBlueprints(): import('./ArtifactBlueprint.js').ArtifactBlueprint[] {
    return [...this.blueprints.values()];
  }

  static readonly VALID_TRANSITIONS: Record<ArtifactStatus, ArtifactStatus[]> = {
    CREATED: ['VALIDATING', 'FAILED'],
    VALIDATING: ['REVIEWING', 'FAILED'],
    REVIEWING: ['APPROVED', 'FAILED'],
    APPROVED: ['RELEASED', 'FAILED'],
    RELEASED: ['DEPLOYED', 'FAILED'],
    DEPLOYED: ['RETIRED', 'FAILED'],
    RETIRED: [],
    FAILED: ['CREATED'],
  };
}
