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

// ── 审批（L1）──
// Wave 8a：验证簇（VerificationEngine/QualityRule/ArtifactChecker/ExecutionVerifier/RepairPlanner）
// 已迁至 evaluation/verification/（L6 评价权威）——L1 治理不再承载执行验证逻辑。
export { ComplianceChecker } from './ComplianceChecker.js';
export type { ComplianceResult } from './ComplianceChecker.js';
export { PolicyRuleRegistry } from './PolicyRuleRegistry.js';
export type { PolicyRule as VerificationPolicyRule } from './PolicyRuleRegistry.js';
export { ApprovalGate, ApprovalPolicyRegistry } from './ApprovalGate.js';
export type { ApprovalRequest, ApprovalDecision, ApprovalPolicy, ApprovalAction } from './ApprovalGate.js';

// ── 评估（L1：原 evaluation/ 归位）──
