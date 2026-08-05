/**
 * LearningEventDetector — 可学习事件识别（会话 16c · 3+4 经验沉淀触发条件）
 *
 * 会话 15 P1：定义明确"可学习事件"（空参模式/规划偏差/上下文不足），让 ExperienceMiner
 * 真正产出可复用经验（此前仅 success/failure 二态 → "常没有产生经验"）。
 *
 * 本检测器从任务级失败报告 + 步骤级质量信号中识别可学习事件：
 *   - 'empty-param'   空参模式：缺失必需参数 / 参数不完整 / Validation failed / 为空
 *   - 'safety-block'  安全拦截：GateContextRequiredError / 需要 Gate 凭证 / 安全拦截 / 权限不足
 *   - 'high-retry'    高重试：步骤总重试 ≥ 2（思考模式工具空参反复）
 *   - 'partial-failure' 部分失败：有硬失败步骤但非上述模式（兜底归类）
 *
 * 产出供：经验沉淀（事件 + 结构化记录）→ 观测聚合（空参率）→ 后续任务间经验注入。
 *
 * @packageDocumentation
 */

export type LearningEventType = 'empty-param' | 'safety-block' | 'high-retry' | 'partial-failure';

export interface LearningEvent {
  type: LearningEventType;
  /** 关联能力名（capabilities[0] 或 'general'） */
  capability: string;
  /** 事件描述（失败原因 / 统计） */
  detail: string;
  /** 关联失败步骤名（可选） */
  step?: string;
  /** 时间戳 */
  timestamp: number;
}

export interface StepStats {
  totalSteps: number;
  failedSteps: number;
  retryableFails: number;
  nonRetryableFails: number;
  totalRetries: number;
}

export interface LearningDetectionInput {
  failureReport?: Array<{ step: string; error: string }>;
  stepStats?: StepStats;
  capabilities?: string[];
}

/** 空参模式特征（step-agent 工具空参——79.4% 成功率瓶颈主因） */
function isEmptyParamError(error: string): boolean {
  return (
    /缺失必需参数|参数不完整|请【重新调用】/.test(error) ||
    /Validation failed for tool/i.test(error) ||
    /为空/.test(error) ||
    /未产出有效结果/.test(error) ||
    /空内容|空响应|未返回任何结果/.test(error)
  );
}

/** 安全拦截特征（Gate 凭证缺失等——重试无效） */
function isSafetyBlockError(error: string): boolean {
  return (
    /GateContextRequiredError/.test(error) ||
    /需要 Gate 凭证|缺少知识凭证/.test(error) ||
    /安全拦截|权限不足|被 Gate 硬拦/.test(error)
  );
}

/**
 * LearningEventDetector — 从失败报告 + 步骤质量信号识别可学习事件（纯函数，可测）
 */
export class LearningEventDetector {
  static detect(input: LearningDetectionInput): LearningEvent[] {
    const events: LearningEvent[] = [];
    const cap = input.capabilities?.[0] ?? 'general';
    const ts = Date.now();

    for (const f of input.failureReport ?? []) {
      if (isEmptyParamError(f.error)) {
        events.push({ type: 'empty-param', capability: cap, detail: f.error.slice(0, 200), step: f.step, timestamp: ts });
      } else if (isSafetyBlockError(f.error)) {
        events.push({ type: 'safety-block', capability: cap, detail: f.error.slice(0, 200), step: f.step, timestamp: ts });
      } else {
        events.push({ type: 'partial-failure', capability: cap, detail: f.error.slice(0, 200), step: f.step, timestamp: ts });
      }
    }

    const stats = input.stepStats;
    if (stats && stats.totalRetries >= 2) {
      events.push({
        type: 'high-retry',
        capability: cap,
        detail: `总重试 ${stats.totalRetries} 次（${stats.retryableFails} retryable / ${stats.nonRetryableFails} non-retryable）`,
        timestamp: ts,
      });
    }

    // 去重（同一失败步骤只保留最具体一条：empty-param/safety-block 优先于 partial-failure）
    const seen = new Set<string>();
    const deduped = events.filter(ev => {
      const key = `${ev.step ?? 'task'}:${ev.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return deduped;
  }

  /** 便捷：按类型聚合统计（供观测聚合端点） */
  static summarize(events: LearningEvent[]): Record<LearningEventType, number> {
    const summary: Record<LearningEventType, number> = {
      'empty-param': 0,
      'safety-block': 0,
      'high-retry': 0,
      'partial-failure': 0,
    };
    for (const ev of events) summary[ev.type] += 1;
    return summary;
  }
}
