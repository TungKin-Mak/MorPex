/**
 * LearningPlane — 学习平面（统一入口）
 *
 * MorPex v10 — 蓝图 §3 Phase 3 Learning Plane:
 * 统一管理 5 类学习: Experience, Preference, Behavior, Workflow, Evolution。
 *
 * 设计原则:
 *   1. 门面模式: 对底层现有学习模块的统一封装
 *   2. 向后兼容: 现有 LearningStage 不受影响，可通过 LearningPlane 调用
 *   3. 可观测: 所有学习操作发射 learning.updated 事件
 *
 * 关联:
 *   - Behavioral Learning → BehaviorTwin (cognition/twin/)
 *   - Experience Learning → CrossAgentLearningEngine (agent/learning/)
 *   - Preference Learning → PreferenceModel (cognition/twin/)
 *   - Workflow Learning → WorkflowIntelligence (cognition/workflow/)
 *   - Evolution Learning → EvolutionStage (cognitive-loop/stages/)
 */

import type { EventBus } from '../../../core/src/common/EventBus.js';
import { ExperienceLearning } from './experience-learning.js';
import { WorkflowLearning } from './workflow-learning.js';
import { PreferenceLearning } from './preference-learning.js';

// ── 事件常量 ──

const EVT_LEARNING_UPDATED = 'learning.updated';

// ── LearningPlane ──

export class LearningPlane {
  private bus: EventBus | null;
  public experience: ExperienceLearning;
  public workflow: WorkflowLearning;
  public preference: PreferenceLearning;

  constructor(bus?: EventBus) {
    this.bus = bus ?? null;
    this.experience = new ExperienceLearning();
    this.workflow = new WorkflowLearning();
    this.preference = new PreferenceLearning();
  }

  /**
   * onLearningUpdated — 从任意子模块学习完成后调用
   */
  emitLearningUpdated(type: string, payload: Record<string, unknown>): void {
    if (!this.bus) return;
    try {
      this.bus.emit({
        id: `evt_lrn_${Date.now()}`,
        type: EVT_LEARNING_UPDATED,
        timestamp: Date.now(),
        executionId: String(payload.missionId || 'unknown'),
        source: 'learning-plane',
        payload: { learningType: type, ...payload },
      });
    } catch (err: any) {
      console.warn('[LearningPlane] Failed to emit event:', err.message);
    }
  }

  /**
   * record — 统一记录学习数据（蓝图 §3 统一接口）
   *
   * 根据 type 分派到对应的子模块:
   *   - 'experience' → ExperienceLearning
   *   - 'workflow'   → WorkflowLearning
   *   - 'preference' → PreferenceLearning
   *   - other        → 通用记录（仅发射事件）
   *
   * @param data - 学习数据
   * @param type - 学习类型（默认 'experience'）
   */
  async record(data: Record<string, unknown>, type?: string): Promise<void> {
    const learningType = type ?? 'experience';
    const log = (label: string) => {
      console.log(`[LearningPlane] 📝 ${label}: ${JSON.stringify(data).substring(0, 100)}`);
      this.emitLearningUpdated(learningType, { data });
    };

    switch (learningType) {
      case 'experience':
        this.experience.record(data);
        log('ExperienceLearning');
        break;
      case 'workflow':
        this.workflow.record(data);
        log('WorkflowLearning');
        break;
      case 'preference':
        this.preference.record(data);
        log('PreferenceLearning');
        break;
      default:
        log(`Learning (${learningType})`);
        break;
    }
  }

  /**
   * health — 健康检查
   */
  health(): {
    ok: boolean;
    name: string;
    uptime: number;
    submodules: Record<string, { ok: boolean; name: string }>;
  } {
    return {
      ok: true,
      name: 'LearningPlane',
      uptime: Date.now(),
      submodules: {
        'ExperienceLearning': this.experience.health(),
        'WorkflowLearning': this.workflow.health(),
        'PreferenceLearning': this.preference.health(),
      },
    };
  }
}
