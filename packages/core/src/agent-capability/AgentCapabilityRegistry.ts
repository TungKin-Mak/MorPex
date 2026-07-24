export interface AgentDeclaration {
  agentId: string;
  name: string;
  version: string;
  capabilities: string[];
  limitations: string[];
  successRate: number;
  avgCost: number;
  avgLatency: number;
  totalCalls: number;
  lastActive: number;
  status: 'active' | 'degraded' | 'offline';
}

export class AgentCapabilityRegistry {
  private static agents: Map<string, AgentDeclaration> = new Map();

  static register(agent: AgentDeclaration): void {
    AgentCapabilityRegistry.agents.set(agent.agentId, agent);
  }

  static get(agentId: string): AgentDeclaration | undefined {
    return AgentCapabilityRegistry.agents.get(agentId);
  }

  static findForCapability(capability: string): AgentDeclaration[] {
    return [...AgentCapabilityRegistry.agents.values()]
      .filter(a => a.capabilities.includes(capability) && a.status === 'active')
      .sort((a, b) => (b.successRate - a.successRate) || (a.avgCost - b.avgCost));
  }

  static recordCall(agentId: string, success: boolean, cost: number, latency: number): void {
    const agent = AgentCapabilityRegistry.agents.get(agentId);
    if (!agent) return;
    agent.totalCalls++;
    agent.successRate = ((agent.successRate * (agent.totalCalls - 1)) + (success ? 1 : 0)) / agent.totalCalls;
    agent.avgCost = ((agent.avgCost * (agent.totalCalls - 1)) + cost) / agent.totalCalls;
    agent.avgLatency = ((agent.avgLatency * (agent.totalCalls - 1)) + latency) / agent.totalCalls;
    agent.lastActive = Date.now();
  }

  static getAll(): AgentDeclaration[] { return [...AgentCapabilityRegistry.agents.values()]; }
}
