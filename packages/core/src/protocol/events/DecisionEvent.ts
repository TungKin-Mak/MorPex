/**
 * DecisionEvent — 认知决策事件（Cognitive Event Stream）
 *
 * v8.6: 记录 Agent 做出每个决策时的完整上下文。
 * 与 Execution History（MissionRuntime 状态转换）互补，形成完整的认知审计线索。
 *
 * 设计原则:
 *   - 只追加（append-only）：决策记录不可篡改
 *   - 完整上下文：记录决策时的输入、推理、证据
 *   - 版本关联：记录决策时使用的 Twin 版本
 *
 * 与 EventStore 的关系:
 *   - DecisionEvent 通过 EventStore.appendDecision() 写入独立的事件流
 *   - 与 BaseEvent 共享相同的 EventStore 实例，但使用专用访问方法
 *   - 每个 DecisionEvent 可关联到一个 executionId（Mission ID）
 *
 * 使用方式:
 *   import type { DecisionEvent } from './DecisionEvent.js';
 *
 *   const decision: DecisionEvent = {
 *     id: 'dec_20260720_a1b2c3d4',
 *     timestamp: Date.now(),
 *     executionId: 'mis_20260720_000001',
 *     source: 'intent-stage',
 *     input: { message: '帮我写一封邮件给投资人' },
 *     reasoning: '用户提到了"投资人"和"邮件"，推断为正式沟通场景',
 *     evidence: ['关键词匹配: 投资人, 邮件', '历史行为: 用户常用正式语气'],
 *     decision: '创建 investor_email 类型 Mission',
 *     confidence: 0.87,
 *     twinVersion: 17,
 *     metadata: { domain: 'communication', riskLevel: 'low' },
 *   };
 */

import { EventType } from './EventType.js';

/**
 * DecisionEvent — 认知决策事件
 *
 * 每次 Agent 做出一个重要决策时记录一条。
 * 重要决策包括但不限于：
 *   - 意图检测结果
 *   - 目标匹配选择
 *   - 计划创建/调整
 *   - 工具选择
 *   - 工作流挖掘候选
 *   - Twin 更新
 *   - 风险接受/拒绝
 */
export interface DecisionEvent {
  /** 唯一决策事件 ID（格式：dec_{YYYYMMDD}_{shortUUID}） */
  id: string;

  /** 决策时间戳（Date.now()） */
  timestamp: number;

  /** 关联执行 ID（Mission ID 或 executionId） */
  executionId: string;

  /** 决策来源组件名称 */
  source: string;

  /** 决策时的输入数据（Agent 看到了什么） */
  input: Record<string, unknown>;

  /** 推理过程（为什么 Agent 这么想） */
  reasoning: string;

  /** 支持决策的证据列表 */
  evidence: string[];

  /** 最终决策内容 */
  decision: string;

  /** 决策置信度 (0-1) */
  confidence: number;

  /** 决策时使用的 Twin 版本号（0 = 无 Twin） */
  twinVersion: number;

  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * DecisionEventQuery — 决策事件查询参数
 */
export interface DecisionEventQuery {
  /** 按 executionId 筛选 */
  executionId?: string;
  /** 按来源组件筛选 */
  source?: string;
  /** 按决策内容筛选 */
  decision?: string;
  /** 按 Twin 版本筛选 */
  twinVersion?: number;
  /** 按时间范围筛选 */
  since?: number;
  until?: number;
  /** 最低置信度筛选 */
  minConfidence?: number;
  /** 最大返回条数 */
  limit?: number;
}

/**
 * createDecisionEvent — 快速创建 DecisionEvent 的工厂函数
 *
 * @param params - 决策事件参数（不含 id 和 timestamp）
 * @returns DecisionEvent
 */
export function createDecisionEvent(
  params: Omit<DecisionEvent, 'id' | 'timestamp'>
): DecisionEvent {
  const date = new Date();
  const yyyymmdd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const shortId = Math.random().toString(36).slice(2, 10);
  return {
    id: `dec_${yyyymmdd}_${shortId}`,
    timestamp: Date.now(),
    ...params,
  };
}

/**
 * decisionToBaseEvent — 将 DecisionEvent 转换为 BaseEvent（用于通过 EventBus 广播）
 *
 * @param decision - DecisionEvent
 * @returns BaseEvent 兼容对象
 */
export function decisionToBaseEvent(decision: DecisionEvent): {
  id: string;
  type: EventType;
  timestamp: number;
  executionId: string;
  source: string;
  payload: Record<string, unknown>;
} {
  return {
    id: decision.id,
    type: EventType.DECISION_RECORDED,
    timestamp: decision.timestamp,
    executionId: decision.executionId,
    source: decision.source,
    payload: {
      decisionId: decision.id,
      input: decision.input,
      reasoning: decision.reasoning,
      evidence: decision.evidence,
      decision: decision.decision,
      confidence: decision.confidence,
      twinVersion: decision.twinVersion,
      metadata: decision.metadata,
    },
  };
}
