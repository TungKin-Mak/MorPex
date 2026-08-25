/**
 * StepEventRecorder — DAG 步骤事件 → 事件源的订阅桥
 *
 * U2+U3 事件溯源编排的第一块：把总线上已有的 workflow.step_* 事件
 * 落入 PersistentMissionStore（missions.db），作为步骤级运行态的真相源。
 *
 * 设计说明：
 * - 遵守 EventBus Only 铁律：DAGRuntime 只负责发总线事件，本类是唯一订阅写入方，
 *   两者零直连。
 * - missionId 归属：DAGRuntime 的 payload 经 ctxMeta 注入 missionId；缺失时跳过
 *   （无法归属到任务的事件不入生命周期库）。
 * - 结果载荷：completed 事件携带截断后的 output（上限见 DAGRuntime RESULT_CLIP），
 *   完整产物应走 ArtifactRegistry——此处是断点续跑的兼容载荷，非产物库。
 */
import type { EventBus } from '../../infrastructure/common/EventBus.js';
import type { MorPexEvent } from '../../infrastructure/common/types.js';
import type { PersistentMissionStore } from './PersistentMissionStore.js';

const STEP_EVENT_TYPES = [
  'workflow.step_started',
  'workflow.step_completed',
  'workflow.step_failed',
  'workflow.step_skipped',
  'workflow.step_retry',
] as const;

export class StepEventRecorder {
  private offs: Array<() => void> = [];
  private attachedBus: EventBus | null = null;

  attach(bus: EventBus, store: PersistentMissionStore): void {
    // 幂等守卫：同一 bus 重复 attach 直接短路（防热重载/多实例双写）
    if (this.attachedBus === bus) return;
    this.detach();
    for (const type of STEP_EVENT_TYPES) {
      this.offs.push(
        bus.on(type, (event: MorPexEvent) => {
          const payload = (event && typeof event === 'object' ? (event as { payload?: Record<string, unknown> }).payload : {}) ?? {};
          const missionId = typeof payload.missionId === 'string' && payload.missionId ? payload.missionId : null;
          if (!missionId) return; // 无法归属到任务的事件不入生命周期库
          const type = event.type.replace('workflow.step_', 'step.'); // workflow.step_started → step.started（与 SYSTEM_EVENT_TYPES.STEP_* 一致）
          store.append(type, missionId, payload).catch((err: Error) => {
            console.warn('[StepEventRecorder] 步骤事件写入失败:', err.message);
          });
        }),
      );
    }
    this.attachedBus = bus;
  }

  detach(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.attachedBus = null;
  }
}
