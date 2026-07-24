import { UnifiedEventStore } from '../protocol/events/store/UnifiedEventStore.js';
import type { BaseEvent } from '../protocol/events/BaseEvent.js';
import type { MissionState, MissionStatus, MissionPhase } from '../mission-control/MissionTypes.js';

export class PersistentMissionStore {
  private store: UnifiedEventStore;
  private missions: Map<string, MissionState> = new Map();
  private ready = false;

  constructor(dbPath?: string) {
    this.store = new UnifiedEventStore(dbPath || './data/missions.db');
  }

  async init(): Promise<void> {
    try {
      await this.store.init();
      const events = await this.store.query({ type: 'mission.', limit: 1000 });
      for (const event of events) {
        this.replay(event);
      }
      this.ready = true;
      console.log(`[PersistentMissionStore] ✅ 已恢复 ${this.missions.size} 个 Mission`);
    } catch (err) {
      console.warn('[PersistentMissionStore] 初始化失败，使用内存模式:', (err as Error).message);
    }
  }

  save(mission: MissionState): void {
    this.missions.set(mission.missionId, mission);
    if (!this.ready) return;
    this.store.append({
      id: `evt_${Date.now()}`,
      type: 'mission.updated',
      timestamp: Date.now(),
      executionId: mission.missionId,
      source: 'persistent-mission-store',
      payload: { missionId: mission.missionId, goalId: mission.goalId, objective: mission.objective, status: mission.status, phase: mission.phase, progress: mission.progress },
    } as BaseEvent).catch((err: Error) => console.warn('[PersistentMissionStore] 写入失败:', err.message));
  }

  get(missionId: string): MissionState | undefined { return this.missions.get(missionId); }
  getAll(): MissionState[] { return [...this.missions.values()]; }

  private replay(event: BaseEvent): void {
    const p = event.payload || {};
    const missionId = (p as Record<string, unknown>).missionId as string | undefined;
    if (!missionId) return;
    let mission = this.missions.get(missionId);
    if (!mission) {
      mission = {
        missionId, goalId: ((p as Record<string, unknown>).goalId as string) || '', objective: ((p as Record<string, unknown>).objective as string) || '',
        status: 'ACTIVE', phase: 'PLANNING', progress: 0, startTime: event.timestamp,
        estimatedCompletion: 0, blocks: [], risks: [], timeline: [], currentTeams: [], artifacts: [],
      };
      this.missions.set(missionId, mission);
    }
    const status = (p as Record<string, unknown>).status as MissionStatus | undefined;
    const phase = (p as Record<string, unknown>).phase as MissionPhase | undefined;
    const progress = (p as Record<string, unknown>).progress as number | undefined;
    if (status) mission.status = status;
    if (phase) mission.phase = phase;
    if (typeof progress === 'number') mission.progress = progress;
  }
}
