/**
 * LeadAgentOrchestrator — 持久化部门负责人编排器
 *
 * Phase 1 / 组织层核心
 *
 * 增强现有 AgentOrchestrator（非替换），增加：
 *   1. 持久化部门负责人（Lead Agent），绑定 Department + RoleRegistry
 *   2. 部门负责人有独立的部门 Memory 分区（DepartmentContext）
 *   3. LeadAgent 管理 SubAgent Fork 的执行生命周期
 *   4. 通过 EventBus 接收部门任务事件（department.task.assigned）
 *   5. 自动推送进度到 GroupChat 和 SSE
 *
 * 对比 AgentOrchestrator：
 *   - AgentOrchestrator：临时 CEO/Manager/Worker 角色，无持久化
 *   - LeadAgentOrchestrator：持久化部门负责人，有部门记忆和能力边界
 *
 * 使用方式：
 *   const orchestrator = new LeadAgentOrchestrator(eventBus, deptManager, roleRegistry);
 *   const leadAgent = await orchestrator.assignLeadAgent('编程部', 'lead-agent-001');
 *   const result = await orchestrator.orchestrateTask('编程部', '优化登录模块');
 */

import { EventBus } from '../common/EventBus.js';
import { DepartmentManager } from './DepartmentManager.js';
import { RoleRegistry } from '../role/RoleRegistry.js';
import { DepartmentContext } from './DepartmentContext.js';
import type { Department, DepartmentId } from './types.js';
import type { Role } from '../role/types.js';
import type { BrainExperience } from '../cognition/BrainFacade.js';

// ── Types ──

export interface LeadAgent {
  id: string;
  name: string;
  departmentId: DepartmentId;
  status: 'active' | 'busy' | 'idle' | 'paused';
  assignedAt: number;
  capabilities: string[];
  totalTasksAssigned: number;
  totalTasksCompleted: number;
  activeTasks: number;
}

export interface TaskAssignment {
  taskId: string;
  departmentId: DepartmentId;
  leadAgentId: string;
  task: string;
  status: 'pending' | 'assigned' | 'executing' | 'verifying' | 'completed' | 'failed';
  assignedAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
  subAgentIds: string[];
}

export interface OrchestrationResult {
  ok: boolean;
  taskId?: string;
  message: string;
  output?: string;
  error?: string;
  artifacts?: string[];
  duration?: number;
}

export interface LeadAgentStats {
  totalLeadAgents: number;
  activeLeadAgents: number;
  busyLeadAgents: number;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  avgTaskDuration: number;
}

// ── LeadAgentOrchestrator ──

export class LeadAgentOrchestrator {
  name = 'LeadAgentOrchestrator';
  version = '2.0.0';

  private eventBus: EventBus;
  private departmentManager: DepartmentManager;
  private roleRegistry: RoleRegistry;
  private leadAgents: Map<string, LeadAgent> = new Map();
  private taskAssignments: Map<string, TaskAssignment> = new Map();
  private taskCounter = 0;

  // 统计数据
  private totalDurationMs = 0;
  private completedCount = 0;

  /** BrainFacade 引用（可选 — 优雅降级） */
  private brainFacade?: { learn: (exp: BrainExperience) => Promise<void> };

  constructor(
    eventBus: EventBus,
    departmentManager: DepartmentManager,
    roleRegistry: RoleRegistry,
  ) {
    if (!eventBus) throw new Error('[LeadAgentOrchestrator] EventBus 是必填参数');
    if (!departmentManager) throw new Error('[LeadAgentOrchestrator] DepartmentManager 是必填参数');
    if (!roleRegistry) throw new Error('[LeadAgentOrchestrator] RoleRegistry 是必填参数');

    this.eventBus = eventBus;
    this.departmentManager = departmentManager;
    this.roleRegistry = roleRegistry;

    // 监听 brain.learn.request 事件（外部触发学习）
    this.eventBus.on('brain.learn.request', (event: any) => {
      const exp = event.payload as BrainExperience;
      if (exp && this.brainFacade) {
        this.brainFacade.learn(exp).catch(err =>
          console.warn('[LeadAgentOrchestrator] BrainFacade.learn 失败:', err),
        );
      }
    });

    // 监听部门事件：部门创建后自动分配 LeadAgent
    this.eventBus.on('department.created', (event: any) => {
      const dept = event.payload?.department as Department;
      if (dept && !dept.leadAgentId) {
        // 自动为新建部门分配一个 Lead Agent
        const agentId = `lead-${dept.id}-auto`;
        this.assignLeadAgent(dept.name, agentId).catch(err => {
          console.warn(`[LeadAgentOrchestrator] 自动分配 LeadAgent 失败:`, err);
        });
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // LeadAgent 管理
  // ═══════════════════════════════════════════════════════════════

  /**
   * assignLeadAgent — 为部门分配 Lead Agent
   *
   * 1. 查找部门
   * 2. 创建 Lead Agent
   * 3. 更新部门的 leadAgentId
   * 4. 在 RoleRegistry 注册 lead_agent 角色
   * 5. 发射 lead_agent.assigned 事件
   *
   * @param departmentName - 部门名称
   * @param agentId - Agent ID（可选，自动生成）
   * @param capabilities - 能力列表（可选，从 CapabilityGraph 查找）
   * @returns 创建的 LeadAgent
   */
  async assignLeadAgent(
    departmentName: string,
    agentId?: string,
    capabilities?: string[],
  ): Promise<LeadAgent | { error: string }> {
    const dept = this.departmentManager.findByName(departmentName);
    if (!dept) {
      return { error: `部门 "${departmentName}" 不存在` };
    }

    const id = agentId || `lead-${dept.id}-${Date.now()}`;

    const leadAgent: LeadAgent = {
      id,
      name: `${dept.name}负责人`,
      departmentId: dept.id,
      status: 'active',
      assignedAt: Date.now(),
      capabilities: capabilities ?? ['plan', 'execute', 'review', 'delegate'],
      totalTasksAssigned: 0,
      totalTasksCompleted: 0,
      activeTasks: 0,
    };

    this.leadAgents.set(id, leadAgent);

    // 更新部门的 leadAgentId
    await this.departmentManager.updateDepartment(dept.id, { leadAgentId: id });

    // 注册 lead_agent 角色
    const role = this.roleRegistry.defineRole({
      name: 'lead_agent',
      departmentId: dept.id,
      agentId: id,
      capabilities: leadAgent.capabilities,
      permissions: ['read', 'write', 'assign_sub_agent'],
    });
    this.roleRegistry.assignRole(id, role.id, dept.id, 'system');

    // 发射事件
    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'lead_agent.assigned',
      timestamp: Date.now(),
      executionId: 'kernel',
      source: 'lead-agent-orchestrator',
      payload: { leadAgent, departmentId: dept.id, departmentName: dept.name },
    });

    console.log(`[LeadAgentOrchestrator] ✅ LeadAgent "${leadAgent.name}" 已分配到 "${dept.name}"`);
    return leadAgent;
  }

  /**
   * getLeadAgent — 获取部门负责人
   *
   * @param departmentId - 部门 ID 或名称
   * @returns LeadAgent 或 undefined
   */
  getLeadAgent(departmentId: DepartmentId): LeadAgent | undefined {
    const dept = this.departmentManager.getDepartment(departmentId);
    if (!dept?.leadAgentId) return undefined;
    return this.leadAgents.get(dept.leadAgentId);
  }

  /**
   * findLeadAgentByDepartmentName — 按部门名称查找负责人
   */
  findLeadAgentByDepartmentName(departmentName: string): LeadAgent | undefined {
    const dept = this.departmentManager.findByName(departmentName);
    if (!dept?.leadAgentId) return undefined;
    return this.leadAgents.get(dept.leadAgentId);
  }

  /**
   * listLeadAgents — 列出所有部门负责人
   */
  listLeadAgents(): LeadAgent[] {
    return [...this.leadAgents.values()];
  }

  /**
   * setLeadAgentStatus — 更新负责人状态
   */
  setLeadAgentStatus(agentId: string, status: LeadAgent['status']): void {
    const agent = this.leadAgents.get(agentId);
    if (agent) {
      agent.status = status;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 任务编排
  // ═══════════════════════════════════════════════════════════════

  /**
   * orchestrateTask — 编排部门任务
   *
   * 完整流程：
   *   1. 查找部门 + LeadAgent
   *   2. 设置 DepartmentContext 到部门分区
   *   3. 创建 TaskAssignment
   *   4. 发射 department.task.assigned → GroupChatManager 推送消息
   *   5. 执行任务（实际的 LLM 调用/SubAgent Fork）
   *   6. 发射 department.task.completed → GroupChatManager 推送结果
   *   7. 返回结构化的 OrchestrationResult
   *
   * @param departmentName - 部门名称
   * @param task - 任务描述
   * @returns OrchestrationResult
   */
  async orchestrateTask(
    departmentName: string,
    task: string,
  ): Promise<OrchestrationResult> {
    const startTime = Date.now();

    // 1. 查找部门
    const dept = this.departmentManager.findByName(departmentName);
    if (!dept) {
      return { ok: false, message: `部门 "${departmentName}" 不存在` };
    }

    if (dept.status !== 'active') {
      return {
        ok: false,
        message: `部门 "${dept.name}" 状态为 "${dept.status}"，无法执行任务`,
      };
    }

    // 2. 查找 LeadAgent
    const leadAgent = dept.leadAgentId ? this.leadAgents.get(dept.leadAgentId) : undefined;
    if (!leadAgent) {
      return { ok: false, message: `部门 "${dept.name}" 尚未分配 LeadAgent` };
    }

    // 3. 设置部门上下文
    DepartmentContext.partitionKey(dept.id);

    // 4. 创建任务
    const taskId = `task-${++this.taskCounter}-${Date.now()}`;
    const assignment: TaskAssignment = {
      taskId,
      departmentId: dept.id,
      leadAgentId: leadAgent.id,
      task,
      status: 'assigned',
      assignedAt: Date.now(),
      subAgentIds: [],
    };
    this.taskAssignments.set(taskId, assignment);
    leadAgent.totalTasksAssigned++;
    leadAgent.activeTasks++;
    leadAgent.status = 'busy';

    // 5. 发射任务分配事件
    this.emitTaskEvent('department.task.assigned', dept, leadAgent, assignment);

    console.log(`[LeadAgentOrchestrator] 📋 "${dept.name}" 任务已分配: "${task.substring(0, 60)}..."`);

    // 6. 执行任务
    assignment.status = 'executing';
    this.emitTaskEvent('department.task.executing', dept, leadAgent, assignment);

    try {
      // Phase 1: 模拟执行（Phase 2 将接入 UnifiedExecutionEngine + SubAgentFork）
      const output = await this.executeTask(dept, task);

      // 7. 完成
      const duration = Date.now() - startTime;
      assignment.status = 'completed';
      assignment.completedAt = Date.now();
      assignment.result = output;
      leadAgent.totalTasksCompleted++;
      leadAgent.activeTasks--;
      leadAgent.status = 'active';

      // 更新统计
      this.totalDurationMs += duration;
      this.completedCount++;

      this.emitTaskEvent('department.task.completed', dept, leadAgent, assignment, { duration, output });

      // 🔁 学习闭环：任务成功 → BrainFacade 记录经验
      if (this.brainFacade) {
        this.brainFacade.learn({
          taskId,
          goal: task,
          result: 'success',
          output,
          duration,
          departmentId: dept.id,
          capabilities: leadAgent.capabilities,
        }).catch(err => console.warn('[LeadAgentOrchestrator] BrainFacade.learn(成功) 失败:', err));
      }

      console.log(`[LeadAgentOrchestrator] ✅ "${dept.name}" 任务完成 (${duration}ms)`);

      return {
        ok: true,
        taskId,
        message: `✅ "${dept.name}" 任务完成`,
        output,
        duration,
      };
    } catch (err) {
      const errorMsg = (err as Error).message;
      assignment.status = 'failed';
      assignment.error = errorMsg;
      leadAgent.activeTasks--;
      leadAgent.status = 'active';

      this.emitTaskEvent('department.task.failed', dept, leadAgent, assignment, { error: errorMsg });

      // 🔁 学习闭环：任务失败 → BrainFacade 记录失败经验
      if (this.brainFacade) {
        this.brainFacade.learn({
          taskId,
          goal: task,
          result: 'failure',
          error: errorMsg,
          duration: Date.now() - startTime,
          departmentId: dept.id,
          capabilities: leadAgent.capabilities,
        }).catch(err => console.warn('[LeadAgentOrchestrator] BrainFacade.learn(失败) 失败:', err));
      }

      console.error(`[LeadAgentOrchestrator] ❌ "${dept.name}" 任务失败:`, errorMsg);

      return {
        ok: false,
        taskId,
        message: `❌ "${dept.name}" 任务失败: ${errorMsg}`,
        error: errorMsg,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * executeTask — 执行任务（通过 PiBridge 调用真实 LLM）
   *
   * 执行链：PiBridge → LLM (deepseek/deepseek-v4-flash)
   * 降级策略：PiBridge 不可用时回退到模拟执行
   *
   * Phase 4: 接入真实 LLM 调用
   */
  private async executeTask(dept: Department, task: string): Promise<string> {
    // 尝试通过 PiBridge 调用真实 LLM
    try {
      // 动态 import 避免启动时加载依赖
      const { PiBridge } = await import('../adapters/pi-bridge/PiBridge.js');
      const bridge = new PiBridge('deepseek/deepseek-v4-flash');
      await bridge.init();

      const result = await bridge.generateText({
        system: `你是 ${dept.name} 的 Lead Agent。你的职责是执行分配的任务并返回结果。\n部门: ${dept.name}\n部门类型: ${dept.type}\n描述: ${dept.description || '无'}`,
        prompt: task,
        maxTokens: 4096,
        temperature: 0.7,
      });

      return result.text;
    } catch (err) {
      // 降级：PiBridge 不可用时回退到模拟执行
      const errMsg = (err as Error).message;
      console.warn(`[LeadAgentOrchestrator] PiBridge 不可用，使用模拟模式: ${errMsg}`);
      await new Promise(r => setTimeout(r, 500));
      return `[${dept.name}] 任务: ${task}\n\n状态: 执行完成 (PiBridge 不可用: ${errMsg}，使用模拟模式)`;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 任务查询
  // ═══════════════════════════════════════════════════════════════

  /**
   * getTask — 获取任务信息
   */
  getTask(taskId: string): TaskAssignment | undefined {
    return this.taskAssignments.get(taskId);
  }

  /**
   * listTasks — 列出部门的任务
   *
   * @param departmentId - 可选，按部门过滤
   * @param status - 可选，按状态过滤
   */
  listTasks(departmentId?: DepartmentId, status?: TaskAssignment['status']): TaskAssignment[] {
    let tasks = [...this.taskAssignments.values()];
    if (departmentId) tasks = tasks.filter(t => t.departmentId === departmentId);
    if (status) tasks = tasks.filter(t => t.status === status);
    return tasks.sort((a, b) => b.assignedAt - a.assignedAt); // 最新的在前
  }

  /**
   * getStats — 获取编排器统计
   */
  getStats(): LeadAgentStats {
    return {
      totalLeadAgents: this.leadAgents.size,
      activeLeadAgents: [...this.leadAgents.values()].filter(a => a.status === 'active').length,
      busyLeadAgents: [...this.leadAgents.values()].filter(a => a.status === 'busy').length,
      totalTasks: this.taskAssignments.size,
      completedTasks: [...this.taskAssignments.values()].filter(t => t.status === 'completed').length,
      failedTasks: [...this.taskAssignments.values()].filter(t => t.status === 'failed').length,
      avgTaskDuration: this.completedCount > 0 ? Math.round(this.totalDurationMs / this.completedCount) : 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // BrainFacade 注入
  // ═══════════════════════════════════════════════════════════════

  /**
   * setBrainFacade — 注入 BrainFacade 用于学习闭环
   */
  setBrainFacade(facade: { learn: (exp: BrainExperience) => Promise<void> }): void {
    this.brainFacade = facade;
  }

  /**
   * resolveTaskConflict — v13: 简化任务冲突解决
   *
   * 合并自 NegotiationLite。当两个任务分配冲突时，
   * 基于优先级和估计耗时进行智能协商。
   *
   * @param taskA - 任务 A
   * @param taskB - 任务 B
   * @returns 被选中的任务 ID 和原因
   */
  resolveTaskConflict(
    taskA: { id: string; priority: 'high' | 'medium' | 'low'; estimatedDuration: number },
    taskB: { id: string; priority: 'high' | 'medium' | 'low'; estimatedDuration: number },
  ): { id: string; reason: string } {
    const priorityOrder = { high: 3, medium: 2, low: 1 };

    // 优先级不同 → 选优先级高的
    if (taskA.priority !== taskB.priority) {
      const winner = priorityOrder[taskA.priority] > priorityOrder[taskB.priority] ? taskA : taskB;
      return { id: winner.id, reason: `优先级更高: ${winner.priority}` };
    }

    // 同优先级 → 选估计耗时更短的
    const winner = taskA.estimatedDuration <= taskB.estimatedDuration ? taskA : taskB;
    return { id: winner.id, reason: '同优先级下估计耗时更短' };
  }

  // ═══════════════════════════════════════════════════════════════
  // 事件发射
  // ═══════════════════════════════════════════════════════════════

  private emitTaskEvent(
    type: string,
    dept: Department,
    leadAgent: LeadAgent,
    assignment: TaskAssignment,
    extra: Record<string, unknown> = {},
  ): void {
    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      timestamp: Date.now(),
      executionId: assignment.taskId,
      source: 'lead-agent-orchestrator',
      payload: {
        departmentId: dept.id,
        departmentName: dept.name,
        leadAgentId: leadAgent.id,
        taskId: assignment.taskId,
        task: assignment.task,
        status: assignment.status,
        ...extra,
      },
    });
  }

}
