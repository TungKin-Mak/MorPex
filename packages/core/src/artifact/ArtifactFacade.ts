/**
 * ArtifactFacade — 产物门面（v16 生命周期升级）
 * v16: 全生命周期管理 Created→Validating→Reviewing→Approved→Released→Deployed→Retired
 * + Lineage 追踪
 */
import { EventBus } from '../common/EventBus.js';
import type { ArtifactNode, ArtifactLineageEntry } from '../contracts/artifact-lifecycle.js';
import type { ArtifactStatus } from '../contracts/artifact-lifecycle.js';
import { systemMetadataGraph } from '../metadata/SystemMetadataGraph.js';

export class ArtifactFacade {
  private artifacts: Map<string, ArtifactNode> = new Map();
  private eventBus: EventBus;
  private store?: { save: (artifact: any) => void; transition: (id: string, to: string) => boolean };

  constructor(eventBus: EventBus) {
    if (!eventBus) throw new Error('[ArtifactFacade] EventBus 是必填参数');
    this.eventBus = eventBus;
  }

  setPersistentStore(store: { save: (artifact: any) => void; transition: (id: string, to: string) => boolean }): void {
    this.store = store;
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
    systemMetadataGraph.registerEntity(node.id, 'artifact', name, { type, sourceTask, version: 1 });
    if (sourceTask) systemMetadataGraph.addRelation(sourceTask, node.id, 'generated_by');
    this.emit('artifact.created', node);
    return node;
  }

  transition(id: string, to: ArtifactStatus): boolean {
    const art = this.artifacts.get(id);
    if (!art) return false;
    const valid = ArtifactFacade.VALID_TRANSITIONS[art.status] || [];
    if (!valid.includes(to)) return false;
    art.status = to;
    art.updatedAt = Date.now();
    art.lineage.push({
      from: art.id,
      relation: `${art.status.toLowerCase()}_to_${to.toLowerCase()}` as ArtifactLineageEntry['relation'],
      timestamp: Date.now(),
    });
    this.emit(`artifact.${to.toLowerCase()}`, art);
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
      executionId: 'artifact', source: 'artifact-facade',
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
