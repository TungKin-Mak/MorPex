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
import * as fs from 'node:fs';
import * as path from 'node:path';

export class ArtifactFacade {
  private artifacts: Map<string, ArtifactNode> = new Map();
  private eventBus: EventBus;
  private store?: { save: (artifact: any) => void; transition: (id: string, to: string) => boolean };
  private eventStore?: IEventStore;
  // ═══ 会话 17i.19：产物快照（启动快速恢复；事件重放兜底）═══
  private snapshotPath = path.resolve('data/artifacts.snapshot.json');
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  // ═══ 会话 17i.21：懒加载——启动不载入全部产物，首次读才从快照合并加载（启动 O(1)，不随产物量增长）═══
  private loaded = false;

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
   *
   * ═══ P0 修复（会话 16l）：显式分页拉全量（此前默认 limit=100 只恢复 100 个产物）
   */
  async restoreFromEvents(eventStore: IEventStore): Promise<void> {
    this.artifacts.clear();

    const PAGE_SIZE = 5000;
    const createdEvents: import('../../infrastructure/protocol/events/BaseEvent.js').BaseEvent[] = [];
    let offset = 0;
    for (;;) {
      const page = await eventStore.query({ type: EventType.ARTIFACT_CREATED, limit: PAGE_SIZE, offset });
      createdEvents.push(...page);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
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
    const updatedEvents: import('../../infrastructure/protocol/events/BaseEvent.js').BaseEvent[] = [];
    offset = 0;
    for (;;) {
      const page = await eventStore.query({ type: EventType.ARTIFACT_UPDATED, limit: PAGE_SIZE, offset });
      updatedEvents.push(...page);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
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
    this.loaded = true;
  }

  // ═══════════════════════════════════════════════════════════
  // 会话 17i.19：产物快照（启动快速恢复，事件重放兜底）
  // ═══════════════════════════════════════════════════════════

  /** 懒加载：首次读时从快照合并历史产物（只补缺，不覆盖内存中已新建的会话产物）。 */
  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (!fs.existsSync(this.snapshotPath)) return;
      const raw = fs.readFileSync(this.snapshotPath, 'utf-8');
      const data = JSON.parse(raw) as { version?: number; artifacts?: ArtifactNode[] };
      if (!data || !Array.isArray(data.artifacts)) return;
      let added = 0;
      for (const a of data.artifacts) {
        if (a && typeof a.id === 'string' && !this.artifacts.has(a.id)) {
          this.artifacts.set(a.id, { ...a, lineage: Array.isArray(a.lineage) ? a.lineage : [], metadata: a.metadata ?? {} });
          added++;
        }
      }
      console.log(`[ArtifactFacade] ⚡ 懒加载快照: 补入 ${added} 个历史产物（当前 ${this.artifacts.size}）`);
    } catch (e) {
      console.warn(`[ArtifactFacade] ⚠️ 懒加载快照失败: ${(e as Error).message}`);
    }
  }

  /** 保存产物快照（序列化内存产物表，供下次启动快速恢复；data/ 已 gitignore）。 */
  saveSnapshot(): void {
    try {
      fs.mkdirSync(path.dirname(this.snapshotPath), { recursive: true });
      fs.writeFileSync(
        this.snapshotPath,
        JSON.stringify({ version: 1, savedAt: Date.now(), artifacts: [...this.artifacts.values()] }, null, 2),
        'utf-8',
      );
    } catch (e) {
      console.warn(`[ArtifactFacade] ⚠️ 快照保存失败: ${(e as Error).message}`);
    }
  }

  /** 从快照恢复；成功返回 true（缺失/损坏 → false，调用方回退事件重放）。 */
  async restoreFromSnapshot(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.snapshotPath)) return false;
      const raw = fs.readFileSync(this.snapshotPath, 'utf-8');
      const data = JSON.parse(raw) as { version?: number; artifacts?: ArtifactNode[] };
      if (!data || !Array.isArray(data.artifacts)) return false;
      this.artifacts.clear();
      for (const a of data.artifacts) {
        if (a && typeof a.id === 'string') {
          this.artifacts.set(a.id, { ...a, lineage: Array.isArray(a.lineage) ? a.lineage : [], metadata: a.metadata ?? {} });
        }
      }
      this.loaded = true;
      console.log(`[ArtifactFacade] ✅ 从快照恢复: ${this.artifacts.size} 个产物`);
      return true;
    } catch (e) {
      console.warn(`[ArtifactFacade] ⚠️ 快照加载失败（回退事件重放）: ${(e as Error).message}`);
      return false;
    }
  }

  /** 产物变更后防抖落盘（500ms），使快照保持较新，减少崩溃时回退重放。 */
  private scheduleSnapshot(): void {
    if (this.snapshotTimer !== undefined) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = undefined;
      this.saveSnapshot();
    }, 500);
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
    if (sourceTask) {
      systemMetadataGraph.addRelation(sourceTask, node.id, 'generated_by');
      // ═══ 血缘接线（审计发现 addLineage 零调用）：产物节点 lineage 数组补录溯源 ═══
      // addRelation 只写图关系，ArtifactNode.lineage 数组（addLineage 入口）此前从未填充
      this.addLineage(node.id, {
        from: sourceTask,
        relation: 'generated_by',
        timestamp: Date.now(),
        detail: name,
      });
    }
    this.emit(EventType.ARTIFACT_CREATED, node);
    this.scheduleSnapshot(); // 17i.19：产物变更 → 防抖落盘快照
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
    this.scheduleSnapshot(); // 17i.19：状态转换 → 防抖落盘快照
    return true;
  }

  addLineage(id: string, entry: ArtifactLineageEntry): void {
    const art = this.artifacts.get(id);
    if (art) art.lineage.push(entry);
  }

  getLineage(id: string): ArtifactLineageEntry[] {
    this.ensureLoaded();
    return this.artifacts.get(id)?.lineage || [];
  }

  getByTask(taskId: string): ArtifactNode[] {
    this.ensureLoaded();
    return [...this.artifacts.values()].filter(a => a.sourceTask === taskId);
  }

  get(id: string): ArtifactNode | undefined {
    this.ensureLoaded();
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
    this.ensureLoaded();
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
