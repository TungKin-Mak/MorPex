/**
 * DynamicTeamOrchestrator — 动态团队编排器 (v16)
 * 能力驱动: Goal → CapabilityDiscovery → WorkflowSelection → TeamFormation → Execution
 */
import { TeamBuilder } from './TeamBuilder.js';
import { AgentAllocator } from './AgentAllocator.js';
import { DependencyCoordinator } from './DependencyCoordinator.js';
import { CapabilityDiscoverer } from '../capability/CapabilityDiscoverer.js';
import type { Capability } from '../capability/CapabilityRegistry.js';
import type { DynamicTeam, DependencyGraph, TeamSpec } from './types.js';
import type { GoalContext } from '../contracts/goal.js';
import { AgentCapabilityRegistry } from '../agent-capability/AgentCapabilityRegistry.js';

export interface WorkflowRegistryLike {
  findForGoal: (goal: string) => Array<{ name: string; description: string }>;
}

export interface AgentPoolProvider {
  getAvailableAgents(): Array<{ id: string; capabilities: string[]; departmentId: string; currentLoad?: number; maxLoad?: number }>;
}

export class DynamicTeamOrchestrator {
  private teams: Map<string, DynamicTeam> = new Map();
  private workflowRegistry?: WorkflowRegistryLike;
  private agentPool?: AgentPoolProvider;

  setWorkflowRegistry(registry: WorkflowRegistryLike): void {
    this.workflowRegistry = registry;
  }

  setAgentPool(pool: AgentPoolProvider): void {
    this.agentPool = pool;
  }

  async orchestrate(goalCtx: GoalContext): Promise<{ teams: DynamicTeam[]; graph: DependencyGraph; capabilities: Capability[]; workflows: string[] }> {
    // 1. Capability Discovery (v16: 先发现能力)
    const discovery = CapabilityDiscoverer.discover(goalCtx);

    // 2. Workflow Selection (v16: 再选工作流)
    let workflows: string[] = [];
    if (this.workflowRegistry) {
      const matched = this.workflowRegistry.findForGoal(goalCtx.objective);
      workflows = matched.map(w => w.name);
    }

    // 3. Team Formation (v16: 最后组团队)
    const specs = TeamBuilder.buildTeams({
      ...goalCtx,
      requiredCapabilities: discovery.matched.map(c => c.name),
    });
    const rawAgents = this.agentPool
      ? this.agentPool.getAvailableAgents()
      : DynamicTeamOrchestrator.getDefaultAgentPool();
    // Phase 2: 按信誉分排序（Agent Reputation → Planner）
    const availableAgents = rawAgents.map(a => ({
      ...a,
      reputation: AgentCapabilityRegistry.get(a.id)?.successRate || 0.5,
    })).sort((a, b) => b.reputation - a.reputation);

    const teams: DynamicTeam[] = specs.map((spec, i) => {
      const members = AgentAllocator.allocate(spec, availableAgents);
      const team: DynamicTeam = {
        id: `team_${Date.now()}_${i}`,
        goalId: goalCtx.goalId,
        name: `${spec.preferredDepartment || 'team'}_${i}`,
        members,
        departments: spec.preferredDepartment ? [spec.preferredDepartment] : [],
        dependencies: { edges: [], nodes: [] },
        lifecycle: 'CREATED',
        createdAt: Date.now(),
      };
      this.teams.set(team.id, team);
      return team;
    });

    const graph = DependencyCoordinator.buildDependencyGraph(teams);
    teams.forEach(t => { t.dependencies = graph; });

    return { teams, graph, capabilities: discovery.matched, workflows };
  }

  private static getDefaultAgentPool(): Array<{ id: string; capabilities: string[]; departmentId: string }> {
    return [
      { id: 'agent-design', capabilities: ['design'], departmentId: 'engineering' },
      { id: 'agent-code', capabilities: ['code', 'test'], departmentId: 'engineering' },
      { id: 'agent-research', capabilities: ['analyze', 'research'], departmentId: 'marketing' },
      { id: 'agent-publish', capabilities: ['publish'], departmentId: 'marketing' },
      { id: 'agent-deploy', capabilities: ['deploy'], departmentId: 'operations' },
    ];
  }

  getTeam(teamId: string): DynamicTeam | undefined { return this.teams.get(teamId); }
  listTeams(): DynamicTeam[] { return [...this.teams.values()]; }
  updateLifecycle(teamId: string, lifecycle: DynamicTeam['lifecycle']): boolean {
    const t = this.teams.get(teamId);
    if (!t) return false;
    t.lifecycle = lifecycle;
    return true;
  }
}
