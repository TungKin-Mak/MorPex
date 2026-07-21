/**
 * PlannerConstraint — Planner 约束接口
 *
 * Phase 2 / MorPex v8.5: PersonalTwin 向 Planner 输出约束条件，
 * 确保生成方案符合用户行为风格和决策模式。
 *
 * 使用方式:
 *   const profile = behaviorTwin.buildProfile();
 *   const decision = decisionTwin.buildProfile(userId);
 *   const preferences = preferenceModel.buildProfile();
 *   const constraint = buildPlannerConstraint(profile, decision, preferences);
 *
 *   planner.setConstraint(constraint);  // 约束 MetaPlanner 的 7-Stage Pipeline
 */

import type { BehaviorProfile } from './BehaviorTwin.js';
import type { DecisionProfile } from '../decision/types.js';
import type { PreferenceProfile } from './PreferenceModel.js';

// ═══════════════════════════════════════════════════════════════
// PlannerConstraint
// ═══════════════════════════════════════════════════════════════

export interface PlannerConstraint {
  /** 行为画像 */
  behavior: BehaviorProfile | null;

  /** 决策画像 */
  decision: DecisionProfile | null;

  /** 偏好画像 */
  preferences: PreferenceProfile | null;

  // ── 派生约束（由 buildPlannerConstraint 计算） ──

  /** 基于历史应避免的领域 */
  avoidDomains: string[];

  /** 偏好的 Agent 类型 */
  preferredAgentTypes: string[];

  /** 建议的最大步骤数（基于任务拆解粒度） */
  suggestedMaxSteps: number;

  /** 是否需要审批（基于风险偏好） */
  requireApproval: boolean;

  /** 建议的并行度（基于规划风格） */
  suggestedParallelism: number;

  /** 更新时间戳 */
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// 约束构建函数
// ═══════════════════════════════════════════════════════════════

/**
 * buildPlannerConstraint — 从各画像源综合构建 Planner 约束
 *
 * 纯函数: 相同输入始终产生相同输出。
 * 若某个画像为 null，使用默认值。
 *
 * @param behavior - 行为画像（可选）
 * @param decision - 决策画像（可选）
 * @param preferences - 偏好画像（可选）
 * @returns PlannerConstraint
 */
export function buildPlannerConstraint(
  behavior?: BehaviorProfile | null,
  decision?: DecisionProfile | null,
  preferences?: PreferenceProfile | null
): PlannerConstraint {
  // ── 步骤数约束（基于任务拆解粒度） ──
  let suggestedMaxSteps = 6; // default
  if (behavior?.taskDecomposition === 'fine-grained') suggestedMaxSteps = 12;
  else if (behavior?.taskDecomposition === 'coarse') suggestedMaxSteps = 3;

  // ── 并行度约束（基于规划风格） ──
  let suggestedParallelism = 2; // default
  if (behavior?.planningStyle === 'architecture-first') suggestedParallelism = 4;
  else if (behavior?.planningStyle === 'top-down') suggestedParallelism = 1;

  // ── 审批约束（基于风险偏好） ──
  let requireApproval = false; // default
  if (behavior?.riskTolerance === 'low' || behavior?.riskTolerance === 'medium-low') {
    requireApproval = true;
  }

  // ── 偏好领域（从偏好模型提取） ──
  const preferredDomains: string[] = [];
  const avoidDomains: string[] = [];
  if (behavior?.preferredDomains) {
    preferredDomains.push(...behavior.preferredDomains);
  }
  if (behavior?.preferredAgentTypes) {
    // preferredAgentTypes 可直接用于 agent 选择
  }

  // ── 决策约束（从决策画像提取） ──
  if (decision) {
    // 如果用户历史偏好稳定性 > 可靠性，避免实验性方案
    if (decision.commonFactors?.some(f => f.name === 'stability')) {
      requireApproval = true;
    }
  }

  return {
    behavior: behavior ?? null,
    decision: decision ?? null,
    preferences: preferences ?? null,
    avoidDomains,
    preferredAgentTypes: behavior?.preferredAgentTypes ?? [],
    suggestedMaxSteps,
    requireApproval,
    suggestedParallelism,
    timestamp: Date.now(),
  };
}
