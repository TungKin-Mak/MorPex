import { EventBus } from '../common/EventBus.js';
import type { MissionState, MissionStatus, MissionPhase, MissionUpdate, BlockReason } from './MissionTypes.js';

export class MissionController {
  private missions: Map<string, MissionState> = new Map();
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    if (!eventBus) throw new Error('[MissionController] EventBus 是必填参数');
    this.eventBus = eventBus;
  }

  createMission(goalId: string, objective: string): MissionState {
    const mission: MissionState = {
      missionId: `msn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      goalId, objective,
      status: 'ACTIVE', phase: 'DISCOVERY', progress: 0,
      startTime: Date.now(),
      estimatedCompletion: Date.now() + 7 * 86400000,
      blocks: [], risks: [],
      timeline: [{ timestamp: Date.now(), event: 'Mission created', detail: objective }],
      currentTeams: [], artifacts: [],
    };
    this.missions.set(mission.missionId, mission);
    this.eventBus.emit({
      id: `evt_${Date.now()}`, type: 'mission.created', timestamp: Date.now(),
      executionId: mission.missionId, source: 'mission-control',
      payload: { missionId: mission.missionId, objective },
    });
    return mission;
  }

  updateMission(update: MissionUpdate): MissionState | undefined {
    const m = this.missions.get(update.missionId);
    if (!m) return undefined;
    if (update.phase) m.phase = update.phase;
    if (update.progress !== undefined) m.progress = Math.min(100, Math.max(0, update.progress));
    if (update.status) m.status = update.status;
    if (update.blocks) m.blocks.push(...update.blocks);
    if (update.risks) m.risks.push(...update.risks);
    if (update.timeline) m.timeline.push(...update.timeline);
    return m;
  }

  addBlock(missionId: string, reason: BlockReason, description: string): void {
    const m = this.missions.get(missionId);
    if (!m) return;
    m.blocks.push({ reason, description, raisedAt: Date.now() });
    m.status = 'BLOCKED';
    m.timeline.push({ timestamp: Date.now(), event: `BLOCKED: ${reason}`, detail: description });
    this.eventBus.emit({ id: `evt_${Date.now()}`, type: 'mission.blocked', timestamp: Date.now(), executionId: missionId, source: 'mission-control', payload: { missionId, reason, description } });
  }

  resolveBlock(missionId: string, blockIndex: number): void {
    const m = this.missions.get(missionId);
    if (!m || !m.blocks[blockIndex]) return;
    m.blocks[blockIndex].resolvedAt = Date.now();
    if (m.blocks.every(b => b.resolvedAt)) m.status = 'ACTIVE';
    m.timeline.push({ timestamp: Date.now(), event: `Block resolved: ${m.blocks[blockIndex].reason}` });
  }

  addRisk(missionId: string, description: string, severity: 'LOW'|'MEDIUM'|'HIGH', probability: number, mitigation?: string): void {
    const m = this.missions.get(missionId);
    if (!m) return;
    m.risks.push({ description, severity, probability, mitigation });
    m.timeline.push({ timestamp: Date.now(), event: `Risk: ${severity} - ${description}` });
  }

  getMission(missionId: string): MissionState | undefined { return this.missions.get(missionId); }
  listMissions(status?: MissionStatus): MissionState[] {
    return status ? [...this.missions.values()].filter(m => m.status === status) : [...this.missions.values()];
  }
  getActiveMissions(): MissionState[] { return this.listMissions('ACTIVE'); }
  getBlockedMissions(): MissionState[] { return this.listMissions('BLOCKED'); }
}
