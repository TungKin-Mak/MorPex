/**
 * PersistentMissionStore — Event Sourcing 架构
 * 所有 Mission 状态变化通过事件记录，启动时从事件重放重建状态
 */
import { UnifiedEventStore } from '../../infrastructure/protocol/events/store/UnifiedEventStore.js';
import { SYSTEM_EVENT_TYPES } from '../../infrastructure/protocol/events/EventTypes.js';
import type { MissionState } from './mission/MissionTypes.js';

export interface StepState {
  nodeId: string;
  nodeName: string;
  status: string;            // running | success | failed | skipped | pending(重试中)
  error: string | null;
  outputPreview: string | null;   // completed 时截断后的结果预览（载荷上限见 DAGRuntime RESULT_CLIP）
  truncated: boolean;
  attempts: number;
  updatedAt: number;
}

/** step.* 事件 → 节点状态 映射 */
const STEP_EVENT_STATUS: Record<string, string> = {
  'step.started': 'running',
  'step.completed': 'success',
  'step.failed': 'failed',
  'step.skipped': 'skipped',
  'step.retry': 'pending',       // 重试 = 回到待执行（attempts 由载荷携带）
};

export class PersistentMissionStore {
  private store: UnifiedEventStore;
  private missions: Map<string, MissionState> = new Map();
  private ready = false;

  /** U2+U3：step 级运行态（missionId → nodeId → 最新状态），由 step.* 事件重放重建 */
  private stepStates: Map<string, Map<string, StepState>> = new Map();

  /** U2+U3：DAG 计划快照（execution.dag 事件重放产物，供断点续跑重建） */
  private dagPlans: Map<string, { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> }> = new Map();

  /** U2+U3：运行控制终态（run.paused/cancelled/resumed 事件重放产物，重启后不复活取消） */
  private runStates: Map<string, 'paused' | 'cancelled' | 'running'> = new Map();

  constructor(dbPath?: string) { this.store = new UnifiedEventStore(dbPath || './data/missions.db'); }

  async init(): Promise<void> {
    try {
      await this.store.init();
      const events = await this.store.query({ limit: 10000 });
      // ⚠️ U2+U3 修复：query 返回 sequence DESC（新→旧），直接遍历会导致“最新状态被最旧事件覆盖”。
      // 事件溯源必须按时间正序重放：先反转为 asc 再逐条 apply。
      for (const event of events.slice().reverse()) { this.apply(event); }
      this.ready = true;
      console.log(`[PersistentMissionStore] ✅ 事件源就绪: ${events.length} 事件, ${this.missions.size} Mission`);
    } catch (err) {
      // ═══ U2+U3：修复静默降级——初始化失败必须显式可见，不再无声变纯内存模式 ═══
      console.error('╔══════════════════════════════════════════════════╗');
      console.error('║ ⚠️ [PersistentMissionStore] 事件源初始化失败！仅内存模式 ║');
      console.error(`║    原因: ${(err as Error).message}`.padEnd(54) + ' ║');
      console.error('║    后果: 进程重启后任务状态将全部丢失（无断点续跑）     ║');
      console.error('╚══════════════════════════════════════════════════╝');
    }
  }

  /** U2+U3：事件源就绪状态（false = 内存模式，重启丢数据） */
  isReady(): boolean { return this.ready; }

  /** U2+U3：按 missionId 重放重建的 step 运行态（供断点续跑/运行控制查询） */
  getStepStates(missionId: string): Map<string, StepState> {
    return this.stepStates.get(missionId) ?? new Map();
  }

  /** 追加事件并应用（事件源核心） */
  async append(type: string, missionId: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.ready) {
      // 内存模式：生命周期走旧逻辑，step 级事件也要更新状态（降级不等于失忆）
      this.applyDirect(missionId, type);
      this.applyStepEvent(missionId, type, payload, Date.now());
      return;
    }
    const base = { id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, type, timestamp: Date.now(), executionId: missionId, source: 'event-store', payload };
    await this.store.append(base as unknown as import('../../infrastructure/protocol/events/BaseEvent.js').BaseEvent);
    this.apply(base as unknown as Record<string, unknown>);
  }

  /** U2+U3：step 级事件的应用逻辑（活写入与重放共用，防两路语义漂移） */
  private applyStepEvent(missionId: string, type: string, p: Record<string, unknown>, timestamp: number): void {
    if (!type.startsWith('step.')) return;
    const nodeId = typeof p.nodeId === 'string' ? p.nodeId : '';
    if (!nodeId) return;
    let steps = this.stepStates.get(missionId);
    if (!steps) { steps = new Map(); this.stepStates.set(missionId, steps); }
    const prev = steps.get(nodeId);
    const status = STEP_EVENT_STATUS[type] ?? prev?.status ?? 'unknown';
    steps.set(nodeId, {
      nodeId,
      nodeName: typeof p.nodeName === 'string' ? p.nodeName : (prev?.nodeName ?? nodeId),
      status,
      error: typeof p.error === 'string' ? p.error : (prev?.error ?? null),
      outputPreview: type === SYSTEM_EVENT_TYPES.STEP_COMPLETED && typeof p.output === 'string'
        ? p.output
        : (prev?.outputPreview ?? null),
      truncated: p.truncated === true || (prev?.truncated ?? false),
      attempts: typeof p.attempts === 'number' ? p.attempts : (prev?.attempts ?? 0),
      updatedAt: timestamp,
    });
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

    // ── U2+U3：step 级事件重放（断点续跑的数据基础；复用活写入同一逻辑防语义漂移）──
    this.applyStepEvent(missionId, event.type, p, event.timestamp);

    // ── U2+U3：计划快照与运行控制态 ──
    if (event.type === 'execution.dag' && Array.isArray(p.nodes)) {
      this.dagPlans.set(missionId, {
        nodes: p.nodes as Array<Record<string, unknown>>,
        edges: (Array.isArray(p.edges) ? p.edges : []) as Array<Record<string, unknown>>,
      });
    }
    if (event.type === 'run.paused') this.runStates.set(missionId, 'paused');
    if (event.type === 'run.cancelled') this.runStates.set(missionId, 'cancelled');
    if (event.type === 'run.resumed') this.runStates.set(missionId, 'running');
  }

  /** U2+U3：重建 DAG 所需的计划快照（无则 null） */
  getDagPlan(missionId: string): { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } | null {
    return this.dagPlans.get(missionId) ?? null;
  }

  /** U2+U3：运行终态查询（undefined=无记录） */
  getRunState(missionId: string): 'paused' | 'cancelled' | 'running' | undefined {
    return this.runStates.get(missionId);
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
