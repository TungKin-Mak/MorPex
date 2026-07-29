/**
 * AgentController — Agent 控制器
 *
 * ═══ v16 重构 ═══
 * - 整合 AgentCapabilityRegistry + CapabilityRegistry
 * - 提供能力匹配 + Agent 选择
 */

import { AgentCapabilityRegistry, type AgentDeclaration } from '../agent-capability/AgentCapabilityRegistry.js';
import { CapabilityRegistry } from '../capability/CapabilityRegistry.js';

export interface AgentSelection {
  agentId: string;
  capability: string;
  successRate: number;
  confidence: number;
}

export class AgentController {
  /**
   * findForCapability — 查找匹配能力的 Agent
   */
  findForCapability(capability: string, minSuccessRate?: number): AgentDeclaration[] {
    const agents = AgentCapabilityRegistry.findForCapability(capability);
    if (minSuccessRate) return agents.filter(a => a.successRate >= minSuccessRate);
    return agents;
  }

  /**
   * selectBestAgent — 选择最佳 Agent
   */
  selectBestAgent(capability: string): AgentSelection | null {
    const agents = this.findForCapability(capability, 0.5);
    if (agents.length === 0) return null;

    // 按成功率排序
    const sorted = [...agents].sort((a, b) => b.successRate - a.successRate);
    const best = sorted[0];

    return {
      agentId: best.agentId,
      capability,
      successRate: best.successRate,
      confidence: Math.min(1, best.successRate + 0.1),
    };
  }

  /**
   * checkCapabilityAvailable — 检查能力是否可用
   */
  checkCapabilityAvailable(capability: string): boolean {
    // 检查系统能力注册表
    const sysCap = CapabilityRegistry.search(capability);
    if (sysCap.length > 0) return true;

    // 检查 Agent 能力
    return AgentCapabilityRegistry.findForCapability(capability).length > 0;
  }

  register(agent: AgentDeclaration): void {
    AgentCapabilityRegistry.register(agent);
  }

  recordCall(agentId: string, success: boolean, cost: number, latency: number): void {
    AgentCapabilityRegistry.recordCall(agentId, success, cost, latency);
  }
}
