import type { DependencyGraph, DynamicTeam } from './types.js';

export class DependencyCoordinator {
  static buildDependencyGraph(teams: DynamicTeam[]): DependencyGraph {
    const edges: Array<{ from: string; to: string; type: 'blocking' | 'data_flow' | 'review' }> = [];
    const nodes = teams.map(t => t.id);

    for (let i = 1; i < teams.length; i++) {
      edges.push({ from: teams[i - 1].id, to: teams[i].id, type: 'data_flow' });
    }

    return { edges, nodes };
  }

  static getBlockedTeams(teamId: string, graph: DependencyGraph): string[] {
    return graph.edges.filter(e => e.to === teamId && e.type === 'blocking').map(e => e.from);
  }
}
