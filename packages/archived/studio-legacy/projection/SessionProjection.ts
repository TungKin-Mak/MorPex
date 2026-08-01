/**
 * SessionProjection — 会话状态读模型投影
 *
 * 与 EventBus 并存，各司其职：
 *   - EventBus: 瞬时消息传输（阅后即焚）
 *   - SessionProjection: 订阅 EventBus，在后端内存中实时维护
 *     "大脑全景状态拓扑树"的结构化快照，供前端随时 Pull 或重载
 *
 * 前端重连流程：
 *   1. 前端 SSE 断开后重连 EventSource
 *   2. 同时发送 GET /api/projection/:sessionId
 *   3. 后端返回全量投影状态 → 3D 大脑重构视觉引线
 *   4. 新 EventBus 事件继续增量更新投影
 *
 * 投影内容：
 *   - DAG 节点状态（pending/running/completed/failed）
 *   - Agent 状态（idle/working/blocked/suspended）
 *   - 产物清单（artifacts）
 *   - 事件时间线（最近的 200 条）
 *   - 跨领域约束状态
 */

import type { MorPexEvent } from '../common/types.js';

// ── 类型 ──

export interface ProjectionParams {
  sessionId: string;
}

export interface ProjectionRecord {
  sessionId: string;
  dagNodes: DAGNodeProjection[];
  agentStates: AgentStateProjection[];
  artifacts: ArtifactProjection[];
  timeline: TimelineEntry[];
  constraints: ConstraintProjection[];
  updatedAt: number;
}

export interface DAGNodeProjection {
  taskId: string;
  domain: string;
  goal: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  deps: string[];
  assignedAgent?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface AgentStateProjection {
  agentId: string;
  name: string;
  domain: string;
  role: string;
  status: 'idle' | 'working' | 'blocked' | 'suspended';
  currentTaskId?: string;
  toolCallPending?: boolean;
}

export interface ArtifactProjection {
  id: string;
  name: string;
  type: string;
  domain: string;
  version: number;
  createdAt: number;
}

export interface TimelineEntry {
  type: string;
  timestamp: number;
  summary: string;
  executionId?: string;
}

export interface ConstraintProjection {
  id: string;
  type: 'lock' | 'dependency' | 'negotiation';
  domainA: string;
  domainB: string;
  status: 'active' | 'resolved' | 'escalated';
  updatedAt: number;
}

// ── SessionProjection ──

const MAX_TIMELINE = 200;
const PROJECTION_TTL_MS = 30 * 60 * 1000; // 30 分钟无更新自动过期

export class SessionProjection {
  private projections: Map<string, ProjectionRecord> = new Map();
  private lastAccess: Map<string, number> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private eventBus: { on: (type: string, handler: (event: any) => void) => () => void } | null = null;
  private unsubscribers: Array<() => void> = [];

  constructor(eventBus?: { on: (type: string, handler: (event: any) => void) => () => void }) {
    if (eventBus) {
      this.eventBus = eventBus;
      this.startListening();
    }
  }

  /** start — 开始订阅 EventBus 事件 */
  startListening(): void {
    if (!this.eventBus) return;

    this.unsubscribers.push(
      this.eventBus.on('runtime.execution.started', (event) => {
        const sessionId = event.payload?.sessionId || event.executionId;
        this.ensureProjection(sessionId);
        this.addTimeline(sessionId, { type: event.type, timestamp: event.timestamp, summary: '执行开始', executionId: event.executionId });
      })
    );

    this.unsubscribers.push(
      this.eventBus.on('runtime.execution.completed', (event) => {
        const sessionId = event.payload?.sessionId || event.executionId;
        this.addTimeline(sessionId, { type: event.type, timestamp: event.timestamp, summary: '执行完成', executionId: event.executionId });
      })
    );

    this.unsubscribers.push(
      this.eventBus.on('cross_domain.dag_created', (event) => {
        const sessionId = event.payload?.sessionId || 'cross-domain';
        const proj = this.ensureProjection(sessionId);
        const nodes = event.payload?.dag || [];
        for (const n of nodes) {
          if (!proj.dagNodes.find(d => d.taskId === n.taskId)) {
            proj.dagNodes.push({
              taskId: n.taskId,
              domain: n.domain || n.goal?.domain || 'unknown',
              goal: n.goal || '',
              status: 'pending',
              deps: n.deps || [],
            });
          }
        }
        this.addTimeline(sessionId, { type: event.type, timestamp: event.timestamp, summary: `DAG 已创建: ${nodes.length} 个节点`, executionId: event.executionId });
      })
    );

    this.unsubscribers.push(
      this.eventBus.on('runtime.task.started', (event) => {
        const sessionId = event.payload?.sessionId || event.executionId;
        const proj = this.ensureProjection(sessionId);
        const node = proj.dagNodes.find(n => n.taskId === (event.payload?.taskId || ''));
        if (node) { node.status = 'running'; node.startedAt = event.timestamp; node.assignedAgent = event.payload?.agentId; }
        this.updateAgentState(event.payload?.agentId, { status: 'working', currentTaskId: event.payload?.taskId });
        this.addTimeline(sessionId, { type: event.type, timestamp: event.timestamp, summary: `任务: ${event.payload?.taskName || event.payload?.taskId}` });
      })
    );

    this.unsubscribers.push(
      this.eventBus.on('runtime.task.completed', (event) => {
        const sessionId = event.payload?.sessionId || event.executionId;
        const proj = this.ensureProjection(sessionId);
        const node = proj.dagNodes.find(n => n.taskId === (event.payload?.taskId || ''));
        if (node) { node.status = event.payload?.status === 'success' ? 'completed' : 'failed'; node.completedAt = event.timestamp; node.error = event.payload?.error; }
        this.updateAgentState(event.payload?.agentId, { status: 'idle', currentTaskId: undefined });
        this.addTimeline(sessionId, { type: event.type, timestamp: event.timestamp, summary: `任务完成: ${event.payload?.taskId}`, executionId: event.executionId });
      })
    );

    this.unsubscribers.push(
      this.eventBus.on('artifact.created', (event) => {
        const sessionId = event.payload?.sessionId || event.executionId || 'global';
        const proj = this.ensureProjection(sessionId);
        const art = event.payload?.artifact || event.payload;
        if (art && art.id && !proj.artifacts.find(a => a.id === art.id)) {
          proj.artifacts.push({
            id: art.id, name: art.name || art.id, type: art.type || 'unknown',
            domain: event.payload?.domain || 'unknown', version: art.version || 1, createdAt: event.timestamp,
          });
        }
        this.addTimeline(sessionId, { type: event.type, timestamp: event.timestamp, summary: `产物: ${art?.name || art?.id || 'unknown'}`, executionId: event.executionId });
      })
    );

    this.unsubscribers.push(
      this.eventBus.on('human.pause.created', (event) => {
        const sessionId = event.payload?.sessionId || event.executionId;
        this.addTimeline(sessionId, { type: event.type, timestamp: event.timestamp, summary: '⏸️ 等待人工确认', executionId: event.executionId });
      })
    );

    this.unsubscribers.push(
      this.eventBus.on('human.decision', (event) => {
        const sessionId = event.payload?.sessionId || event.executionId;
        this.addTimeline(sessionId, { type: event.type, timestamp: event.timestamp, summary: `✅ 人工决策: ${event.payload?.decision || 'unknown'}`, executionId: event.executionId });
      })
    );

    // 清理定时器
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
  }

  /** stop — 取消订阅，停止清理 */
  stop(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; }
  }

  /** getProjection — 按 sessionId 获取投影快照 */
  getProjection(sessionId: string): ProjectionRecord | null {
    const proj = this.projections.get(sessionId);
    if (!proj) return null;
    this.lastAccess.set(sessionId, Date.now());
    return proj;
  }

  /** getAllProjections — 获取所有投影的元数据（不含详情） */
  getAllProjections(): Array<{ sessionId: string; nodeCount: number; artifactCount: number; updatedAt: number }> {
    return Array.from(this.projections.entries()).map(([k, v]) => ({
      sessionId: k,
      nodeCount: v.dagNodes.length,
      artifactCount: v.artifacts.length,
      updatedAt: v.updatedAt,
    }));
  }

  /** getStats — 统计信息 */
  getStats(): { totalProjections: number; totalNodes: number; totalArtifacts: number; totalTimeline: number } {
    let totalNodes = 0, totalArtifacts = 0, totalTimeline = 0;
    for (const p of this.projections.values()) {
      totalNodes += p.dagNodes.length;
      totalArtifacts += p.artifacts.length;
      totalTimeline += p.timeline.length;
    }
    return { totalProjections: this.projections.size, totalNodes, totalArtifacts, totalTimeline };
  }

  // ── 内部方法 ──

  private ensureProjection(sessionId: string): ProjectionRecord {
    let proj = this.projections.get(sessionId);
    if (!proj) {
      proj = {
        sessionId,
        dagNodes: [],
        agentStates: [],
        artifacts: [],
        timeline: [],
        constraints: [],
        updatedAt: Date.now(),
      };
      this.projections.set(sessionId, proj);
    }
    proj.updatedAt = Date.now();
    this.lastAccess.set(sessionId, Date.now());
    return proj;
  }

  private addTimeline(sessionId: string, entry: TimelineEntry): void {
    const proj = this.projections.get(sessionId);
    if (!proj) return;
    proj.timeline.push(entry);
    if (proj.timeline.length > MAX_TIMELINE) proj.timeline = proj.timeline.slice(-MAX_TIMELINE);
  }

  private updateAgentState(agentId: string | undefined, updates: Partial<AgentStateProjection>): void {
    if (!agentId) return;
    for (const proj of this.projections.values()) {
      const agent = proj.agentStates.find(a => a.agentId === agentId);
      if (agent) Object.assign(agent, updates);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [sessionId, last] of this.lastAccess) {
      if (now - last > PROJECTION_TTL_MS) {
        this.projections.delete(sessionId);
        this.lastAccess.delete(sessionId);
      }
    }
  }
}
