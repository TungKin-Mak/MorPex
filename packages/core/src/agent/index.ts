/**
 * Agent Plane — v9 Multi-Agent Runtime Foundation
 *
 * 从 Single Agent → Agent Organization Runtime。
 *
 * 包含:
 *   - Identity: Agent 身份 + 性能档案
 *   - Registry: Agent 注册 + 按能力查找
 *   - Capability: 能力定义 + 层级图
 *   - Scheduler: Task → Agent 分配
 *   - Communication: 异步消息总线
 *   - Collaboration: 多 Agent 协作 + 协商
 *   - Context: 执行上下文 + 内存隔离
 */

// Identity
export { AgentProfileManager } from './identity/index.js'
export type { AgentIdentity, AgentProfile, AgentRole, AgentGovernanceMetadata, AgentGovernanceStats } from './identity/index.js'
export { createDefaultGovernance } from './identity/index.js'

// Registry
export { AgentRegistry } from './registry/index.js'

// Capability
export { CapabilityGraph } from './capability/index.js'
export type { Capability, CapabilityMatchResult } from './capability/index.js'

// Scheduler
export { AssignmentStrategy, AgentScheduler } from './scheduler/index.js'
export type { TaskRequirement, AgentAssignment, AssignmentStrategyType } from './scheduler/index.js'

// Communication
export { AgentMessageBus } from './communication/index.js'
export type { AgentMessage, AgentMessageType, AgentResponse } from './communication/index.js'

// Collaboration
export { CollaborationManager, ResultAggregator, NegotiationEngine } from './collaboration/index.js'
export type { CollaborationPlan, CollaborationTask, CollaborationResult, NegotiationRequest, NegotiationResponse } from './collaboration/index.js'

// Context
export { AgentContextFactory } from './context/index.js'
export type { AgentExecutionContext, AgentMemoryScope } from './context/index.js'
export { AgentBootstrap, BUILTIN_AGENTS } from './AgentBootstrap.js'
export { AgentWorker, AgentWorkerPool } from './AgentWorker.js'
export type { AgentWorkerConfig } from './AgentWorker.js'
export { AgentMemoryIsolation } from './memory/index.js'
export { AgentRanking } from './ranking/index.js'
export { AgentLifecycle } from './lifecycle/index.js'
export { AgentCapabilityEvolution } from './evolution/index.js'
export { AgentBenchmark } from './benchmark/index.js'
export { AgentAutoOptimizer } from './optimizer/index.js'

// ── v9.2 Cross-Agent Learning ──
export { CrossAgentLearningEngine, ExperienceRepository, KnowledgeDistiller, LearningPropagationService, ExperienceMatcher, ExperienceSqliteRepository } from './learning/index.js'
export type { GeneralizedExperience, ExperienceCategory, ExperienceQuery } from './learning/index.js'

// ── v9.2 Organization Governance ──
export { OrganizationPolicyEngine, TeamGovernanceModel, OrgBudgetAllocator, GovernanceAudit, GovernanceSqliteRepository } from './governance/index.js'
export type { OrgPolicyAction, OrgPolicyRule, OrgPolicyContext, OrgPolicyDecision, TeamPolicy, TeamMembership, OrgBudget, BudgetAllocation, GovernanceAuditEntry } from './governance/index.js'

// ── v9.2 Agent Marketplace ──
export { MarketplaceRegistry, CapabilityAdvertiser, BidEngine, TrustVerifier, MarketplaceContractManager, ThirdPartyAgentAdapter, MarketplaceSqliteRepository } from './marketplace/index.js'
export type { MarketplaceListing, BidRequest, Bid, MarketplaceContract, BidStrategy } from './marketplace/index.js'

// ── v9.2 Distributed Agent Runtime ──
export { AgentTransport, RemoteAgentProxy, DistributedScheduler, DistributedRuntimeManager, ConsensusCoordinator, DistributedSqliteRepository } from './distributed/index.js'
export type { RemoteNode, TransportMessage, HeartbeatStatus, TransportType, NodeStatus } from './distributed/index.js'

// ── v9.2 Agent Team Formation ──
export { TeamFormationEngine, TeamCompositionOptimizer, RoleAssignmentStrategy, TeamLifecycleManager, TeamSqliteRepository } from './team/index.js'
export type { TeamSpec, TeamFormation, TeamMember, TeamContext, TeamRole, TeamStatus } from './team/index.js'

// ── v9.2 Shared Memory Consensus (enhanced) ──
export { SharedMemoryManager, ConsensusProtocol, MemoryLockService, ConflictResolver, MemorySnapshotService, SharedMemorySqliteRepository } from './memory/index.js'
export type { SharedMemoryConfig, MemoryConsistencyLevel, MemoryScope, ConsensusProposal, MemoryLock, ConflictResolutionStrategy, ConflictRecord, MemorySnapshot } from './memory/index.js'
