/**
 * AgentOrchestrator — Agent 编排器
 *
 * 管理 Agent 的创建、分配、生命周期。
 * 支持 CEO/Manager 层级结构。
 *
 * Phase 5 / 实现版本 1.0.0
 */

import type { DAGNode } from '../../../domains/types.js';

// ── Types ──

export interface AgentCEO {
  id: string;
  name: string;
  role: 'ceo';
  capabilities: string[];
  createdAt: number;
  activeMissions: number;
  status: 'active' | 'busy' | 'idle';
}

export interface AgentManager {
  id: string;
  name: string;
  role: 'manager';
  domain: string;
  teamSize: number;
  createdAt: number;
  teamMembers: string[];
  status: 'active' | 'busy' | 'idle';
}

export type AgentRole = AgentCEO | AgentManager;

export interface AgentCreateOptions {
  capabilities?: string[];
  domain?: string;
  teamSize?: number;
}

// ── AgentOrchestrator ──

export class AgentOrchestrator {
  name = 'AgentOrchestrator';
  version = '1.0.0';

  private ceos: Map<string, AgentCEO> = new Map();
  private managers: Map<string, AgentManager> = new Map();
  private taskAssignments: Map<string, { agentId: string; task: string; assignedAt: number }> = new Map();
  private idCounter = 0;

  // ── CEO Operations ──

  /**
   * createCEO — 创建 CEO Agent
   *
   * @param name - CEO 名称
   * @param capabilities - 能力列表
   * @returns 创建的 CEO Agent
   */
  createCEO(name: string, capabilities: string[] = []): AgentCEO {
    const ceo: AgentCEO = {
      id: `ceo_${++this.idCounter}`,
      name,
      role: 'ceo',
      capabilities,
      createdAt: Date.now(),
      activeMissions: 0,
      status: 'active',
    };
    this.ceos.set(ceo.id, ceo);
    console.log(`[AgentOrchestrator] ✅ CEO created: ${ceo.id} — "${name}"`);
    return ceo;
  }

  // ── Manager Operations ──

  /**
   * createManager — 创建 Manager Agent
   *
   * @param name - Manager 名称
   * @param domain - 管理领域
   * @param teamSize - 团队规模
   * @returns 创建的 Manager Agent
   */
  createManager(name: string, domain: string, teamSize: number = 3): AgentManager {
    const manager: AgentManager = {
      id: `mgr_${++this.idCounter}`,
      name,
      role: 'manager',
      domain,
      teamSize,
      createdAt: Date.now(),
      teamMembers: [],
      status: 'active',
    };
    this.managers.set(manager.id, manager);
    console.log(`[AgentOrchestrator] ✅ Manager created: ${manager.id} — "${name}" (domain: ${domain}, team: ${teamSize})`);
    return manager;
  }

  // ── Agent Retrieval ──

  /**
   * getAgent — 获取 Agent 信息
   *
   * @param agentId - Agent ID
   * @returns Agent 信息，不存在返回 undefined
   */
  getAgent(agentId: string): AgentRole | undefined {
    return this.ceos.get(agentId) || this.managers.get(agentId);
  }

  /**
   * listCEOs — 列出所有 CEO
   */
  listCEOs(): AgentCEO[] {
    return [...this.ceos.values()];
  }

  /**
   * listManagers — 列出所有 Manager
   */
  listManagers(): AgentManager[] {
    return [...this.managers.values()];
  }

  /**
   * listAgents — 列出所有 Agent
   */
  listAgents(): AgentRole[] {
    return [...this.ceos.values(), ...this.managers.values()];
  }

  /**
   * countAgents — 统计 Agent 数量
   */
  countAgents(): number {
    return this.ceos.size + this.managers.size;
  }

  // ── Task Assignment ──

  /**
   * assignTask — 分配任务给 Agent
   *
   * @param agentId - Agent ID
   * @param task - 任务描述
   * @returns 是否成功
   */
  assignTask(agentId: string, task: string): boolean {
    const agent = this.getAgent(agentId);
    if (!agent) {
      console.warn(`[AgentOrchestrator] ⚠️ Agent not found: ${agentId}`);
      return false;
    }

    this.taskAssignments.set(`${agentId}_${Date.now()}`, {
      agentId,
      task,
      assignedAt: Date.now(),
    });

    // Update agent status
    if (agent.role === 'ceo') {
      agent.activeMissions++;
    }
    agent.status = 'busy';

    console.log(`[AgentOrchestrator] 📋 Task assigned to ${agentId}: "${task.substring(0, 50)}..."`);
    return true;
  }

  /**
   * getAgentTasks — 获取 Agent 的任务列表
   *
   * @param agentId - Agent ID
   */
  getAgentTasks(agentId: string): Array<{ task: string; assignedAt: number }> {
    const assignments = [...this.taskAssignments.values()]
      .filter(a => a.agentId === agentId)
      .map(({ task, assignedAt }) => ({ task, assignedAt }));
    return assignments;
  }

  /**
   * releaseAgent — 释放 Agent（标记为空闲）
   *
   * @param agentId - Agent ID
   */
  releaseAgent(agentId: string): void {
    const agent = this.getAgent(agentId);
    if (agent) {
      agent.status = 'idle';
      console.log(`[AgentOrchestrator] 🔄 Agent released: ${agentId}`);
    }
  }

  /**
   * getStats — 获取编排器统计
   */
  getStats(): {
    totalAgents: number;
    ceoCount: number;
    managerCount: number;
    totalAssignments: number;
    activeAgents: number;
  } {
    return {
      totalAgents: this.countAgents(),
      ceoCount: this.ceos.size,
      managerCount: this.managers.size,
      totalAssignments: this.taskAssignments.size,
      activeAgents: [...this.listAgents()].filter(a => a.status === 'busy').length,
    };
  }
}
