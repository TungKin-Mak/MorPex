/**
 * TaskStateProjector — 任务状态投影（P-A：UI 状态持久化第一性原理「真相源」）
 *
 * 设计契约：docs/design/ui-state-persistence.md §3.2
 *
 * 问题（现状）：任务执行状态（steps/DAG/progress）只在前端内存 + SSE 事件流，
 * 切视图/刷新/重启即丢；事件本身缺任务级关联键（execution.step.* 只有 nodeId）。
 *
 * 本服务：
 *   1. 订阅 execution.dag / execution.step.* / workflow.step_* 事件（P-A 透传后 payload 带 missionId/goal）
 *   2. 投影 = 任务级「当前状态」（goal/spaceId/steps/DAG/progress）——可查、可恢复
 *   3. 防抖落盘 data/tasks/<missionId>.json；启动扫描载入
 *   4. 暴露 get(missionId) / list()（供 GET /api/tasks/:id、/api/tasks）
 *
 * 键 = missionId（贯穿：MissionController ↔ DAGExecutorAdapter context ↔ 前端 threadId）。
 * 事件溯源仍是根本真源；投影是「当前状态」缓存，损坏 → 由事件重放/丢弃重建。
 */

import type { EventBus } from '../infrastructure/common/EventBus.js';
import { MorPexEvent } from '../infrastructure/common/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 投影类型（前后端共用契约，镜像 docs/design/ui-state-persistence.md）──
export interface TaskStepProjection {
  nodeId: string;
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed';
}

export interface TaskDagProjection {
  nodes: Array<{ id: string; name: string; deps: string[] }>;
  edges: Array<{ from: string; to: string }>;
}

export interface TaskProjection {
  missionId: string;
  goal: string;
  executionId?: string;
  spaceId?: string;
  departmentId?: string;
  /** stepsTotal/progress 由 dag.nodes 数量或 steps 覆盖推导；保留冗余便于前端零计算。 */
  progress: string; // '1/3' | ''
  steps: TaskStepProjection[];
  dag?: TaskDagProjection | null;
  createdAt: number;
  updatedAt: number;
}

const STEP_EVENT_START = 'execution.step.started';
const STEP_EVENT_RESULT = 'execution.step.result';
const DAG_EVENT = 'execution.dag';
const WF_START = 'workflow.step_started';
const WF_DONE = 'workflow.step_completed';
const WF_FAILED = 'workflow.step_failed';

export class TaskStateProjector {
  private eventBus: EventBus | null = null;
  private dataRoot: string;
  private byMission = new Map<string, TaskProjection>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly knownKeys = new Set<string>([
    STEP_EVENT_START, STEP_EVENT_RESULT, DAG_EVENT, WF_START, WF_DONE, WF_FAILED,
  ]);

  constructor(dataRoot?: string) {
    this.dataRoot = path.resolve(dataRoot ?? path.join(process.cwd(), 'data'));
  }

  /** 进程级接线：订阅执行事件（bootstrap 装配调用）。 */
  attach(bus: EventBus): void {
    this.eventBus = bus;
    bus.on('*', (evt) => this.handle(evt as MorPexEvent));
  }

  private tasksDir(): string {
    return path.join(this.dataRoot, 'tasks');
  }

  private fileFor(missionId: string): string {
    return path.join(this.tasksDir(), `${missionId}.json`);
  }

  // ── 事件 → 投影 ──

  private handle(evt: MorPexEvent): void {
    const type = evt.type ?? '';
    if (!this.knownKeys.has(type)) return;
    const payload = (evt.payload ?? {}) as Record<string, unknown>;
    // P-A 透传后 payload 应带 missionId/goal；旧事件无则跳过（由新执行产生）
    const missionId = typeof payload.missionId === 'string' && payload.missionId ? payload.missionId : undefined;
    const goal = typeof payload.goal === 'string' && payload.goal.trim() ? payload.goal.trim() : '';
    if (!missionId) return;
    const p = this.byMission.get(missionId) ?? this.newProjection(missionId, goal, payload);
    if (goal && !p.goal) p.goal = goal;
    if (payload.departmentId && typeof payload.departmentId === 'string') p.departmentId = payload.departmentId;

    if (type === DAG_EVENT) {
      const nodes = Array.isArray(payload.nodes)
        ? (payload.nodes as Array<Record<string, unknown>>).map((n) => ({ id: String(n.id ?? ''), name: String(n.name ?? n.id ?? ''), deps: Array.isArray(n.deps) ? n.deps.map(String) : [] }))
        : [];
      const edges = Array.isArray(payload.edges)
        ? (payload.edges as Array<Record<string, unknown>>).map((e) => ({ from: String(e.from ?? ''), to: String(e.to ?? '') }))
        : [];
      p.dag = { nodes, edges };
      p.steps = nodes.map((n) => {
        const cur = p.steps.find((s) => s.nodeId === n.id);
        return { nodeId: n.id, name: n.name, status: cur?.status ?? 'pending' };
      });
    } else if (type === STEP_EVENT_START || type === WF_START) {
      this.upsertStep(p, String(payload.nodeId ?? payload.nodeId ?? ''), String(payload.nodeName ?? payload.nodeId ?? '未知'), 'running');
    } else if (type === STEP_EVENT_RESULT) {
      this.upsertStep(p, String(payload.nodeId ?? ''), String(payload.nodeName ?? payload.nodeId ?? '未知'), payload.success === false ? 'failed' : 'done');
    } else if (type === WF_DONE) {
      this.upsertStep(p, String(payload.nodeId ?? ''), String(payload.nodeName ?? payload.nodeId ?? '未知'), 'done');
    } else if (type === WF_FAILED) {
      this.upsertStep(p, String(payload.nodeId ?? ''), String(payload.nodeName ?? payload.nodeId ?? '未知'), 'failed');
    }

    p.updatedAt = Date.now();
    this.recomputeProgress(p);
    this.persist();
  }

  private newProjection(missionId: string, goal: string, payload: Record<string, unknown>): TaskProjection {
    return {
      missionId,
      goal,
      executionId: typeof payload.executionId === 'string' ? payload.executionId : undefined,
      spaceId: typeof payload.spaceId === 'string' ? payload.spaceId : undefined,
      departmentId: typeof payload.departmentId === 'string' ? payload.departmentId : undefined,
      progress: '',
      steps: [],
      dag: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private upsertStep(p: TaskProjection, nodeId: string, name: string, status: TaskStepProjection['status']): void {
    if (!nodeId) return;
    const existing = p.steps.find((s) => s.nodeId === nodeId);
    if (existing) existing.status = status;
    else p.steps.push({ nodeId, name: name || nodeId, status });
  }

  private recomputeProgress(p: TaskProjection): void {
    const total = p.dag?.nodes?.length || p.steps.length;
    if (!total) { p.progress = ''; return; }
    // 以 steps 状态为准（steps 是步骤事件的最新覆盖）
    const done = p.steps.filter((s) => s.status === 'done' || s.status === 'failed').length;
    p.progress = `${done}/${total}`;
    // 若 dag 节点多于 steps（未全部发射 started），也计入总数
    if (p.dag && p.dag.nodes.length > p.steps.length) {
      p.progress = `${done}/${p.dag.nodes.length}`;
    }
  }

  // ── 持久化 / 恢复 ──

  private persist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      try {
        fs.mkdirSync(this.tasksDir(), { recursive: true });
        for (const p of this.byMission.values()) {
          try { fs.writeFileSync(this.fileFor(p.missionId), JSON.stringify(p), 'utf-8'); }
          catch { /* 单项失败不影响其它 */ }
        }
      } catch (err) {
        console.warn('[TaskStateProjector] ⚠️ 投影落盘失败:', (err as Error).message);
      }
    }, 500);
  }

  /** 启动扫描 data/tasks/*.json 载入已有投影（缺失/损坏跳过）。 */
  restore(): void {
    try {
      if (!fs.existsSync(this.tasksDir())) return;
      for (const f of fs.readdirSync(this.tasksDir())) {
        if (!f.endsWith('.json')) continue;
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(this.tasksDir(), f), 'utf-8')) as TaskProjection;
          if (raw && raw.missionId) this.byMission.set(raw.missionId, raw);
        } catch { /* 损坏跳过（事件重放兜底/直接丢弃） */ }
      }
    } catch { /* 目录不存在等，忽略 */ }
  }

  // ── 查询 ──

  get(missionId: string): TaskProjection | undefined {
    return this.byMission.get(missionId);
  }

  list(): TaskProjection[] {
    return [...this.byMission.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 100);
  }

  /** 测试/调试：清理全部（避免污染）。 */
  clear(): void {
    this.byMission.clear();
  }
}