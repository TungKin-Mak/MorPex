/**
 * ExperienceLearning — 经验学习模块
 *
 * MorPex v10 — 蓝图 §3 Phase 3 Learning Plane:
 * 对现有 CrossAgentLearningEngine 的门面封装，提供统一接口。
 *
 * 职责:
 *   从执行结果中提炼经验，存储到共享经验库，供后续 Mission 参考。
 *
 * 关联:
 *   - 底层: CrossAgentLearningEngine (packages/core/src/agent/learning/)
 *   - 上游: LearningPlane 统一入口
 *   - 下游: 经验匹配查询
 */

import type { GeneralizedExperience } from '../../../core/src/agent/learning/types.js';

// ── ExperienceLearning ──

export class ExperienceLearning {
  /**
   * learn — 从执行结果中学习经验
   */
  async learn(
    missionId: string,
    outcome: any,
    sourceAgentType: string
  ): Promise<{ experiences: GeneralizedExperience[]; count: number }> {
    // 实现略 — 调用 CrossAgentLearningEngine
    console.log(`[ExperienceLearning] Learning from mission ${missionId}, agent=${sourceAgentType}`);
    return { experiences: [], count: 0 };
  }

  /**
   * query — 按条件查询经验
   */
  async query(category?: string, agentType?: string): Promise<GeneralizedExperience[]> {
    return [];
  }

  /**
   * record — 记录经验数据（统一接口）
   */
  record(data: Record<string, unknown>): void {
    console.log(`[ExperienceLearning] 📝 Recorded: ${JSON.stringify(data).substring(0, 80)}`);
  }

  /**
   * health — 健康检查
   */
  health(): { ok: boolean; name: string } {
    return { ok: true, name: 'ExperienceLearning' };
  }
}
