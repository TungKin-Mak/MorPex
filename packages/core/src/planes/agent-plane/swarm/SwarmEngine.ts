/**
 * SwarmEngine — 群组智能引擎
 *
 * 管理 Agent 群组（Swarm），支持多种协作策略：
 * - consensus: 共识决策（多数表决）
 * - round_robin: 轮流执行
 * - voting: 加权投票
 *
 * Phase 5 / 实现版本 1.0.0
 */

// ── Types ──

export type SwarmStrategy = 'consensus' | 'round_robin' | 'voting';

export interface SwarmConfig {
  name: string;
  strategy: SwarmStrategy;
  maxAgents?: number;
  consensusThreshold?: number; // 0.0 ~ 1.0, default 0.6
  votingWeights?: Map<string, number>; // agentId → weight
}

export interface SwarmAgent {
  id: string;
  name: string;
  capabilities: string[];
}

export interface SwarmResult {
  swarmId: string;
  strategy: SwarmStrategy;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: string;
  decisions: Array<{ agentId: string; vote: string; weight: number }>;
  consensusReached: boolean;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export interface SwarmInfo {
  id: string;
  name: string;
  strategy: SwarmStrategy;
  agentCount: number;
  agents: string[];
  status: 'idle' | 'active' | 'completed';
  createdAt: number;
}

// ── SwarmEngine ──

export class SwarmEngine {
  name = 'SwarmEngine';
  version = '1.0.0';

  private swarms: Map<string, SwarmInfo> = new Map();
  private swarmAgents: Map<string, SwarmAgent[]> = new Map();
  private swarmResults: Map<string, SwarmResult> = new Map();
  private idCounter = 0;

  constructor(private defaultConfig?: Partial<SwarmConfig>) {}

  // ── Swarm Management ──

  /**
   * createSwarm — 创建群组
   *
   * @param name - 群组名称
   * @param strategy - 协作策略
   * @returns 创建的群组信息
   */
  createSwarm(name: string, strategy: SwarmStrategy = 'consensus'): SwarmInfo {
    const id = `swarm_${++this.idCounter}`;
    const swarm: SwarmInfo = {
      id,
      name,
      strategy,
      agentCount: 0,
      agents: [],
      status: 'idle',
      createdAt: Date.now(),
    };
    this.swarms.set(id, swarm);
    this.swarmAgents.set(id, []);
    console.log(`[SwarmEngine] ✅ Swarm created: ${id} — "${name}" (strategy: ${strategy})`);
    return swarm;
  }

  /**
   * addAgent — 添加 Agent 到群组
   *
   * @param swarmId - 群组 ID
   * @param agent - Agent 信息
   * @returns 是否成功
   */
  addAgent(swarmId: string, agent: SwarmAgent): boolean {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) {
      console.warn(`[SwarmEngine] ⚠️ Swarm not found: ${swarmId}`);
      return false;
    }

    const maxAgents = this.defaultConfig?.maxAgents ?? 20;
    if (swarm.agentCount >= maxAgents) {
      console.warn(`[SwarmEngine] ⚠️ Swarm ${swarmId} at max capacity (${maxAgents})`);
      return false;
    }

    const agents = this.swarmAgents.get(swarmId)!;
    agents.push(agent);
    swarm.agentCount = agents.length;
    swarm.agents.push(agent.id);
    console.log(`[SwarmEngine] ➕ Agent ${agent.id} ("${agent.name}") added to ${swarmId}`);
    return true;
  }

  /**
   * removeAgent — 从群组移除 Agent
   *
   * @param swarmId - 群组 ID
   * @param agentId - Agent ID
   * @returns 是否成功
   */
  removeAgent(swarmId: string, agentId: string): boolean {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) return false;

    const agents = this.swarmAgents.get(swarmId);
    if (!agents) return false;

    const idx = agents.findIndex(a => a.id === agentId);
    if (idx === -1) return false;

    agents.splice(idx, 1);
    swarm.agentCount = agents.length;
    swarm.agents = agents.map(a => a.id);
    console.log(`[SwarmEngine] ➖ Agent ${agentId} removed from ${swarmId}`);
    return true;
  }

  // ── Task Execution ──

  /**
   * executeTask — 在群组中执行任务
   *
   * 根据群组策略执行任务：
   * - consensus: 收集所有 Agent 的决策，多数表决
   * - round_robin: 轮流执行，每个 Agent 执行一部分
   * - voting: 加权投票，按权重计算最终结果
   *
   * @param swarmId - 群组 ID
   * @param task - 任务描述
   * @returns 执行结果
   */
  async executeTask(swarmId: string, task: string): Promise<SwarmResult> {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) {
      throw new Error(`[SwarmEngine] Swarm not found: ${swarmId}`);
    }

    const agents = this.swarmAgents.get(swarmId) || [];
    if (agents.length === 0) {
      throw new Error(`[SwarmEngine] No agents in swarm: ${swarmId}`);
    }

    swarm.status = 'active';
    const startTime = Date.now();

    const result: SwarmResult = {
      swarmId,
      strategy: swarm.strategy,
      status: 'running',
      decisions: [],
      consensusReached: false,
      startedAt: startTime,
    };

    console.log(`[SwarmEngine] 🚀 Executing task in ${swarmId}: "${task.substring(0, 60)}..." (strategy: ${swarm.strategy}, agents: ${agents.length})`);

    try {
      switch (swarm.strategy) {
        case 'consensus':
          await this.executeConsensus(agents, task, result);
          break;
        case 'round_robin':
          await this.executeRoundRobin(agents, task, result);
          break;
        case 'voting':
          await this.executeVoting(agents, task, result);
          break;
      }

      result.status = 'completed';
      result.completedAt = Date.now();
      console.log(`[SwarmEngine] ✅ Task completed in ${swarmId}: consensus=${result.consensusReached}, duration=${result.completedAt - startTime}ms`);

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      result.status = 'failed';
      result.error = errorMsg;
      result.completedAt = Date.now();
      console.error(`[SwarmEngine] ❌ Task failed in ${swarmId}: ${errorMsg}`);
    }

    this.swarmResults.set(`${swarmId}_${Date.now()}`, result);
    swarm.status = 'completed';
    return result;
  }

  /**
   * executeConsensus — 共识策略执行
   *
   * 每个 Agent 投一票，超过阈值则达成共识。
   */
  private async executeConsensus(
    agents: SwarmAgent[],
    task: string,
    result: SwarmResult
  ): Promise<void> {
    const threshold = this.defaultConfig?.consensusThreshold ?? 0.6;
    let agreeCount = 0;
    let totalVotes = 0;

    for (const agent of agents) {
      // Simulate agent decision
      const vote = `Agent ${agent.name} processed: ${task.substring(0, 30)}`;
      result.decisions.push({ agentId: agent.id, vote, weight: 1 });
      totalVotes++;
      agreeCount++;
    }

    result.consensusReached = (agreeCount / totalVotes) >= threshold;
    result.output = result.consensusReached
      ? `Consensus reached (${agreeCount}/${totalVotes} ≥ ${threshold})`
      : `Consensus not reached (${agreeCount}/${totalVotes} < ${threshold})`;
  }

  /**
   * executeRoundRobin — 轮流执行策略
   *
   * 每个 Agent 依次处理任务的一部分。
   */
  private async executeRoundRobin(
    agents: SwarmAgent[],
    task: string,
    result: SwarmResult
  ): Promise<void> {
    const outputs: string[] = [];

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const vote = `[Round ${i + 1}/${agents.length}] ${agent.name} handled segment`;
      result.decisions.push({ agentId: agent.id, vote, weight: 1 });
      outputs.push(`${agent.name}: done`);
    }

    result.consensusReached = true; // Round-robin always completes
    result.output = outputs.join(' | ');
  }

  /**
   * executeVoting — 加权投票策略
   *
   * 按 Agent 权重计算最终结果。
   */
  private async executeVoting(
    agents: SwarmAgent[],
    task: string,
    result: SwarmResult
  ): Promise<void> {
    const weights = this.defaultConfig?.votingWeights ?? new Map();
    let totalWeight = 0;
    let agreeWeight = 0;

    for (const agent of agents) {
      const weight = weights.get(agent.id) ?? 1;
      const vote = `Agent ${agent.name} (weight: ${weight}) processed task`;
      result.decisions.push({ agentId: agent.id, vote, weight });
      totalWeight += weight;
      agreeWeight += weight;
    }

    const threshold = this.defaultConfig?.consensusThreshold ?? 0.6;
    result.consensusReached = (agreeWeight / totalWeight) >= threshold;
    result.output = `Weighted vote: ${agreeWeight}/${totalWeight} (threshold: ${threshold})`;
  }

  // ── Status Queries ──

  /**
   * getSwarmStatus — 获取群组状态
   *
   * @param swarmId - 群组 ID
   * @returns 群组信息，不存在返回 undefined
   */
  getSwarmStatus(swarmId: string): SwarmInfo | undefined {
    return this.swarms.get(swarmId);
  }

  /**
   * getSwarmAgents — 获取群组中的 Agent 列表
   *
   * @param swarmId - 群组 ID
   */
  getSwarmAgents(swarmId: string): SwarmAgent[] {
    return this.swarmAgents.get(swarmId) || [];
  }

  /**
   * listSwarms — 列出所有群组
   */
  listSwarms(): SwarmInfo[] {
    return [...this.swarms.values()];
  }

  /**
   * getSwarmResults — 获取群组的执行结果历史
   *
   * @param swarmId - 群组 ID
   */
  getSwarmResults(swarmId: string): SwarmResult[] {
    return [...this.swarmResults.values()].filter(r => r.swarmId === swarmId);
  }

  /**
   * getStats — 获取引擎统计
   */
  getStats(): {
    totalSwarms: number;
    totalResults: number;
    activeSwarms: number;
  } {
    return {
      totalSwarms: this.swarms.size,
      totalResults: this.swarmResults.size,
      activeSwarms: [...this.swarms.values()].filter(s => s.status === 'active').length,
    };
  }
}
