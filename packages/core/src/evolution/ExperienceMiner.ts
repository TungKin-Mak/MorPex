/**
 * ExperienceMiner — 经验挖掘器
 *
 * v16: 任务完成后自动挖掘经验，更新 CapabilityRegistry。
 * v16c（会话 16c · 3+4）：经验沉淀触发条件——消费步骤级失败信号（failureReport/stepStats），
 * 经 LearningEventDetector 识别可学习事件（空参/安全拦截/高重试/部分失败），
 * 产出结构化事件 + 发射 evolution.experience.mined（供观测聚合与后续任务间注入）。
 */
import { PatternExtractor } from './PatternExtractor.js';
import { LearningEventDetector, type LearningEvent, type StepStats } from './LearningEventDetector.js';
import type { EventBus } from '../infrastructure/common/EventBus.js';

export class ExperienceMiner {
  /** 事件总线（可选；未注入则不发射 evolution.experience.mined） */
  private eventBus?: EventBus;
  /** 内存事件记录（供治理/观测查询） */
  private events: LearningEvent[] = [];

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus;
  }

  /** 最近可学习事件（观测/测试用） */
  getEvents(): LearningEvent[] {
    return [...this.events];
  }

  /** 按类型聚合（观测聚合端点数据源） */
  summarizeEvents(): Record<string, number> {
    return LearningEventDetector.summarize(this.events);
  }

  async mineFromCompletedTask(task: {
    goal: string;
    taskId: string;
    result: string;
    capabilities?: string[];
    departmentId?: string;
    /** 会话 16c：失败步骤报告（salvage 产出） */
    failureReport?: Array<{ step: string; error: string }>;
    /** 会话 16c：步骤级质量统计 */
    stepStats?: StepStats;
  }): Promise<LearningEvent[]> {
    // 基础：CapabilityRegistry 成功率/步骤/来源（既有）
    await PatternExtractor.extract(task);

    // ═══ 会话 16c：可学习事件识别（经验沉淀触发条件）═══
    const events = LearningEventDetector.detect({
      failureReport: task.failureReport,
      stepStats: task.stepStats,
      capabilities: task.capabilities,
    });

    if (events.length > 0) {
      this.events.push(...events);
      // 发射事件（观测聚合 + 治理消费）
      if (this.eventBus) {
        this.eventBus.emit({
          id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'evolution.experience.mined',
          timestamp: Date.now(),
          executionId: task.taskId,
          source: 'experience-miner',
          payload: {
            goal: task.goal.slice(0, 120),
            result: task.result,
            departmentId: task.departmentId,
            events: events.map(ev => ({ type: ev.type, capability: ev.capability, detail: ev.detail, step: ev.step })),
            summary: LearningEventDetector.summarize(events),
          },
        });
      }
      console.log(`[ExperienceMiner] 💡 识别可学习事件 ${events.length} 条: ${events.map(e => e.type).join(', ')}`);
    }

    return events;
  }
}
