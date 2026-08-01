export { GovernanceDashboard } from './GovernanceDashboard.js';
export type { SystemHealthReport, CostReport, ComplianceReport, GovernanceReport } from './GovernanceDashboard.js';
export { RuntimeManager } from './RuntimeManager.js';
export { CostController } from './CostController.js';
export { AlertEngine } from './AlertEngine.js';
export type { RuntimeContext } from './RuntimeManager.js';
export type { Alert, AlertLevel } from './AlertEngine.js';

// ── Governance 控制面（原 control/ 归位）──
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

// ── 能力注册（L1）──
export { CapabilityRegistry } from './capability/CapabilityRegistry.js';
export { CapabilityDiscoverer } from './capability/CapabilityDiscoverer.js';
export { AgentCapabilityRegistry } from './capability/AgentCapabilityRegistry.js';

// ── 验证/审批（L1：原 verification/ 归位）──
export { VerificationEngine } from './VerificationEngine.js';
export { QualityRule } from './QualityRule.js';
export type { QualityCheck } from './QualityRule.js';
export { ArtifactChecker } from './ArtifactChecker.js';
export type { CheckResult } from './ArtifactChecker.js';
export { ExecutionVerifier } from './ExecutionVerifier.js';
export type { VerificationResult } from './ExecutionVerifier.js';
export { RepairPlanner } from './RepairPlanner.js';
export type { RepairPlan } from './RepairPlanner.js';
export { ComplianceChecker } from './ComplianceChecker.js';
export type { ComplianceResult } from './ComplianceChecker.js';
export { PolicyRuleRegistry } from './PolicyRuleRegistry.js';
export type { PolicyRule as VerificationPolicyRule } from './PolicyRuleRegistry.js';
export { ApprovalGate, ApprovalPolicyRegistry } from './ApprovalGate.js';
export type { ApprovalRequest, ApprovalDecision, ApprovalPolicy, ApprovalAction } from './ApprovalGate.js';

// ── 评估（L1：原 evaluation/ 归位）──
