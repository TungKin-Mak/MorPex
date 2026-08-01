/**
 * approval — Approval Engine Barrel
 *
 * Phase 4 / MorPex v8: 人工审批流程管理。
 *
 * 导出：
 *   - ApprovalEngine   审批引擎（核心类）
 *   - ApprovalRequest  审批请求类型
 *   - ApprovalStatus   审批状态类型
 *   - ApprovalEngineConfig  审批引擎配置
 *   - ApprovalEventPayload  审批事件负载
 *   - ApprovalStats    审批统计类型
 */

export { ApprovalEngine } from './ApprovalEngine.js';
export type {
  ApprovalRequest,
  ApprovalStatus,
  ApprovalEngineConfig,
  ApprovalEventPayload,
  ApprovalStats,
} from './types.js';
