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

export interface WorkflowRegistryLike {
  findForGoal: (goal: string) => Array<{ name: string; description: string }>;
}

export class DynamicTeamOrchestrator {
  private teams: Map<string, DynamicTeam> = new Map();
  private workflowRegistry?: WorkflowRegistryLike;

  setWorkflowRegistry(registry: WorkflowRegistryLike): void {
    this.workflowRegistry = registry;
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
    const availableAgents = [
      { id: 'agent-hardware', capabilities: ['design', 'code'], departmentId: 'engineering' },
      { id: 'agent-software', capabilities: ['code', 'test'], departmentId: 'engineering' },
      { id: 'agent-marketing', capabilities: ['publish', 'analyze'], departmentId: 'marketing' },
    ];

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

  getTeam(teamId: string): DynamicTeam | undefined { return this.teams.get(teamId); }
  listTeams(): DynamicTeam[] { return [...this.teams.values()]; }
  updateLifecycle(teamId: string, lifecycle: DynamicTeam['lifecycle']): boolean {
    const t = this.teams.get(teamId);
    if (!t) return false;
    t.lifecycle = lifecycle;
    return true;
  }
}
