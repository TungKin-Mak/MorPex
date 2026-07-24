/**
 * DynamicTeamOrchestrator — 动态团队编排器
 * v15: 根据目标需求动态创建并行团队，管理依赖和生命周期
 *
 * 流程:
 *   GoalContext → TeamBuilder.buildTeams() → AgentAllocator.allocate()
 *   → DependencyCoordinator.buildDependencyGraph() → 并行执行
 */
import { TeamBuilder } from './TeamBuilder.js';
import { AgentAllocator } from './AgentAllocator.js';
import { DependencyCoordinator } from './DependencyCoordinator.js';
import type { DynamicTeam, DependencyGraph, TeamSpec } from './types.js';
import type { GoalContext } from '../contracts/goal.js';

export class DynamicTeamOrchestrator {
  private teams: Map<string, DynamicTeam> = new Map();

  async orchestrate(goalCtx: GoalContext): Promise<{ teams: DynamicTeam[]; graph: DependencyGraph }> {
    const specs = TeamBuilder.buildTeams(goalCtx);
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

    return { teams, graph };
  }

  getTeam(teamId: string): DynamicTeam | undefined {
    return this.teams.get(teamId);
  }

  listTeams(): DynamicTeam[] {
    return [...this.teams.values()];
  }

  updateLifecycle(teamId: string, lifecycle: DynamicTeam['lifecycle']): boolean {
    const team = this.teams.get(teamId);
    if (!team) return false;
    team.lifecycle = lifecycle;
    return true;
  }
}
