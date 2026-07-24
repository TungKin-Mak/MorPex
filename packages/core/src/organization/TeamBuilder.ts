import type { TeamSpec } from './types.js';

export class TeamBuilder {
  static buildTeams(goalContext: { objective: string; requiredCapabilities: string[]; domain?: string }): TeamSpec[] {
    const caps = goalContext.requiredCapabilities;
    const teams: TeamSpec[] = [];

    if (caps.some(c => ['design', 'code', 'test'].includes(c))) {
      teams.push({
        requiredCapabilities: caps.filter(c => ['design', 'code', 'test'].includes(c)),
        preferredDepartment: 'engineering',
        minSize: 1,
        maxSize: 5,
      });
    }

    if (caps.some(c => ['publish', 'analyze', 'research'].includes(c))) {
      teams.push({
        requiredCapabilities: caps.filter(c => ['publish', 'analyze', 'research'].includes(c)),
        preferredDepartment: 'marketing',
        minSize: 1,
        maxSize: 3,
      });
    }

    if (teams.length === 0) {
      teams.push({ requiredCapabilities: ['execute'], minSize: 1, maxSize: 3 });
    }

    return teams;
  }
}
