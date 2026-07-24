/**
 * ArtifactFacade — 产物管理门面
 * v14: 包裹 planes/artifact-plane/ 提供简洁 API
 */
import { EventBus } from '../common/EventBus.js';
import type { Artifact, ArtifactType, ArtifactStatus } from '../contracts/artifact.js';

export class ArtifactFacade {
  private eventBus: EventBus;
  private artifacts: Map<string, Artifact> = new Map();

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  async createFromTask(taskId: string, content: unknown, type: string): Promise<Artifact> {
    const artifact: Artifact = {
      id: `art_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: type as ArtifactType,
      sourceTask: taskId,
      version: 1,
      status: 'CREATED' as ArtifactStatus,
      metadata: { contentPreview: JSON.stringify(content).substring(0, 500) },
      createdAt: Date.now(),
    };
    this.artifacts.set(artifact.id, artifact);

    this.eventBus.emit({
      id: `evt_${Date.now()}`,
      type: 'artifact.created',
      timestamp: Date.now(),
      executionId: taskId,
      source: 'artifact-facade',
      payload: { artifactId: artifact.id, type, taskId },
    });
    return artifact;
  }

  async approve(artifactId: string): Promise<Artifact | undefined> {
    const art = this.artifacts.get(artifactId);
    if (!art) return undefined;
    art.status = 'APPROVED';
    this.eventBus.emit({
      id: `evt_${Date.now()}`,
      type: 'artifact.approved',
      timestamp: Date.now(),
      executionId: art.sourceTask,
      source: 'artifact-facade',
      payload: { artifactId },
    });
    return art;
  }

  async getByTask(taskId: string): Promise<Artifact[]> {
    return [...this.artifacts.values()].filter(a => a.sourceTask === taskId);
  }

  getAll(): Artifact[] {
    return [...this.artifacts.values()];
  }
}
