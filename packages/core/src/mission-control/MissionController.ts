import { EventBus } from '../common/EventBus.js';
import type { MissionState, MissionStatus, MissionPhase, MissionUpdate, BlockReason } from './MissionTypes.js';
import { systemMetadataGraph } from '../metadata/SystemMetadataGraph.js';

export class MissionController {
  private missions: Map<string, MissionState> = new Map();
  private eventBus: EventBus;
  private persistentStore?: { save: (mission: MissionState) => void };

  constructor(eventBus: EventBus) {
    if (!eventBus) throw new Error('[MissionController] EventBus 是必填参数');
    this.eventBus = eventBus;
  }

  setPersistentStore(store: { save: (mission: MissionState) => void }): void {
    this.persistentStore = store;
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
    if (this.persistentStore) this.persistentStore.save(mission);
    systemMetadataGraph.registerEntity(mission.missionId, 'mission', objective.substring(0, 80), { goalId, status: 'ACTIVE', phase: 'DISCOVERY' });
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
    if (this.persistentStore) this.persistentStore.save(m);
    return m;
  }

  addBlock(missionId: string, reason: BlockReason, description: string): void {
    const m = this.missions.get(missionId);
    if (!m) return;
    m.blocks.push({ reason, description, raisedAt: Date.now() });
    systemMetadataGraph.addRelation(missionId, `${missionId}_block_${m.blocks.length}`, 'depends_on', 0.5, { reason, description });
    m.status = 'BLOCKED';
    m.timeline.push({ timestamp: Date.now(), event: `BLOCKED: ${reason}`, detail: description });
    if (this.persistentStore) this.persistentStore.save(m);
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

  /**
   * recover — 从失败/阻塞状态恢复 Mission
   * Stabilization: 分析阻塞原因，推荐恢复策略
   */
  recover(missionId: string): { recovered: boolean; actions: string[]; recommended: 'continue' | 'replan' | 'abort' } {
    const mission = this.missions.get(missionId);
    if (!mission) return { recovered: false, actions: [], recommended: 'abort' };

    const actions: string[] = [];
    const unresolved = mission.blocks.filter(b => !b.resolvedAt);

    for (const block of unresolved) {
      switch (block.reason) {
        case 'RESOURCE_UNAVAILABLE': actions.push(`等待资源: ${block.description}`); break;
        case 'QUALITY_FAILED':       actions.push(`质量问题: ${block.description}，建议重新规划`); break;
        case 'COMPLIANCE_BLOCKED':   actions.push(`合规阻塞: ${block.description}，需人工介入`); break;
        case 'HUMAN_WAITING':        actions.push(`等待审批: ${block.description}`); break;
        case 'EXTERNAL_DEPENDENCY':  actions.push(`外部依赖: ${block.description}`); break;
        case 'COST_LIMIT':           actions.push(`成本超限: ${block.description}`); break;
        default:                     actions.push(`未知阻塞: ${block.description}`);
      }
    }

    if (unresolved.length === 0) {
      mission.status = 'ACTIVE';
      return { recovered: true, actions: ['所有阻塞已解决'], recommended: 'continue' };
    }

    const hasHuman = unresolved.some(b => b.reason === 'HUMAN_WAITING' || b.reason === 'COMPLIANCE_BLOCKED');
    if (hasHuman) return { recovered: false, actions, recommended: 'abort' };

    const hasQuality = unresolved.some(b => b.reason === 'QUALITY_FAILED');
    if (hasQuality) return { recovered: false, actions, recommended: 'replan' };

    return { recovered: false, actions, recommended: 'abort' };
  }

  getAllMissions(): MissionState[] { return [...this.missions.values()]; }
}
