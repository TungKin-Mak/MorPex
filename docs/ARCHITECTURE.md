# MorPex v9.2 Architecture

> **v9.2 Agent Organization OS** — 453 源文件 | 26 SQLite 表 | tsc 0 errors | 25/32 测试通过
>
> 生产化阶段: S0(统一EventStore) ✅ S1(Context/Artifact/Agent持久化) ✅ S2(v9.2六大域持久化) ✅ S3(Config v9+Zod) ✅
> Phase 1(Resilience) ✅ Phase 2(Performance+Compaction) ✅ Phase 3(Security) ✅ Phase 4(Observability) ✅ Phase 5(Deploy+Docs) ✅

---

## Layer Stack (v9.2)

```
                            HUMAN / EXTERNAL
                                  │
                         MessageGateway
                                  │
                              EventBus
                                  │
    ┌─────────────────────────────┼──────────────────────────────┐
    │                             │                              │
    ▼                             ▼                              ▼
┌──────────────┐    ┌──────────────────────┐    ┌────────────────────────┐
│ CONTROL      │    │  COGNITIVE PIPELINE  │    │  RELIABILITY PLANE     │
│ PLANE        │    │  ──────────────────  │    │  ──────────────────    │
│ ────────     │    │                      │    │  Chaos / Replay        │
│ PolicyEngine │◄──►│ ContextStage  (v9.1) │    │  Scoring / Regression  │
│ RiskAnalyzer │    │ IntentStage          │    │  Promotion / Canary    │
│ Permission   │    │ GoalStage            │    │  Report                │
│ AuditTrail   │    │ TwinStage            │    └────────────────────────┘
│ OrgPolicy★   │    │ PlanningStage        │
│ (v9.2)       │    │ ExecutionStage       │    ┌────────────────────────┐
│              │    │   ├─ Contract        │    │  RUNTIME KERNEL        │
│              │    │   ├─ Permission      │    │  ──────────────────    │
│              │    │   ├─ Budget          │    │  MissionFSM (19状态)   │
│              │    │   ├─ Sandbox         │    │  DAG Runtime           │
│              │    │   ├─ Verification    │    │  ExecutionFSM (10状态) │
│              │    │   └─ Compensation    │    │  Checkpoint/Recovery   │
│              │    │ LearningStage        │    │  Sandbox/Budget/Comp   │
│              │    │ EvolutionStage       │    └────────────────────────┘
│              │    │ PersistenceStage     │
└──────────────┘    └──────┬───────────────┘    ┌────────────────────────┐
                           │                    │  KNOWLEDGE PLANE       │
                    ┌──────▼──────┐             │  ──────────────────    │
                    │ EVENT SOURCE│             │  BehaviorTwin (v2)     │
                    │ ────────────│             │  DecisionTwin          │
                    │ SqliteEvent │             │  GoalGraph             │
                    │ Store (26表)│             │  PersonalBrain (5层)   │
                    └─────────────┘             │  WorkflowIntelligence  │
                           │                    └────────────────────────┘
                           ▼
    ┌──────────────────────────────────────────────────────────────────────────┐
    │                        AGENT PLANE (v9.2 — 18 子模块, 83 文件)           │
    │  ─────────────────────────────────────────────────────────────────────  │
    │                                                                          │
    │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
    │  │ Identity │ │ Registry │ │Capability│ │Scheduler │ │ Communication│  │
    │  │ Profile  │ │  (查找)   │ │  Graph   │ │AssgnStrat│ │  MessageBus  │  │
    │  │Governance│ │          │ │          │ │          │ │  (异步唯一)   │  │
    │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
    │                                                                          │
    │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────┐  │
    │  │Collabor  │ │Negotiatn│ │  Memory  │ │  Lifecycle   │ │ Ranking  │  │
    │  │ ationMgr │ │ Engine   │ │Isolation │ │  Evolution   │ │Benchmark │  │
    │  │ResultAgg │ │          │ │SharedMem │ │  Optimizer   │ │          │  │
    │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘ └──────────┘  │
    │                                                                          │
    │  ┌──────────────────┐ ┌──────────────────┐ ┌────────────────────────┐  │
    │  │ ★ v9.2 NEW       │ │ ★ v9.2 NEW       │ │ ★ v9.2 NEW             │  │
    │  │ Cross-Agent      │ │ Organization      │ │ Agent Marketplace      │  │
    │  │ Learning         │ │ Governance        │ │ (BidEngine/Trust/Mktpl)│  │
    │  │ (ExpRepo/        │ │ (OrgPolicy/       │ └────────────────────────┘  │
    │  │ Distiller/       │ │  TeamGovernance/  │ ┌────────────────────────┐  │
    │  │ Propagation/     │ │  Budget)          │ │ ★ v9.2 NEW             │  │
    │  │ Matcher)         │ └──────────────────┘ │ Distributed Runtime    │  │
    │  └──────────────────┘                      │ (Transport/Proxy/      │  │
    │  ┌──────────────────┐ ┌──────────────────┐ │  Scheduler/Consensus)  │  │
    │  │ ★ v9.2 NEW       │ │ ★ v9.2 NEW       │ └────────────────────────┘  │
    │  │ Team Formation   │ │ Shared Memory    │                              │
    │  │ (Formation/      │ │ Consensus        │  ┌────────────────────────┐  │
    │  │  Composition/    │ │ (ConsensusProto/ │  │ ★ Production Layers    │  │
    │  │  RoleAssignment/ │ │  LockService/    │  │ Resilience (RetryCB    │  │
    │  │  Lifecycle)      │ │  ConflictResolve │  │  + CircuitBreaker +    │  │
    │  └──────────────────┘ │  SnapshotService)│  │  ErrorHandler)         │  │
    │                       └──────────────────┘  │ Observability         │  │
    │                                              │ (Metrics/Compaction/  │  │
    │                                              │  Prometheus/Health)   │  │
    │  ┌──────────────────────────────────────────┐│ Security (Encryption/ │  │
    │  │ ★ Persistence Layer (26 表, 9 SqliteRepo)││  Sandbox/Trust)       │  │
    │  │ ContextPersistence / ArtifactSqliteRepo  │└────────────────────────┘  │
    │  │ AgentGovernanceRepo / ExperienceSqlite   │                              │
    │  │ GovernanceSqlite / MarketplaceSqlite     │                              │
    │  │ DistributedSqlite / TeamSqlite           │                              │
    │  │ SharedMemorySqlite                       │                              │
    │  └──────────────────────────────────────────┘                              │
    └──────────────────────────────────────────────────────────────────────────┘
```

---

## Module Inventory (v9.2)

### Control Plane (5 modules)
| Module | Role | Integrates with |
|--------|------|-----------------|
| `PolicyEngine` | Rule-based auto-approve/block/require_approval | CognitivePipeline, ExecutionStage, WorkflowSimulator |
| `RiskAnalyzer` | 4-dimension mission risk scoring (step/domain/tool/permission) | IntentStage, PlanningStage |
| `PermissionModel` | User-level permissions (read/write/execute/delete/deploy/approve/admin) + Agent-level (collaborate/access_shared/evolve) | ExecutionStage, Scheduler |
| `AuditTrail` | Append-only governance log; `recordAgentAction()`, `recordGovernanceCheck()` | All Control+Agent operations |
| `OrganizationPolicyEngine` ★ | v9.2: Org-level policy evaluation (cross-team, artifact access, senior override) | **NOT wired into AgentScheduler or CollaborationManager** |

### Cognitive Pipeline (9 stages + 3 infrastructure)
| Stage | Role | Key integration |
|-------|------|----------------|
| `ContextStage` (v9.1) | Unify multi-source fragments → 3-layer ExecutionContext | ContextFragmentRegistry, ContextPersistence |
| `IntentStage` | detectIntent → {goal,domain,confidence} | IntentResolver |
| `GoalStage` | Jaccard goal matching → GoalManager | GoalGraph |
| `TwinStage` | BehaviorTwin + DecisionTwin retrieval | BehaviorTwin, DecisionTwin |
| `PlanningStage` | MetaPlannerAdapter → Mission creation | MissionRuntime |
| `ExecutionStage` | Full lifecycle: Contract→Permission→Budget→Sandbox→Agent→Verification→Lineage→Compensation→Metrics | ExecutionFSM, DAGRuntime, CompensationEngine, AgentScheduler |
| `LearningStage` | EvidenceAggregator → TwinCandidate | BehaviorTwin, DecisionTwin, PersonalBrain, EventStore |
| `EvolutionStage` | WorkflowMiner→Simulator→Policy→Registry | WorkflowMiner, WorkflowSimulator, PolicyEngine |
| `PersistenceStage` | BrainPersistor bridge→MemoryWiki | PersonalBrain, MemoryWiki |
| `CognitivePipeline` | Stage orchestrator with error handler | ErrorHandlerService (wired) |
| `ErrorHandlerService` | RetryPolicy + CircuitBreaker + Compensation | CognitivePipeline (wired) |

### Runtime Kernel (14 modules)
MissionFSM(19 states), DAGRuntime, ExecutionFSM(10 states), CheckpointManager, RecoveryManager, SandboxManager, BudgetManager, CompensationEngine, VerificationEngine, ApprovalEngine, MetaPlannerAdapter, DAGExecutorAdapter, MissionRuntime.

### Knowledge Plane (10 modules)
BehaviorTwin, PersonalBrain(5-layer memory), DecisionTwin, GoalManager, GoalGraph, WorkflowMemory, DecisionMemory, BrainPersistor, WorkflowIntelligence, PreferenceModel.

### Reliability Plane (12 modules)
ChaosEngine, FaultInjector, EventReplayer(2), ReliabilityScorer, GoldenDatasetManager, RegressionRunner, WorkflowPromotion(2), WorkflowMetrics, ReliabilityReport, CanaryEvaluator.

### Agent Plane (83 files, 18 sub-modules)

| Sub-module | Files | Contains | Runtime-wired? |
|-----------|-------|----------|---------------|
| `identity/` | 3 | AgentIdentity, AgentProfile, GovernanceMetadata | AgentBootstrap |
| `registry/` | 2 | AgentRegistry (capability lookup) | AgentBootstrap |
| `capability/` | 2 | Capability, CapabilityGraph | AgentBootstrap |
| `scheduler/` | 3 | AgentScheduler, AssignmentStrategy | CollaborationManager |
| `communication/` | 3 | AgentMessage, AgentMessageBus | CollaborationManager, NegotiationEngine |
| `collaboration/` | 4 | CollaborationManager, NegotiationEngine, ResultAggregator | **TeamFormationEngine NOT wired** |
| `context/` | 2 | AgentExecutionContext, AgentContextFactory | AgentWorker |
| `memory/` | 8 | AgentMemoryIsolation, SharedMemoryManager, ConsensusProtocol, MemoryLockService, ConflictResolver, MemorySnapshotService, SharedMemorySqliteRepository | **SharedMemoryManager NOT wired into CollaborationManager** |
| `lifecycle/` | 2 | AgentLifecycle | AgentBootstrap |
| `ranking/` | 2 | AgentRanking | AgentBootstrap |
| `evolution/` | 2 | AgentCapabilityEvolution | AgentBootstrap |
| `benchmark/` | 2 | AgentBenchmark | standalone |
| `optimizer/` | 2 | AgentAutoOptimizer | AgentBootstrap |
| `learning/` ★ | 7 | CrossAgentLearningEngine, ExperienceRepository, KnowledgeDistiller, LearningPropagationService, ExperienceMatcher, ExperienceSqliteRepository, types | **NOT wired into LearningStage** |
| `governance/` ★ | 6 | OrganizationPolicyEngine, TeamGovernanceModel, OrgBudgetAllocator, GovernanceAudit, AgentGovernanceRepository, GovernanceSqliteRepository | **NOT wired into AgentScheduler/CollaborationManager** |
| `marketplace/` ★ | 8 | BidEngine, MarketplaceRegistry, CapabilityAdvertiser, TrustVerifier, MarketplaceContract, ThirdPartyAgentAdapter, MarketplaceSqliteRepository, types | **standalone, no runtime consumer** |
| `distributed/` ★ | 7 | DistributedRuntimeManager, AgentTransport, RemoteAgentProxy, DistributedScheduler, ConsensusCoordinator, DistributedSqliteRepository, types | **standalone, no runtime consumer** |
| `team/` ★ | 6 | TeamFormationEngine, TeamCompositionOptimizer, RoleAssignmentStrategy, TeamLifecycleManager, TeamSqliteRepository, types | **NOT wired into CollaborationManager** |

### Context Layer (7 files)
ContextAssemblyEngine, ContextBuilder, ContextVersioner, ContextFragmentRegistry, ContextTemplateRepository, ContextEnricher, ContextPersistence.

### Artifact Plane (11 files)
ArtifactPlane, ArtifactManager (with optional ArtifactSqliteRepository), ArtifactSqliteRepository, ArtifactStagingArea, ArtifactValidator, ArtifactVerifier, ArtifactVersionService, ArtifactLineageTracker, ArtifactEventEmitter, ArtifactRepository, types.

### Resilience Layer (3 files)
RetryPolicy (4 backoff strategies), CircuitBreaker (CLOSED→OPEN→HALF_OPEN), ErrorHandlerService (integrates both + compensation).

### Observability Layer (6 files)
MetricsCollector (with V9Metrics), CompactionService, TraceManager, WorkflowMetrics, PrometheusExporter, HealthCheckService.

---

## Database Schema (26 tables, single SQLite DB)

| Group | Tables | Stage |
|-------|--------|-------|
| **Event Sourcing** | `events`, `events_decision`, `schema_migrations` | S0 |
| **Context** | `context_snapshots` | S1 |
| **Artifact** | `artifacts_v2`, `artifact_versions_v2`, `artifact_dependencies_v2`, `artifact_staging_v2` | S1 |
| **Agent Identity** | `agents`, `agent_capabilities`, `agent_governance_log`, `agent_collaborations` | S1 |
| **Learning** | `shared_experiences` | S2 |
| **Governance** | `org_policies`, `team_governance`, `team_memberships`, `org_budget`, `budget_allocations` | S2 |
| **Marketplace** | `marketplace_listings`, `marketplace_bids`, `marketplace_contracts` | S2 |
| **Distributed** | `agent_instances`, `remote_messages` | S2 |
| **Team** | `agent_teams` | S2 |
| **Shared Memory** | `shared_memory_entries` | S2 |

---

## Data Flow

### Primary Flow: Message → CognitivePipeline → SQLite

```
User Request
    │
    ▼
MessageGateway.receive()
    │
    ▼
EventBus.emit(USER_MESSAGE_RECEIVED)
    │
    ▼
CognitivePipeline.process() [with errorHandler wrapping]
    │
    ├─ ContextStage → ContextAssemblyEngine.assemble()
    │   └─ Persist: context_snapshots table
    ├─ IntentStage → detectIntent()
    ├─ GoalStage → matchGoals()
    ├─ TwinStage → BehaviorTwin + DecisionTwin
    ├─ PlanningStage → createMission()
    ├─ ExecutionStage → executeMission() [Contract→Permission→Budget→Sandbox→Agent→Verification→Compensation]
    │   └─ Persist: events table (via EventStore)
    ├─ LearningStage → EvidenceAggregator → TwinCandidate
    │   ├─ Persist: events_decision (via EventStore)
    │   └─ *** CrossAgentLearningEngine NOT wired ***
    ├─ EvolutionStage → Mine→Simulate→Policy→Register
    └─ PersistenceStage → BrainPersistor → MemoryWiki
```

### Secondary Flow: Agent Collaboration (v9.2, partly wired)

```
Multi-Agent Mission
    │
    ▼
CollaborationManager.execute(plan)
    ├─ TeamFormationEngine.formTeam() *** NOT WIRED ***
    ├─ AgentScheduler.selectAgent()
    │   └─ OrganizationPolicyEngine.evaluate() *** NOT WIRED ***
    ├─ AgentMessageBus.request()
    ├─ SharedMemoryManager.acquireLock() *** NOT WIRED ***
    └─ ResultAggregator.aggregate()
```

---

## Orphaned Modules Report (v9.2)

The following modules exist and are exported, but are **not wired into any runtime flow**:

| Module | File | Problem | Impact |
|--------|------|---------|--------|
| `CrossAgentLearningEngine` | `agent/learning/` | LearningStage uses its own EvidenceAggregator, never calls CALEngine | v9.2 learning feature non-functional |
| `TeamFormationEngine` | `agent/team/` | CollaborationManager creates plans manually, never calls TeamFormation | Agent teams never auto-formed |
| `OrganizationPolicyEngine` | `agent/governance/` | AgentScheduler selects agents by score only, no policy check | Org governance bypassed |
| `SharedMemoryManager` | `agent/memory/` | CollaborationManager doesn't use shared memory for coordination | Shared memory isolated/unused |
| `All SqliteRepositories` | `agent/*/` | Exported but never injected into managers | Persistence layer tables exist but remain empty in production |
| `CompactionService` | `observability/` | Exists but `startAuto()` never called | DB grows unbounded |
| `PrometheusExporter` | `observability/` | No HTTP endpoint starts it | `/metrics` endpoint unavailable |
| `HealthCheckService` | `observability/` | No route mounts it | No `/health` endpoint |
| `DistributedRuntimeManager` | `agent/distributed/` | No bootstrap enables it | Distributed mode non-functional |
| `MarketplaceEngine` | `agent/marketplace/` | No runtime consumer | Marketplace never used |

---

## Test Status (25/32 passing)

| Group | Tests | Status |
|-------|-------|--------|
| v9.1 Context Assembly | 14 | ✅ All pass |
| v9.1 Artifact Plane | 10 | ✅ All pass |
| v9.2 Learning/Governance/Marketplace | 6 | ✅ All pass |
| v9.2 Distributed/Team/Consensus | 6 | ✅ All pass |
| Stage 0 Unified EventStore | 12 | ✅ All pass |
| Stage 1-2 Persistence | 24 | ✅ All pass |
| Stage 3 Config v9 | 13 | ✅ All pass |
| E2E Pipeline | 8 | ✅ All pass |
| Resilience | 13 | ✅ All pass |
| Phase 2-3 Compaction/Metrics | 10 | ✅ All pass |
| Phase 4 Prometheus/Health | 2 | ✅ All pass |
| **v4 Legacy (pre-existing)** | **7** | ❌ Logic failures (unrelated to v9.2) |

---

## Key Design Decisions

1. **Single SQLite DB** — All 26 tables in one file (`morpex-events.db`). WAL mode for concurrency.
2. **Two learning systems co-exist** — LearningStage's EvidenceAggregator (v8.7, TwinCandidate-based) and CrossAgentLearningEngine (v9.2, experience-based) are separate. Merging them is future work.
3. **Feature-gated** — Distributed/Marketplace features exist but require opt-in via Config.
4. **SqliteRepositories are additive** — All managers work in-memory; SQLite persistence is optional until wired.
5. **ErrorHandlerService is the one wired success** — The only production layer actively integrated into the CognitivePipeline.
