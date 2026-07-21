/**
 * control — Governance Layer Barrel
 *
 * Phase 8 / MorPex v8: 风险分析 + 审计追踪统一导出。
 *
 * 使用方式：
 *   import { RiskAnalyzer, AuditTrail } from './control/index.js';
 *
 *   const risk = new RiskAnalyzer();
 *   const audit = new AuditTrail();
 *
 *   const assessment = risk.assessMission(mission, plan);
 *   audit.recordRiskAssessment(mission.id, assessment);
 */

export { RiskAnalyzer } from './RiskAnalyzer.js';
export { AuditTrail } from './AuditTrail.js';
export { PolicyEngine } from './PolicyEngine.js';
export { PermissionModel } from './PermissionModel.js';
export type {
  RiskLevel,
  RiskAssessment,
  RiskFactor,
  AuditEntry,
  AuditEventType,
  AuditReport,
  GovernanceConfig,
} from './types.js';
export type {
  PolicyAction,
  ActionProposal,
  PolicyDecision,
  PolicyRule,
  PolicyEngineConfig,
  WorkflowTypePolicy,
  WorkflowSimulationProposal,
  WorkflowPolicyAction,
  WorkflowPolicyDecision,
  AgentPolicyRule,
  AgentPolicyDecision,
} from './PolicyEngine.js';
export type {
  Permission,
  PermissionSet,
  PermissionCheck,
} from './PermissionModel.js';
export { DEFAULT_GOVERNANCE_CONFIG } from './types.js';
export { DEFAULT_USER_PERMISSIONS } from './PermissionModel.js';
