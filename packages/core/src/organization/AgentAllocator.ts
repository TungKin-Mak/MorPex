import type { TeamMember, TeamSpec } from './types.js';

export class AgentAllocator {
  static allocate(
    spec: TeamSpec,
    availableAgents: Array<{ id: string; capabilities: string[]; departmentId: string }>,
  ): TeamMember[] {
    const members: TeamMember[] = [];
    const max = spec.maxSize || 3;

    for (const cap of spec.requiredCapabilities) {
      if (members.length >= max) break;
      const agent = availableAgents.find(
        a => a.capabilities.includes(cap) && !members.find(m => m.agentId === a.id),
      );
      if (agent) {
        members.push({
          agentId: agent.id,
          role: cap,
          departmentId: agent.departmentId,
          capabilities: [cap],
          status: 'ASSIGNED',
        });
      }
    }

    if (members.length === 0) {
      members.push({
        agentId: 'default-agent',
        role: 'executor',
        departmentId: spec.preferredDepartment || 'general',
        capabilities: ['execute'],
        status: 'ASSIGNED',
      });
    }

    return members;
  }
}
