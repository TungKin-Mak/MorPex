/**
 * ExecutionSimulator — 执行计划模拟器
 * v16: 在规划后执行前模拟，发现潜在问题
 */
export interface SimulationInput {
  plan: { steps: Array<{ name: string; estimatedDuration: number; capabilities: string[] }> };
  capabilities: Array<{ name: string; successRate: number }>;
  constraints: { budget?: number; deadline?: string; quality?: string };
}

export interface SimulationResult {
  feasible: boolean;
  estimatedDuration: number;
  estimatedCost: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  warnings: string[];
  blockingIssues: string[];
  suggestions: string[];
}

export class ExecutionSimulator {
  simulate(input: SimulationInput): SimulationResult {
    const warnings: string[] = [];
    const blocking: string[] = [];
    const suggestions: string[] = [];

    let totalDuration = 0;
    let totalCost = 0;
    let riskCount = 0;

    for (const step of input.plan.steps) {
      totalDuration += step.estimatedDuration;
      totalCost += step.estimatedDuration * 0.001;

      for (const cap of step.capabilities) {
        const match = input.capabilities.find(c => c.name.toLowerCase().includes(cap.toLowerCase()));
        if (!match) {
          warnings.push(`步骤 "${step.name}" 缺少能力 "${cap}"`);
          riskCount++;
        } else if (match.successRate < 0.7) {
          warnings.push(`步骤 "${step.name}" 的能力 "${cap}" 成功率仅 ${Math.round(match.successRate * 100)}%`);
          riskCount++;
        }
      }
    }

    if (input.constraints.budget && totalCost > input.constraints.budget) {
      blocking.push(`预估成本 $${Math.round(totalCost)} 超出预算 $${input.constraints.budget}`);
    }
    if (input.constraints.deadline) {
      const deadlineMs = new Date(input.constraints.deadline).getTime() - Date.now();
      if (totalDuration > deadlineMs) {
        warnings.push(`预估工期 ${Math.round(totalDuration / 86400000)}天 可能超过截止日期`);
      }
    }

    if (blocking.length > 0) suggestions.push('需要调整计划或增加资源以解决阻塞问题');
    if (warnings.length > 3) suggestions.push('考虑拆分高风险步骤，增加缓冲');

    const riskLevel: SimulationResult['riskLevel'] =
      blocking.length > 0 ? 'HIGH' : riskCount > 2 ? 'MEDIUM' : 'LOW';

    return {
      feasible: blocking.length === 0,
      estimatedDuration: totalDuration,
      estimatedCost: Math.round(totalCost),
      riskLevel, warnings, blockingIssues: blocking, suggestions,
    };
  }
}
