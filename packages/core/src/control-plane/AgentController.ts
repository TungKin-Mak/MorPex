import { AgentCapabilityRegistry, AgentDeclaration } from '../agent-capability/AgentCapabilityRegistry.js';

export class AgentController {
  findForCapability(capability: string, minSuccessRate?: number): AgentDeclaration[] {
    const agents = AgentCapabilityRegistry.findForCapability(capability);
    if (minSuccessRate) return agents.filter(a => a.successRate >= minSuccessRate);
    return agents;
  }

  register(agent: AgentDeclaration): void {
    AgentCapabilityRegistry.register(agent);
  }

  recordCall(agentId: string, success: boolean, cost: number, latency: number): void {
    AgentCapabilityRegistry.recordCall(agentId, success, cost, latency);
  }
}
