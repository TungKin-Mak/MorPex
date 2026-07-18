/**
 * AgentOrchestrator — 多 Agent 编排引擎
 *
 * 集成 pi-agent-core 的 Agent 类作为 LLM 执行内核。
 *
 * 分层架构：
 *   上层：编排层（CEO → Manager → Worker 任务分配）
 *   下层：执行层（pi-agent-core Agent：prompt/continue/abort/subscribe）
 *
 * 层级结构：
 *   CEO Agent     — 目标分解 + 策略制定（1 个）
 *   Manager Agent — 任务分配 + 进度追踪（1+ 个）
 *   Worker Agent  — 具体执行（coder, reviewer, tester...）
 *
 * 工作流：
 *   CEO: Intent → 战略分解 → 子目标
 *     ↓
 *   Manager: 子目标 → 任务分配 → Worker
 *     ↓
 *   Worker: 使用 pi-agent-core Agent 执行任务 → 产出
 *     ↓
 *   Manager: 汇总 → 完成报告
 */

import { generateShortUUID } from '../../../adapters/identity.js';
import type { AgentTool } from '../../../adapters/pi-types.js';
import { AgentService } from '../../../services/AgentService.js';
import type {
  Agent,
  AgentRole,
  AgentStatus,
  WorkerSpecialty,
  TaskAssignment,
  OrchestrationStatus,
  OrchestratorConfig,
  ZoneConfig,
} from './types.js';

/** 默认配置 */
const DEFAULT_CONFIG: Required<OrchestratorConfig> = {
  defaultWorkerCount: 3,
  specialties: ['coder', 'reviewer', 'tester', 'designer', 'researcher'],
  zones: [],
};

/**
 * AgentOrchestrator — 多 Agent 编排引擎
 */
export class AgentOrchestrator {
  private ceo: Agent | null = null;
  private managers: Agent[] = [];
  private workers: Agent[] = [];
  private assignments: TaskAssignment[] = [];
  private config: Required<OrchestratorConfig>;

  // ── Phase 6: AgentService + Zone 调度 ──
  private zones: Map<string, ZoneConfig> = new Map();
  private agentService: AgentService;

  /** 事件回调 */
  onAgentCreated: ((agent: Agent) => void) | null = null;
  onAgentStatusChanged: ((agentId: string, status: AgentStatus, prevStatus: AgentStatus) => void) | null = null;
  onTaskAssigned: ((assignment: TaskAssignment) => void) | null = null;
  onTaskCompleted: ((assignment: TaskAssignment) => void) | null = null;

  constructor(config?: OrchestratorConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.agentService = new AgentService();
    // 如果配置中有 zones，自动注册
    if (config?.zones) {
      this.registerZones(config.zones);
    }
  }

  // ── Agent 管理 ──

  /** 创建 CEO */
  createCEO(name: string = 'CEO'): Agent {
    const agent = this.createAgent('ceo', name);
    this.ceo = agent;
    return agent;
  }

  /** 创建 Manager */
  createManager(name: string): Agent {
    const agent = this.createAgent('manager', name);
    this.managers.push(agent);
    return agent;
  }

  /** 创建 Worker */
  createWorker(name: string, specialty: WorkerSpecialty): Agent {
    const agent = this.createAgent('worker', name, specialty);
    this.workers.push(agent);
    return agent;
  }

  /** 批量创建默认 Worker */
  createDefaultWorkers(): Agent[] {
    const created: Agent[] = [];
    for (let i = 0; i < this.config.defaultWorkerCount; i++) {
      const specialty = this.config.specialties[i % this.config.specialties.length];
      const worker = this.createWorker(`Worker-${specialty}-${i + 1}`, specialty);
      created.push(worker);
    }
    return created;
  }

  /** 获取空闲 Worker */
  getIdleWorker(specialty?: WorkerSpecialty): Agent | undefined {
    return this.workers.find(w =>
      w.status === 'idle' && (!specialty || w.specialty === specialty),
    );
  }

  /** 获取所有空闲 Worker */
  getIdleWorkers(): Agent[] {
    return this.workers.filter(w => w.status === 'idle');
  }

  // ── 任务管理 ──

  /** 分配任务给 Agent */
  assignTask(taskId: string, agentId: string): TaskAssignment | null {
    const agent = this.findAgent(agentId);
    if (!agent) return null;
    if (agent.status !== 'idle') return null;

    agent.status = 'working';
    agent.currentTaskId = taskId;
    this.onAgentStatusChanged?.(agentId, 'working', 'idle');

    const assignment: TaskAssignment = {
      taskId,
      agentId,
      assignedAt: Date.now(),
      status: 'assigned',
    };

    this.assignments.push(assignment);
    this.onTaskAssigned?.(assignment);
    return assignment;
  }

  /** 完成任务 */
  completeTask(taskId: string, result?: any): boolean {
    const assignment = this.assignments.find(a => a.taskId === taskId && a.status === 'assigned');
    if (!assignment) return false;

    assignment.status = 'completed';
    assignment.completedAt = Date.now();
    assignment.result = result;

    const agent = this.findAgent(assignment.agentId);
    if (agent) {
      agent.status = 'idle';
      agent.currentTaskId = undefined;
      agent.completedTasks++;
      this.onAgentStatusChanged?.(agent.id, 'idle', 'working');
    }

    this.onTaskCompleted?.(assignment);
    return true;
  }

  /** 标记任务失败 */
  failTask(taskId: string, error: string): boolean {
    const assignment = this.assignments.find(a => a.taskId === taskId && a.status === 'assigned');
    if (!assignment) return false;

    assignment.status = 'failed';

    const agent = this.findAgent(assignment.agentId);
    if (agent) {
      agent.status = 'error';
      agent.currentTaskId = undefined;
      this.onAgentStatusChanged?.(agent.id, 'error', 'working');
    }

    return true;
  }

  /** 释放 Agent（从 error 恢复） */
  releaseAgent(agentId: string): boolean {
    const agent = this.findAgent(agentId);
    if (!agent || agent.status !== 'error') return false;
    agent.status = 'idle';
    this.onAgentStatusChanged?.(agentId, 'idle', 'error');
    return true;
  }

  // ── 战略分解（CEO 职责） ──

  /** CEO 分解目标（由外部 LLM 调用后录入） */
  decomposeGoal(goal: string, subgoals: string[]): Array<{ id: string; description: string }> {
    if (!this.ceo) throw new Error('CEO 未创建');

    return subgoals.map((desc, i) => ({
      id: `sg_${Date.now()}_${i}`,
      description: desc,
    }));
  }

  // ── 查询 ──

  /** 获取编排状态 */
  getStatus(): OrchestrationStatus {
    return {
      ceo: this.ceo,
      managers: [...this.managers],
      workers: [...this.workers],
      activeAssignments: this.assignments.filter(a => a.status === 'assigned' || a.status === 'in_progress'),
      totalTasks: this.assignments.length,
      completedTasks: this.assignments.filter(a => a.status === 'completed').length,
    };
  }

  /** 获取 Agent */
  getAgent(agentId: string): Agent | undefined {
    return this.findAgent(agentId);
  }

  /** 获取任务分配 */
  getAssignment(taskId: string): TaskAssignment | undefined {
    return this.assignments.find(a => a.taskId === taskId);
  }

  /** 获取 Agent 的任务历史 */
  getAgentHistory(agentId: string): TaskAssignment[] {
    return this.assignments.filter(a => a.agentId === agentId);
  }

  /** 获取所有 Agent */
  getAllAgents(): Agent[] {
    const agents: Agent[] = [];
    if (this.ceo) agents.push(this.ceo);
    agents.push(...this.managers);
    agents.push(...this.workers);
    return agents;
  }

  // ── Phase 6: Zone 调度 ──

  /** 默认功能区配置 */
  private static DEFAULT_ZONES: ZoneConfig[] = [
    {
      name: 'chat',
      tools: [],
      modelId: 'deepseek-chat',
      systemPrompt: '你是聊天助手，与用户进行日常对话。',
    },
    {
      name: 'coder',
      tools: [],  // 工具由 AgentService 的 createBuiltinTools 自动注入
      modelId: 'deepseek-chat',
      systemPrompt: '你是编程专家，编写高质量的代码。',
    },
    {
      name: 'analyst',
      tools: [],
      modelId: 'deepseek-chat',
      systemPrompt: '你是数据分析师，分析数据和生成报告。',
    },
  ];

  /**
   * registerZones — 注册功能区
   *
   * @param zones - 功能区配置列表
   */
  registerZones(zones: ZoneConfig[]): void {
    for (const zone of zones) {
      this.zones.set(zone.name, zone);
    }
  }

  /**
   * dispatch — 按功能区调度 Agent
   *
   * 根据 zoneName 查找 ZoneConfig，
   * 通过 AgentService 创建/复用 AgentHarness，
   * 发送消息并返回结果。
   *
   * @param zoneName - 功能区名称（chat/coder/analyst）
   * @param message - 发送给 Agent 的消息
   * @returns Agent 的回复内容
   */
  async dispatch(zoneName: string, message: string): Promise<{ content: string; executionId: string }> {
    const zone = this.zones.get(zoneName);
    if (!zone) {
      throw new Error(`未知功能区: ${zoneName}，请先调用 registerZones()`);
    }

    // v2.4: 使用 AgentFactory 统一创建 Agent
    const { AgentFactory } = await import('../../../services/AgentFactory.js');
    const factory = new AgentFactory();
    const harness = await factory.spawn({
      identityToken: `orchestrator_${zoneName}`,
      cgroupQuota: { tokenLimit: 2_000_000, usedTokens: 0 },
      ring: 1,
      domainId: zoneName,
      tools: zone.tools,
      systemPrompt: zone.systemPrompt,
    });

    const result = await harness.prompt(message);

    const replyText = result.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');

    return {
      content: replyText,
      executionId: `zone_${zoneName}_${Date.now()}`,
    };
  }

  /**
   * getActiveZones — 获取所有活跃的功能区（v2.4 返回空数组，zone 管理已废弃）
   */
  getActiveZones(): string[] {
    return [];
  }

  /**
   * 获取 AgentService 实例
   */
  getAgentService(): AgentService {
    return this.agentService;
  }

  // ── 工具注册 ──

  /** 注册工具（供 AgentService 使用） */
  registerTools(_tools: AgentTool[]): void {
    // v2.4: 工具注册通过 AgentFactory + DomainCluster.spawnSubAgent 自动管理
  }

  /** 清空 */
  clear(): void {
    this.agentService.disposeAll();
    this.zones.clear();

    this.ceo = null;
    this.managers = [];
    this.workers = [];
    this.assignments = [];
  }

  // ── 内部 ──

  private createAgent(role: AgentRole, name: string, specialty?: WorkerSpecialty): Agent {
    const agent: Agent = {
      id: `agt_${generateShortUUID()}${generateShortUUID().slice(0,4)}`,
      name,
      role,
      specialty,
      status: 'idle',
      completedTasks: 0,
      successRate: 1.0,
      createdAt: Date.now(),
    };
    this.onAgentCreated?.(agent);
    return agent;
  }

  private findAgent(agentId: string): Agent | undefined {
    if (this.ceo?.id === agentId) return this.ceo;
    return this.managers.find(a => a.id === agentId)
      ?? this.workers.find(a => a.id === agentId);
  }
}
