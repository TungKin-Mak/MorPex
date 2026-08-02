import { QualityRule } from './QualityRule.js';
import { ExecutionVerifier } from './ExecutionVerifier.js';
import { RepairPlanner } from './RepairPlanner.js';
import type { ArtifactNode as Artifact } from '../../infrastructure/protocol/contracts/artifact-lifecycle.js';
import type { VerificationResult } from './ExecutionVerifier.js';
import type { RepairPlan } from './RepairPlanner.js';
import type { EventBus } from '../../infrastructure/common/EventBus.js';

/**
 * VerificationEngine — L6 验证引擎（Wave 8a 自 governance/ 迁入）
 * 组合 QualityRule + ExecutionVerifier + RepairPlanner 对产物做质量验证并生成修复计划。
 * Wave 9.7：注入 EventBus 时发射 evaluation.verification.completed 审计事件（L6 可追溯）。
 */
export class VerificationEngine {
  private eventBus?: EventBus;

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus;
    QualityRule.init();
  }

  async verify(artifacts: Artifact[]): Promise<{ success: boolean; result: VerificationResult; repairs: RepairPlan[] }> {
    const result = await ExecutionVerifier.verify(artifacts);
    const repairs = result.success ? [] : RepairPlanner.planRepairs(result);

    // L6 审计事件：验证完成（成功/产物数/修复计划数）
    this.eventBus?.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'evaluation.verification.completed',
      timestamp: Date.now(),
      executionId: `verify_${Date.now()}`,
      source: 'evaluation-verification',
      payload: {
        success: result.success,
        artifactCount: artifacts.length,
        repairsCount: repairs.length,
      },
    });

    return { success: result.success, result, repairs };
  }
}
