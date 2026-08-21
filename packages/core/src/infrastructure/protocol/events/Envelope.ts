/**
 * infrastructure/protocol/events/Envelope — 任务事件载荷规格的类型投影
 *
 * 规格见 docs/EVENT_PAYLOAD_SPEC.md（v1）：Envelope（稳定头）+ MessageBox（可扩展分块载荷）。
 *
 * 设计要点：
 *   - 头结构稳定（schemaVersion/id/type/timestamp/source/layer/refs），只增不删语义；
 *   - payload = MessageBox：每块可选（task/state/human/artifacts/media/error/extensions），
 *     新增交互/媒体/能力 = 加新块（extensions 开放任意命名空间）→ 向前兼容；
 *   - 媒体引用优先：media 只带元数据 + ref，LLM 按引用经工具取用 / 本地打开。
 *
 * 使用：发射点把原扁平 payload 逐步迁移为 MessageBox；投影 / 前端按块读取，未知块忽略。
 */
export type EventLayer = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7' | 'L8' | 'S';

export interface EventEnvelopeRefs {
  executionId: string;
  missionId?: string;
  stepId?: string;
  parentStepId?: string | null;
}

/** 稳定头（Envelope） */
export interface EventEnvelope {
  schemaVersion: string; // '1.0'（语义升级 bump；旧消费者可按版本分支/忽略）
  id: string;
  type: string;
  timestamp: number;
  source: string;
  layer: EventLayer;
  refs: EventEnvelopeRefs;
  payload: MessageBox;
}

// ── MessageBox 各块（每块可选；新增块 = 加命名空间）──

/** task — 任务卡片头 */
export interface TaskMessageBlock {
  goal: string;
  name?: string;
  departmentId?: string;
  spaceId?: string;
}

/** state — 进度 / 状态机 / 元数据 */
export type TaskStatus = 'queued' | 'running' | 'waiting_human' | 'done' | 'failed' | 'cancelled';
export type TaskStage = 'planning' | 'orchestrating' | 'executing' | 'evaluating' | 'approving';

export interface StateMessageBlock {
  status: TaskStatus;
  stage?: TaskStage;
  progressText?: string; // '2/5'
  stepIndex?: number;
  stepTotal?: number;
  durationMs?: number;
  costTokens?: number;
  attempt?: number;
}

/** human — 人工交互（审批 / 问用户 / 复核） */
export type HumanKind = 'approval' | 'ask' | 'review';

export interface HumanMessageBlock {
  kind: HumanKind;
  status: 'awaiting' | 'answered' | 'approved' | 'rejected';
  question?: string;
  requestId?: string;
  decisionBy?: string;
}

/** artifact — 产物引用（回链 ArtifactRegistry） */
export interface ArtifactMessageRef {
  ref: string;
  name: string;
  type: string;
  verified?: boolean;
  uri?: string;
}

/** media — 附件 / 多模态（引用优先，新媒体类型 = 新 kind） */
export interface MediaMessageRef {
  kind: 'image' | 'video' | 'document' | 'file' | string;
  ref: string;
  mime?: string;
  size?: number;
  preview?: string; // 小图预览（可选）
  recognizedAs?: string;
}

/** error — 结构化错误（卡片错误区） */
export interface ErrorMessageBlock {
  code: string;
  message: string;
  recoverable?: boolean;
  retries?: number;
  detail?: unknown;
}

/** 可扩展载荷盒子（MessageBox） */
export interface MessageBox {
  task?: TaskMessageBlock;
  state?: StateMessageBlock;
  human?: HumanMessageBlock;
  artifacts?: ArtifactMessageRef[];
  media?: MediaMessageRef[];
  error?: ErrorMessageBlock;
  /** 开放扩展区：任意新命名空间（如 collaboration/rag/usage/team），老消费者忽略未知根键 */
  extensions?: Record<string, unknown>;
}

/** 便捷：从 MessageBox 取 status（缺省 queued） */
export function statusOf(box: MessageBox | undefined): TaskStatus | undefined {
  return box?.state?.status;
}