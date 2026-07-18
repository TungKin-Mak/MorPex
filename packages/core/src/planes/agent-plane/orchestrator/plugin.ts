/**
 * Agent Orchestration Plugin — 多 Agent 编排插件
 *
 * 事件协议：
 *   - 监听: 'orchestrator.create_agents'     ← 创建 Agent 团队
 *   - 监听: 'orchestrator.assign_task'       ← 分配任务
 *   - 监听: 'orchestrator.complete_task'     ← 完成任务
 *   - 监听: 'orchestrator.fail_task'         ← 任务失败
 *   - 监听: 'orchestrator.release_agent'     ← 释放 Agent
 *   - 广播: 'orchestrator.agent_created'     → Agent 创建
 *   - 广播: 'orchestrator.task_assigned'     → 任务分配
 *   - 广播: 'orchestrator.task_completed'    → 任务完成
 *   - 广播: 'orchestrator.status'            → 编排状态
 */

import type {
  MorPexPlugin,
  PluginContext,
  EventBus,
  MorPexEvent,
} from '../../../common/types.js';
import { AgentOrchestrator } from './AgentOrchestrator.js';
import type { OrchestratorConfig, WorkerSpecialty } from './types.js';

/** 默认配置 */
const DEFAULT_CONFIG: Required<OrchestratorConfig> = {
  defaultWorkerCount: 3,
  specialties: ['coder', 'reviewer', 'tester', 'designer', 'researcher'],
  zones: [],
};

export class OrchestratorPlugin implements MorPexPlugin {
  name = 'orchestrator-plugin';
  version = '0.1.0';
  dependencies: string[] = [];

  private orchestrator!: AgentOrchestrator;
  private eventBus!: EventBus;
  private config!: Required<OrchestratorConfig>;
  private identity!: { createEventId(): string };
  private unsubscribers: Array<() => void> = [];
  private initialized = false;

  async initialize(context: PluginContext): Promise<void> {
    this.eventBus = context.eventBus;
    this.identity = context.executionIdentity;

    const userConfig = (context.config?.orchestrator ?? {}) as OrchestratorConfig;
    this.config = {
      defaultWorkerCount: userConfig.defaultWorkerCount ?? DEFAULT_CONFIG.defaultWorkerCount,
      specialties: userConfig.specialties ?? DEFAULT_CONFIG.specialties,
      zones: userConfig.zones ?? DEFAULT_CONFIG.zones,
    };

    this.orchestrator = new AgentOrchestrator(this.config);

    this.orchestrator.onAgentCreated = (agent) => {
      this.emitEvent('orchestrator.agent_created', { agent });
    };
    this.orchestrator.onTaskAssigned = (assignment) => {
      this.emitEvent('orchestrator.task_assigned', { assignment });
    };
    this.orchestrator.onTaskCompleted = (assignment) => {
      this.emitEvent('orchestrator.task_completed', { assignment });
    };

    this.initialized = true;
    console.log('[OrchestratorPlugin] 已初始化');
  }

  async start(): Promise<void> {
    if (!this.initialized) throw new Error('必须先 initialize');

    this.unsubscribers.push(
      this.eventBus.on('orchestrator.create_agents', () => {
        this.orchestrator.createCEO();
        this.orchestrator.createManager('Manager-1');
        this.orchestrator.createDefaultWorkers();
        this.emitEvent('orchestrator.status', { status: this.orchestrator.getStatus() });
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('orchestrator.assign_task', (event: MorPexEvent) => {
        const { taskId, agentId } = event.payload ?? {};
        if (taskId && agentId) {
          this.orchestrator.assignTask(taskId, agentId);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('orchestrator.complete_task', (event: MorPexEvent) => {
        const { taskId, result } = event.payload ?? {};
        if (taskId) this.orchestrator.completeTask(taskId, result);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('orchestrator.fail_task', (event: MorPexEvent) => {
        const { taskId, error } = event.payload ?? {};
        if (taskId) this.orchestrator.failTask(taskId, error ?? 'unknown');
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('orchestrator.get_status', () => {
        this.emitEvent('orchestrator.status', { status: this.orchestrator.getStatus() });
      }),
    );

    console.log('[OrchestratorPlugin] 已启动');
  }

  async stop(): Promise<void> {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    this.orchestrator.clear();
    console.log('[OrchestratorPlugin] 已停止');
  }

  getOrchestrator(): AgentOrchestrator { return this.orchestrator; }

  private emitEvent(type: string, payload: any, executionId?: string): void {
    this.eventBus.emit({
      id: this.identity.createEventId(),
      type,
      timestamp: Date.now(),
      executionId: executionId ?? 'orchestrator-plugin',
      source: 'orchestrator-plugin',
      payload,
    });
  }
}
