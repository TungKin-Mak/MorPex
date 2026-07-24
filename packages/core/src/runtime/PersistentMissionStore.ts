/**
 * PersistentMissionStore — Event Sourcing 架构
 * 所有 Mission 状态变化通过事件记录，启动时从事件重放重建状态
 */
import { UnifiedEventStore } from '../protocol/events/store/UnifiedEventStore.js';
import { SYSTEM_EVENT_TYPES } from '../protocol/events/EventTypes.js';
import type { MissionState, MissionStatus, MissionPhase } from '../mission-control/MissionTypes.js';

export class PersistentMissionStore {
  private store: UnifiedEventStore;
  private missions: Map<string, MissionState> = new Map();
  private ready = false;

  constructor(dbPath?: string) { this.store = new UnifiedEventStore(dbPath || './data/missions.db'); }

  async init(): Promise<void> {
    try {
      await this.store.init();
      const events = await this.store.query({ limit: 10000 });
      for (const event of events) { this.apply(event as any); }
      this.ready = true;
      console.log(`[PersistentMissionStore] ✅ 事件源就绪: ${events.length} 事件, ${this.missions.size} Mission`);
    } catch (err) {
      console.warn('[PersistentMissionStore] 初始化失败，仅内存模式:', (err as Error).message);
    }
  }

  /** 追加事件并应用（事件源核心） */
  async append(type: string, missionId: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.ready) { this.applyDirect(missionId, type); return; }
    const base = { id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, type, timestamp: Date.now(), executionId: missionId, source: 'event-store', payload };
    await this.store.append(base as any);
    this.applyDirect(missionId, type);
  }

  get(id: string): MissionState | undefined { return this.missions.get(id); }
  getAll(): MissionState[] { return [...this.missions.values()]; }

  /** 从事件重建状态 */
  private apply(event: any): void {
    const p = event?.payload || {};
    const missionId = p.missionId;
    if (!missionId) return;
    let m = this.missions.get(missionId);
    if (!m) {
      m = { missionId, goalId: p.goalId || '', objective: p.objective || '', status: 'ACTIVE', phase: 'PLANNING', progress: 0, startTime: event.timestamp, estimatedCompletion: 0, blocks: [], risks: [], timeline: [], currentTeams: [], artifacts: [] };
      this.missions.set(missionId, m);
    }
    m.timeline.push({ timestamp: event.timestamp, event: event.type, detail: p.objective || '' });
    if (event.type === SYSTEM_EVENT_TYPES.MISSION_PHASE_CHANGED) m.phase = p.phase;
    if (event.type === SYSTEM_EVENT_TYPES.MISSION_STATUS_CHANGED) m.status = p.status;
    if (event.type === SYSTEM_EVENT_TYPES.MISSION_BLOCKED) { m.blocks.push({ reason: p.reason, description: p.description, raisedAt: event.timestamp }); m.status = 'BLOCKED'; }
    if (event.type === SYSTEM_EVENT_TYPES.MISSION_COMPLETED) { m.status = 'COMPLETED'; m.progress = 100; }
  }

  private applyDirect(missionId: string, type: string): void {
    let m = this.missions.get(missionId);
    if (!m) {
      m = { missionId, goalId: '', objective: '', status: 'ACTIVE', phase: 'PLANNING', progress: 0, startTime: Date.now(), estimatedCompletion: 0, blocks: [], risks: [], timeline: [], currentTeams: [], artifacts: [] };
      this.missions.set(missionId, m);
    }
    m.timeline.push({ timestamp: Date.now(), event: type, detail: '' });
  }
}
