/**
 * RiskAnalyzer — 风险分析引擎
 *
 * Phase 8 / MorPex v8: 在执行前评估 Mission 计划的潜在风险。
 *
 * 职责：
 *   1. 分析 Mission 计划的复杂度风险
 *   2. 检测涉及敏感领域（finance/legal/hr/production）的操作
 *   3. 检测敏感工具（delete/deploy/email/payment）的使用
 *   4. 评估权限范围（run-as / allowed-tools）
 *   5. 生成包含缓解建议的 RiskAssessment
 *
 * 使用方式：
 *   const riskAnalyzer = new RiskAnalyzer(config);
 *   const assessment = riskAnalyzer.assessMission(mission, plan);
 *   if (assessment.requiresApproval) { ... }
 *
 * 设计原则：
 *   - 纯函数式：相同输入永远相同输出
 *   - 无副作用：不发射事件、不修改任何状态
 *   - 可配置：所有阈值通过 GovernanceConfig 注入
 */

import type { RiskAssessment, RiskFactor, RiskLevel, GovernanceConfig } from './types.js';
import type { Mission, MissionPlan, PlanStep } from '../runtime/mission/types.js';
import { DEFAULT_GOVERNANCE_CONFIG } from './types.js';

// ── RiskAnalyzer ──

export class RiskAnalyzer {
  private config: GovernanceConfig;

  /**
   * @param config - 可选的治理配置（合并到默认配置）
   */
  constructor(config?: Partial<GovernanceConfig>) {
    this.config = { ...DEFAULT_GOVERNANCE_CONFIG, ...config };
  }

  /**
   * assessMission — 评估 Mission 计划的综合风险
   *
   * 评估 4 个维度：
   *   1. step_complexity  — 步骤数量 + 依赖深度（weight: 0.25）
   *   2. domain_sensitivity — 领域敏感度（weight: 0.30）
   *   3. tool_risk       — 工具风险（weight: 0.30）
   *   4. permission_scope — 权限范围（weight: 0.15）
   *
   * @param mission - 待评估的 Mission
   * @param plan - 待评估的执行计划
   * @returns RiskAssessment
   */
  assessMission(mission: Mission, plan: MissionPlan): RiskAssessment {
    const factors: RiskFactor[] = [
      this.assessStepComplexity(plan),
      this.assessDomainSensitivity(plan),
      this.assessToolRisk(plan),
      this.assessPermissionScope(mission),
    ];

    // 加权计算综合评分
    const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
    const weightedScore = factors.reduce((s, f) => s + f.score * f.weight, 0);
    const score = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0;

    const level = this.scoreToLevel(score);
    const mitigations = this.generateMitigations(factors, level);

    return {
      id: `risk_${mission.id}_${Date.now()}`,
      missionId: mission.id,
      level,
      score,
      factors,
      mitigations,
      requiresApproval: this.requiresApproval(level, score),
      assessedAt: Date.now(),
      assessedBy: 'system',
    };
  }

  /**
   * setConfig — 运行时更新配置
   *
   * @param config - 部分配置更新
   */
  setConfig(config: Partial<GovernanceConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[RiskAnalyzer] Config updated:', Object.keys(config).join(', '));
  }

  /**
   * getConfig — 获取当前配置
   */
  getConfig(): Readonly<GovernanceConfig> {
    return { ...this.config };
  }

  // ═══════════════════════════════════════════════════════════
  // ★ v9.1: Agent 专属风险评估
  // ═══════════════════════════════════════════════════════════

  /**
   * AgentRiskInput — Agent 任务风险评估输入
   */
  assessAgentTask(input: {
    agentId: string
    agentRole: string
    action: string
    targetType?: string
    collaborationCount?: number
    pastSuccessRate?: number
    trustLevel?: number
  }): RiskAssessment {
    const factors: RiskFactor[] = [
      this.assessAgentPastReliability(input),
      this.assessAgentCollaborationRisk(input),
      this.assessAgentActionRisk(input),
      this.assessAgentTrustLevel(input),
    ]

    const totalWeight = factors.reduce((s, f) => s + f.weight, 0)
    const weightedScore = factors.reduce((s, f) => s + f.score * f.weight, 0)
    const score = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0
    const level = this.scoreToLevel(score)

    return {
      id: `risk_agent_${input.agentId}_${Date.now()}`,
      missionId: input.agentId,
      level,
      score,
      factors,
      mitigations: this.generateMitigations(factors, level),
      requiresApproval: this.requiresApproval(level, score),
      assessedAt: Date.now(),
      assessedBy: 'system',
    }
  }

  /**
   * assessAgentPastReliability — 评估 Agent 历史可靠性
   *
   * 基于 pastSuccessRate（0-1）评估。
   */
  private assessAgentPastReliability(input: {
    pastSuccessRate?: number
  }): RiskFactor {
    const rate = input.pastSuccessRate ?? 0.5
    let score: number

    if (rate >= 0.95) score = 5
    else if (rate >= 0.85) score = 15
    else if (rate >= 0.7) score = 35
    else if (rate >= 0.5) score = 55
    else score = 80

    return {
      name: 'agent_reliability',
      weight: 0.30,
      score,
      detail: `历史成功率: ${(rate * 100).toFixed(0)}%`,
    }
  }

  /**
   * assessAgentCollaborationRisk — 评估 Agent 协作风险
   *
   * collaborationCount 越低风险越高（新 Agent 缺乏协作记录）。
   */
  private assessAgentCollaborationRisk(input: {
    collaborationCount?: number
  }): RiskFactor {
    const count = input.collaborationCount ?? 0
    let score: number

    if (count >= 50) score = 5
    else if (count >= 20) score = 15
    else if (count >= 10) score = 30
    else if (count >= 3) score = 50
    else score = 75

    return {
      name: 'agent_collaboration',
      weight: 0.20,
      score,
      detail: `协作次数: ${count}`,
    }
  }

  /**
   * assessAgentActionRisk — 评估 Agent 操作风险
   *
   * 根据操作类型评估风险。
   */
  private assessAgentActionRisk(input: {
    action: string
    targetType?: string
  }): RiskFactor {
    const sensitiveActions = ['delete', 'deploy', 'terminate', 'write_file', 'execute_shell', 'payment']
    const actionLower = input.action.toLowerCase()

    let score: number
    if (sensitiveActions.some(sa => actionLower.includes(sa))) {
      score = 70
    } else if (actionLower.includes('write') || actionLower.includes('update') || actionLower.includes('create')) {
      score = 35
    } else {
      score = 10
    }

    // targetType 敏感度加成
    if (input.targetType === 'production' || input.targetType === 'deployment') {
      score += 20
    }

    return {
      name: 'agent_action_risk',
      weight: 0.30,
      score: Math.min(100, score),
      detail: `操作: ${input.action}${input.targetType ? `, 目标: ${input.targetType}` : ''}`,
    }
  }

  /**
   * assessAgentTrustLevel — 评估 Agent 信任等级
   */
  private assessAgentTrustLevel(input: {
    trustLevel?: number
  }): RiskFactor {
    const trust = input.trustLevel ?? 0.5
    let score: number

    if (trust >= 0.9) score = 5
    else if (trust >= 0.7) score = 20
    else if (trust >= 0.5) score = 40
    else if (trust >= 0.3) score = 60
    else score = 85

    return {
      name: 'agent_trust',
      weight: 0.20,
      score,
      detail: `信任等级: ${(trust * 100).toFixed(0)}%`,
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 因子评估
  // ═══════════════════════════════════════════════════════════

  /**
   * assessStepComplexity — 评估步骤复杂度
   *
   * 评估维度：
   *   - 步骤数量：>10 步高风险，>5 步中风险
   *   - 依赖深度：深度 >3 的中风险，有循环依赖的高风险
   *   - 并行度：过高并行可能增加协调风险
   */
  private assessStepComplexity(plan: MissionPlan): RiskFactor {
    const stepCount = plan.steps.length;
    const maxDepth = this.computeMaxDependencyDepth(plan.steps);
    let score = 0;
    const issues: string[] = [];

    // 步骤数量评分
    if (stepCount > 15) {
      score += 40;
      issues.push(`${stepCount} 个步骤，超过 15 步建议简化`);
    } else if (stepCount > 8) {
      score += 25;
      issues.push(`${stepCount} 个步骤，复杂度较高`);
    } else if (stepCount > 4) {
      score += 10;
      issues.push(`${stepCount} 个步骤，在合理范围内`);
    } else {
      score += 5;
    }

    // 依赖深度评分
    if (maxDepth > 5) {
      score += 30;
      issues.push(`最长依赖链 ${maxDepth} 层，风险较高`);
    } else if (maxDepth > 3) {
      score += 15;
      issues.push(`最长依赖链 ${maxDepth} 层`);
    } else {
      score += 5;
    }

    // 检测循环依赖
    if (this.detectCycle(plan.steps)) {
      score += 20;
      issues.push('检测到循环依赖');
    }

    // 计算最终得分（0-100）
    const finalScore = Math.min(100, score);

    return {
      name: 'step_complexity',
      weight: 0.25,
      score: finalScore,
      detail: issues.length > 0 ? issues.join('; ') : `${stepCount} 步，深度 ${maxDepth}，风险可控`,
    };
  }

  /**
   * assessDomainSensitivity — 评估领域敏感度
   *
   * 检查计划步骤是否涉及敏感领域（finance/legal/hr/production）
   */
  private assessDomainSensitivity(plan: MissionPlan): RiskFactor {
    const sensitiveDomains = this.config.sensitiveDomains;
    const matchedDomains = new Set<string>();

    for (const step of plan.steps) {
      const domain = (step as any).domain || '';
      for (const sd of sensitiveDomains) {
        if (domain.toLowerCase().includes(sd.toLowerCase())) {
          matchedDomains.add(sd);
        }
      }
    }

    const matchCount = matchedDomains.size;
    let score: number;

    if (matchCount >= 3) {
      score = 90;
    } else if (matchCount === 2) {
      score = 65;
    } else if (matchCount === 1) {
      score = 40;
    } else {
      score = 5;
    }

    return {
      name: 'domain_sensitivity',
      weight: 0.30,
      score,
      detail: matchCount > 0
        ? `涉及敏感领域: ${[...matchedDomains].join(', ')}`
        : '未检测到敏感领域',
    };
  }

  /**
   * assessToolRisk — 评估工具风险
   *
   * 检查步骤是否使用了敏感工具（delete/deploy/email/payment）
   */
  private assessToolRisk(plan: MissionPlan): RiskFactor {
    const sensitiveTools = this.config.sensitiveTools;
    const matchedTools = new Set<string>();

    for (const step of plan.steps) {
      const agentType = (step as any).agentType || '';
      const description = (step as any).description || '';

      for (const st of sensitiveTools) {
        if (agentType.toLowerCase().includes(st.toLowerCase()) ||
            description.toLowerCase().includes(st.toLowerCase())) {
          matchedTools.add(st);
        }
      }
    }

    const matchCount = matchedTools.size;
    let score: number;

    if (matchCount >= 2) {
      score = 85;
    } else if (matchCount === 1) {
      score = 55;
    } else {
      score = 5;
    }

    return {
      name: 'tool_risk',
      weight: 0.30,
      score,
      detail: matchCount > 0
        ? `涉及敏感工具: ${[...matchedTools].join(', ')}`
        : '未检测到敏感工具',
    };
  }

  /**
   * assessPermissionScope — 评估权限范围
   *
   * 根据 Mission 的权限配置评估风险
   */
  private assessPermissionScope(mission: Mission): RiskFactor {
    const permissions = mission.permissions || { allowAutoExecute: true, requireApproval: false, allowedTools: ['*'] };
    const hasWildcardTools = permissions.allowedTools.includes('*');
    const customTools = permissions.allowedTools.filter(
      t => t !== '*' && !this.config.defaultAllowedTools.includes(t)
    );

    let score: number;
    const issues: string[] = [];

    if (hasWildcardTools) {
      score = 60;
      issues.push('允许所有工具（通配符 *）');
    } else if (customTools.length > 5) {
      score = 40;
      issues.push(`允许 ${customTools.length} 个自定义工具`);
    } else if (customTools.length > 0) {
      score = 20;
      issues.push(`允许 ${customTools.length} 个非默认工具`);
    } else {
      score = 5;
    }

    if (permissions.allowAutoExecute) {
      score += 10;
      issues.push('允许自动执行');
    }

    return {
      name: 'permission_scope',
      weight: 0.15,
      score: Math.min(100, score),
      detail: issues.length > 0 ? issues.join('; ') : '只使用了默认工具',
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 评分辅助方法
  // ═══════════════════════════════════════════════════════════

  /**
   * scoreToLevel — 将 0-100 评分映射到风险等级
   */
  private scoreToLevel(score: number): RiskLevel {
    if (score >= 80) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 40) return 'medium';
    if (score >= 20) return 'low';
    return 'none';
  }

  /**
   * requiresApproval — 判断是否需要人工审批
   *
   * 条件：
   *   1. 风险等级高于 autoApproveBelow 且评分高于阈值 → 需要审批
   *   2. 等级为 critical → 始终需要审批
   */
  private requiresApproval(level: RiskLevel, score: number): boolean {
    if (level === 'critical') return true;
    if (level === 'high' && score >= this.config.approvalThreshold) return true;

    const autoLevels: RiskLevel[] = ['none', 'low'];
    const autoLevel = this.config.autoApproveBelow;

    const levelOrder: RiskLevel[] = ['none', 'low', 'medium', 'high', 'critical'];
    const levelIndex = levelOrder.indexOf(level);
    const autoIndex = levelOrder.indexOf(autoLevel);

    return levelIndex > autoIndex;
  }

  /**
   * generateMitigations — 根据风险因子生成缓解措施
   */
  private generateMitigations(factors: RiskFactor[], level: RiskLevel): string[] {
    const mitigations: string[] = [];

    if (level === 'critical' || level === 'high') {
      mitigations.push('需要人工审批通过后才能执行');
    }

    for (const factor of factors) {
      if (factor.score >= 60) {
        switch (factor.name) {
          case 'step_complexity':
            mitigations.push('建议将计划拆分为多个较短阶段，逐步执行');
            mitigations.push('考虑增加检查点（checkpoint）以便回退');
            break;
          case 'domain_sensitivity':
            mitigations.push('敏感领域操作建议双人复核');
            break;
          case 'tool_risk':
            mitigations.push('限制敏感工具的使用范围');
            mitigations.push('考虑使用只读模式执行');
            break;
          case 'permission_scope':
            mitigations.push('限制工具白名单，避免使用通配符 *');
            break;
        }
      }
    }

    // 去重
    return [...new Set(mitigations)];
  }

  /**
   * computeMaxDependencyDepth — 计算依赖链最大深度
   */
  private computeMaxDependencyDepth(steps: PlanStep[]): number {
    const depthMap = new Map<string, number>();

    const computeDepth = (stepId: string, visited: Set<string>): number => {
      if (visited.has(stepId)) return 0; // 避免循环
      if (depthMap.has(stepId)) return depthMap.get(stepId)!;

      const step = steps.find(s => s.id === stepId);
      if (!step || !step.deps || step.deps.length === 0) {
        depthMap.set(stepId, 1);
        return 1;
      }

      visited.add(stepId);
      let maxDepDepth = 0;
      for (const depId of step.deps) {
        maxDepDepth = Math.max(maxDepDepth, computeDepth(depId, visited));
      }
      visited.delete(stepId);

      const depth = maxDepDepth + 1;
      depthMap.set(stepId, depth);
      return depth;
    };

    let maxDepth = 0;
    for (const step of steps) {
      maxDepth = Math.max(maxDepth, computeDepth(step.id, new Set()));
    }
    return maxDepth;
  }

  /**
   * detectCycle — 检测依赖中是否存在循环
   */
  private detectCycle(steps: PlanStep[]): boolean {
    const depMap = new Map<string, string[]>();
    for (const step of steps) {
      depMap.set(step.id, step.deps || []);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      if (inStack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      inStack.add(nodeId);

      const deps = depMap.get(nodeId) || [];
      for (const depId of deps) {
        if (dfs(depId)) return true;
      }

      inStack.delete(nodeId);
      return false;
    };

    for (const step of steps) {
      if (dfs(step.id)) return true;
    }
    return false;
  }
}
