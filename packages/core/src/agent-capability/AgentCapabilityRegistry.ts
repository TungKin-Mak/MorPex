export interface CapabilityNode {
  name: string;
  description: string;
  parent?: string;
  children: string[];
  requiredTools: string[];
  estimatedDuration: number;
  successRate: number;
  totalRuns: number;
}

export interface AgentDeclaration {
  agentId: string;
  name: string;
  version: string;
  capabilities: string[];
  capabilityPaths: string[];
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
  private static graph: Map<string, CapabilityNode> = new Map();

  // ── 能力图 ──

  static registerCapability(node: Omit<CapabilityNode, 'children'>): void {
    const existing = AgentCapabilityRegistry.graph.get(node.name);
    AgentCapabilityRegistry.graph.set(node.name, { ...node, children: existing?.children || [] });
  }

  static addChild(parentName: string, childName: string): void {
    const parent = AgentCapabilityRegistry.graph.get(parentName);
    if (parent && !parent.children.includes(childName)) parent.children.push(childName);
    const child = AgentCapabilityRegistry.graph.get(childName);
    if (child) child.parent = parentName;
    else AgentCapabilityRegistry.graph.set(childName, { name: childName, description: '', parent: parentName, children: [], requiredTools: [], estimatedDuration: 0, successRate: 0, totalRuns: 0 });
  }

  static getCapability(name: string): CapabilityNode | undefined { return AgentCapabilityRegistry.graph.get(name); }

  static getChildren(parentName: string): CapabilityNode[] {
    const parent = AgentCapabilityRegistry.graph.get(parentName);
    return parent ? parent.children.map(c => AgentCapabilityRegistry.graph.get(c)).filter(Boolean) as CapabilityNode[] : [];
  }

  static getTree(rootName: string): CapabilityNode | undefined {
    const root = AgentCapabilityRegistry.graph.get(rootName);
    if (!root) return undefined;
    const build = (n: CapabilityNode): CapabilityNode => ({
      ...n, children: n.children.map(c => { const ch = AgentCapabilityRegistry.graph.get(c); return ch ? build(ch) : null; }).filter(Boolean) as any,
    });
    return build(root);
  }

  static initCapabilityGraph(): void {
    // 硬件
    AgentCapabilityRegistry.registerCapability({ name: 'Hardware Design', description: '硬件设计与开发', requiredTools: [], estimatedDuration: 0, successRate: 0, totalRuns: 0 });
    AgentCapabilityRegistry.addChild('Hardware Design', 'PCB Design');
    AgentCapabilityRegistry.addChild('PCB Design', 'Schematic Design');
    AgentCapabilityRegistry.addChild('PCB Design', 'PCB Layout');
    AgentCapabilityRegistry.addChild('PCB Design', 'DFM Check');
    AgentCapabilityRegistry.addChild('Hardware Design', 'Firmware Development');
    AgentCapabilityRegistry.addChild('Firmware Development', 'Driver Development');
    AgentCapabilityRegistry.addChild('Firmware Development', 'Protocol Stack');
    AgentCapabilityRegistry.addChild('Hardware Design', 'Industrial Design');
    AgentCapabilityRegistry.addChild('Industrial Design', '3D Modeling');
    AgentCapabilityRegistry.addChild('Industrial Design', 'Rendering');
    // 电商
    AgentCapabilityRegistry.registerCapability({ name: 'E-Commerce', description: '电商运营与推广', requiredTools: [], estimatedDuration: 0, successRate: 0, totalRuns: 0 });
    AgentCapabilityRegistry.addChild('E-Commerce', 'Amazon Listing');
    AgentCapabilityRegistry.addChild('Amazon Listing', 'Keyword Research');
    AgentCapabilityRegistry.addChild('Amazon Listing', 'Image Generation');
    AgentCapabilityRegistry.addChild('Amazon Listing', 'A+ Content');
    AgentCapabilityRegistry.addChild('E-Commerce', 'PPC Advertising');
    AgentCapabilityRegistry.addChild('E-Commerce', 'Inventory Management');
    // 软件
    AgentCapabilityRegistry.registerCapability({ name: 'Software Development', description: '软件开发', requiredTools: [], estimatedDuration: 0, successRate: 0, totalRuns: 0 });
    AgentCapabilityRegistry.addChild('Software Development', 'Backend Development');
    AgentCapabilityRegistry.addChild('Backend Development', 'API Design');
    AgentCapabilityRegistry.addChild('Backend Development', 'Database Design');
    AgentCapabilityRegistry.addChild('Software Development', 'Frontend Development');
    AgentCapabilityRegistry.addChild('Frontend Development', 'UI Design');
    AgentCapabilityRegistry.addChild('Frontend Development', 'Component Development');
    // 营销
    AgentCapabilityRegistry.registerCapability({ name: 'Marketing', description: '市场营销', requiredTools: [], estimatedDuration: 0, successRate: 0, totalRuns: 0 });
    AgentCapabilityRegistry.addChild('Marketing', 'Video Production');
    AgentCapabilityRegistry.addChild('Marketing', 'Social Media');
    AgentCapabilityRegistry.addChild('Marketing', 'Content Writing');
  }

  // ── Agent 管理 ──

  static register(agent: AgentDeclaration): void { AgentCapabilityRegistry.agents.set(agent.agentId, agent); }
  static get(agentId: string): AgentDeclaration | undefined { return AgentCapabilityRegistry.agents.get(agentId); }

  static findForCapability(capability: string): AgentDeclaration[] {
    return [...AgentCapabilityRegistry.agents.values()]
      .filter(a => a.status === 'active' && (a.capabilities.includes(capability) || a.capabilityPaths.some(p => p.includes(capability))))
      .sort((a, b) => b.successRate - a.successRate || a.avgCost - b.avgCost);
  }

  static findForCapabilityPath(path: string): AgentDeclaration[] {
    return [...AgentCapabilityRegistry.agents.values()]
      .filter(a => a.capabilityPaths.includes(path) && a.status === 'active')
      .sort((a, b) => b.successRate - a.successRate);
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
  static getActive(): AgentDeclaration[] { return [...AgentCapabilityRegistry.agents.values()].filter(a => a.status === 'active'); }
}
