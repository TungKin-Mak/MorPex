import { UnifiedEventStore } from '../protocol/events/store/UnifiedEventStore.js';
import type { BaseEvent } from '../protocol/events/BaseEvent.js';
import type { ArtifactNode, ArtifactStatus } from '../contracts/artifact-lifecycle.js';

export class PersistentArtifactStore {
  private store: UnifiedEventStore;
  private artifacts: Map<string, ArtifactNode> = new Map();
  private ready = false;

  constructor(dbPath?: string) {
    this.store = new UnifiedEventStore(dbPath || './data/artifacts.db');
  }

  async init(): Promise<void> {
    try {
      await this.store.init();
      const events = await this.store.query({ type: 'artifact.', limit: 1000 });
      for (const event of events) {
        this.replay(event);
      }
      this.ready = true;
      console.log(`[PersistentArtifactStore] ✅ 已恢复 ${this.artifacts.size} 个 Artifact`);
    } catch (err) {
      console.warn('[PersistentArtifactStore] 初始化失败，使用内存模式:', (err as Error).message);
    }
  }

  save(artifact: ArtifactNode): void {
    this.artifacts.set(artifact.id, artifact);
    if (!this.ready) return;
    this.store.append({
      id: `evt_${Date.now()}`,
      type: 'artifact.created',
      timestamp: Date.now(),
      executionId: artifact.sourceTask,
      source: 'persistent-artifact-store',
      payload: { artifactId: artifact.id, name: artifact.name, type: artifact.type, status: artifact.status, sourceTask: artifact.sourceTask, version: artifact.version },
    } as BaseEvent).catch((err: Error) => console.warn('[PersistentArtifactStore] 写入失败:', err.message));
  }

  transition(id: string, to: ArtifactStatus): boolean {
    const art = this.artifacts.get(id);
    if (!art) return false;
    art.status = to;
    art.updatedAt = Date.now();
    if (this.ready) {
      this.store.append({
        id: `evt_${Date.now()}`,
        type: 'artifact.transitioned',
        timestamp: Date.now(),
        executionId: art.sourceTask,
        source: 'persistent-artifact-store',
        payload: { artifactId: id, from: art.status, to },
      } as BaseEvent).catch(() => {});
    }
    return true;
  }

  get(id: string): ArtifactNode | undefined { return this.artifacts.get(id); }
  getByTask(taskId: string): ArtifactNode[] { return [...this.artifacts.values()].filter(a => a.sourceTask === taskId); }

  private replay(event: BaseEvent): void {
    const p = (event.payload || {}) as Record<string, unknown>;
    if (event.type === 'artifact.created') {
      const node: ArtifactNode = {
        id: p.artifactId as string, type: p.type as string, name: p.name as string,
        version: (p.version as number) || 1, status: (p.status as ArtifactStatus) || 'CREATED',
        sourceTask: p.sourceTask as string, lineage: [], createdAt: Date.now(), updatedAt: Date.now(), metadata: {},
      };
      this.artifacts.set(node.id, node);
    } else if (event.type === 'artifact.transitioned') {
      const art = this.artifacts.get(p.artifactId as string);
      if (art) art.status = p.to as ArtifactStatus;
    }
  }
}
