# MorPex 后端代码函数与关系链分析

> 生成时间：2026-08-21 15:28:47 ｜ 工具：`scripts/_backend-code-analyze.ts`（TS compiler API，只读）

## 0. 统计概览

| 指标 | 值 |
|---|---|
| 扫描根 | packages/core/src/facade、packages/core/src/governance、packages/core/src/knowledge、packages/core/src/gate、packages/core/src/cognition、packages/core/src/execution、packages/core/src/evaluation、packages/core/src/evolution、packages/core/src/infrastructure、packages/core/src/workflow、packages/connectors/src、packages/memory/src、packages/studio/server、packages/workflows、packages/workflow-sdk/src、packages/contracts、scripts |
| 文件数 | 483 |
| 函数/方法数 | 2768 |
| 调用表达式数 | 12742 |
| import 数 | 985 |

## 1. 文件间依赖关系链（import 图）

> 每文件列出其直接 import 的模块（相对路径按所在目录归一化）。

### packages\connectors\src\BaseConnector.ts
- `./IActionConnector.js` → IActionConnector
- `./types.js` → ActionRequest, ActionResult, ConnectorMeta, ConnectorCapability

### packages\connectors\src\ConnectorRegistry.ts
- `./IActionConnector.js` → IActionConnector
- `./types.js` → ActionRequest, ActionResult, ConnectorMeta, PermissionRule, PermissionResult

### packages\connectors\src\FileSystemConnector.ts
- `./BaseConnector.js` → BaseConnector
- `./types.js` → ConnectorCapability
- `node:path` → resolve

### packages\connectors\src\IActionConnector.ts
- `./types.js` → ActionRequest, ActionResult, ConnectorMeta, ConnectorCapability

### packages\connectors\src\ShellConnector.ts
- `./BaseConnector.js` → BaseConnector
- `./types.js` → ActionRequest, ActionResult, ConnectorCapability
- `./secureExec.js` → runCommand, makePrivateTempDir, randomPrivateFilePath, writeExclusive, cleanupTempDir

### packages\connectors\src\index.ts
- （无 import）
### packages\connectors\src\secureExec.ts
- `node:child_process` → spawn
- `node:crypto` → randomBytes
- `node:fs/promises` → chmod, mkdtemp, open, rm
- `node:os` → tmpdir
- `node:path` → *

### packages\connectors\src\types.ts
- （无 import）
### packages\contracts\agent-runtime.ts
- `./errors.js` → RuntimeError
- `./capabilities.js` → AgentRuntimeCapabilities
- `./tool.js` → ToolDefinition, ToolCall, ToolResult
- `./inference.js` → ExecutionContext, TokenUsage

### packages\contracts\capabilities.ts
- （无 import）
### packages\contracts\errors.ts
- （无 import）
### packages\contracts\index.ts
- （无 import）
### packages\contracts\inference.ts
- `./errors.js` → RuntimeError
- `./capabilities.js` → InferenceCapabilities
- `./tool.js` → ToolDefinition

### packages\contracts\runtime-events.ts
- `./tool.js` → ToolCall, ToolResult
- `./errors.js` → RuntimeError
- `./inference.js` → TokenUsage
- `./agent-runtime.js` → AgentRuntimeEvent

### packages\contracts\tool.ts
- （无 import）
### packages\core\src\cognition\BrainFacade.ts
- `../infrastructure/common/EventBus.js` → EventBus
- `../infrastructure/common/types.js` → MorPexEvent
- `../infrastructure/observability/deblackbox/DeblackboxRecorder.js` → getSharedDeblackboxRecorder
- `./ReflectionEngine.js` → ReflectionEngineLike, BrainReflectionState, BrainReflectionResult
- `./learning/LearningLoop.js` → TaskRecord, LearningResult

### packages\core\src\cognition\CrossDepartmentKnowledgeSynthesizer.ts
- `../infrastructure/common/EventBus.js` → EventBus
- `../infrastructure/common/types.js` → MorPexEvent
- `../governance/control-plane/DepartmentContext.js` → DepartmentContext
- `../governance/control-plane/department-types.js` → DepartmentId

### packages\core\src\cognition\ReflectionEngine.ts
- `../infrastructure/common/EventBus.js` → EventBus

### packages\core\src\cognition\SafetyMonitor.ts
- `../infrastructure/common/EventBus.js` → EventBus

### packages\core\src\cognition\decision\DecisionTwin.ts
- `../memory/DecisionMemory.js` → DecisionMemory
- `../memory/types.js` → DecisionMemoryEntry
- `../twin/PersonalTwinGraph.js` → PersonalTwinGraph
- `../twin/BehaviorTwin.js` → BehaviorTwin
- `./types.js` → DecisionProfile, FactorSummary, DecisionAnalysis, DecisionPrediction, OutcomeRecord, FactorCorrelation, DecisionPath, BiasReport, DetectedBias, OutcomeFeedbackStats

### packages\core\src\cognition\decision\index.ts
- （无 import）
### packages\core\src\cognition\decision\types.ts
- （无 import）
### packages\core\src\cognition\goal\GoalGraph.ts
- `./types.js` → Goal, GoalGraphNode, GoalStatus, GoalLevel

### packages\core\src\cognition\goal\GoalManager.ts
- `./GoalGraph.js` → GoalGraph
- `./types.js` → Goal, GoalLevel, Objective, KeyResult, GoalGraphNode, GoalCreateInput, GoalStats

### packages\core\src\cognition\goal\index.ts
- （无 import）
### packages\core\src\cognition\goal\types.ts
- （无 import）
### packages\core\src\cognition\index.ts
- （无 import）
### packages\core\src\cognition\learning\ExperienceExtractor.ts
- （无 import）
### packages\core\src\cognition\learning\LearningLoop.ts
- `../../infrastructure/common/EventBus.js` → EventBus
- `./ExperienceExtractor.js` → ExperienceExtractor, ExecutionRecord, Experience
- `./PlanEvaluator.js` → PlanEvaluator, PlanEvaluation
- `./StrategyOptimizer.js` → StrategyOptimizer, OptimizationSuggestion
- `../../cognition/BrainFacade.js` → LearningLoopLike

### packages\core\src\cognition\learning\PlanEvaluator.ts
- `./ExperienceExtractor.js` → ExecutionRecord, Experience

### packages\core\src\cognition\learning\StrategyOptimizer.ts
- `./PlanEvaluator.js` → PlanEvaluation

### packages\core\src\cognition\learning\TemplateEvolutionEngine.ts
- `./ExperienceExtractor.js` → Experience
- `./PlanEvaluator.js` → PlanEvaluation

### packages\core\src\cognition\learning\agent\CrossAgentLearningEngine.ts
- `./types.js` → GeneralizedExperience
- `./ExperienceRepository.js` → ExperienceRepository
- `./KnowledgeDistiller.js` → KnowledgeDistiller
- `./LearningPropagationService.js` → LearningPropagationService
- `./ExperienceMatcher.js` → ExperienceMatcher

### packages\core\src\cognition\learning\agent\ExperienceMatcher.ts
- `./types.js` → GeneralizedExperience
- `./ExperienceRepository.js` → ExperienceRepository

### packages\core\src\cognition\learning\agent\ExperienceRepository.ts
- `./types.js` → GeneralizedExperience, ExperienceQuery

### packages\core\src\cognition\learning\agent\ExperienceSqliteRepository.ts
- `better-sqlite3` → Database
- `./types.js` → GeneralizedExperience, ExperienceQuery

### packages\core\src\cognition\learning\agent\KnowledgeDistiller.ts
- `./types.js` → GeneralizedExperience, ExperienceCategory

### packages\core\src\cognition\learning\agent\LearningPropagationService.ts
- `./types.js` → GeneralizedExperience

### packages\core\src\cognition\learning\agent\index.ts
- （无 import）
### packages\core\src\cognition\learning\agent\types.ts
- （无 import）
### packages\core\src\cognition\learning\index.ts
- （无 import）
### packages\core\src\cognition\memory\BrainPersistor.ts
- `./PersonalBrain.js` → PersonalBrain
- `../../infrastructure/adapters/memory/index.js` → MemoryApi

### packages\core\src\cognition\memory\DecisionMemory.ts
- `./types.js` → DecisionMemoryEntry

### packages\core\src\cognition\memory\PersonalBrain.ts
- `./types.js` → MemoryLayer, MemoryEntry, MemoryQuery, MemoryQueryResult, BrainStats, PreferenceMemoryEntry
- `./types.js` → LAYER_TTL
- `./WorkflowMemory.js` → WorkflowMemory
- `./DecisionMemory.js` → DecisionMemory

### packages\core\src\cognition\memory\WorkflowMemory.ts
- `./types.js` → WorkflowMemoryEntry

### packages\core\src\cognition\memory\index.ts
- （无 import）
### packages\core\src\cognition\memory\types.ts
- （无 import）
### packages\core\src\cognition\planning\CrossDepartmentArbitrationEngine.ts
- `../../infrastructure/common/EventBus.js` → EventBus

### packages\core\src\cognition\planning\DeliveryPlanner.ts
- `../../infrastructure/common/EventBus.js` → EventBus
- `../../infrastructure/common/types.js` → MorPexEvent
- `../../governance/control-plane/DepartmentContext.js` → DepartmentContext
- `../../governance/control-plane/department-types.js` → DepartmentId
- `../../infrastructure/observability/deblackbox/DeblackboxRecorder.js` → getSharedDeblackboxRecorder
- `./HierarchicalPlanner.js` → HierarchicalPlannerLike, DAGPlan
- `../../knowledge/ontology/OntologyService.js` → OntologyService
- `../../gate/ForcedQueryGuard.js` → ForcedQueryGuard

### packages\core\src\cognition\planning\DeliveryPlannerAdapter.ts
- `../../execution/runtime/mission/MissionRuntime.js` → MissionPlanner
- `../../execution/runtime/mission/types.js` → Mission, MissionPlan, PlanStep
- `./DeliveryPlanner.js` → DeliveryPlanner
- `./DeliveryPlanner.js` → PlanningRequest
- `./CrossDepartmentArbitrationEngine.js` → CrossDepartmentArbitrationEngine
- `./CrossDepartmentArbitrationEngine.js` → PlanWithTasks, Conflict
- `./HierarchicalPlanner.js` → HierarchicalPlanner

### packages\core\src\cognition\planning\HierarchicalPlanner.ts
- `../../infrastructure/common/EventBus.js` → EventBus
- `../../infrastructure/observability/deblackbox/DeblackboxRecorder.js` → getSharedDeblackboxRecorder
- `../../knowledge/ontology/OntologyService.js` → OntologyService
- `../../gate/ForcedQueryGuard.js` → ForcedQueryGuard

### packages\core\src\cognition\planning\goal-intelligence\ConstraintAnalyzer.ts
- `../../../infrastructure/protocol/contracts/goal.js` → GoalContext

### packages\core\src\cognition\planning\goal-intelligence\GoalIntelligenceFacade.ts
- `./GoalParser.js` → GoalParser
- `./RequirementExtractor.js` → RequirementExtractor
- `./ConstraintAnalyzer.js` → ConstraintAnalyzer
- `./GoalValidator.js` → GoalValidator
- `./IntentClassifier.js` → IntentClassifier
- `../../../infrastructure/protocol/contracts/goal.js` → GoalContext

### packages\core\src\cognition\planning\goal-intelligence\GoalParser.ts
- `../../../infrastructure/protocol/contracts/goal.js` → GoalContext, GoalParseResult

### packages\core\src\cognition\planning\goal-intelligence\GoalValidator.ts
- `../../../infrastructure/protocol/contracts/goal.js` → GoalContext

### packages\core\src\cognition\planning\goal-intelligence\IntentClassifier.ts
- （无 import）
### packages\core\src\cognition\planning\goal-intelligence\RequirementExtractor.ts
- `../../../infrastructure/protocol/contracts/goal.js` → GoalContext

### packages\core\src\cognition\planning\goal-intelligence\index.ts
- （无 import）
### packages\core\src\cognition\planning\goal-intelligence\types.ts
- （无 import）
### packages\core\src\cognition\planning\index.ts
- （无 import）
### packages\core\src\cognition\twin\BehaviorTwin.ts
- `../../execution/runtime/mission/types.js` → Mission, MissionResult, MissionPlan

### packages\core\src\cognition\twin\OrganizationTwin.ts
- `./BehaviorTwin.js` → BehaviorTwin
- `../../infrastructure/observability/deblackbox/DeblackboxRecorder.js` → getSharedDeblackboxRecorder
- `../decision/DecisionTwin.js` → DecisionTwin
- `../memory/DecisionMemory.js` → DecisionMemory
- `./PreferenceModel.js` → PreferenceModel

### packages\core\src\cognition\twin\PersonalTwinGraph.ts
- `./types.js` → TwinNode, TwinEdge, TwinNodeType, TwinEdgeType, TwinQuery, TwinStats, DecisionProfile, SubgraphResult, TwinInsight

### packages\core\src\cognition\twin\PlannerConstraint.ts
- `./BehaviorTwin.js` → BehaviorProfile
- `../decision/types.js` → DecisionProfile
- `./PreferenceModel.js` → PreferenceProfile

### packages\core\src\cognition\twin\PreferenceModel.ts
- （无 import）
### packages\core\src\cognition\twin\index.ts
- （无 import）
### packages\core\src\cognition\twin\types.ts
- （无 import）
### packages\core\src\cognition\types.ts
- （无 import）
### packages\core\src\cognition\workflow\WorkflowIntelligence.ts
- `../../execution/runtime/mission/types.js` → Mission, PlanStep
- `../memory/WorkflowMemory.js` → WorkflowMemory
- `../memory/types.js` → WorkflowMemoryEntry
- `./types.js` → WorkflowPattern, WorkflowStep, OptimizationSuggestion, AutomationAssessment, IntelligenceReport

### packages\core\src\cognition\workflow\index.ts
- （无 import）
### packages\core\src\cognition\workflow\types.ts
- （无 import）
### packages\core\src\evaluation\EvaluationEngine.ts
- `./QualityScorer.js` → QualityScorer, SystemScore
- `./ontologyCompliance.js` → scoreOntologyCompliance, OntologyComplianceScore
- `./lineageCompliance.js` → scoreLineageHealth, LineageHealthScore
- `../knowledge/artifact/registry/ArtifactGraph.js` → ArtifactGraph
- `../gate/ForcedQueryGuard.js` → ForcedQueryGuard
- `../infrastructure/common/EventBus.js` → EventBus
- `../infrastructure/common/types.js` → MorPexEvent
- `../infrastructure/protocol/events/EventTypes.js` → SYSTEM_EVENT_TYPES

### packages\core\src\evaluation\QualityScorer.ts
- （无 import）
### packages\core\src\evaluation\index.ts
- （无 import）
### packages\core\src\evaluation\lineageCompliance.ts
- `../knowledge/artifact/registry/ArtifactLineage.js` → ArtifactLineage
- `../knowledge/artifact/registry/ArtifactGraph.js` → ArtifactGraph
- `../knowledge/artifact/registry/types.js` → ArtifactNode

### packages\core\src\evaluation\ontologyCompliance.ts
- `../gate/ForcedQueryGuard.js` → ForcedQueryGuard

### packages\core\src\evaluation\verification\ArtifactChecker.ts
- `./QualityRule.js` → QualityRule
- `./QualityRule.js` → QualityCheck

### packages\core\src\evaluation\verification\ExecutionVerifier.ts
- `./ArtifactChecker.js` → ArtifactChecker
- `../../infrastructure/protocol/contracts/artifact-lifecycle.js` → Artifact

### packages\core\src\evaluation\verification\QualityRule.ts
- （无 import）
### packages\core\src\evaluation\verification\RepairPlanner.ts
- `./ExecutionVerifier.js` → VerificationResult

### packages\core\src\evaluation\verification\VerificationEngine.ts
- `./QualityRule.js` → QualityRule
- `./ExecutionVerifier.js` → ExecutionVerifier
- `./RepairPlanner.js` → RepairPlanner
- `../../infrastructure/protocol/contracts/artifact-lifecycle.js` → Artifact
- `./ExecutionVerifier.js` → VerificationResult
- `./RepairPlanner.js` → RepairPlan
- `../../infrastructure/common/EventBus.js` → EventBus

### packages\core\src\evolution\ActiveEvolutionTrigger.ts
- `../infrastructure/common/EventBus.js` → EventBus
- `../infrastructure/common/types.js` → MorPexEvent
- `../governance/control-plane/department-types.js` → DepartmentId

### packages\core\src\evolution\EvolutionApplyLoop.ts
- `../infrastructure/common/EventBus.js` → EventBus
- `../gate/context.js` → KnowledgeContextPackage
- `./EvolutionSandbox.js` → EvolutionSandbox, EvolutionChangeRecord
- `./PromptStrategyRegistry.js` → PromptStrategyRegistry, StrategyType
- `../infrastructure/observability/deblackbox/DeblackboxRecorder.js` → getSharedDeblackboxRecorder

### packages\core\src\evolution\EvolutionProposal.ts
- `../gate/context.js` → requireKnowledgeContext, KnowledgeContextPackage
- `../gate/types.js` → RiskTier

### packages\core\src\evolution\EvolutionSandbox.ts
- `../infrastructure/protocol/events/store/IEventStore.js` → IEventStore
- `../gate/context.js` → requireKnowledgeContext, KnowledgeContextPackage
- `../infrastructure/observability/deblackbox/DeblackboxRecorder.js` → getSharedDeblackboxRecorder

### packages\core\src\evolution\ExperienceInjectionService.ts
- `./LearningEventDetector.js` → LearningEvent

### packages\core\src\evolution\ExperienceMiner.ts
- `./PatternExtractor.js` → PatternExtractor
- `./LearningEventDetector.js` → LearningEventDetector, LearningEvent, StepStats
- `../infrastructure/common/EventBus.js` → EventBus

### packages\core\src\evolution\FailureAnalyzer.ts
- `./workflow/types.js` → RegisteredWorkflow

### packages\core\src\evolution\ImprovementAnalyzer.ts
- （无 import）
### packages\core\src\evolution\KnowledgeGapListener.ts
- `../knowledge/ontology/FeedbackService.js` → FeedbackInput

### packages\core\src\evolution\LearningEventDetector.ts
- （无 import）
### packages\core\src\evolution\PatternExtractor.ts
- `../governance/capability/CapabilityRegistry.js` → CapabilityRegistry

### packages\core\src\evolution\PromptStrategyRegistry.ts
- （无 import）
### packages\core\src\evolution\SelfImprovementLoop.ts
- `./ImprovementAnalyzer.js` → ImprovementAnalyzer
- `./EvolutionProposal.js` → EvolutionProposal
- `../cognition/SafetyMonitor.js` → SafetyMonitor
- `./ImprovementAnalyzer.js` → ImprovementInsight
- `./EvolutionProposal.js` → Proposal

### packages\core\src\evolution\index.ts
- （无 import）
### packages\core\src\evolution\workflow\WorkflowExecutor.ts
- `./WorkflowRegistry.js` → WorkflowRegistry
- `./types.js` → RegisteredWorkflow, ExecutionResult
- `../../execution/runtime/mission/MissionRuntime.js` → MissionRuntime
- `../../execution/runtime/mission/types.js` → PlanStep
- `../../infrastructure/protocol/message-types.js` → IncomingMessage

### packages\core\src\evolution\workflow\WorkflowOptimizer.ts
- `../../cognition/index.js` → WorkflowIntelligence, WorkflowMemory
- `./WorkflowRegistry.js` → WorkflowRegistry
- `./types.js` → RegisteredWorkflow, OptimizationPlan
- `../../cognition/index.js` → OptimizationSuggestion

### packages\core\src\evolution\workflow\WorkflowRegistry.ts
- `./types.js` → RegisteredWorkflow, WorkflowCandidate, WorkflowStatus, WorkflowVersion
- `./contract/WorkflowContract.js` → WorkflowContract
- `./contract/WorkflowContract.js` → ContractValidator

### packages\core\src\evolution\workflow\WorkflowSimulator.ts
- `../../execution/runtime/mission/types.js` → Mission
- `./types.js` → WorkflowCandidate, WorkflowStepDef, WorkflowSimulationContext, SimulationResult, SimulationMetrics, SimulatorConfig, WorkflowFailureMode

### packages\core\src\evolution\workflow\contract\ContractValidator.ts
- `./types.js` → WorkflowContract, ContractValidationResult

### packages\core\src\evolution\workflow\contract\WorkflowContract.ts
- （无 import）
### packages\core\src\evolution\workflow\contract\index.ts
- （无 import）
### packages\core\src\evolution\workflow\contract\types.ts
- （无 import）
### packages\core\src\evolution\workflow\index.ts
- （无 import）
### packages\core\src\evolution\workflow\types.ts
- （无 import）
### packages\core\src\execution\AgentAllocator.ts
- `./types.js` → TeamMember, TeamSpec

### packages\core\src\execution\AgentMailbox.ts
- `../infrastructure/common/EventBus.js` → EventBus
- `../governance/control-plane/SpaceService.js` → SpaceService
- `node:fs` → *
- `node:path` → *

### packages\core\src\execution\DecisionStore.ts
- `node:fs` → *
- `node:path` → *

### packages\core\src\execution\DependencyCoordinator.ts
- `./types.js` → DependencyGraph, DynamicTeam

### packages\core\src\execution\DynamicTeamOrchestrator.ts
- `./TeamBuilder.js` → TeamBuilder
- `../infrastructure/observability/deblackbox/DeblackboxRecorder.js` → getSharedDeblackboxRecorder
- `./AgentAllocator.js` → AgentAllocator
- `./DependencyCoordinator.js` → DependencyCoordinator
- `../governance/capability/CapabilityDiscoverer.js` → CapabilityDiscoverer
- `../governance/capability/CapabilityRegistry.js` → Capability
- `./types.js` → DynamicTeam, DependencyGraph
- `../infrastructure/protocol/contracts/goal.js` → GoalContext
- `../governance/capability/AgentCapabilityRegistry.js` → AgentCapabilityRegistry

### packages\core\src\execution\PlanGateService.ts
- `../infrastructure/common/EventBus.js` → EventBus
- `../execution/DecisionStore.js` → recordDecision, resolveDecision

### packages\core\src\execution\SubAgentFork.ts
- `../infrastructure/common/EventBus.js` → EventBus
- `../governance/control-plane/DepartmentContext.js` → DepartmentContext
- `../infrastructure/common/ProgressCallback.js` → makeProgressEvent
- `../governance/control-plane/department-types.js` → DepartmentId
- `../infrastructure/common/ProgressCallback.js` → ProgressCallback

### packages\core\src\execution\TaskStateProjector.ts
- `../infrastructure/common/EventBus.js` → EventBus
- `../infrastructure/common/types.js` → MorPexEvent
- `node:fs` → *
- `node:path` → *

### packages\core\src\execution\TeamBuilder.ts
- `./types.js` → TeamSpec

### packages\core\src\execution\UnifiedExecutionEngine.ts
- `../infrastructure/common/EventBus.js` → EventBus
- `../governance/control-plane/DepartmentContext.js` → DepartmentContext
- `../infrastructure/common/ProgressCallback.js` → makeProgressEvent
- `../governance/control-plane/department-types.js` → DepartmentId
- `../infrastructure/common/ProgressCallback.js` → ProgressCallback
- `../infrastructure/tools/DomainPrimitiveRegistry.js` → DomainPrimitiveRegistry
- `../infrastructure/observability/deblackbox/DeblackboxRecorder.js` → getSharedDeblackboxRecorder

### packages\core\src\execution\UserAskService.ts
- `../infrastructure/common/EventBus.js` → EventBus
- `./DecisionStore.js` → recordDecision, resolveDecision

### packages\core\src\execution\fabric\ExecutionFabric.ts
- `@morpex/connectors/ConnectorRegistry.js` → ConnectorRegistry
- `../../infrastructure/observability/deblackbox/DeblackboxRecorder.js` → getSharedDeblackboxRecorder
- `@morpex/connectors/types.js` → ActionRequest, ActionResult

### packages\core\src\execution\fabric\index.ts
- （无 import）
### packages\core\src\execution\index.ts
- （无 import）
### packages\core\src\execution\orchestration\AgentSessionStore.ts
- `node:path` → *
- `../../infrastructure/adapters/index.js` → PiBridge, AgentSessionRepo
- `../../infrastructure/adapters/index.js` → MPSession

### packages\core\src\execution\orchestration\OrchestratorAgent.ts
- `../UnifiedExecutionEngine.js` → DAGRuntimeLike
- `../../infrastructure/observability/deblackbox/DeblackboxRecorder.js` → getSharedDeblackboxRecorder
- `../runtime/dag/StepAgentExecutor.js` → StepAgentExecutor
- `./AgentSessionStore.js` → AgentSessionStore, AgentSessionHandle
- `../../gate/context.js` → KnowledgeContextPackage
- `../PlanGateService.js` → requestPlanConfirm
- `node:fs` → *
- `node:path` → *

### packages\core\src\execution\runtime\ExecutionContext.ts
- `../../infrastructure/protocol/contracts/goal.js` → GoalContext
- `./mission/MissionTypes.js` → MissionState
- `../../execution/types.js` → DynamicTeam
- `../../governance/capability/CapabilityRegistry.js` → Capability

### packages\core\src\execution\runtime\MorPexRuntime.ts
- `../../infrastructure/common/EventBus.js` → EventBus
- `./PipelineOrchestrator.js` → PipelineOrchestrator
- `./mission/MissionController.js` → MissionController
- `../../execution/UnifiedExecutionEngine.js` → UnifiedExecutionEngine
- `../../execution/UnifiedExecutionEngine.js` → ExecutionRequest
- `../../knowledge/artifact/ArtifactFacade.js` → ArtifactFacade
- `../../evaluation/verification/VerificationEngine.js` → VerificationEngine
- `../../governance/ComplianceChecker.js` → ComplianceChecker
- `../../infrastructure/observability/deblackbox/DeblackboxRecorder.js` → getSharedDeblackboxRecorder
- `../../governance/ApprovalGate.js` → ApprovalGate
- `../../evolution/ExperienceMiner.js` → ExperienceMiner
- `./simulation/ExecutionSimulator.js` → ExecutionSimulator
- `../../execution/DynamicTeamOrchestrator.js` → DynamicTeamOrchestrator
- `./ExecutionContext.js` → ExecutionContext
- `../../infrastructure/protocol/contracts/artifact-lifecycle.js` → Artifact
- `../../cognition/index.js` → SafetyMonitor
- `../../evolution/index.js` → SelfImprovementLoop
- `../../knowledge/graph/SystemMetadataGraph.js` → systemMetadataGraph
- `../../cognition/learning/agent/CrossAgentLearningEngine.js` → CrossAgentLearningEngine
- `../../infrastructure/protocol/events/store/IEventStore.js` → IEventStore
- `../../knowledge/ontology/OntologyService.js` → OntologyService
- `../../gate/ForcedQueryGuard.js` → ForcedQueryGuard
- `../../evaluation/EvaluationEngine.js` → EvaluationEngine

### packages\core\src\execution\runtime\PersistentArtifactStore.ts
- `../../infrastructure/protocol/events/store/UnifiedEventStore.js` → UnifiedEventStore
- `../../infrastructure/protocol/events/BaseEvent.js` → BaseEvent
- `../../infrastructure/protocol/contracts/artifact-lifecycle.js` → ArtifactNode, ArtifactStatus

### packages\core\src\execution\runtime\PersistentMissionStore.ts
- `../../infrastructure/protocol/events/store/UnifiedEventStore.js` → UnifiedEventStore
- `../../infrastructure/protocol/events/EventTypes.js` → SYSTEM_EVENT_TYPES
- `./mission/MissionTypes.js` → MissionState

### packages\core\src\execution\runtime\PipelineOrchestrator.ts
- `../../infrastructure/common/EventBus.js` → EventBus
- `../../cognition/planning/goal-intelligence/GoalIntelligenceFacade.js` → GoalIntelligenceFacade
- `./mission/MissionController.js` → MissionController
- `../../execution/DynamicTeamOrchestrator.js` → DynamicTeamOrchestrator
- `../../governance/capability/CapabilityRegistry.js` → CapabilityRegistry
- `../../knowledge/artifact/ArtifactBlueprint.js` → ArtifactBlueprintBuilder
- `./ExecutionContext.js` → ExecutionContext, WorkflowContext

### packages\core\src\execution\runtime\ServiceContainer.ts
- `../../infrastructure/common/EventBus.js` → EventBus
- `../PlanGateService.js` → setPlanEventBus
- `../../infrastructure/observability/deblackbox/DeblackboxRecorder.js` → getSharedDeblackboxRecorder
- `./mission/MissionController.js` → MissionController
- `../../execution/DynamicTeamOrchestrator.js` → DynamicTeamOrchestrator
- `../../execution/UnifiedExecutionEngine.js` → UnifiedExecutionEngine
- `../../execution/UnifiedExecutionEngine.js` → DAGRuntimeLike
- `../../knowledge/artifact/ArtifactFacade.js` → ArtifactFacade
- `../../evaluation/verification/VerificationEngine.js` → VerificationEngine
- `../../governance/ComplianceChecker.js` → ComplianceChecker
- `../../governance/ApprovalGate.js` → ApprovalGate
- `../../governance/AnomalyDetector.js` → AnomalyDetector
- `../../evolution/ExperienceMiner.js` → ExperienceMiner
- `../../evolution/EvolutionSandbox.js` → EvolutionSandbox
- `../../evolution/PromptStrategyRegistry.js` → PromptStrategyRegistry
- `../../evolution/EvolutionApplyLoop.js` → EvolutionApplyLoop
- `./simulation/ExecutionSimulator.js` → ExecutionSimulator
- `./MorPexRuntime.js` → MorPexRuntime
- `./mission/MissionRuntime.js` → MissionRuntime
- `./dag/DAGRuntime.js` → DAGRuntime
- `./dag/StepAgentExecutor.js` → StepAgentExecutor
- `../orchestration/OrchestratorAgent.js` → OrchestratorAgent
- `../orchestration/AgentSessionStore.js` → AgentSessionStore
- `../../knowledge/context/ContextPersistence.js` → ContextPersistence
- `./PersistentMissionStore.js` → PersistentMissionStore
- `./PersistentArtifactStore.js` → PersistentArtifactStore
- `../../governance/control-plane/ControlPlane.js` → ControlPlane
- `../../knowledge/graph/SystemMetadataGraph.js` → systemMetadataGraph
- `../../cognition/learning/agent/CrossAgentLearningEngine.js` → CrossAgentLearningEngine
- `../../cognition/learning/agent/ExperienceRepository.js` → ExperienceRepository
- `../../cognition/learning/agent/KnowledgeDistiller.js` → KnowledgeDistiller
- `../../cognition/learning/agent/LearningPropagationService.js` → LearningPropagationService
- `../../cognition/learning/agent/ExperienceMatcher.js` → ExperienceMatcher
- `../../knowledge/ontology/OntologyService.js` → OntologyService
- `../../gate/ForcedQueryGuard.js` → ForcedQueryGuard
- `../../evaluation/EvaluationEngine.js` → EvaluationEngine

### packages\core\src\execution\runtime\approval\ApprovalEngine.ts
- `../../../infrastructure/common/EventBus.js` → EventBus
- `../../../infrastructure/protocol/events/EventType.js` → EventType
- `./types.js` → ApprovalRequest, ApprovalEngineConfig

### packages\core\src\execution\runtime\approval\index.ts
- （无 import）
### packages\core\src\execution\runtime\approval\types.ts
- （无 import）
### packages\core\src\execution\runtime\budget\BudgetManager.ts
- （无 import）
### packages\core\src\execution\runtime\budget\index.ts
- （无 import）
### packages\core\src\execution\runtime\checkpoint\CheckpointManager.ts
- `node:fs/promises` → *
- `node:path` → *
- `node:fs` → *

### packages\core\src\execution\runtime\checkpoint\RecoveryManager.ts
- `./CheckpointManager.js` → ExecutionSnapshot, NodeState

### packages\core\src\execution\runtime\checkpoint\ReplayEngine.ts
- `./CheckpointManager.js` → NodeState
- `./CheckpointManager.js` → CheckpointManager

### packages\core\src\execution\runtime\checkpoint\index.ts
- （无 import）
### packages\core\src\execution\runtime\compensation\CompensationEngine.ts
- （无 import）
### packages\core\src\execution\runtime\compensation\index.ts
- （无 import）
### packages\core\src\execution\runtime\dag\DAGRuntime.ts
- `./types.js` → ExecutionDAG
- `./TaskGraph.js` → TaskGraph
- `./DependencyResolver.js` → DependencyResolver
- `./Scheduler.js` → Scheduler, SchedulerConfig
- `./ParallelExecutor.js` → ParallelExecutor
- `./TaskNode.js` → TaskNode
- `../../../infrastructure/common/EventBus.js` → EventBus

### packages\core\src\execution\runtime\dag\DependencyResolver.ts
- `./TaskNode.js` → TaskNode
- `./TaskGraph.js` → TaskGraph

### packages\core\src\execution\runtime\dag\ParallelExecutor.ts
- `./TaskNode.js` → TaskNode, TaskExecutionResult

### packages\core\src\execution\runtime\dag\Scheduler.ts
- `./TaskNode.js` → TaskNode
- `./TaskGraph.js` → TaskGraph
- `./DependencyResolver.js` → DependencyResolver

### packages\core\src\execution\runtime\dag\StepAgentExecutor.ts
- `../../../infrastructure/adapters/agent-spawner.js` → agentSpawner
- `../../../infrastructure/tools/primitiveAgentTools.js` → createPrimitiveAgentTools, createPrimitiveBeforeToolCall
- `../../../infrastructure/adapters/pi-bridge/index.js` → AgentTool
- `node:path` → *
- `node:fs` → *
- `../../orchestration/AgentSessionStore.js` → AgentSessionStore, AgentSessionHandle
- `../../../gate/context.js` → KnowledgeContextPackage
- `../../../infrastructure/common/EventBus.js` → EventBus

### packages\core\src\execution\runtime\dag\TaskGraph.ts
- `./types.js` → DAGEdge, DAGStatus, ExecutionDAG
- `./TaskNode.js` → TaskNode

### packages\core\src\execution\runtime\dag\TaskNode.ts
- `./types.js` → DAGNode, DAGNodeStatus

### packages\core\src\execution\runtime\dag\index.ts
- （无 import）
### packages\core\src\execution\runtime\dag\types.ts
- （无 import）
### packages\core\src\execution\runtime\index.ts
- （无 import）
### packages\core\src\execution\runtime\mission\MissionController.ts
- `../../../infrastructure/common/EventBus.js` → EventBus
- `../../../infrastructure/protocol/events/EventType.js` → EventType
- `./MissionTypes.js` → MissionState, MissionStatus, MissionUpdate, BlockReason
- `../../../knowledge/graph/SystemMetadataGraph.js` → systemMetadataGraph
- `../../../infrastructure/protocol/events/store/IEventStore.js` → IEventStore

### packages\core\src\execution\runtime\mission\MissionRuntime.ts
- `../../../infrastructure/common/EventBus.js` → EventBus
- `../../../infrastructure/protocol/events/EventType.js` → EventType
- `../../../infrastructure/protocol/message-types.js` → IncomingMessage
- `./types.js` → MissionState, MISSION_VALID_TRANSITIONS
- `./types.js` → Mission, MissionPlan, MissionResult, MissionPermissions, MissionStateTransitionEvent
- `../verification/VerificationEngine.js` → VerificationEngine
- `../approval/ApprovalEngine.js` → ApprovalEngine
- `../../../infrastructure/protocol/events/store/IEventStore.js` → IEventStore
- `../../../infrastructure/protocol/events/store/EventProjection.js` → EventProjection

### packages\core\src\execution\runtime\mission\MissionTypes.ts
- （无 import）
### packages\core\src\execution\runtime\mission\adapters\DAGExecutorAdapter.ts
- `../MissionRuntime.js` → MissionExecutor
- `../types.js` → Mission, MissionPlan, MissionResult
- `../types.js` → MissionState

### packages\core\src\execution\runtime\mission\adapters\MetaPlannerAdapter.ts
- `../MissionRuntime.js` → MissionPlanner
- `../types.js` → Mission, MissionPlan

### packages\core\src\execution\runtime\mission\adapters\index.ts
- （无 import）
### packages\core\src\execution\runtime\mission\index.ts
- （无 import）
### packages\core\src\execution\runtime\mission\types.ts
- （无 import）
### packages\core\src\execution\runtime\sandbox\SandboxManager.ts
- `node:child_process` → execFile, ExecFileOptions

### packages\core\src\execution\runtime\sandbox\index.ts
- （无 import）
### packages\core\src\execution\runtime\sandbox\types.ts
- （无 import）
### packages\core\src\execution\runtime\simulation\ExecutionSimulator.ts
- （无 import）
### packages\core\src\execution\runtime\simulation\index.ts
- （无 import）
### packages\core\src\execution\runtime\state-machine\ExecutionFSM.ts
- `node:fs` → *
- `node:path` → *

### packages\core\src\execution\runtime\state-machine\index.ts
- （无 import）
### packages\core\src\execution\runtime\verification\VerificationEngine.ts
- `../mission/types.js` → Mission, MissionPlan, MissionResult
- `./types.js` → VerificationResult, VerificationCheck, VerificationIssue, VerificationEngineConfig

### packages\core\src\execution\runtime\verification\index.ts
- （无 import）
### packages\core\src\execution\runtime\verification\types.ts
- （无 import）
### packages\core\src\execution\types.ts
- `../governance/control-plane/department-types.js` → DepartmentId

### packages\core\src\facade\CompanyFacade.ts
- `../governance/control-plane/DepartmentManager.js` → DepartmentManager
- `../governance/control-plane/RoleRegistry.js` → RoleRegistry
- `../governance/control-plane/department-types.js` → Department, DepartmentStats
- `../governance/control-plane/department-types.js` → CreateDepartmentParams
- `../infrastructure/protocol/contracts/goal.js` → GoalContext
- `../execution/runtime/MorPexRuntime.js` → MorPexRuntime, RunOptions
- `../governance/control-plane/ControlPlane.js` → ControlPlane
- `../infrastructure/observability/deblackbox/DeblackboxRecorder.js` → getSharedDeblackboxRecorder
- `../cognition/planning/goal-intelligence/IntentClassifier.js` → IntentClassifier

### packages\core\src\facade\gateway\ExecutionGateway.ts
- `../../infrastructure/common/types.js` → AgentRuntimeAdapter, ExecutionRequest, ExecutionResult, RuntimeHealth, MorPexEvent
- `../../infrastructure/common/EventBus.js` → EventBus
- `../../infrastructure/common/ExecutionIdentity.js` → ExecutionIdentity

### packages\core\src\facade\gateway\adapters\PiAdapter.ts
- `../../../infrastructure/common/types.js` → AgentRuntimeAdapter, ExecutionRequest, ExecutionResult, RuntimeHealth, MorPexEvent, EventHandler
- `../../../infrastructure/common/EventBus.js` → EventBus
- `../../../infrastructure/common/ExecutionIdentity.js` → ExecutionIdentity
- `../../../infrastructure/common/types.js` → PiAdapterConfig

### packages\core\src\facade\index.ts
- （无 import）
### packages\core\src\gate\ForcedQueryGuard.ts
- `./types.js` → QueryTrace

### packages\core\src\gate\context.ts
- `./types.js` → RiskTier

### packages\core\src\gate\index.ts
- （无 import）
### packages\core\src\gate\modelVisibleLog.ts
- `../knowledge/context/ContextPersistence.js` → ContextPersistence
- `../infrastructure/observability/deblackbox/DeblackboxRecorder.js` → DeblackboxRecorder

### packages\core\src\gate\ontologyEvents.ts
- `../infrastructure/protocol/events/BaseEvent.js` → BaseEvent

### packages\core\src\gate\rules\DetectorRegistry.ts
- `./detectors.js` → RuleDetector

### packages\core\src\gate\rules\RuleEnforcementGuard.ts
- `../types.js` → OntologyProposal
- `./types.js` → RuleCheckResult, RuleEntity, RuleViolation
- `./detectors.js` → detectorRegistry
- `./DetectorRegistry.js` → DetectorRegistry

### packages\core\src\gate\rules\RuleExtractor.ts
- `./types.js` → RuleEntity

### packages\core\src\gate\rules\RuleRegistry.ts
- `./types.js` → RuleEntity, RuleStatus

### packages\core\src\gate\rules\detectors.ts
- `../types.js` → OntologyProposal
- `./types.js` → RuleEntity, RuleTarget, RuleType, RuleViolation
- `./normalize.js` → normalizePattern, normalizeText

### packages\core\src\gate\rules\index.ts
- （无 import）
### packages\core\src\gate\rules\lexicalCorrection.ts
- `../types.js` → OntologyProposal
- `./types.js` → RuleEntity, RuleViolation

### packages\core\src\gate\rules\normalize.ts
- （无 import）
### packages\core\src\gate\rules\ruleEvents.ts
- `../../infrastructure/protocol/events/BaseEvent.js` → BaseEvent

### packages\core\src\gate\rules\rulePersistence.ts
- `./RuleRegistry.js` → RuleRegistry
- `./types.js` → RuleEntity

### packages\core\src\gate\rules\structuralCorrection.ts
- `../types.js` → OntologyProposal
- `./types.js` → RuleEntity, RuleViolation

### packages\core\src\gate\rules\types.ts
- （无 import）
### packages\core\src\gate\runOntologyGroundedReasoning.ts
- `../knowledge/ontology/OntologyService.js` → OntologyService
- `./ForcedQueryGuard.js` → ForcedQueryGuard
- `./types.js` → OntologyProposal, RiskTier
- `../infrastructure/tools/ontologyTools.js` → createOntologyToolExecutor
- `../knowledge/ontology/prompts/forced-query-system.js` → FORCED_QUERY_SYSTEM_PROMPT, buildReasoningUserPrompt
- `../infrastructure/protocol/events/store/IEventStore.js` → IEventStore
- `./ontologyEvents.js` → createReferenceValidationFailedEvent, createQueryMissEvent
- `./rules/RuleRegistry.js` → RuleRegistry
- `./rules/RuleEnforcementGuard.js` → ruleEnforcementCheck
- `./rules/detectors.js` → extractTargetText
- `./rules/lexicalCorrection.js` → lexicalCorrect
- `./rules/structuralCorrection.js` → applyStructuralCorrection
- `./rules/ruleEvents.js` → createRuleViolationEvent, createRuleDowngradedEvent
- `./rules/ruleEvents.js` → RuleDowngradedEvent
- `../infrastructure/common/resilience/RetryPolicy.js` → RetryPolicy
- `../infrastructure/observability/deblackbox/DeblackboxRecorder.js` → getSharedDeblackboxRecorder
- `./rules/types.js` → RuleEntity, RuleViolation

### packages\core\src\gate\types.ts
- （无 import）
### packages\core\src\governance\AlertEngine.ts
- `../infrastructure/common/EventBus.js` → EventBus

### packages\core\src\governance\AnomalyDetector.ts
- `../infrastructure/common/EventBus.js` → EventBus

### packages\core\src\governance\ApprovalGate.ts
- `../infrastructure/common/EventBus.js` → EventBus
- `../infrastructure/protocol/events/EventType.js` → EventType
- `../execution/DecisionStore.js` → recordDecision, resolveDecision
- `./ComplianceChecker.js` → ComplianceResult

### packages\core\src\governance\AuditTrail.ts
- `./types.js` → AuditEntry, AuditEventType, AuditReport, RiskLevel
- `./types.js` → DEFAULT_GOVERNANCE_CONFIG

### packages\core\src\governance\ComplianceChecker.ts
- `./PolicyRuleRegistry.js` → PolicyRuleRegistry

### packages\core\src\governance\CostController.ts
- `../infrastructure/common/EventBus.js` → EventBus

### packages\core\src\governance\GovernanceDashboard.ts
- `../infrastructure/common/EventBus.js` → EventBus

### packages\core\src\governance\PermissionModel.ts
- `./types.js` → RiskLevel

### packages\core\src\governance\PolicyEngine.ts
- `./types.js` → RiskAssessment, RiskLevel
- `./AuditTrail.js` → AuditTrail

### packages\core\src\governance\PolicyRuleRegistry.ts
- （无 import）
### packages\core\src\governance\RiskAnalyzer.ts
- `./types.js` → RiskAssessment, RiskFactor, RiskLevel, GovernanceConfig
- `../execution/runtime/mission/types.js` → Mission, MissionPlan, PlanStep
- `./types.js` → DEFAULT_GOVERNANCE_CONFIG

### packages\core\src\governance\RuntimeManager.ts
- `../infrastructure/common/EventBus.js` → EventBus

### packages\core\src\governance\capability\AgentCapabilityRegistry.ts
- （无 import）
### packages\core\src\governance\capability\CapabilityDiscoverer.ts
- `./CapabilityRegistry.js` → CapabilityRegistry
- `./CapabilityRegistry.js` → Capability

### packages\core\src\governance\capability\CapabilityRegistry.ts
- （无 import）
### packages\core\src\governance\capability\index.ts
- （无 import）
### packages\core\src\governance\control-plane\AgentController.ts
- `../../governance/capability/AgentCapabilityRegistry.js` → AgentCapabilityRegistry, AgentDeclaration
- `../../governance/capability/CapabilityRegistry.js` → CapabilityRegistry

### packages\core\src\governance\control-plane\ControlPlane.ts
- `./GoalController.js` → GoalController, GoalCheckResult
- `./PolicyController.js` → PolicyController, PolicyCheckResult
- `./ResourceController.js` → ResourceController, ResourceAvailability
- `./AgentController.js` → AgentController
- `../../governance/capability/CapabilityRegistry.js` → CapabilityRegistry

### packages\core\src\governance\control-plane\DepartmentContext.ts
- `./department-types.js` → DepartmentId

### packages\core\src\governance\control-plane\DepartmentManager.ts
- `../../infrastructure/common/EventBus.js` → EventBus
- `./department-types.js` → Department, DepartmentId, DepartmentStatus, CreateDepartmentParams, DepartmentStats

### packages\core\src\governance\control-plane\GoalController.ts
- `../../cognition/index.js` → GoalIntelligenceFacade
- `../../governance/RiskAnalyzer.js` → RiskAnalyzer
- `../../infrastructure/protocol/contracts/goal.js` → GoalContext
- `../../governance/types.js` → RiskLevel, RiskAssessment

### packages\core\src\governance\control-plane\PolicyController.ts
- `../../governance/ApprovalGate.js` → ApprovalPolicyRegistry, ApprovalAction, RiskLevel, ApprovalPolicy
- `../../governance/CostController.js` → CostController

### packages\core\src\governance\control-plane\ResourceController.ts
- `../../governance/CostController.js` → CostController
- `../../governance/RuntimeManager.js` → RuntimeManager

### packages\core\src\governance\control-plane\RoleRegistry.ts
- `../../infrastructure/common/EventBus.js` → EventBus
- `./types.js` → Role, RoleId, RoleName, RoleAssignment

### packages\core\src\governance\control-plane\SpaceService.ts
- `../../infrastructure/common/EventBus.js` → EventBus
- `../../workflow/WorkflowProvider.js` → WorkflowRegistry
- `../../workflow/WorkflowProvider.js` → WorkflowProvider
- `./space-types.js` → Space, SpaceId, SpaceTree, SpaceAliasMap
- `node:fs` → *
- `node:path` → *

### packages\core\src\governance\control-plane\department-types.ts
- （无 import）
### packages\core\src\governance\control-plane\index.ts
- （无 import）
### packages\core\src\governance\control-plane\space-types.ts
- （无 import）
### packages\core\src\governance\control-plane\types.ts
- （无 import）
### packages\core\src\governance\index.ts
- （无 import）
### packages\core\src\governance\types.ts
- （无 import）
### packages\core\src\infrastructure\adapters\agent-spawner.ts
- `./pi-bridge/index.js` → AgentTool
- `./pi-bridge/index.js` → getSharedPiBridge

### packages\core\src\infrastructure\adapters\embedding\EmbeddingProvider.ts
- （无 import）
### packages\core\src\infrastructure\adapters\identity.ts
- （无 import）
### packages\core\src\infrastructure\adapters\index.ts
- （无 import）
### packages\core\src\infrastructure\adapters\memory\index.ts
- `../../../../../memory/src/index.js` → _MemoryWiki
- `../../../../../memory/src/index.js` → _MemoryRetriever

### packages\core\src\infrastructure\adapters\model-registry.ts
- `@earendil-works/pi-ai/compat` → getModels, getProviders
- `./pi-bridge/index.js` → resolveDefaultModel, DEFAULT_MODEL
- `./pi-bridge/yamlConfig.js` → loadMorpexConfig, getEnabledExtraLlms

### packages\core\src\infrastructure\adapters\model-resolver.ts
- `@earendil-works/pi-ai/compat` → getModel, getProviders
- `./pi-bridge/index.js` → resolveDefaultModel
- `./pi-bridge/yamlConfig.js` → loadMorpexConfig, getEnabledExtraLlms

### packages\core\src\infrastructure\adapters\pi-agent-core.d.ts
- （无 import）
### packages\core\src\infrastructure\adapters\pi-ai-types.ts
- `@earendil-works/pi-ai` → Type
- `@earendil-works/pi-ai` → Static, TSchema

### packages\core\src\infrastructure\adapters\pi-augmentations.ts
- （无 import）
### packages\core\src\infrastructure\adapters\pi-bridge\PiBridge.ts
- `./yamlConfig.js` → loadMorpexConfig, getEnabledExtraLlms, LlmGatewayConfig
- `../../observability/deblackbox/DeblackboxRecorder.js` → getSharedDeblackboxRecorder
- `@earendil-works/pi-agent-core` → _AgentHarness, _InMemorySessionRepo, _JsonlSessionRepo, _uuidv7
- `@earendil-works/pi-agent-core/node` → _NodeExecutionEnv
- `@earendil-works/pi-agent-core` → _AgentTool, _AgentToolResult, _AgentMessage, _AgentEvent, _Session, _ExecutionEnv, _AgentHarnessType
- `@earendil-works/pi-ai` → _clampThinkingLevel
- `@earendil-works/pi-ai` → _getSupportedThinkingLevels

### packages\core\src\infrastructure\adapters\pi-bridge\index.ts
- （无 import）
### packages\core\src\infrastructure\adapters\pi-bridge\yamlConfig.ts
- `node:fs` → readFileSync
- `node:path` → resolve
- `node:child_process` → execSync

### packages\core\src\infrastructure\adapters\pi-types.ts
- `./pi-bridge/index.js` → _PiAgentTool, _PiAgentToolResult, _PiAgentMessage, _PiAgentEvent, _PiExecutionEnv, _PiAgentHarness
- `@earendil-works/pi-agent-core` → _PiSession
- `@earendil-works/pi-ai` → _PiThinkingLevel

### packages\core\src\infrastructure\adapters\pi-utils.ts
- `./pi-bridge/index.js` → PiBridge
- `@earendil-works/pi-ai/compat` → _piType
- `@earendil-works/pi-ai/compat` → _piParseJsonWithRepair
- `@earendil-works/pi-ai/compat` → _piGetModel

### packages\core\src\infrastructure\adapters\thinking-level.ts
- `./pi-bridge/index.js` → PiBridge, resolveDefaultModel

### packages\core\src\infrastructure\common\EncryptionService.ts
- `node:crypto` → *

### packages\core\src\infrastructure\common\EventBus.ts
- `../../../config/MorPexConfig.js` → config
- `./types.js` → MorPexEvent, EventHandler
- `./eventContract.js` → EventContractMap, ReconcileReport
- `./eventContract.js` → validateEventPayload, reconcileKnownEvents
- `node:async_hooks` → AsyncLocalStorage

### packages\core\src\infrastructure\common\ExecutionIdentity.ts
- `../../infrastructure/adapters/identity.js` → generateShortUUID
- `./types.js` → ExecutionIdentityType

### packages\core\src\infrastructure\common\ModelRegistry.ts
- `../../infrastructure/adapters/model-registry.js` → piModelRegistry
- `../../infrastructure/adapters/model-registry.js` → ModelInfo, ProviderInfo

### packages\core\src\infrastructure\common\PluginSystem.ts
- `./types.js` → MorPexPlugin, PluginContext, EventBus
- `./ExecutionIdentity.js` → ExecutionIdentity
- `../../infrastructure/utils/toposort.js` → tsort

### packages\core\src\infrastructure\common\ProgressCallback.ts
- （无 import）
### packages\core\src\infrastructure\common\ThinkingLevelControl.ts
- `../../infrastructure/adapters/thinking-level.js` → thinkingLevelControl
- `../../infrastructure/adapters/thinking-level.js` → ThinkingLevel

### packages\core\src\infrastructure\common\ToolQualityTracker.ts
- （无 import）
### packages\core\src\infrastructure\common\contracts\eventContractCatalog.ts
- `../eventContract.js` → defineContract, buildContractMap
- `../eventContract.js` → EventContract, EventContractMap, ReconcileReport
- `../EventBus.js` → EventBus
- `../../protocol/events/EventType.js` → EventType

### packages\core\src\infrastructure\common\eventContract.ts
- `../../infrastructure/protocol/events/EventType.js` → getAllEventTypes

### packages\core\src\infrastructure\common\resilience\CircuitBreaker.ts
- （无 import）
### packages\core\src\infrastructure\common\resilience\ErrorHandlerService.ts
- `./RetryPolicy.js` → RetryPolicy
- `./CircuitBreaker.js` → CircuitBreaker

### packages\core\src\infrastructure\common\resilience\RetryPolicy.ts
- （无 import）
### packages\core\src\infrastructure\common\resilience\index.ts
- （无 import）
### packages\core\src\infrastructure\common\secureExec.ts
- `node:child_process` → spawn
- `node:crypto` → randomBytes
- `node:fs/promises` → chmod, mkdtemp, open, rm
- `node:os` → tmpdir
- `node:path` → *

### packages\core\src\infrastructure\common\types.ts
- （无 import）
### packages\core\src\infrastructure\observability\CompactionService.ts
- `better-sqlite3` → Database
- `node:fs` → *

### packages\core\src\infrastructure\observability\HealthCheckService.ts
- （无 import）
### packages\core\src\infrastructure\observability\MetricsCollector.ts
- （无 import）
### packages\core\src\infrastructure\observability\ObservabilityBootstrap.ts
- `./PrometheusExporter.js` → PrometheusExporter
- `./HealthCheckService.js` → HealthCheckService
- `./MetricsCollector.js` → MetricsCollector

### packages\core\src\infrastructure\observability\PrometheusExporter.ts
- `./MetricsCollector.js` → MetricsCollector, V9Metrics
- `node:process` → *

### packages\core\src\infrastructure\observability\TraceManager.ts
- （无 import）
### packages\core\src\infrastructure\observability\WorkflowMetrics.ts
- （无 import）
### packages\core\src\infrastructure\observability\deblackbox\DeblackboxDetailStore.ts
- `better-sqlite3` → Database

### packages\core\src\infrastructure\observability\deblackbox\DeblackboxRecorder.ts
- `../../protocol/events/BaseEvent.js` → BaseEvent
- `../../protocol/events/DecisionEvent.js` → createDecisionEvent, DecisionEvent
- `../../protocol/events/store/IEventStore.js` → IEventStore
- `./DeblackboxDetailStore.js` → DeblackboxDetailStore, DeblackboxDetailRecord
- `./RecordPolicy.js` → RecordPolicy, DeblackboxLevel

### packages\core\src\infrastructure\observability\deblackbox\RecordCleaner.ts
- `./DeblackboxDetailStore.js` → DeblackboxDetailStore
- `./RecordPolicy.js` → RecordPolicy

### packages\core\src\infrastructure\observability\deblackbox\RecordPolicy.ts
- （无 import）
### packages\core\src\infrastructure\observability\deblackbox\index.ts
- （无 import）
### packages\core\src\infrastructure\observability\index.ts
- （无 import）
### packages\core\src\infrastructure\protocol\contracts\artifact-lifecycle.ts
- （无 import）
### packages\core\src\infrastructure\protocol\contracts\goal.ts
- `../../../cognition/planning/goal-intelligence/IntentClassifier.js` → IntentKind

### packages\core\src\infrastructure\protocol\events\BaseEvent.ts
- `./EventType.js` → EventType

### packages\core\src\infrastructure\protocol\events\DecisionEvent.ts
- `./EventType.js` → EventType

### packages\core\src\infrastructure\protocol\events\EventType.ts
- （无 import）
### packages\core\src\infrastructure\protocol\events\EventTypes.ts
- （无 import）
### packages\core\src\infrastructure\protocol\events\index.ts
- （无 import）
### packages\core\src\infrastructure\protocol\events\store\EventProjection.ts
- `../BaseEvent.js` → BaseEvent
- `../EventType.js` → EventType

### packages\core\src\infrastructure\protocol\events\store\EventRepository.ts
- `./IEventStore.js` → IEventStore
- `../EventType.js` → EventType
- `../BaseEvent.js` → BaseEvent

### packages\core\src\infrastructure\protocol\events\store\IEventStore.ts
- `../BaseEvent.js` → BaseEvent
- `../DecisionEvent.js` → DecisionEvent

### packages\core\src\infrastructure\protocol\events\store\SqliteEventStore.ts
- `better-sqlite3` → Database
- `../BaseEvent.js` → BaseEvent
- `../DecisionEvent.js` → DecisionEvent
- `./IEventStore.js` → EventQueryFilter, EventStoreStats, IEventStore
- `../../../../infrastructure/observability/CompactionService.js` → CompactionService
- `../../../../infrastructure/observability/CompactionService.js` → CompactionConfig

### packages\core\src\infrastructure\protocol\events\store\UnifiedEventStore.ts
- `../BaseEvent.js` → BaseEvent
- `../DecisionEvent.js` → DecisionEvent
- `./IEventStore.js` → EventQueryFilter, EventStoreStats, IEventStore
- `./SqliteEventStore.js` → SqliteEventStore, createSqliteEventStore

### packages\core\src\infrastructure\protocol\events\store\index.ts
- （无 import）
### packages\core\src\infrastructure\protocol\index.ts
- （无 import）
### packages\core\src\infrastructure\protocol\message-gateway.ts
- `../../infrastructure/common/EventBus.js` → EventBus
- `./events/EventType.js` → EventType
- `./events/BaseEvent.js` → BaseEvent
- `./message-types.js` → IncomingMessage, OutgoingMessage, ChannelAdapter, SessionInfo

### packages\core\src\infrastructure\protocol\message-types.ts
- （无 import）
### packages\core\src\infrastructure\tools\DomainPrimitiveRegistry.ts
- `./primitives/types.js` → ActionPrimitive, ActionResult

### packages\core\src\infrastructure\tools\ForkExecuteTool.ts
- `../../infrastructure/adapters/pi-types.js` → AgentTool, _AgentToolResult
- `../../infrastructure/adapters/pi-ai-types.js` → Type, optionalProp
- `./ToolExecutionProxy.js` → ToolExecutionProxy

### packages\core\src\infrastructure\tools\ReadArtifactTool.ts
- `../../infrastructure/adapters/pi-types.js` → AgentTool, _AgentToolResult
- `../../infrastructure/adapters/pi-ai-types.js` → Type, optionalProp
- `../../knowledge/artifact/registry/ArtifactRegistry.js` → ArtifactRegistry
- `../../knowledge/artifact/registry/types.js` → ArtifactInstance

### packages\core\src\infrastructure\tools\TeamSayTool.ts
- `../../infrastructure/adapters/pi-types.js` → AgentTool, _AgentToolResult
- `../../infrastructure/adapters/pi-ai-types.js` → Type

### packages\core\src\infrastructure\tools\ToolExecutionProxy.ts
- `worker_threads` → Worker
- `../../../config/MorPexConfig.js` → config
- `../../infrastructure/adapters/pi-types.js` → _AgentToolResult

### packages\core\src\infrastructure\tools\ToolFactory.ts
- `../../infrastructure/common/EventBus.js` → EventBus
- `./ToolRegistry.js` → ToolRegistry
- `./ToolRegistry.js` → ToolSchema, RegisteredTool

### packages\core\src\infrastructure\tools\ToolRegistry.ts
- `../../infrastructure/common/EventBus.js` → EventBus

### packages\core\src\infrastructure\tools\index.ts
- （无 import）
### packages\core\src\infrastructure\tools\memory-search-tool.ts
- `../../infrastructure/adapters/pi-ai-types.js` → Type
- `../../infrastructure/adapters/pi-types.js` → AgentTool
- `../../../../memory/src/index.js` → MemoryRetriever

### packages\core\src\infrastructure\tools\ontologyTools.ts
- `../../knowledge/memory/CompanyKnowledge.js` → queryCompanyKnowledge
- `../../knowledge/ontology/OntologyService.js` → OntologyService
- `../../gate/ForcedQueryGuard.js` → ForcedQueryGuard

### packages\core\src\infrastructure\tools\paramCompleter.ts
- （无 import）
### packages\core\src\infrastructure\tools\primitiveAgentTools.ts
- `../adapters/pi-bridge/index.js` → AgentTool, AgentToolResult
- `./DomainPrimitiveRegistry.js` → DomainPrimitiveRegistry
- `../../gate/context.js` → KnowledgeContextPackage
- `../../execution/UserAskService.js` → createAskUserTool, setAskEventBus
- `../../execution/AgentMailbox.js` → getMailbox

### packages\core\src\infrastructure\tools\primitives\APICallPrimitive.ts
- `./types.js` → ActionPrimitive, ActionResult, APICallRequest
- `./gateBinding.js` → PrimitiveGate
- `../../../gate/context.js` → KnowledgeContextPackage

### packages\core\src\infrastructure\tools\primitives\ArtifactGenerationPrimitive.ts
- `./types.js` → ActionPrimitive, ActionResult, ArtifactGenerationRequest, ArtifactGenerationResult
- `../../../gate/ForcedQueryGuard.js` → ForcedQueryGuard
- `../../../gate/runOntologyGroundedReasoning.js` → runOntologyGroundedReasoning
- `../../../gate/context.js` → KnowledgeContextPackage
- `../../../knowledge/ontology/OntologyService.js` → OntologyService
- `../../../knowledge/graph/SystemMetadataGraph.js` → systemMetadataGraph
- `../../../knowledge/ontology/ObjectTypeRegistry.js` → ObjectTypeRegistry
- `../../../infrastructure/protocol/events/store/IEventStore.js` → IEventStore

### packages\core\src\infrastructure\tools\primitives\FileOperationPrimitive.ts
- `./types.js` → ActionPrimitive, ActionResult, FileOperationRequest
- `./gateBinding.js` → PrimitiveGate
- `../../../gate/context.js` → KnowledgeContextPackage

### packages\core\src\infrastructure\tools\primitives\KnowledgeQueryPrimitive.ts
- `./types.js` → ActionPrimitive, ActionResult, KnowledgeQuery, KnowledgeQueryResult
- `../../../gate/ForcedQueryGuard.js` → ForcedQueryGuard
- `../../../gate/runOntologyGroundedReasoning.js` → runOntologyGroundedReasoning
- `../../../knowledge/ontology/OntologyService.js` → OntologyService
- `../../../knowledge/graph/SystemMetadataGraph.js` → systemMetadataGraph
- `../../../knowledge/ontology/ObjectTypeRegistry.js` → ObjectTypeRegistry
- `../../../infrastructure/protocol/events/store/IEventStore.js` → IEventStore

### packages\core\src\infrastructure\tools\primitives\ShellExecutionPrimitive.ts
- `./types.js` → ActionPrimitive, ActionResult, ShellExecutionRequest
- `./gateBinding.js` → PrimitiveGate
- `../../../gate/context.js` → KnowledgeContextPackage
- `../../common/secureExec.js` → scrubEnv

### packages\core\src\infrastructure\tools\primitives\gateBinding.ts
- `../../../gate/context.js` → GateContextRequiredError, requireKnowledgeContext, KnowledgeContextPackage
- `../../observability/deblackbox/DeblackboxRecorder.js` → getSharedDeblackboxRecorder

### packages\core\src\infrastructure\tools\primitives\index.ts
- （无 import）
### packages\core\src\infrastructure\tools\primitives\types.ts
- `../../../gate/context.js` → KnowledgeContextPackage

### packages\core\src\infrastructure\utils\AsyncResourceLocker.ts
- （无 import）
### packages\core\src\infrastructure\utils\extractJson.ts
- （无 import）
### packages\core\src\infrastructure\utils\jsonl.ts
- （无 import）
### packages\core\src\infrastructure\utils\toposort.ts
- （无 import）
### packages\core\src\knowledge\artifact\ArtifactBlueprint.ts
- （无 import）
### packages\core\src\knowledge\artifact\ArtifactFacade.ts
- `../../infrastructure/common/EventBus.js` → EventBus
- `../../infrastructure/protocol/events/EventType.js` → EventType
- `../../infrastructure/protocol/contracts/artifact-lifecycle.js` → ArtifactNode, ArtifactLineageEntry
- `../../infrastructure/protocol/contracts/artifact-lifecycle.js` → ArtifactStatus
- `../../knowledge/graph/SystemMetadataGraph.js` → systemMetadataGraph
- `../../infrastructure/protocol/events/store/IEventStore.js` → IEventStore
- `node:fs` → *
- `node:path` → *

### packages\core\src\knowledge\artifact\index.ts
- （无 import）
### packages\core\src\knowledge\artifact\registry\ArtifactDependencyResolver.ts
- `./types.js` → ArtifactNode, ArtifactDependency, ArtifactEdge
- `./ArtifactGraph.js` → ArtifactGraph

### packages\core\src\knowledge\artifact\registry\ArtifactEmbedding.ts
- `./types.js` → ArtifactNode, ArtifactEmbeddingType

### packages\core\src\knowledge\artifact\registry\ArtifactEvaluator.ts
- `./types.js` → ArtifactNode, ArtifactEvaluation, ArtifactCapability

### packages\core\src\knowledge\artifact\registry\ArtifactGraph.ts
- `./types.js` → ArtifactNode, ArtifactEdge

### packages\core\src\knowledge\artifact\registry\ArtifactLineage.ts
- `./types.js` → ArtifactNode, ArtifactEdge, LineageQuery, LineagePath
- `./ArtifactGraph.js` → ArtifactGraph

### packages\core\src\knowledge\artifact\registry\ArtifactRegistry.ts
- `fs` → *
- `path` → *
- `./types.js` → ArtifactInstance, ArtifactType, ArtifactStatus, ArtifactQuery, ArtifactRelation, ArtifactRelationRecord, ArtifactVersion, ArtifactPluginConfig
- `./ArtifactVersion.js` → createVersionSnapshot
- `../../../gate/context.js` → requireKnowledgeContext, TierWriteGuard, KnowledgeAuthorityTier, KnowledgeContextPackage
- `../../../infrastructure/common/ExecutionIdentity.js` → ExecutionIdentity
- `../../../infrastructure/utils/AsyncResourceLocker.js` → AsyncResourceLocker, VersionConflictError

### packages\core\src\knowledge\artifact\registry\ArtifactVersion.ts
- `./types.js` → ArtifactVersion, ArtifactInstance
- `../../../infrastructure/common/ExecutionIdentity.js` → ExecutionIdentity

### packages\core\src\knowledge\artifact\registry\index.ts
- （无 import）
### packages\core\src\knowledge\artifact\registry\types.ts
- （无 import）
### packages\core\src\knowledge\context\ContextArchive.ts
- `../../infrastructure/protocol/events/store/IEventStore.js` → IEventStore
- `./ContextBuilder.js` → ExecutionContext

### packages\core\src\knowledge\context\ContextAssemblyEngine.ts
- `./ContextFragmentRegistry.js` → FragmentSource, ContextAssemblyInput, ContextFragment
- `./ContextBuilder.js` → ExecutionContext, RecentSummaryReader, RiskGrader, RiskLevel
- `./ContextFragmentRegistry.js` → ContextFragmentRegistry
- `./ContextBuilder.js` → ContextBuilder
- `./ContextVersioner.js` → ContextVersioner
- `./ContextTemplateRepository.js` → ContextTemplateRepository
- `./ContextEnricher.js` → ContextEnricherPipeline
- `./ContextPersistence.js` → ContextPersistence
- `../../infrastructure/common/EventBus.js` → EventBus
- `../../infrastructure/observability/deblackbox/DeblackboxRecorder.js` → getSharedDeblackboxRecorder
- `../../gate/modelVisibleLog.js` → assertModelVisibleLogged, createContextPackageEntry, createDeblackboxEntry, contextPersistenceResolver, deblackboxResolver

### packages\core\src\knowledge\context\ContextBuilder.ts
- `./ContextFragmentRegistry.js` → ContextFragment

### packages\core\src\knowledge\context\ContextEnricher.ts
- `./ContextBuilder.js` → ExecutionContext

### packages\core\src\knowledge\context\ContextFragmentRegistry.ts
- （无 import）
### packages\core\src\knowledge\context\ContextPersistence.ts
- `better-sqlite3` → Database
- `./ContextBuilder.js` → ExecutionContext, ContextLayer

### packages\core\src\knowledge\context\ContextTemplateRepository.ts
- `./ContextFragmentRegistry.js` → FragmentSource

### packages\core\src\knowledge\context\ContextVersioner.ts
- `./ContextBuilder.js` → ExecutionContext
- `./ContextPersistence.js` → ContextPersistence

### packages\core\src\knowledge\context\index.ts
- （无 import）
### packages\core\src\knowledge\context\providers\realProviders.ts
- `../../ontology/OntologyService.js` → OntologyService
- `../ContextFragmentRegistry.js` → ContextAssemblyInput, ContextFragment, FragmentProvider

### packages\core\src\knowledge\context\retrieval\ContextDistiller.ts
- （无 import）
### packages\core\src\knowledge\context\retrieval\ContextRetriever.ts
- `../../../evolution/LearningEventDetector.js` → LearningEvent
- `../../../evolution/PromptStrategyRegistry.js` → AppliedStrategy
- `./ContextDistiller.js` → ContextDistiller
- `./SparseRetriever.js` → SparseRetriever

### packages\core\src\knowledge\context\retrieval\Reranker.ts
- `node:crypto` → createHash

### packages\core\src\knowledge\context\retrieval\SparseRetriever.ts
- （无 import）
### packages\core\src\knowledge\context\retrieval\index.ts
- （无 import）
### packages\core\src\knowledge\graph\SystemMetadataGraph.ts
- `../../infrastructure/protocol/events/store/IEventStore.js` → IEventStore
- `../../infrastructure/protocol/events/EventType.js` → EventType
- `../../infrastructure/protocol/events/BaseEvent.js` → BaseEvent
- `node:fs` → *
- `node:path` → *

### packages\core\src\knowledge\graph\index.ts
- （无 import）
### packages\core\src\knowledge\graph\knowledge\KnowledgeGraph.ts
- `node:fs` → *
- `node:path` → *
- `node:crypto` → *
- `better-sqlite3` → Database

### packages\core\src\knowledge\graph\knowledge\types.ts
- （无 import）
### packages\core\src\knowledge\memory\CompanyKnowledge.ts
- `../../infrastructure/adapters/memory/index.js` → MemoryApi, MemoryQueryRequest, MemoryQueryResult

### packages\core\src\knowledge\memory\MemoryActivationEngine.ts
- `./types.js` → MemoryRecord

### packages\core\src\knowledge\memory\MemoryApiBus.ts
- `../../infrastructure/adapters/memory/index.js` → MemoryApi, MemoryHit
- `../../infrastructure/observability/deblackbox/DeblackboxRecorder.js` → getSharedDeblackboxRecorder
- `./MemoryHooks.js` → MemoryBus
- `./MemoryActivationEngine.js` → MemoryActivationSource
- `./types.js` → MemoryRecord

### packages\core\src\knowledge\memory\MemoryHooks.ts
- `../../infrastructure/adapters/pi-types.js` → AgentEvent, AgentMessage
- `../../infrastructure/common/types.js` → EventBus, MorPexEvent
- `./MemoryActivationEngine.js` → MemoryActivationEngine, ActivationContext

### packages\core\src\knowledge\memory\MemoryMessages.ts
- `../../infrastructure/adapters/pi-types.js` → AgentMessage
- `../../infrastructure/adapters/pi-augmentations.js` → (default)

### packages\core\src\knowledge\memory\activationRegistry.ts
- `./MemoryActivationEngine.js` → MemoryActivationEngine

### packages\core\src\knowledge\memory\index.ts
- （无 import）
### packages\core\src\knowledge\memory\types.ts
- （无 import）
### packages\core\src\knowledge\ontology\FeedbackService.ts
- `./OntologyService.js` → OntologyService
- `../../gate/types.js` → OntologyObject

### packages\core\src\knowledge\ontology\ObjectTypeRegistry.ts
- `./objectTypes.js` → DEFAULT_SCHEMAS, ObjectTypeSchema

### packages\core\src\knowledge\ontology\OntologyService.ts
- `../../gate/types.js` → ObjectId, OntologyObject, OntologyRelation, QueryFilter, RetrievedFact
- `../../knowledge/graph/SystemMetadataGraph.js` → SystemMetadataGraph, EntityType, RelationType
- `./ObjectTypeRegistry.js` → ObjectTypeRegistry
- `../../infrastructure/observability/deblackbox/DeblackboxRecorder.js` → getSharedDeblackboxRecorder

### packages\core\src\knowledge\ontology\bootstrapFromDocs.ts
- `./OntologyService.js` → OntologyService

### packages\core\src\knowledge\ontology\index.ts
- （无 import）
### packages\core\src\knowledge\ontology\objectTypes.ts
- （无 import）
### packages\core\src\knowledge\ontology\projectors\ArtifactProjector.ts
- `../OntologyService.js` → OntologyService

### packages\core\src\knowledge\ontology\projectors\MissionProjector.ts
- `../OntologyService.js` → OntologyService

### packages\core\src\knowledge\ontology\projectors\index.ts
- （无 import）
### packages\core\src\knowledge\ontology\prompts\expert-prompt.ts
- `./prompt-types.js` → PromptTemplate, PromptCompileOptions

### packages\core\src\knowledge\ontology\prompts\forced-query-system.ts
- （无 import）
### packages\core\src\knowledge\ontology\prompts\index.ts
- （无 import）
### packages\core\src\knowledge\ontology\prompts\leader-prompt.ts
- `./prompt-types.js` → PromptTemplate, PromptCompileOptions

### packages\core\src\knowledge\ontology\prompts\prompt-types.ts
- （无 import）
### packages\core\src\workflow\WorkflowProvider.ts
- （无 import）
### packages\core\src\workflow\index.ts
- （无 import）
### packages\memory\src\api\MemoryApi.ts
- `../confirmation/queue.js` → ConfirmationQueue
- `../gate/ForceRetrieve.js` → ForceRetriever
- `../ontology/validate.js` → validateUpsert
- `../memory-types.js` → ConfirmDecision, ConfirmTicket, MemoryAPI, MemoryEngine, MemoryQueryRequest, MemoryQueryResult, ReflectResult, UpsertEntityInput, UpsertResult

### packages\memory\src\api\factory.ts
- `./MemoryApi.js` → MemoryApiOptions
- `./MemoryApi.js` → MemoryApi
- `../memory-types.js` → MemoryEngine
- `../engines/factory.js` → createEngine, EngineFactoryOptions

### packages\memory\src\confirmation\queue.ts
- `better-sqlite3` → Database
- `node:fs` → mkdirSync
- `node:path` → dirname
- `../memory-types.js` → ConfirmTicket, ConfirmDecision

### packages\memory\src\engines\cognee\CogneeEngine.ts
- `../../memory-types.js` → EngineHit, EngineSearchOptions, EngineWriteOptions, MemoryEngine
- `./client.js` → CogneeClient

### packages\memory\src\engines\cognee\client.ts
- （无 import）
### packages\memory\src\engines\factory.ts
- `./cognee/client.js` → CogneeClient
- `./cognee/CogneeEngine.js` → CogneeEngine
- `./mock/MockEngine.js` → MockEngine
- `../memory-types.js` → MemoryEngine

### packages\memory\src\engines\mock\MockEngine.ts
- `../../memory-types.js` → EngineHit, EngineSearchOptions, EngineWriteOptions, MemoryEngine

### packages\memory\src\gate\ForceRetrieve.ts
- `../memory-types.js` → MemoryEngine, MemoryHit, MemoryQueryRequest, MemoryQueryResult, MemoryQuerySource, NeedHumanReason
- `./domain.js` → isCompanyKnowledgeDomain

### packages\memory\src\gate\domain.ts
- （无 import）
### packages\memory\src\index.ts
- （无 import）
### packages\memory\src\memory-types.ts
- （无 import）
### packages\memory\src\ontology\schema.ts
- （无 import）
### packages\memory\src\ontology\validate.ts
- `../memory-types.js` → UpsertEntityInput
- `./schema.js` → isEntityType, isRelationType

### packages\memory\src\storage\Compactor.ts
- `node:fs/promises` → *
- `node:fs` → *
- `node:path` → *
- `node:crypto` → *

### packages\memory\src\storage\HistoryStore.ts
- `fs` → *
- `path` → *
- `../wiki/index.js` → MemoryWiki

### packages\memory\src\storage\JSONLWriter.ts
- `fs` → *
- `path` → *

### packages\memory\src\storage\LogRotator.ts
- `node:fs` → *
- `node:fs/promises` → *
- `node:path` → *

### packages\memory\src\types.ts
- （无 import）
### packages\memory\src\wiki\DocTopology.ts
- `node:fs` → *
- `node:path` → *
- `./MemoryWiki.js` → MemoryWiki

### packages\memory\src\wiki\DocWatcher.ts
- `node:fs` → *
- `node:path` → *
- `./MemoryWiki.js` → MemoryWiki

### packages\memory\src\wiki\MemoryRetriever.ts
- `./MemoryWiki.js` → MemoryWiki

### packages\memory\src\wiki\MemoryWiki.ts
- `node:path` → *
- `node:fs` → *
- `./types.js` → MemoryItem, MemoryWikiConfig
- `./schema.js` → MEMORY_WIKI_SCHEMA

### packages\memory\src\wiki\index.ts
- （无 import）
### packages\memory\src\wiki\migrate.ts
- `node:fs/promises` → *
- `node:path` → *
- `./MemoryWiki.js` → MemoryWiki
- `./types.js` → MigrationSource, MigrationResult, MemoryItem

### packages\memory\src\wiki\schema.ts
- （无 import）
### packages\memory\src\wiki\types.ts
- （无 import）
### packages\studio\server\RuntimeAPI.ts
- `express` → ExpressRouter
- `node:fs` → *
- `node:path` → *

### packages\studio\server\SessionStore.ts
- `fs` → *
- `path` → *

### packages\studio\server\StudioServer.ts
- `express` → express
- `cors` → cors
- `node:fs` → *
- `node:path` → *
- `mammoth` → mammoth
- `xlsx` → XLSX
- `node:http` → HttpServer
- `node:child_process` → spawn
- `../../core/src/bootstrap-unified.js` → bootstrapUnified
- `../../core/src/bootstrap-unified.js` → UnifiedBootstrapResult
- `../../core/src/governance/CostController.js` → CostController
- `../../core/src/infrastructure/adapters/pi-bridge/PiBridge.js` → getSharedPiBridge
- `../../core/src/cognition/planning/goal-intelligence/IntentClassifier.js` → IntentClassifier
- `../../core/src/governance/control-plane/space-types.js` → Space
- `../../core/src/governance/control-plane/SpaceService.js` → SpaceService
- `../../core/src/workflow/WorkflowProvider.js` → WorkflowRegistry
- `../../core/src/execution/UserAskService.js` → answerAsk, getPendingAsks
- `../../core/src/execution/PlanGateService.js` → confirmPlan, getPendingPlans, setAutoExecute
- `../../core/src/execution/DecisionStore.js` → listPendingDecisions
- `../../core/src/infrastructure/adapters/pi-bridge/yamlConfig.js` → loadMorpexConfig
- `./SessionStore.js` → SessionStore
- `./observability/index.js` → createObservabilityRouter
- `./observability/runtime-bridge.js` → startObservabilityBridge, wireObservabilityServices
- `./RuntimeAPI.js` → registerRuntimeRoutes

### packages\studio\server\index.ts
- `./StudioServer.js` → StudioServer

### packages\studio\server\observability\agent-tracer.ts
- `./execution-tracer.js` → ExecutionTracer
- `./runtime-invoker.js` → RuntimeInvoker

### packages\studio\server\observability\architecture-auditor.ts
- `./architecture-contract.js` → ModuleContract
- `./architecture-contract.js` → ARCHITECTURE_CONTRACT
- `./observation.js` → ObservationCollector
- `./observation.js` → Observation

### packages\studio\server\observability\architecture-contract.ts
- （无 import）
### packages\studio\server\observability\coverage-engine.ts
- `./observation.js` → ObservationCollector
- `./types.js` → DEFAULT_MODULES

### packages\studio\server\observability\dag-tracer.ts
- `./execution-tracer.js` → ExecutionTracer

### packages\studio\server\observability\event-bus.ts
- `./types` → TraceEvent
- `./trace-store` → TraceStore

### packages\studio\server\observability\execution-tracer.ts
- `./runtime-invoker.js` → RuntimeInvoker

### packages\studio\server\observability\exercise-all.ts
- `./runtime-invoker.js` → RuntimeInvoker
- `./observation.js` → ObservationCollector, createExecutionContext, forkContext, ExecutionContext
- `./architecture-contract.js` → ARCHITECTURE_CONTRACT

### packages\studio\server\observability\fsm-tracer.ts
- `./execution-tracer.js` → ExecutionTracer

### packages\studio\server\observability\graph-builder.ts
- `./types` → TraceEvent, GraphNode, TaskTimelineEntry
- `./trace-store` → TraceStore

### packages\studio\server\observability\index.ts
- （无 import）
### packages\studio\server\observability\llm-tracer.ts
- `../../../core/src/infrastructure/observability/deblackbox/DeblackboxRecorder.js` → getSharedDeblackboxRecorder
- `../../../core/src/infrastructure/observability/deblackbox/DeblackboxRecorder.js` → DeblackboxRecord

### packages\studio\server\observability\observability-api.ts
- `express` → Router, Request, Response
- `./event-bus` → traceBus
- `./coverage-engine` → CoverageEngine
- `./graph-builder` → GraphBuilder
- `./task-generator` → taskGenerator
- `./types` → DEFAULT_MODULES
- `./observation.js` → ObservationCollector
- `./exercise-all.js` → exerciseAllFromGlobal, getExerciseContext
- `./runtime-invoker.js` → RuntimeInvoker
- `./llm-tracer.js` → llmTracer
- `../../../core/src/infrastructure/observability/deblackbox/DeblackboxRecorder.js` → getSharedDeblackboxRecorder
- `../../../core/src/infrastructure/common/contracts/eventContractCatalog.js` → getEventContractReconcile, CORE_EVENT_CONTRACTS, CORE_EVENT_CONTRACT_TYPES

### packages\studio\server\observability\observable-module.ts
- `./observation.js` → ObservationCollector, ExecutionContext, Observation, createExecutionContext, forkContext

### packages\studio\server\observability\observation-adapter.ts
- `./observation.js` → ObservationCollector
- `./types.js` → TraceEvent

### packages\studio\server\observability\observation.ts
- （无 import）
### packages\studio\server\observability\replay-engine.ts
- `./observation.js` → Observation

### packages\studio\server\observability\runtime-bridge.ts
- `../../../core/src/infrastructure/common/EventBus.js` → EventBus
- `../../../core/src/infrastructure/common/types.js` → MorPexEvent
- `./observation.js` → ObservationCollector
- `./event-bus.js` → traceBus
- `./architecture-auditor.js` → ArchitectureAuditor
- `./replay-engine.js` → ReplayEngine
- `./execution-tracer.js` → createExecutionTracer
- `./observation.js` → Observation

### packages\studio\server\observability\runtime-invoker.ts
- `./observation.js` → ObservationCollector, createExecutionContext, forkContext, ExecutionContext, Observation

### packages\studio\server\observability\task-generator.ts
- `./types` → TraceEvent
- `./event-bus` → traceBus

### packages\studio\server\observability\tool-tracer.ts
- `./execution-tracer.js` → ExecutionTracer
- `./runtime-invoker.js` → RuntimeInvoker

### packages\studio\server\observability\trace-store.ts
- `better-sqlite3` → Database
- `./types` → TraceEvent, ModuleRegistration
- `./observation.js` → ObservationCollector
- `path` → path
- `fs` → fs

### packages\studio\server\observability\types.ts
- （无 import）
### packages\studio\server\observability\ws-handler.ts
- `http` → IncomingMessage
- `ws` → WebSocketServer, WebSocket
- `http` → HttpServer
- `./event-bus` → traceBus
- `./observation.js` → ObservationCollector

### packages\studio\server\security-middleware.ts
- `express` → Request, Response, NextFunction

### packages\workflow-sdk\src\IWorkflowAdapter.ts
- `./types.js` → WorkflowContext, WorkflowExecutionResult, OptimizationProposal

### packages\workflow-sdk\src\PiModelRegistry.ts
- `@morpex/core` → getSharedPiBridge, DEFAULT_MODEL, PiBridge

### packages\workflow-sdk\src\WorkflowContext.ts
- `./types.js` → WorkflowContext, WorkflowExecutionResult, QualityScore

### packages\workflow-sdk\src\WorkflowRuntime.ts
- `./types.js` → WorkflowPackage, InstalledWorkflow, WorkflowExecutionResult, WorkflowMetrics, WorkflowStatus, OptimizationProposal, WorkflowVersionInfo, ExecutionOptions, WorkflowContext, TraceEntry, QualityScore
- `./WorkflowContext.js` → createWorkflowContext, createExecutionResult

### packages\workflow-sdk\src\WorkflowSDK.ts
- `./types.js` → WorkflowDefinition, WorkflowStepDefinition, WorkflowPackage, InstalledWorkflow, WorkflowExecutionResult, WorkflowMetrics, WorkflowStatus, OptimizationProposal, WorkflowVersion, ExecutionOptions
- `./IWorkflowAdapter.js` → IWorkflowAdapter

### packages\workflow-sdk\src\bootstrap.ts
- `@morpex/core` → EventBus, MissionRuntime, DAGRuntime, WorkflowRegistry, V10WorkflowExecutor, V10WorkflowOptimizer, WorkflowIntelligence, WorkflowMemory, MissionState, DAGExecutorAdapter
- `@morpex/core` → Mission, MissionPlan
- `@morpex/core` → MissionPlanner
- `./WorkflowRuntime.js` → WorkflowRuntime
- `./WorkflowSDK.js` → WorkflowSDK
- `./PiModelRegistry.js` → PiModelRegistry

### packages\workflow-sdk\src\index.ts
- （无 import）
### packages\workflow-sdk\src\types.ts
- （无 import）
### packages\workflows\ecommerce\actions\amazon.ts
- （无 import）
### packages\workflows\ecommerce\artifacts\types.ts
- （无 import）
### packages\workflows\ecommerce\index.ts
- （无 import）
### packages\workflows\ecommerce\src\actions\amazon-primitives.ts
- `@morpex/core` → ActionPrimitive, ActionResult
- `../../actions/amazon.js` → createListing, uploadImage, updatePrice

### packages\workflows\ecommerce\src\bootstrap.ts
- `@morpex/core` → DomainPrimitiveRegistry
- `./actions/amazon-primitives.js` → CreateListingAction, UploadImageAction, UpdatePriceAction
- `./rules/amazon-rules.js` → registerAmazonRules
- `./rules/rule-register.js` → registerDomainRules

### packages\workflows\ecommerce\src\index.ts
- （无 import）
### packages\workflows\ecommerce\src\rules\amazon-rules.ts
- `@morpex/core` → QualityRule, PolicyRuleRegistry

### packages\workflows\ecommerce\src\rules\rule-register.ts
- `@morpex/core` → RuleRegistry, RuleEntity

### packages\workflows\ecommerce\validators\amazon-policy.ts
- （无 import）
### packages\workflows\ecommerce\workflow-provider.ts
- `@morpex/core` → WorkflowProvider, WorkflowAction
- `./actions/amazon.js` → createListing, uploadImage, updatePrice

### packages\workflows\hardware\firmware\actions\build_project.ts
- `./generate.js` → generateAction, GenerateInput
- `./compile.js` → compileAction, CompileInput, CompileOutput

### packages\workflows\hardware\firmware\actions\compile.ts
- `child_process` → execSync
- `path` → resolve, dirname
- `url` → fileURLToPath
- `fs` → existsSync

### packages\workflows\hardware\firmware\actions\generate.ts
- `child_process` → execSync
- `path` → resolve, dirname
- `url` → fileURLToPath
- `fs` → writeFileSync, existsSync, mkdirSync

### packages\workflows\hardware\firmware\artifacts\types.ts
- （无 import）
### packages\workflows\hardware\firmware\index.ts
- `@morpex/workflow-sdk` → WorkflowContext
- `./actions/compile.js` → compileAction
- `./actions/generate.js` → generateAction
- `./actions/build_project.js` → buildProjectAction

### packages\workflows\hardware\simulation\actions\debug.ts
- `child_process` → execSync
- `path` → resolve, dirname
- `url` → fileURLToPath

### packages\workflows\hardware\simulation\actions\flash.ts
- `child_process` → execSync
- `path` → resolve, dirname
- `url` → fileURLToPath
- `fs` → existsSync

### packages\workflows\hardware\simulation\index.ts
- `./actions/flash.js` → flashAction
- `./actions/debug.js` → debugAction

### packages\workflows\hardware\src\actions\hardware-actions.ts
- `@morpex/core` → ActionPrimitive, ActionResult
- `../../firmware/actions/compile.js` → compileAction
- `../../firmware/actions/generate.js` → generateAction
- `../../firmware/actions/build_project.js` → buildProjectAction
- `../../simulation/actions/flash.js` → flashAction
- `../../simulation/actions/debug.js` → debugAction

### packages\workflows\hardware\src\bootstrap.ts
- `@morpex/core` → DomainPrimitiveRegistry
- `./actions/hardware-actions.js` → HardwareGenerateAction, HardwareCompileAction, HardwareBuildProjectAction, HardwareFlashAction, HardwareDebugAction
- `./rules/hardware-rules.js` → registerHardwareRules

### packages\workflows\hardware\src\index.ts
- （无 import）
### packages\workflows\hardware\src\rules\hardware-rules.ts
- `@morpex/core` → PolicyRuleRegistry

### packages\workflows\hardware\workflow-provider.ts
- `@morpex/core` → WorkflowProvider, WorkflowAction
- `./firmware/actions/generate.js` → generateAction
- `./firmware/actions/compile.js` → compileAction
- `./firmware/actions/build_project.js` → buildProjectAction
- `./simulation/actions/flash.js` → flashAction
- `./simulation/actions/debug.js` → debugAction

### packages\workflows\software\src\actions\software-actions.ts
- `@morpex/core` → ActionPrimitive, ActionResult

### packages\workflows\software\src\bootstrap.ts
- `@morpex/core` → DomainPrimitiveRegistry
- `./actions/software-actions.js` → GithubCreateRepoAction, DockerBuildImageAction, CloudDeployAction
- `./rules/custom-detectors.js` → registerSoftwareDetectors
- `./rules/structural-eslint.js` → registerSoftwareStructuralCorrector
- `./rules/structural-ast-tsc.js` → registerSoftwareAstTscAdapters

### packages\workflows\software\src\index.ts
- （无 import）
### packages\workflows\software\src\rules\ast-utils.ts
- `typescript` → ts

### packages\workflows\software\src\rules\custom-detectors.ts
- `@morpex/core` → DetectorRegistry, RuleRegistry, RuleDetector, RuleEntity
- `@morpex/core` → OntologyProposal

### packages\workflows\software\src\rules\structural-ast-tsc.ts
- `@morpex/core` → DetectorRegistry, RuleRegistry, StructuralCorrectionRegistry, RuleDetector, RuleEntity, RuleViolation, StructuralCorrector, OntologyProposal
- `./ast-utils.js` → typeCheck, formatDiagnostic, findVarDeclarations, findEvalCalls, fixVarToLetConst, parseSource

### packages\workflows\software\src\rules\structural-eslint.ts
- `eslint` → Linter
- `@morpex/core` → StructuralCorrectionRegistry, DetectorRegistry, RuleRegistry, StructuralCorrector, RuleDetector, RuleEntity, RuleViolation, OntologyProposal

### packages\workflows\software\workflow-provider.ts
- `@morpex/core` → WorkflowProvider, WorkflowAction
- `./src/actions/software-actions.js` → GithubCreateRepoAction, DockerBuildImageAction, CloudDeployAction

### packages\workflows\xjmcu\src\actions\compile.ts
- `child_process` → execSync
- `path` → resolve, dirname
- `url` → fileURLToPath
- `fs` → existsSync, mkdirSync
- `@morpex/core` → ActionPrimitive, ActionResult

### packages\workflows\xjmcu\src\actions\generate.ts
- `fs` → writeFileSync, existsSync, mkdirSync
- `path` → resolve
- `@morpex/core` → ActionPrimitive, ActionResult

### packages\workflows\xjmcu\src\actions\pipeline.ts
- `child_process` → execSync
- `path` → resolve, dirname
- `url` → fileURLToPath
- `fs` → existsSync, mkdirSync, writeFileSync
- `@morpex/core` → ActionPrimitive, ActionResult

### packages\workflows\xjmcu\src\bootstrap.ts
- `@morpex/core` → DomainPrimitiveRegistry
- `./actions/compile.js` → XJMcuCompileAction
- `./actions/generate.js` → XJMcuGenerateAction
- `./actions/pipeline.js` → XJMcuPipelineAction
- `./rules/platform-rule.js` → registerPlatformRules

### packages\workflows\xjmcu\src\index.ts
- （无 import）
### packages\workflows\xjmcu\src\rules\platform-rule.ts
- `@morpex/core` → RuleRegistry, RuleEntity

### packages\workflows\xjmcu\toolchain\scripts\import_sfr_to_memory.cjs
- （无 import）
### packages\workflows\xjmcu\workflow-provider.ts
- `@morpex/core` → WorkflowProvider, WorkflowAction
- `./src/actions/generate.js` → XJMcuGenerateAction
- `./src/actions/compile.js` → XJMcuCompileAction
- `./src/actions/pipeline.js` → XJMcuPipelineAction

### scripts\_backend-code-analyze.ts
- `typescript` → *
- `node:fs` → *
- `node:path` → *
- `node:url` → *

### scripts\_mission-session.ts
- `../packages/core/src/bootstrap-unified.js` → bootstrapUnified

### scripts\analyze-trace-reports.ts
- `node:fs` → readdirSync, readFileSync
- `node:path` → join

### scripts\batch-run.ts
- `../packages/core/src/bootstrap-unified.js` → bootstrapUnified
- `../packages/core/src/gate/rules/RuleRegistry.js` → RuleRegistry
- `./tracing/TraceRecorder.js` → createTraceSession, renderCallChain, TraceCall
- `./batch-tasks.js` → TASKS, BatchTask
- `node:fs` → mkdirSync, writeFileSync
- `node:path` → join, resolve
- `node:os` → freemem
- `node:url` → pathToFileURL

### scripts\batch-tasks.ts
- （无 import）
### scripts\check-llm.ts
- `../packages/core/src/infrastructure/adapters/pi-bridge/yamlConfig.js` → loadMorpexConfig

### scripts\compact-entity-events.cjs
- （无 import）
### scripts\dev-fast.mjs
- `node:child_process` → spawn

### scripts\k6-load-test.js
- `k6/http` → http
- `k6` → check, sleep, group
- `k6/metrics` → Rate, Trend, Counter

### scripts\k6-smoke.js
- `k6/http` → http
- `k6` → check, sleep, group
- `k6/metrics` → Rate

### scripts\ops-validate.ts
- `../packages/core/src/bootstrap-unified.js` → bootstrapUnified

### scripts\production-check.cjs
- （无 import）
### scripts\run-all-production-tests.ts
- `node:child_process` → execSync, spawn
- `node:path` → *
- `node:fs` → *

### scripts\run-all-tests.ts
- `node:child_process` → spawn
- `node:path` → *

### scripts\run-everything.ts
- `node:child_process` → spawn
- `node:path` → *
- `node:fs` → *

### scripts\start.ts
- `node:child_process` → execSync

### scripts\tracing\TraceRecorder.ts
- （无 import）
### scripts\validate-architecture.js
- `fs` → readFileSync, existsSync, readdirSync, statSync
- `path` → join, relative, normalize, sep

### scripts\verify-e2e.ts
- `../packages/core/src/bootstrap-unified.js` → bootstrapUnified
- `../packages/core/src/knowledge/context/ContextArchive.js` → loadByTaskRef

### scripts\workflow-cli.ts
- `../packages/workflow-sdk/src/bootstrap.js` → createWorkflowRuntime

## 2. 文件内函数/方法清单

### packages\connectors\src\BaseConnector.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 30 |
| initialize | method | Y |  | 47 |
| validate | method | Y |  | 60 |
| execute | method | Y |  | 92 |
| executeAction | method |  |  | 133 |
| rollback | method | Y |  | 142 |
| getMeta | method |  |  | 150 |

### packages\connectors\src\ConnectorRegistry.ts（15 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| register | method | Y |  | 37 |
| unregister | method |  |  | 54 |
| get | method |  |  | 63 |
| getMeta | method |  |  | 70 |
| list | method |  |  | 77 |
| listMeta | method |  |  | 84 |
| find | method |  |  | 94 |
| execute | method | Y |  | 113 |
| executeBatch | method | Y |  | 154 |
| addPermissionRule | method |  |  | 176 |
| setPermissionRules | method |  |  | 185 |
| checkPermission | method | Y |  | 196 |
| matchesRule | method |  |  | 221 |
| globMatch | method |  |  | 244 |
| findConnectorForAction | method |  |  | 264 |

### packages\connectors\src\FileSystemConnector.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 145 |
| initialize | method | Y |  | 150 |
| executeAction | method | Y |  | 155 |
| resolvePath | method |  |  | 242 |
| walkDir | method | Y |  | 257 |
| requireNodePath | fn |  |  | 276 |
| requireActualPath | fn |  |  | 287 |

### packages\connectors\src\IActionConnector.ts（0 个）
- （无顶层函数/方法提取）
### packages\connectors\src\ShellConnector.ts（5 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| parseCommandLine | fn |  |  | 70 |
| (anon) | ctor |  |  | 121 |
| validate | method | Y |  | 130 |
| execute | method | Y |  | 153 |
| executeAction | method | Y |  | 168 |

### packages\connectors\src\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\connectors\src\secureExec.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| scrubEnv | fn |  | Y | 35 |
| runCommand | fn |  | Y | 89 |
| finish | const-fn |  |  | 125 |
| makePrivateTempDir | fn | Y | Y | 169 |
| randomPrivateFilePath | fn |  | Y | 180 |
| writeExclusive | fn | Y | Y | 190 |
| cleanupTempDir | fn | Y | Y | 204 |

### packages\connectors\src\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\contracts\agent-runtime.ts（0 个）
- （无顶层函数/方法提取）
### packages\contracts\capabilities.ts（0 个）
- （无顶层函数/方法提取）
### packages\contracts\errors.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| classifyError | fn |  | Y | 40 |

### packages\contracts\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\contracts\inference.ts（0 个）
- （无顶层函数/方法提取）
### packages\contracts\runtime-events.ts（0 个）
- （无顶层函数/方法提取）
### packages\contracts\tool.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\cognition\BrainFacade.ts（27 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 198 |
| setPersonalBrain | method |  |  | 250 |
| setMemoryWiki | method |  |  | 254 |
| setMemoryApi | method |  |  | 259 |
| setLearningLoop | method |  |  | 263 |
| setEvolutionEngine | method |  |  | 267 |
| setSOPEngine | method |  |  | 272 |
| setReflectionEngine | method |  |  | 277 |
| setMemoryActivationEngine | method |  |  | 282 |
| isReady | method |  |  | 289 |
| activeReflect | method | Y |  | 301 |
| stop | method |  |  | 353 |
| enableAutoConsolidation | method |  |  | 367 |
| disableAutoConsolidation | method |  |  | 374 |
| processTask | method | Y |  | 388 |
| remember | method | Y |  | 439 |
| recall | method | Y |  | 516 |
| learn | method | Y |  | 600 |
| reflect | method | Y |  | 759 |
| forget | method | Y |  | 825 |
| consolidate | method | Y |  | 870 |
| generateCEOReport | method | Y |  | 943 |
| synthesize | method | Y |  | 997 |
| routeByIntent | method | Y |  | 1109 |
| activateMemory | method |  |  | 1153 |
| getStats | method |  |  | 1160 |
| recordBackground | method |  |  | 1178 |

### packages\core\src\cognition\CrossDepartmentKnowledgeSynthesizer.ts（14 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 136 |
| setMemoryWiki | method |  |  | 152 |
| setBehaviorTwin | method |  |  | 156 |
| isReady | method |  |  | 160 |
| synthesizeAcrossDepartments | method | Y |  | 179 |
| migratePattern | method | Y |  | 279 |
| getStats | method |  |  | 357 |
| resetCache | method |  |  | 364 |
| discoverDepartments | method | Y |  | 377 |
| gatherCandidates | method | Y |  | 392 |
| fuseCandidates | method |  |  | 459 |
| extractActions | method |  |  | 483 |
| getCachedSimilarity | method |  |  | 502 |
| setCachedSimilarity | method |  |  | 513 |

### packages\core\src\cognition\ReflectionEngine.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 56 |
| setLLMCaller | method |  |  | 61 |
| reflect | method | Y |  | 65 |
| deepReflect | method | Y |  | 94 |
| parseLLMResponse | method |  |  | 131 |
| ruleBasedReflect | method |  |  | 147 |

### packages\core\src\cognition\SafetyMonitor.ts（5 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 24 |
| setThreshold | method |  |  | 33 |
| observe | method |  |  | 37 |
| getRecent | method |  |  | 81 |
| getCritical | method |  |  | 85 |

### packages\core\src\cognition\decision\DecisionTwin.ts（17 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 45 |
| buildProfile | method | Y |  | 63 |
| analyze | method | Y |  | 99 |
| predict | method | Y |  | 152 |
| extractCommonFactors | method |  |  | 221 |
| determineTrend | method |  |  | 256 |
| assessRiskTolerance | method |  |  | 271 |
| calculateConsistency | method |  |  | 318 |
| predictTopChoice | method |  |  | 353 |
| recordOutcome | method |  |  | 387 |
| getOutcomes | method |  |  | 402 |
| getOutcomeStats | method |  |  | 409 |
| getSuccessFactors | method |  |  | 431 |
| analyzeFactorCorrelation | method |  |  | 464 |
| getDecisionNetwork | method |  |  | 513 |
| detectBiases | method |  |  | 552 |
| extractFactorsFromContext | method |  |  | 673 |

### packages\core\src\cognition\decision\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\cognition\decision\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\cognition\goal\GoalGraph.ts（22 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| generateId | fn |  |  | 20 |
| createGoal | method |  |  | 35 |
| addGoal | method |  |  | 78 |
| getGoal | method |  |  | 85 |
| updateGoal | method |  |  | 89 |
| removeGoal | method |  |  | 128 |
| getRootGoals | method |  |  | 157 |
| getByLevel | method |  |  | 162 |
| getByStatus | method |  |  | 167 |
| getAll | method |  |  | 172 |
| getPath | method |  |  | 177 |
| getDescendants | method |  |  | 188 |
| buildTree | method |  |  | 201 |
| buildForest | method |  |  | 216 |
| assignDepth | const-fn |  |  | 218 |
| recalculateProgress | method |  |  | 240 |
| getOverallProgress | method |  |  | 260 |
| linkMission | method |  |  | 275 |
| unlinkMission | method |  |  | 284 |
| getGoalsForMission | method |  |  | 292 |
| toJSON | method |  |  | 302 |
| fromJSON | method |  |  | 309 |

### packages\core\src\cognition\goal\GoalManager.ts（31 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| generateKrId | fn |  |  | 30 |
| generateObjId | fn |  |  | 31 |
| (anon) | ctor |  |  | 39 |
| createGoal | method |  |  | 47 |
| getGoal | method |  |  | 59 |
| updateGoal | method |  |  | 63 |
| archiveGoal | method |  |  | 67 |
| completeGoal | method |  |  | 74 |
| pauseGoal | method |  |  | 84 |
| resumeGoal | method |  |  | 88 |
| removeGoal | method |  |  | 92 |
| getFullTree | method |  |  | 105 |
| getGoalPath | method |  |  | 115 |
| getRootGoals | method |  |  | 120 |
| getByLevel | method |  |  | 125 |
| getActiveGoals | method |  |  | 130 |
| getAllGoals | method |  |  | 135 |
| linkMissionToGoal | method |  |  | 143 |
| unlinkMissionToGoal | method |  |  | 147 |
| getMissionsForGoal | method |  |  | 151 |
| getGoalsForMission | method |  |  | 156 |
| addObjective | method |  |  | 164 |
| updateKeyResult | method |  |  | 189 |
| getObjectives | method |  |  | 211 |
| getAllObjectives | method |  |  | 215 |
| recalculateAllProgress | method |  |  | 223 |
| getOverallProgress | method |  |  | 229 |
| getStats | method |  |  | 233 |
| injectObjectives | method |  |  | 254 |
| toJSON | method |  |  | 265 |
| fromJSON | method |  |  | 272 |

### packages\core\src\cognition\goal\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\cognition\goal\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\cognition\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\cognition\learning\ExperienceExtractor.ts（5 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| isDuplicate | method |  |  | 38 |
| extract | method |  |  | 50 |
| extractPatterns | method |  |  | 89 |
| extractLessons | method |  |  | 117 |
| detectGoalType | method |  |  | 139 |

### packages\core\src\cognition\learning\LearningLoop.ts（11 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| toExecutionRecord | fn |  |  | 65 |
| isPlanEvaluation | fn |  |  | 81 |
| (anon) | ctor |  |  | 101 |
| extractExperience | method | Y |  | 118 |
| evaluatePlan | method | Y |  | 144 |
| optimize | method | Y |  | 162 |
| learnFromTask | method | Y |  | 172 |
| updateDepartmentPattern | method |  |  | 227 |
| getPreferenceModel | method |  |  | 248 |
| getDepartmentPattern | method |  |  | 252 |
| getStats | method |  |  | 257 |

### packages\core\src\cognition\learning\PlanEvaluator.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| evaluate | method |  |  | 25 |
| identifyStrengths | method |  |  | 58 |
| identifyWeaknesses | method |  |  | 67 |
| generateSuggestions | method |  |  | 76 |

### packages\core\src\cognition\learning\StrategyOptimizer.ts（5 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| addEvaluation | method |  |  | 19 |
| getHistory | method |  |  | 24 |
| optimize | method |  |  | 27 |
| reset | method |  |  | 101 |
| historySize | getter |  |  | 104 |

### packages\core\src\cognition\learning\TemplateEvolutionEngine.ts（10 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| register | method |  |  | 32 |
| getAll | method |  |  | 38 |
| updateWithExperience | method |  |  | 41 |
| updateWithEvaluation | method |  |  | 60 |
| recommend | method |  |  | 78 |
| evict | method |  |  | 91 |
| getStats | method |  |  | 103 |
| clear | method |  |  | 114 |
| calculateNewSuccessRate | method |  |  | 116 |
| calculateNewAvg | method |  |  | 122 |

### packages\core\src\cognition\learning\agent\CrossAgentLearningEngine.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 19 |
| learnFromOutcome | method |  |  | 36 |
| learnFromVerification | method |  |  | 99 |
| queryRelevant | method |  |  | 152 |
| feedback | method |  |  | 162 |
| getStats | method |  |  | 169 |

### packages\core\src\cognition\learning\agent\ExperienceMatcher.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| match | method |  |  | 22 |
| matchScore | method |  |  | 50 |
| tokenize | method |  |  | 58 |
| jaccardSimilarity | method |  |  | 66 |
| computeMatchScore | method |  |  | 74 |
| isAccessible | method |  |  | 86 |

### packages\core\src\cognition\learning\agent\ExperienceRepository.ts（9 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| store | method |  |  | 16 |
| query | method |  |  | 25 |
| get | method |  |  | 50 |
| getBySourceAgentType | method |  |  | 57 |
| recordFeedback | method |  |  | 66 |
| cleanupExpired | method |  |  | 84 |
| getStats | method |  |  | 99 |
| toJSON | method |  |  | 118 |
| fromJSON | method |  |  | 125 |

### packages\core\src\cognition\learning\agent\ExperienceSqliteRepository.ts（8 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 11 |
| save | method |  |  | 13 |
| query | method |  |  | 30 |
| get | method |  |  | 41 |
| recordFeedback | method |  |  | 46 |
| getStats | method |  |  | 53 |
| cleanupExpired | method |  |  | 62 |
| hydrate | method |  |  | 67 |

### packages\core\src\cognition\learning\agent\KnowledgeDistiller.ts（11 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| distillFromDecision | method |  |  | 18 |
| distillFromMission | method |  |  | 57 |
| distillFromCollaboration | method |  |  | 92 |
| distillFromVerification | method |  |  | 136 |
| mergeDuplicate | method |  |  | 188 |
| doMerge | method |  |  | 197 |
| extractProblemPattern | method |  |  | 226 |
| inferCategory | method |  |  | 232 |
| extractTags | method |  |  | 241 |
| isSimilarPattern | method |  |  | 251 |
| mergeGroup | method |  |  | 257 |

### packages\core\src\cognition\learning\agent\LearningPropagationService.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| propagate | method |  |  | 16 |
| propagateToAll | method |  |  | 28 |
| checkAccess | method |  |  | 40 |
| anonymize | method |  |  | 50 |
| getPropagationLog | method |  |  | 61 |
| getStats | method |  |  | 68 |

### packages\core\src\cognition\learning\agent\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\cognition\learning\agent\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\cognition\learning\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\cognition\memory\BrainPersistor.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| normalizeSink | fn |  |  | 17 |
| restore | method | Y |  | 24 |
| persist | method | Y |  | 73 |
| queryLayer | method | Y |  | 122 |

### packages\core\src\cognition\memory\DecisionMemory.ts（15 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| storeDecision | method | Y |  | 40 |
| getDecision | method |  |  | 50 |
| removeDecision | method |  |  | 59 |
| getAll | method |  |  | 69 |
| findSimilar | method |  |  | 84 |
| getByContext | method |  |  | 137 |
| getCommonFactors | method |  |  | 155 |
| getRecentDecisions | method |  |  | 176 |
| getDecisionsByOutcome | method |  |  | 187 |
| getStats | method |  |  | 196 |
| indexEntry | method |  |  | 209 |
| unindexEntry | method |  |  | 224 |
| toJSON | method |  |  | 242 |
| fromJSON | method |  |  | 251 |
| clear | method |  |  | 264 |

### packages\core\src\cognition\memory\PersonalBrain.ts（23 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 57 |
| destroy | method |  |  | 81 |
| rememberWorking | method | Y |  | 103 |
| recallWorking | method |  |  | 117 |
| clearWorking | method |  |  | 124 |
| recordEpisode | method | Y |  | 143 |
| recallEpisodes | method |  |  | 157 |
| storeFact | method | Y |  | 175 |
| recallFacts | method |  |  | 185 |
| storePreference | method | Y |  | 202 |
| getPreferences | method |  |  | 234 |
| recall | method |  |  | 253 |
| query | method |  |  | 303 |
| getEntry | method |  |  | 346 |
| removeEntry | method |  |  | 362 |
| getLayerSize | method |  |  | 376 |
| getStats | method |  |  | 386 |
| addEntry | method | Y |  | 434 |
| recallFromLayer | method |  |  | 465 |
| cleanup | method |  |  | 511 |
| toJSON | method |  |  | 536 |
| fromJSON | method |  |  | 558 |
| clear | method |  |  | 585 |

### packages\core\src\cognition\memory\WorkflowMemory.ts（15 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| storeWorkflow | method | Y |  | 46 |
| getWorkflow | method |  |  | 56 |
| removeWorkflow | method |  |  | 65 |
| getAll | method |  |  | 75 |
| findSimilar | method |  |  | 90 |
| getByFrequency | method |  |  | 140 |
| getByDomain | method |  |  | 154 |
| getLowConfidence | method |  |  | 168 |
| getStats | method |  |  | 177 |
| indexEntry | method |  |  | 198 |
| unindexEntry | method |  |  | 223 |
| extractFromMission | method | Y |  | 248 |
| toJSON | method |  |  | 303 |
| fromJSON | method |  |  | 312 |
| clear | method |  |  | 327 |

### packages\core\src\cognition\memory\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\cognition\memory\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\cognition\planning\CrossDepartmentArbitrationEngine.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 57 |
| detectConflicts | method |  |  | 61 |
| detectCycle | const-fn |  |  | 93 |
| arbitrate | method | Y |  | 122 |

### packages\core\src\cognition\planning\DeliveryPlanner.ts（24 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 153 |
| setMetaPlanner | method |  |  | 180 |
| setSimulationEngine | method |  |  | 187 |
| setSOPEngine | method |  |  | 192 |
| setBrainFacade | method |  |  | 197 |
| setHierarchicalPlanner | method |  |  | 202 |
| setOntology | method |  |  | 207 |
| setForcedQueryGuard | method |  |  | 212 |
| setPiBridge | method |  |  | 217 |
| isReady | method |  |  | 224 |
| createPlan | method | Y |  | 247 |
| resolveMode | method |  |  | 425 |
| recordOutcome | method |  |  | 480 |
| setPatterns | method |  |  | 528 |
| quickPlan | method | Y |  | 541 |
| parseQuickSteps | method |  |  | 665 |
| fullPlan | method | Y |  | 689 |
| normalizePlan | method |  |  | 739 |
| convertDAGPlanToPlan | method |  |  | 789 |
| simulate | method | Y |  | 831 |
| getPlan | method |  |  | 851 |
| listPlans | method |  |  | 860 |
| confirmPlan | method |  |  | 869 |
| getHealth | method |  |  | 879 |

### packages\core\src\cognition\planning\DeliveryPlannerAdapter.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 26 |
| createPlan | method | Y |  | 39 |
| replan | method | Y |  | 111 |

### packages\core\src\cognition\planning\HierarchicalPlanner.ts（14 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 95 |
| setBrainFacade | method |  |  | 100 |
| setOntology | method |  |  | 105 |
| setForcedQueryGuard | method |  |  | 110 |
| setPiBridge | method |  |  | 115 |
| setOntologyGroundingEnabled | method |  |  | 120 |
| createPlan | method | Y |  | 124 |
| decomposeGoal | method | Y |  | 275 |
| ruleBasedDecompose | method |  |  | 293 |
| sgId | const-fn |  |  | 295 |
| buildDAGNodes | method |  |  | 342 |
| inferCapabilities | method |  |  | 351 |
| assessComplexity | method |  |  | 362 |
| assessRiskLevel | method |  |  | 368 |

### packages\core\src\cognition\planning\goal-intelligence\ConstraintAnalyzer.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| analyze | method | Y |  | 8 |

### packages\core\src\cognition\planning\goal-intelligence\GoalIntelligenceFacade.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| setLLM | method |  |  | 19 |
| understandGoal | method | Y |  | 23 |

### packages\core\src\cognition\planning\goal-intelligence\GoalParser.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| parse | method | Y |  | 8 |
| ruleBasedParse | method |  |  | 21 |

### packages\core\src\cognition\planning\goal-intelligence\GoalValidator.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| validate | method |  |  | 8 |

### packages\core\src\cognition\planning\goal-intelligence\IntentClassifier.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| isQuestionLike | fn |  |  | 38 |
| heuristic | fn |  |  | 46 |
| classify | method | Y |  | 64 |

### packages\core\src\cognition\planning\goal-intelligence\RequirementExtractor.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| extract | method | Y |  | 7 |
| inferCapabilities | method |  |  | 11 |

### packages\core\src\cognition\planning\goal-intelligence\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\cognition\planning\goal-intelligence\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\cognition\planning\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\cognition\twin\BehaviorTwin.ts（30 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 148 |
| recordMission | method |  |  | 166 |
| recordApproval | method |  |  | 193 |
| recordActivity | method |  |  | 211 |
| recordSourceEvent | method |  |  | 229 |
| buildProfile | method |  |  | 241 |
| getVersion | method |  |  | 324 |
| getVersionHistory | method |  |  | 336 |
| getTwinVersion | method |  |  | 358 |
| getCurrentVersion | method |  |  | 365 |
| rollback | method |  |  | 378 |
| getVersionChain | method |  |  | 414 |
| getVersionAt | method |  |  | 434 |
| fork | method |  |  | 455 |
| compare | method |  |  | 496 |
| diffVersions | method |  |  | 509 |
| getCreationTimestamp | method |  |  | 571 |
| getSourceEvents | method |  |  | 578 |
| getPlanningStyle | method |  |  | 587 |
| getRiskTolerance | method |  |  | 596 |
| inferPlanningStyle | method |  |  | 607 |
| inferRiskTolerance | method |  |  | 638 |
| inferWorkHours | method |  |  | 673 |
| inferReviewHabit | method |  |  | 696 |
| inferTaskDecomposition | method |  |  | 710 |
| inferCollaborationStyle | method |  |  | 726 |
| collectPreferredAgentTypes | method |  |  | 731 |
| collectPreferredDomains | method |  |  | 741 |
| toJSON | method |  |  | 754 |
| fromJSON | method |  |  | 769 |

### packages\core\src\cognition\twin\OrganizationTwin.ts（10 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 38 |
| initializeDefaultRoles | method |  |  | 42 |
| addRole | method |  |  | 58 |
| getRole | method |  |  | 59 |
| getRoleByTitle | method |  |  | 60 |
| simulateDecision | method |  |  | 64 |
| simulateGoToMarket | method |  |  | 115 |
| getSimulationHistory | method |  |  | 135 |
| getRequiredApprovals | method |  |  | 137 |
| simulateOutcome | method |  |  | 145 |

### packages\core\src\cognition\twin\PersonalTwinGraph.ts（32 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| generateNodeId | fn |  |  | 46 |
| generateEdgeId | fn |  |  | 51 |
| (anon) | ctor |  |  | 79 |
| getUserId | method |  |  | 86 |
| addNode | method |  |  | 102 |
| getNode | method |  |  | 140 |
| updateNode | method |  |  | 151 |
| removeNode | method |  |  | 175 |
| getNodesByType | method |  |  | 202 |
| searchNodes | method |  |  | 219 |
| addEdge | method |  |  | 249 |
| getEdge | method |  |  | 296 |
| getEdgesBetween | method |  |  | 307 |
| removeEdge | method |  |  | 328 |
| getEdgesByType | method |  |  | 344 |
| getPreferences | method |  |  | 364 |
| getGoals | method |  |  | 380 |
| getCollaborators | method |  |  | 406 |
| getDecisionProfile | method |  |  | 431 |
| getWorkflows | method |  |  | 467 |
| getRelated | method |  |  | 481 |
| getSubgraph | method |  |  | 535 |
| query | method |  |  | 585 |
| learnPreference | method | Y |  | 652 |
| learnDecision | method | Y |  | 710 |
| learnWorkflow | method | Y |  | 779 |
| getInsights | method |  |  | 808 |
| getStats | method |  |  | 859 |
| clear | method |  |  | 887 |
| toJSON | method |  |  | 903 |
| fromJSON | method |  |  | 917 |
| calculateNewStrength | method |  |  | 952 |

### packages\core\src\cognition\twin\PlannerConstraint.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| buildPlannerConstraint | fn |  | Y | 70 |

### packages\core\src\cognition\twin\PreferenceModel.ts（11 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 68 |
| record | method |  |  | 86 |
| getByCategory | method |  |  | 132 |
| getTop | method |  |  | 141 |
| getAll | method |  |  | 151 |
| getStrong | method |  |  | 159 |
| decay | method |  |  | 171 |
| buildProfile | method |  |  | 193 |
| count | method |  |  | 204 |
| toJSON | method |  |  | 212 |
| fromJSON | method |  |  | 216 |

### packages\core\src\cognition\twin\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\cognition\twin\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\cognition\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\cognition\workflow\WorkflowIntelligence.ts（18 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 48 |
| detectPatterns | method | Y |  | 65 |
| buildSimilarityMatrix | method |  |  | 100 |
| computeMissionSimilarity | method |  |  | 124 |
| clusterMissions | method |  |  | 152 |
| buildPatternFromCluster | method |  |  | 183 |
| inferPatternName | method |  |  | 222 |
| mergeSteps | method |  |  | 250 |
| extractWorkflow | method | Y |  | 290 |
| optimizeWorkflow | method | Y |  | 350 |
| canParallelize | method |  |  | 393 |
| canMerge | method |  |  | 404 |
| assessAutomation | method | Y |  | 430 |
| generateReport | method | Y |  | 517 |
| getPatterns | method |  |  | 546 |
| getPattern | method |  |  | 553 |
| toJSON | method |  |  | 564 |
| fromJSON | method |  |  | 573 |

### packages\core\src\cognition\workflow\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\cognition\workflow\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\evaluation\EvaluationEngine.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 90 |
| evaluate | method |  |  | 100 |
| computeReport | method |  |  | 106 |
| emitEvaluationEvents | method |  |  | 244 |

### packages\core\src\evaluation\QualityScorer.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| score | method |  |  | 17 |
| scoreSystem | method |  |  | 47 |
| decide | method |  |  | 71 |

### packages\core\src\evaluation\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\evaluation\lineageCompliance.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| scoreLineageHealth | fn |  | Y | 39 |
| collect | const-fn |  |  | 50 |

### packages\core\src\evaluation\ontologyCompliance.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| scoreOntologyCompliance | fn |  | Y | 47 |

### packages\core\src\evaluation\verification\ArtifactChecker.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| check | method | Y |  | 10 |

### packages\core\src\evaluation\verification\ExecutionVerifier.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| verify | method | Y |  | 11 |

### packages\core\src\evaluation\verification\QualityRule.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| register | method |  |  | 10 |
| getChecks | method |  |  | 14 |
| init | method |  |  | 18 |

### packages\core\src\evaluation\verification\RepairPlanner.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| planRepairs | method |  |  | 10 |

### packages\core\src\evaluation\verification\VerificationEngine.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 17 |
| verify | method | Y |  | 22 |

### packages\core\src\evolution\ActiveEvolutionTrigger.ts（15 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 129 |
| setSelfImprovementLoop | method |  |  | 184 |
| setEvolutionSandbox | method |  |  | 199 |
| setConfig | method |  |  | 203 |
| isReady | method |  |  | 207 |
| checkAndTrigger | method | Y |  | 221 |
| fireTrigger | method | Y |  | 280 |
| autoEvolve | method | Y |  | 318 |
| triggerManual | method | Y |  | 386 |
| checkMissionCompleted | method | Y |  | 402 |
| recordQuality | method |  |  | 450 |
| getDeptTracker | method |  |  | 475 |
| listDeptsAtRisk | method |  |  | 482 |
| getStats | method |  |  | 512 |
| resetDeptTracker | method |  |  | 519 |

### packages\core\src\evolution\EvolutionApplyLoop.ts（8 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 46 |
| init | method |  |  | 57 |
| getAppliedCount | method |  |  | 61 |
| listPending | method |  |  | 66 |
| approve | method | Y |  | 75 |
| reject | method |  |  | 87 |
| onExperienceMined | method | Y |  | 93 |
| proposeStrategy | method | Y |  | 108 |

### packages\core\src\evolution\EvolutionProposal.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| create | method |  |  | 26 |
| submitForReview | method |  |  | 52 |
| approve | method |  |  | 59 |
| reject | method |  |  | 66 |
| getPending | method |  |  | 73 |
| getAll | method |  |  | 77 |

### packages\core\src\evolution\EvolutionSandbox.ts（11 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 83 |
| setGoldenTasks | method |  |  | 88 |
| setEventStore | method |  |  | 93 |
| sandboxDryRun | method | Y |  | 101 |
| proposeChange | method | Y |  | 119 |
| approveAndApply | method | Y |  | 188 |
| reject | method | Y |  | 252 |
| rollback | method | Y |  | 271 |
| listChanges | method |  |  | 313 |
| getChange | method |  |  | 317 |
| recordEvent | method | Y |  | 321 |

### packages\core\src\evolution\ExperienceInjectionService.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 21 |
| inject | method |  |  | 26 |

### packages\core\src\evolution\ExperienceMiner.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 19 |
| getEvents | method |  |  | 24 |
| summarizeEvents | method |  |  | 29 |
| mineFromCompletedTask | method | Y |  | 33 |

### packages\core\src\evolution\FailureAnalyzer.ts（11 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 90 |
| analyze | method |  |  | 100 |
| analyzeAll | method |  |  | 131 |
| getFailureModes | method |  |  | 146 |
| getFailureModesByCategory | method |  |  | 153 |
| identifyFailureModes | method |  |  | 162 |
| collectAllSteps | method |  |  | 191 |
| detectCapabilityIssues | method |  |  | 208 |
| detectDependencyIssues | method |  |  | 229 |
| detectTimeoutRisk | method |  |  | 250 |
| generateTopRecommendation | method |  |  | 269 |

### packages\core\src\evolution\ImprovementAnalyzer.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| analyze | method |  |  | 15 |

### packages\core\src\evolution\KnowledgeGapListener.ts（11 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 65 |
| setEventBus | method |  |  | 70 |
| setFeedbackService | method |  |  | 74 |
| attach | method |  |  | 81 |
| handler | const-fn |  |  | 85 |
| recordMiss | method | Y |  | 109 |
| getGap | method |  |  | 159 |
| listKnowledgeGaps | method |  |  | 166 |
| getMissStats | method |  |  | 173 |
| clear | method |  |  | 190 |
| detach | method |  |  | 198 |

### packages\core\src\evolution\LearningEventDetector.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| isEmptyParamError | fn |  |  | 47 |
| isSafetyBlockError | fn |  |  | 58 |
| detect | method |  |  | 70 |
| summarize | method |  |  | 108 |

### packages\core\src\evolution\PatternExtractor.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| extract | method | Y |  | 8 |

### packages\core\src\evolution\PromptStrategyRegistry.ts（5 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| getHint | method |  |  | 28 |
| setHint | method |  |  | 35 |
| removeHint | method |  |  | 43 |
| all | method |  |  | 51 |
| count | method |  |  | 55 |

### packages\core\src\evolution\SelfImprovementLoop.ts（9 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 33 |
| setSimulator | method |  |  | 37 |
| getMonitor | method |  |  | 38 |
| getCurrentPhase | method |  |  | 39 |
| evolve | method | Y |  | 41 |
| transition | method |  |  | 94 |
| getPhaseHistory | method |  |  | 99 |
| runAnalysis | method | Y |  | 103 |
| getPendingProposals | method |  |  | 108 |

### packages\core\src\evolution\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\evolution\workflow\WorkflowExecutor.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 52 |
| execute | method | Y |  | 71 |
| canAutoExecute | method |  |  | 186 |
| executeAllAutoExecutable | method | Y |  | 197 |
| executeScheduled | method | Y |  | 227 |
| getStats | method |  |  | 257 |

### packages\core\src\evolution\workflow\WorkflowOptimizer.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 40 |
| analyze | method | Y |  | 58 |
| applyOptimization | method | Y |  | 98 |
| needsOptimization | method |  |  | 181 |
| autoOptimize | method | Y |  | 210 |
| estimateImprovement | method |  |  | 234 |
| assessRisk | method |  |  | 251 |

### packages\core\src\evolution\workflow\WorkflowRegistry.ts（16 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| register | method |  |  | 52 |
| confirm | method |  |  | 115 |
| activate | method |  |  | 131 |
| pause | method |  |  | 142 |
| resume | method |  |  | 153 |
| deprecate | method |  |  | 167 |
| addVersion | method |  |  | 186 |
| recordExecution | method |  |  | 216 |
| get | method |  |  | 262 |
| getByStatus | method |  |  | 269 |
| getAutoExecutable | method |  |  | 278 |
| getExecutable | method |  |  | 291 |
| getAll | method |  |  | 300 |
| count | method |  |  | 307 |
| toJSON | method |  |  | 318 |
| fromJSON | method |  |  | 322 |

### packages\core\src\evolution\workflow\WorkflowSimulator.ts（15 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 52 |
| simulate | method | Y |  | 64 |
| getStats | method |  |  | 146 |
| defaultContext | method |  |  | 154 |
| estimateSuccessRate | method |  |  | 166 |
| estimateAvgLatency | method |  |  | 193 |
| estimateResourceEfficiency | method |  |  | 220 |
| estimateErrorRate | method |  |  | 241 |
| detectFailureModes | method |  |  | 275 |
| computeRiskScore | method |  |  | 371 |
| hasCycle | method |  |  | 405 |
| dfs | const-fn |  |  | 413 |
| assessStepReasonableness | method |  |  | 434 |
| computeQualityScore | method |  |  | 458 |
| generateRecommendations | method |  |  | 470 |

### packages\core\src\evolution\workflow\contract\ContractValidator.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| validate | method |  |  | 22 |
| validateInput | method |  |  | 85 |
| validateOutput | method |  |  | 113 |
| checkPreconditions | method |  |  | 132 |

### packages\core\src\evolution\workflow\contract\WorkflowContract.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| validate | method |  |  | 56 |
| validateInput | method |  |  | 88 |
| validateOutput | method |  |  | 110 |
| checkPreconditions | method |  |  | 125 |

### packages\core\src\evolution\workflow\contract\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\evolution\workflow\contract\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\evolution\workflow\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\evolution\workflow\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\execution\AgentAllocator.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| allocate | method |  |  | 4 |

### packages\core\src\execution\AgentMailbox.ts（18 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 68 |
| setEventBus | method |  |  | 79 |
| setLLM | method |  |  | 80 |
| setSpaceService | method |  |  | 81 |
| sendAndWait | method |  |  | 88 |
| fulfill | method | Y |  | 129 |
| generateReply | method | Y |  | 142 |
| fallbackReply | method |  |  | 161 |
| resolvePersona | method |  |  | 166 |
| emit | method |  |  | 182 |
| fileFor | method |  |  | 194 |
| append | method |  |  | 199 |
| patchStore | method |  |  | 208 |
| listForSpace | method |  |  | 217 |
| getPending | method |  |  | 242 |
| setMailboxInstance | fn |  | Y | 249 |
| getMailbox | fn |  | Y | 250 |
| describeMailActor | fn |  | Y | 253 |

### packages\core\src\execution\DecisionStore.ts（8 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| filePath | fn |  |  | 33 |
| appendLine | fn |  |  | 37 |
| setDecisionStoreRoot | fn |  | Y | 47 |
| recordDecision | fn |  | Y | 52 |
| resolveDecision | fn |  | Y | 64 |
| listPendingDecisions | fn |  | Y | 73 |
| restoreDecisions | fn |  | Y | 78 |
| clearDecisions | fn |  | Y | 97 |

### packages\core\src\execution\DependencyCoordinator.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| buildDependencyGraph | method |  |  | 4 |
| getBlockedTeams | method |  |  | 15 |

### packages\core\src\execution\DynamicTeamOrchestrator.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| setWorkflowRegistry | method |  |  | 28 |
| setAgentPool | method |  |  | 32 |
| orchestrate | method | Y |  | 36 |
| getDefaultAgentPool | method |  |  | 100 |
| getTeam | method |  |  | 110 |
| listTeams | method |  |  | 111 |
| updateLifecycle | method |  |  | 112 |

### packages\core\src\execution\PlanGateService.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| setPlanEventBus | fn |  | Y | 28 |
| setAutoExecute | fn |  | Y | 33 |
| isAutoExecute | fn |  | Y | 38 |
| requestPlanConfirm | fn |  | Y | 46 |
| confirmPlan | fn |  | Y | 78 |
| getPendingPlans | fn |  | Y | 90 |

### packages\core\src\execution\SubAgentFork.ts（22 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 152 |
| setExecutionEngine | method |  |  | 167 |
| setConnectorRegistry | method |  |  | 177 |
| setToolQualityTracker | method |  |  | 186 |
| setCostEstimator | method |  |  | 195 |
| getFleetCost | method |  |  | 202 |
| isFleetOverBudget | method |  |  | 209 |
| failFleetByBudget | method |  |  | 220 |
| spawnFleet | method | Y |  | 257 |
| executeFleet | method | Y |  | 337 |
| executeTask | method | Y |  | 419 |
| isConnectorTask | method |  |  | 652 |
| executeViaConnector | method | Y |  | 663 |
| mapCapabilityToAction | method |  |  | 697 |
| simulateExecution | method | Y |  | 707 |
| withTimeout | method |  |  | 719 |
| snapshotTaskMemory | method |  |  | 735 |
| getFleet | method |  |  | 763 |
| waitForFleet | method | Y |  | 777 |
| listFleets | method |  |  | 806 |
| getStats | method |  |  | 814 |
| cancelFleet | method |  |  | 844 |

### packages\core\src\execution\TaskStateProjector.ts（13 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 66 |
| attach | method |  |  | 71 |
| tasksDir | method |  |  | 76 |
| fileFor | method |  |  | 80 |
| handle | method |  |  | 86 |
| newProjection | method |  |  | 125 |
| upsertStep | method |  |  | 140 |
| recomputeProgress | method |  |  | 147 |
| persist | method |  |  | 161 |
| restore | method |  |  | 177 |
| get | method |  |  | 192 |
| list | method |  |  | 196 |
| clear | method |  |  | 203 |

### packages\core\src\execution\TeamBuilder.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| buildTeams | method |  |  | 4 |

### packages\core\src\execution\UnifiedExecutionEngine.ts（19 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| isGenerativePrimitive | fn |  |  | 34 |
| (anon) | ctor |  |  | 139 |
| setOrchestratorAgent | method |  |  | 145 |
| setParamExtractor | method |  |  | 154 |
| isReady | method |  |  | 161 |
| execute | method | Y |  | 174 |
| analyzeComplexity | method |  |  | 282 |
| executeViaOrchestrator | method | Y |  | 321 |
| runOnce | const-fn | Y |  | 337 |
| hasRetryableFailure | method |  |  | 405 |
| executeAuto | method | Y |  | 420 |
| recordExecutionPath | method |  |  | 484 |
| withTimeout | method | Y |  | 512 |
| recordExecutionQuality | method |  |  | 533 |
| getExecutionQuality | method |  |  | 544 |
| getExecution | method |  |  | 559 |
| listExecutions | method |  |  | 568 |
| cancel | method | Y |  | 577 |
| getHealth | method |  |  | 587 |

### packages\core\src\execution\UserAskService.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| setAskEventBus | fn |  | Y | 33 |
| createAskUserTool | fn |  | Y | 38 |
| answerAsk | fn |  | Y | 108 |
| getPendingAsks | fn |  | Y | 120 |

### packages\core\src\execution\fabric\ExecutionFabric.ts（16 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 97 |
| registerAgentCapabilities | method |  |  | 118 |
| snapshotMemoryState | method |  |  | 138 |
| unregisterAgent | method |  |  | 158 |
| getAgent | method |  |  | 166 |
| setAgentStatus | method |  |  | 173 |
| listAgents | method |  |  | 183 |
| getPoolCapabilities | method |  |  | 192 |
| resolveCapability | method |  |  | 215 |
| resolveMultipleCapabilities | method |  |  | 260 |
| findCoverage | method |  |  | 270 |
| execute | method | Y |  | 315 |
| executePipeline | method | Y |  | 413 |
| getFabricStatus | method |  |  | 475 |
| invalidateCache | method |  |  | 498 |
| delay | method |  |  | 503 |

### packages\core\src\execution\fabric\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\execution\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\execution\orchestration\AgentSessionStore.ts（11 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 82 |
| rootPath | getter |  |  | 87 |
| createSession | method | Y |  | 94 |
| open | method | Y |  | 117 |
| list | method | Y |  | 124 |
| fork | method | Y |  | 139 |
| appendCustom | method | Y |  | 159 |
| appendSessionName | method | Y |  | 171 |
| readEntries | method | Y |  | 189 |
| normalizeEntry | fn |  |  | 212 |
| contentToText | fn |  |  | 258 |

### packages\core\src\execution\orchestration\OrchestratorAgent.ts（19 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| tokenCount | fn |  |  | 132 |
| extractJsonObject | fn |  |  | 139 |
| toStringList | fn |  |  | 151 |
| sanitizeSessionId | fn |  |  | 156 |
| previewText | fn |  |  | 161 |
| parseAnalysis | fn |  |  | 171 |
| ANALYSIS_PROMPT | const-fn |  |  | 195 |
| AUDIT_PROMPT | const-fn |  |  | 211 |
| REPLAN_PROMPT | const-fn |  |  | 226 |
| SYNTHESIS_PROMPT | const-fn |  |  | 243 |
| (anon) | ctor |  |  | 260 |
| run | method | Y |  | 268 |
| chargeTokens | const-fn |  |  | 276 |
| capSteps | const-fn |  |  | 283 |
| executeSteps | method | Y |  | 538 |
| ensureStepSession | const-fn | Y |  | 549 |
| formatResults | method |  |  | 629 |
| snapshotStepResults | method |  |  | 640 |
| writePlanFile | method |  |  | 670 |

### packages\core\src\execution\runtime\ExecutionContext.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\execution\runtime\MorPexRuntime.ts（10 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 89 |
| setOntology | method |  |  | 120 |
| setEventStore | method |  |  | 123 |
| setContextAssemblyEngine | method |  |  | 126 |
| setPlanner | method |  |  | 131 |
| setForcedQueryGuard | method |  |  | 135 |
| setPiBridge | method |  |  | 137 |
| setEvaluationEngine | method |  |  | 139 |
| run | method | Y |  | 141 |
| learnFromVerification | method |  |  | 725 |

### packages\core\src\execution\runtime\PersistentArtifactStore.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 10 |
| init | method | Y |  | 14 |
| save | method |  |  | 28 |
| transition | method |  |  | 41 |
| get | method |  |  | 59 |
| getByTask | method |  |  | 60 |
| replay | method |  |  | 62 |

### packages\core\src\execution\runtime\PersistentMissionStore.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 14 |
| init | method | Y |  | 16 |
| append | method | Y |  | 29 |
| get | method |  |  | 36 |
| getAll | method |  |  | 37 |
| apply | method |  |  | 40 |
| applyDirect | method |  |  | 56 |

### packages\core\src\execution\runtime\PipelineOrchestrator.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 15 |
| setWorkflowRegistry | method |  |  | 25 |
| orchestrate | method | Y |  | 29 |

### packages\core\src\execution\runtime\ServiceContainer.ts（16 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| eventStore | getter |  |  | 76 |
| getContextPersistence | method |  |  | 90 |
| recallTaskContext | method | Y |  | 103 |
| recallTaskForAgent | method | Y |  | 120 |
| (anon) | ctor |  |  | 149 |
| setOntology | method |  |  | 239 |
| setContextAssemblyEngine | method |  |  | 249 |
| registerRealProviders | method |  |  | 257 |
| ready | getter |  |  | 271 |
| createEventStoreAppender | method |  |  | 282 |
| initEventStore | method | Y |  | 292 |
| createOrchestratorAgent | method |  |  | 333 |
| createMissionRuntime | method |  |  | 414 |
| createDAGRuntime | method |  |  | 419 |
| ensurePiBridge | method | Y |  | 567 |
| initLearningPersistence | method | Y |  | 587 |

### packages\core\src\execution\runtime\approval\ApprovalEngine.ts（12 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 53 |
| requestApproval | method | Y |  | 83 |
| approve | method | Y |  | 190 |
| deny | method | Y |  | 245 |
| getPendingForMission | method |  |  | 301 |
| getPending | method |  |  | 312 |
| hasPending | method |  |  | 322 |
| getRequest | method |  |  | 332 |
| getAllRequests | method |  |  | 341 |
| expire | method | Y |  | 354 |
| clearTimeout | method |  |  | 389 |
| generateId | method |  |  | 400 |

### packages\core\src\execution\runtime\approval\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\execution\runtime\approval\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\execution\runtime\budget\BudgetManager.ts（8 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 63 |
| check | method |  |  | 73 |
| consume | method |  |  | 115 |
| trackStep | method |  |  | 130 |
| getStatus | method |  |  | 142 |
| reset | method |  |  | 193 |
| getConfig | method |  |  | 200 |
| getStats | method |  |  | 207 |

### packages\core\src\execution\runtime\budget\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\execution\runtime\checkpoint\CheckpointManager.ts（13 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 62 |
| ensureTable | method |  |  | 71 |
| save | method | Y |  | 86 |
| load | method | Y |  | 105 |
| saveMissionCheckpoint | method | Y |  | 126 |
| loadMissionCheckpoint | method | Y |  | 145 |
| listCheckpoints | method | Y |  | 166 |
| list | method | Y |  | 190 |
| cleanup | method | Y |  | 209 |
| delete | method | Y |  | 238 |
| getPath | method |  |  | 251 |
| hydrateSnapshot | method |  |  | 255 |
| toMissionCheckpoint | method |  |  | 265 |

### packages\core\src\execution\runtime\checkpoint\RecoveryManager.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| recover | method | Y |  | 33 |
| determineAction | method |  |  | 72 |
| getFailedNodes | method |  |  | 136 |
| getCompletedNodes | method |  |  | 145 |
| getPendingNodes | method |  |  | 154 |
| summarize | method |  |  | 163 |

### packages\core\src\execution\runtime\checkpoint\ReplayEngine.ts（5 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 22 |
| replay | method | Y |  | 30 |
| replayFast | method | Y |  | 116 |
| topologicalSort | method |  |  | 124 |
| waitForStep | method |  |  | 160 |

### packages\core\src\execution\runtime\checkpoint\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\execution\runtime\compensation\CompensationEngine.ts（8 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| registerSaga | method |  |  | 54 |
| recordExecution | method |  |  | 65 |
| compensate | method | Y |  | 81 |
| canCompensate | method |  |  | 137 |
| getSagas | method |  |  | 145 |
| getStats | method |  |  | 152 |
| findSagaForTask | method |  |  | 160 |
| executeCompensation | method | Y |  | 167 |

### packages\core\src\execution\runtime\compensation\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\execution\runtime\dag\DAGRuntime.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 54 |
| executionTrace | getter |  |  | 66 |
| ctxMeta | method |  |  | 71 |
| run | method | Y |  | 82 |
| resetTrace | method |  |  | 261 |
| buildResult | method |  |  | 265 |
| sleep | method |  |  | 302 |

### packages\core\src\execution\runtime\dag\DependencyResolver.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 19 |
| getDependencies | method |  |  | 26 |
| areDependenciesMet | method |  |  | 34 |
| getBlockedNodes | method |  |  | 48 |
| resolveAll | method |  |  | 58 |
| hasCycle | method |  |  | 91 |
| detectCycle | method |  |  | 103 |

### packages\core\src\execution\runtime\dag\ParallelExecutor.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| executeAll | method | Y |  | 20 |
| executeWithConcurrency | method | Y |  | 36 |
| worker | const-fn | Y |  | 44 |
| getSummary | method |  |  | 63 |

### packages\core\src\execution\runtime\dag\Scheduler.ts（5 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 20 |
| maxParallel | getter |  |  | 27 |
| maxParallel | setter |  |  | 28 |
| schedule | method |  |  | 33 |
| getStatus | method |  |  | 61 |

### packages\core\src\execution\runtime\dag\StepAgentExecutor.ts（18 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| isToolFailureOutput | fn |  |  | 46 |
| isSafetyBlockedOutput | fn |  |  | 56 |
| classifyStepOutput | fn |  | Y | 65 |
| classifyStepError | fn |  | Y | 76 |
| buildStepSystemPrompt | fn |  |  | 153 |
| formatUpstreamResults | fn |  |  | 177 |
| formatUpstreamSessionRefs | fn |  |  | 189 |
| sanitizeSessionId | fn |  |  | 196 |
| previewText | fn |  |  | 201 |
| (anon) | ctor |  |  | 213 |
| executeStep | method | Y |  | 224 |
| flushStream | const-fn |  |  | 329 |
| emitStepStarted | method |  |  | 465 |
| emitStepResult | method |  |  | 489 |
| recordStepResult | method | Y |  | 514 |
| withSessionMeta | method | Y |  | 537 |
| withTimeout | method | Y |  | 552 |
| extractText | fn |  | Y | 569 |

### packages\core\src\execution\runtime\dag\TaskGraph.ts（16 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 14 |
| id | getter |  |  | 18 |
| nodes | getter |  |  | 19 |
| edges | getter |  |  | 20 |
| addNode | method |  |  | 22 |
| getNode | method |  |  | 26 |
| addEdge | method |  |  | 30 |
| getReadyNodes | method |  |  | 37 |
| getRunningNodes | method |  |  | 53 |
| getFailedNodes | method |  |  | 60 |
| isComplete | method |  |  | 67 |
| isSuccess | method |  |  | 76 |
| topologicalSort | method |  |  | 83 |
| getStatus | method |  |  | 121 |
| fromExecutionDAG | method |  |  | 135 |
| toExecutionDAG | method |  |  | 149 |

### packages\core\src\execution\runtime\dag\TaskNode.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 41 |
| setHandler | method |  |  | 52 |
| isReady | getter |  |  | 56 |
| canRetry | getter |  |  | 60 |
| execute | method | Y |  | 64 |
| reset | method |  |  | 105 |
| toDAGNode | method |  |  | 114 |

### packages\core\src\execution\runtime\dag\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\execution\runtime\dag\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\execution\runtime\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\execution\runtime\mission\MissionController.ts（15 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 13 |
| setPersistentStore | method |  |  | 18 |
| setEventStore | method |  |  | 26 |
| createMission | method | Y |  | 30 |
| updateMission | method |  |  | 63 |
| addBlock | method |  |  | 96 |
| resolveBlock | method |  |  | 118 |
| autoRecover | method |  |  | 135 |
| addRisk | method |  |  | 173 |
| getMission | method |  |  | 180 |
| listMissions | method |  |  | 181 |
| getActiveMissions | method |  |  | 184 |
| getBlockedMissions | method |  |  | 185 |
| recover | method |  |  | 191 |
| getAllMissions | method |  |  | 224 |

### packages\core\src\execution\runtime\mission\MissionRuntime.ts（21 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 166 |
| setPlanner | method |  |  | 202 |
| setExecutor | method |  |  | 212 |
| setEventStore | method |  |  | 225 |
| createMission | method | Y |  | 249 |
| createMissionFromGoal | method | Y |  | 306 |
| getMission | method |  |  | 361 |
| getProjectedMission | method | Y |  | 376 |
| listProjectedMissions | method | Y |  | 408 |
| listMissions | method |  |  | 425 |
| listActiveMissions | method |  |  | 438 |
| countMissions | method |  |  | 449 |
| executeMission | method | Y |  | 471 |
| finalizeExecution | method | Y |  | 643 |
| approveMission | method | Y |  | 772 |
| denyMission | method | Y |  | 878 |
| cancelMission | method | Y |  | 917 |
| transitionState | method | Y |  | 947 |
| stateToEventType | method |  |  | 1020 |
| generateId | method |  |  | 1093 |
| getStats | method |  |  | 1107 |

### packages\core\src\execution\runtime\mission\MissionTypes.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\execution\runtime\mission\adapters\DAGExecutorAdapter.ts（5 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 44 |
| ready | getter |  |  | 52 |
| execute | method | Y |  | 66 |
| convertPlanToDAG | method |  |  | 135 |
| simulatedResult | method |  |  | 177 |

### packages\core\src\execution\runtime\mission\adapters\MetaPlannerAdapter.ts（8 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 44 |
| ready | getter |  |  | 52 |
| createPlan | method | Y |  | 65 |
| replan | method | Y |  | 160 |
| extractConstraint | method |  |  | 173 |
| fallbackPlan | method |  |  | 201 |
| buildFallbackSteps | method |  |  | 225 |
| evaluateRisk | method |  |  | 278 |

### packages\core\src\execution\runtime\mission\adapters\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\execution\runtime\mission\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\execution\runtime\mission\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\execution\runtime\sandbox\SandboxManager.ts（13 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| execute | method | Y |  | 86 |
| validateTask | method |  |  | 128 |
| getDefaultContext | method |  |  | 140 |
| getThirdPartySandboxContext | method |  |  | 144 |
| registerAgentBehavior | method |  |  | 148 |
| getAgentRiskScore | method |  |  | 153 |
| getHighRiskAgentIds | method |  |  | 168 |
| getStats | method |  |  | 176 |
| detectLanguage | method |  |  | 193 |
| executeCode | method | Y |  | 212 |
| executeCodeFromArtifact | method | Y |  | 253 |
| runSandboxed | method | Y |  | 270 |
| executeAction | method | Y |  | 296 |

### packages\core\src\execution\runtime\sandbox\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\execution\runtime\sandbox\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\execution\runtime\simulation\ExecutionSimulator.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| simulate | method |  |  | 22 |

### packages\core\src\execution\runtime\simulation\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\execution\runtime\state-machine\ExecutionFSM.ts（28 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 115 |
| setMetadata | method |  |  | 136 |
| getMetadata | method |  |  | 139 |
| currentState | getter |  |  | 145 |
| executionId | getter |  |  | 146 |
| history | getter |  |  | 147 |
| createdAt | getter |  |  | 148 |
| updatedAt | getter |  |  | 149 |
| isTerminal | getter |  |  | 151 |
| isRunning | getter |  |  | 157 |
| canTransition | method |  |  | 166 |
| getAllowedNextStates | method |  |  | 174 |
| transition | method |  |  | 182 |
| startPlanning | method |  |  | 248 |
| markReady | method |  |  | 252 |
| startExecution | method |  |  | 256 |
| wait | method |  |  | 260 |
| resume | method |  |  | 264 |
| review | method |  |  | 268 |
| recover | method |  |  | 272 |
| complete | method |  |  | 276 |
| fail | method |  |  | 280 |
| cancel | method |  |  | 284 |
| persist | method | Y |  | 293 |
| restore | method | Y |  | 310 |
| listExecutions | method | Y |  | 343 |
| getAuditLog | method |  |  | 359 |
| getStats | method |  |  | 366 |

### packages\core\src\execution\runtime\state-machine\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\execution\runtime\verification\VerificationEngine.ts（8 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 40 |
| verify | method | Y |  | 54 |
| verifyArtifact | method | Y |  | 115 |
| checkStepCompletion | method |  |  | 174 |
| checkOutputPresence | method |  |  | 221 |
| checkErrorAbsence | method |  |  | 252 |
| checkArtifactIntegrity | method |  |  | 294 |
| buildSummary | method |  |  | 323 |

### packages\core\src\execution\runtime\verification\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\execution\runtime\verification\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\execution\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\facade\CompanyFacade.ts（21 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 59 |
| ensureBootstrapped | method | Y |  | 91 |
| createDepartment | method | Y |  | 103 |
| setLLMProvider | method |  |  | 117 |
| setChatStreamer | method |  |  | 123 |
| setContextAssemblyEngine | method |  |  | 131 |
| sendTask | method | Y |  | 138 |
| getDepartmentStatus | method |  |  | 147 |
| listDepartments | method |  |  | 148 |
| getStats | method |  |  | 149 |
| executeGoal | method | Y |  | 151 |
| generateDailyReport | method | Y |  | 291 |
| searchAcrossDepartments | method | Y |  | 301 |
| setBrainFacade | method |  |  | 303 |
| setTeamOrchestrator | method |  |  | 306 |
| getTeams | method |  |  | 311 |
| getTeam | method |  |  | 316 |
| setGoalIntelligenceFacade | method |  |  | 320 |
| setFeedbackService | method |  |  | 323 |
| setOntology | method |  |  | 324 |
| setCEO | method |  |  | 325 |

### packages\core\src\facade\gateway\ExecutionGateway.ts（10 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 49 |
| registerAdapter | method |  |  | 61 |
| unregisterAdapter | method |  |  | 85 |
| setRecordingEngine | method |  |  | 99 |
| getAdapterNames | method |  |  | 106 |
| execute | method | Y |  | 119 |
| abort | method | Y |  | 196 |
| health | method |  |  | 212 |
| getDefaultAdapter | method |  |  | 232 |
| emitRuntimeEvent | method |  |  | 241 |

### packages\core\src\facade\gateway\adapters\PiAdapter.ts（8 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 52 |
| bridgeRuntimeEvents | method |  |  | 78 |
| mapPiEvent | method |  |  | 130 |
| execute | method | Y |  | 160 |
| abort | method | Y |  | 219 |
| subscribe | method |  |  | 236 |
| health | method |  |  | 246 |
| dispose | method |  |  | 262 |

### packages\core\src\facade\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\gate\ForcedQueryGuard.ts（14 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| recordToolCall | method |  |  | 30 |
| assertQueried | method |  |  | 61 |
| validateReferences | method |  |  | 76 |
| getTrace | method |  |  | 92 |
| getRetrievedIds | method |  |  | 99 |
| clear | method |  |  | 106 |
| setOnTrace | method |  |  | 117 |
| setMissionId | method |  |  | 124 |
| flushTrace | method | Y |  | 132 |
| flushAllTraces | method | Y |  | 142 |
| clearAll | method |  |  | 152 |
| extractIds | method |  |  | 159 |
| walk | const-fn |  |  | 161 |
| safeStringify | method |  |  | 179 |

### packages\core\src\gate\context.ts（5 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 43 |
| (anon) | ctor |  |  | 51 |
| requireKnowledgeContext | fn |  | Y | 64 |
| assertWriteAllowed | method |  |  | 105 |
| assertNotPromoted | method |  |  | 128 |

### packages\core\src\gate\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\gate\modelVisibleLog.ts（13 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 67 |
| encodeContextSnapshotKey | fn |  | Y | 84 |
| parseContextSnapshotKey | fn |  | Y | 88 |
| encodeDeblackboxKey | fn |  | Y | 104 |
| parseDeblackboxKey | fn |  | Y | 108 |
| newId | fn |  |  | 118 |
| createContextPackageEntry | fn |  | Y | 123 |
| createDeblackboxEntry | fn |  | Y | 139 |
| contextPersistenceResolver | fn |  | Y | 156 |
| deblackboxResolver | fn |  | Y | 177 |
| composeResolvers | fn |  | Y | 196 |
| assertModelVisibleLogged | fn |  | Y | 215 |
| reconstructContext | fn |  | Y | 232 |

### packages\core\src\gate\ontologyEvents.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| createQueryPerformedEvent | fn |  | Y | 64 |
| createQueryMissEvent | fn |  | Y | 111 |
| createReferenceValidationFailedEvent | fn |  | Y | 144 |

### packages\core\src\gate\rules\DetectorRegistry.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| registerDetector | method |  |  | 24 |
| getDetector | method |  |  | 29 |
| has | method |  |  | 34 |
| clear | method |  |  | 39 |

### packages\core\src\gate\rules\RuleEnforcementGuard.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| check | fn |  | Y | 29 |

### packages\core\src\gate\rules\RuleExtractor.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| extractRule | fn | Y | Y | 41 |
| parseExtractionJson | fn |  |  | 78 |

### packages\core\src\gate\rules\RuleRegistry.ts（9 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| register | method |  |  | 22 |
| registerMany | method |  |  | 33 |
| getActiveRules | method |  |  | 43 |
| getRule | method |  |  | 51 |
| getAll | method |  |  | 56 |
| setStatus | method |  |  | 63 |
| isRuleActive | method |  |  | 69 |
| fingerprint | method |  |  | 81 |
| clear | method |  |  | 94 |

### packages\core\src\gate\rules\detectors.ts（11 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| stripCommentsAndStrings | fn |  | Y | 36 |
| extractTargetText | fn |  | Y | 89 |
| check | method |  |  | 113 |
| matchText | fn |  |  | 135 |
| check | method |  |  | 168 |
| check | method |  |  | 213 |
| validateAgainstSchema | fn |  | Y | 252 |
| walk | fn |  |  | 258 |
| matchesType | fn |  |  | 293 |
| typeOf | fn |  |  | 305 |
| check | method |  |  | 314 |

### packages\core\src\gate\rules\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\gate\rules\lexicalCorrection.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| lexicalCorrect | fn |  | Y | 30 |

### packages\core\src\gate\rules\normalize.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| normalizeText | fn |  | Y | 22 |
| normalizePattern | fn |  | Y | 35 |

### packages\core\src\gate\rules\ruleEvents.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| createRuleViolationEvent | fn |  | Y | 63 |
| createRuleDowngradedEvent | fn |  | Y | 108 |

### packages\core\src\gate\rules\rulePersistence.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| saveRule | method |  |  | 16 |
| confirmRule | method |  |  | 24 |
| disableRule | method |  |  | 34 |

### packages\core\src\gate\rules\structuralCorrection.ts（5 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| registerCorrector | method |  |  | 54 |
| getCorrectors | method |  |  | 59 |
| has | method |  |  | 64 |
| clear | method |  |  | 69 |
| applyStructuralCorrection | fn | Y | Y | 91 |

### packages\core\src\gate\rules\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\gate\runOntologyGroundedReasoning.ts（12 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| withGateRetry | fn | Y |  | 57 |
| getCacheKey | fn |  |  | 184 |
| getCachedResult | fn |  |  | 196 |
| countTokens | fn |  |  | 210 |
| setCachedResult | fn |  |  | 218 |
| runOntologyGroundedReasoning | fn | Y | Y | 240 |
| ruleDomainOf | const-fn |  |  | 440 |
| parseQueryPlanRobust | fn |  |  | 832 |
| sanitizeQueryPlan | fn |  |  | 875 |
| extractBalancedJSON | fn |  |  | 906 |
| normalizeProposal | fn |  |  | 954 |
| semanticJudgement | fn | Y |  | 995 |

### packages\core\src\gate\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\governance\AlertEngine.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 11 |
| getInstance | method |  |  | 15 |
| init | method |  |  | 20 |
| emit | method |  |  | 22 |
| getRecent | method |  |  | 31 |
| getByLevel | method |  |  | 32 |
| getAll | method |  |  | 33 |

### packages\core\src\governance\AnomalyDetector.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 42 |
| init | method |  |  | 47 |
| getAnomalies | method |  |  | 54 |
| onStepResult | method |  |  | 60 |
| onAssemblyTelemetry | method |  |  | 88 |
| alert | method |  |  | 95 |

### packages\core\src\governance\ApprovalGate.ts（11 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| getRevision | method |  |  | 68 |
| needsHumanApproval | method |  |  | 72 |
| register | method |  |  | 79 |
| (anon) | ctor |  |  | 89 |
| requestApproval | method |  |  | 91 |
| requestApprovalForAction | method |  |  | 108 |
| decide | method |  |  | 122 |
| getPending | method |  |  | 135 |
| getHistory | method |  |  | 136 |
| getAll | method |  |  | 137 |
| waitForDecision | method | Y |  | 149 |

### packages\core\src\governance\AuditTrail.ts（15 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 55 |
| record | method |  |  | 72 |
| recordRiskAssessment | method |  |  | 110 |
| recordApproval | method |  |  | 132 |
| recordAgentAction | method |  |  | 161 |
| recordGovernanceCheck | method |  |  | 178 |
| query | method |  |  | 205 |
| getForMission | method |  |  | 267 |
| getRecent | method |  |  | 282 |
| generateReport | method |  |  | 299 |
| getStats | method |  |  | 364 |
| toJSON | method |  |  | 397 |
| fromJSON | method |  |  | 406 |
| clear | method |  |  | 429 |
| evictOldest | method |  |  | 443 |

### packages\core\src\governance\ComplianceChecker.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 15 |
| check | method | Y |  | 19 |

### packages\core\src\governance\CostController.ts（11 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| getInstance | method |  |  | 21 |
| resetInstance | method |  |  | 27 |
| init | method |  |  | 31 |
| setBudget | method |  |  | 47 |
| setTokenPrice | method |  |  | 50 |
| recordCost | method |  |  | 52 |
| recordTokens | method |  |  | 57 |
| getUsage | method |  |  | 62 |
| getTokenUsage | method |  |  | 73 |
| getTotalCost | method |  |  | 80 |
| suggestAction | method |  |  | 84 |

### packages\core\src\governance\GovernanceDashboard.ts（14 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 105 |
| recordModuleActivity | method |  |  | 138 |
| recordError | method |  |  | 145 |
| recordCost | method |  |  | 151 |
| recordTaskResult | method |  |  | 159 |
| getDeliveryMetrics | method |  |  | 170 |
| recordLatency | method |  |  | 181 |
| getSystemHealth | method |  |  | 195 |
| getCostReport | method |  |  | 251 |
| getComplianceStatus | method |  |  | 292 |
| checkPiBridgeIsolation | method |  |  | 325 |
| getCostQualityReport | method |  |  | 337 |
| getGovernanceReport | method |  |  | 372 |
| getStats | method |  |  | 407 |

### packages\core\src\governance\PermissionModel.ts（16 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| setPermissions | method |  |  | 113 |
| getPermissions | method |  |  | 123 |
| canExecute | method |  |  | 144 |
| hasPermission | method |  |  | 212 |
| grantPermission | method |  |  | 223 |
| revokePermission | method |  |  | 237 |
| getAllowedDomains | method |  |  | 250 |
| getAllowedTools | method |  |  | 260 |
| cleanupExpired | method |  |  | 269 |
| getAll | method |  |  | 286 |
| removeUser | method |  |  | 295 |
| canAccessSharedMemory | method |  |  | 316 |
| canAgentEvolve | method |  |  | 366 |
| toJSON | method |  |  | 380 |
| fromJSON | method |  |  | 384 |
| mapActionToPermission | method |  |  | 399 |

### packages\core\src\governance\PolicyEngine.ts（22 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| createDefaultRules | fn |  |  | 297 |
| (anon) | ctor |  |  | 353 |
| evaluate | method |  |  | 385 |
| execute | method | Y |  | 419 |
| addRule | method |  |  | 475 |
| removeRule | method |  |  | 480 |
| getRules | method |  |  | 487 |
| setConfig | method |  |  | 491 |
| buildDecision | method |  |  | 497 |
| recordAudit | method |  |  | 510 |
| actionDescription | method |  |  | 526 |
| getConfig | method |  |  | 535 |
| evaluateWorkflow | method |  |  | 557 |
| executeWorkflowDecision | method | Y |  | 654 |
| addWorkflowPolicy | method |  |  | 722 |
| removeWorkflowPolicy | method |  |  | 732 |
| getWorkflowPolicies | method |  |  | 739 |
| getWorkflowPolicy | method |  |  | 748 |
| addAgentPolicy | method |  |  | 761 |
| removeAgentPolicy | method |  |  | 771 |
| getAgentPolicies | method |  |  | 781 |
| evaluateAgentAction | method |  |  | 795 |

### packages\core\src\governance\PolicyRuleRegistry.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| register | method |  |  | 17 |
| getRules | method |  |  | 23 |
| init | method |  |  | 27 |

### packages\core\src\governance\RiskAnalyzer.ts（20 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 36 |
| assessMission | method |  |  | 53 |
| setConfig | method |  |  | 87 |
| getConfig | method |  |  | 95 |
| assessAgentTask | method |  |  | 106 |
| assessAgentPastReliability | method |  |  | 145 |
| assessAgentCollaborationRisk | method |  |  | 170 |
| assessAgentActionRisk | method |  |  | 195 |
| assessAgentTrustLevel | method |  |  | 227 |
| assessStepComplexity | method |  |  | 259 |
| assessDomainSensitivity | method |  |  | 312 |
| assessToolRisk | method |  |  | 353 |
| assessPermissionScope | method |  |  | 395 |
| scoreToLevel | method |  |  | 438 |
| requiresApproval | method |  |  | 453 |
| generateMitigations | method |  |  | 470 |
| computeMaxDependencyDepth | method |  |  | 505 |
| computeDepth | const-fn |  |  | 508 |
| detectCycle | method |  |  | 540 |
| dfs | const-fn |  |  | 549 |

### packages\core\src\governance\RuntimeManager.ts（8 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| getInstance | method |  |  | 16 |
| init | method |  |  | 21 |
| getActiveCount | method |  |  | 34 |
| getActiveContexts | method |  |  | 35 |
| isResourceAvailable | method |  |  | 37 |
| allocateResource | method |  |  | 40 |
| releaseResource | method |  |  | 43 |
| getStatus | method |  |  | 47 |

### packages\core\src\governance\capability\AgentCapabilityRegistry.ts（14 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| registerCapability | method |  |  | 38 |
| addChild | method |  |  | 43 |
| getCapability | method |  |  | 51 |
| getChildren | method |  |  | 53 |
| getTree | method |  |  | 58 |
| build | const-fn |  |  | 61 |
| initCapabilityGraph | method |  |  | 67 |
| register | method |  |  | 105 |
| get | method |  |  | 106 |
| findForCapability | method |  |  | 108 |
| findForCapabilityPath | method |  |  | 114 |
| recordCall | method |  |  | 120 |
| getAll | method |  |  | 130 |
| getActive | method |  |  | 131 |

### packages\core\src\governance\capability\CapabilityDiscoverer.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| discover | method |  |  | 5 |

### packages\core\src\governance\capability\CapabilityRegistry.ts（12 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| register | method |  |  | 37 |
| get | method |  |  | 41 |
| search | method |  |  | 45 |
| findByDomain | method |  |  | 54 |
| getTop | method |  |  | 60 |
| updateSuccessRate | method |  |  | 66 |
| addStep | method |  |  | 73 |
| addExtraction | method |  |  | 78 |
| getAll | method |  |  | 83 |
| count | method |  |  | 87 |
| clear | method |  |  | 91 |
| init | method |  |  | 95 |

### packages\core\src\governance\capability\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\governance\control-plane\AgentController.ts（5 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| findForCapability | method |  |  | 23 |
| selectBestAgent | method |  |  | 32 |
| checkCapabilityAvailable | method |  |  | 51 |
| register | method |  |  | 60 |
| recordCall | method |  |  | 64 |

### packages\core\src\governance\control-plane\ControlPlane.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 36 |
| checkAll | method | Y |  | 53 |
| inferGoalCapabilities | fn |  |  | 156 |

### packages\core\src\governance\control-plane\DepartmentContext.ts（5 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| partitionKey | method |  |  | 38 |
| compositeKey | method |  |  | 53 |
| legacyDepartmentId | method |  |  | 64 |
| isGlobal | method |  |  | 71 |
| parseCompositeKey | method |  |  | 81 |

### packages\core\src\governance\control-plane\DepartmentManager.ts（8 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 30 |
| createDepartment | method | Y |  | 47 |
| getDepartment | method |  |  | 79 |
| findByName | method |  |  | 86 |
| listDepartments | method |  |  | 95 |
| updateDepartment | method | Y |  | 105 |
| deleteDepartment | method | Y |  | 132 |
| getStats | method |  |  | 153 |

### packages\core\src\governance\control-plane\GoalController.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| process | method | Y |  | 26 |

### packages\core\src\governance\control-plane\PolicyController.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| capturePolicySnapshot | method |  |  | 28 |
| hasPolicyChanged | method |  |  | 35 |
| getPolicyRevision | method |  |  | 42 |
| checkAction | method |  |  | 49 |
| evaluate | method | Y |  | 94 |
| registerPolicy | method |  |  | 101 |
| checkGoalPolicy | method |  |  | 108 |

### packages\core\src\governance\control-plane\ResourceController.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| canAllocate | method |  |  | 36 |
| check | method | Y |  | 45 |
| checkAvailability | method |  |  | 52 |
| getBudgetStatus | method |  |  | 76 |
| setQuota | method |  |  | 83 |
| useQuota | method |  |  | 90 |

### packages\core\src\governance\control-plane\RoleRegistry.ts（10 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 27 |
| defineRole | method |  |  | 40 |
| assignRole | method |  |  | 66 |
| unassignRole | method |  |  | 99 |
| getRole | method |  |  | 121 |
| findRolesByName | method |  |  | 128 |
| findRolesByDepartment | method |  |  | 135 |
| getAssignment | method |  |  | 146 |
| listAssignments | method |  |  | 155 |
| getCapabilitiesForAgent | method |  |  | 163 |

### packages\core\src\governance\control-plane\SpaceService.ts（18 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 40 |
| aliasesPath | getter |  |  | 49 |
| loadAliases | method |  |  | 53 |
| setAlias | method |  |  | 65 |
| scanWorkflowProviders | method |  |  | 81 |
| buildDepartmentSpace | method |  |  | 101 |
| emitSpaceCreated | method |  |  | 130 |
| spacesPath | getter |  |  | 143 |
| persist | method |  |  | 147 |
| restore | method |  |  | 160 |
| ensureLoaded | method |  |  | 174 |
| getTree | method |  |  | 181 |
| getSpace | method |  |  | 197 |
| getDepartmentSpace | method |  |  | 202 |
| routeGoal | method |  |  | 208 |
| routingHint | method |  |  | 216 |
| getDefaultDepartmentSpace | method |  |  | 224 |
| refresh | method |  |  | 230 |

### packages\core\src\governance\control-plane\department-types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\governance\control-plane\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\governance\control-plane\space-types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\governance\control-plane\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\governance\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\governance\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\infrastructure\adapters\agent-spawner.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| mapToolForAgent | fn |  | Y | 52 |
| spawn | method | Y |  | 76 |

### packages\core\src\infrastructure\adapters\embedding\EmbeddingProvider.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 28 |
| ready | getter |  |  | 36 |
| model | getter |  |  | 40 |
| embed | method | Y |  | 48 |
| embedOne | method | Y |  | 63 |
| cosine | method |  |  | 69 |
| embedBatch | method | Y |  | 81 |

### packages\core\src\infrastructure\adapters\identity.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| generateShortUUID | fn |  | Y | 17 |
| uuidv7 | fn |  | Y | 29 |

### packages\core\src\infrastructure\adapters\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\infrastructure\adapters\memory\index.ts（10 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| createMemoryWiki | fn |  | Y | 73 |
| createMemoryRetriever | fn |  | Y | 125 |
| initialize | method |  |  | 159 |
| getWiki | method |  |  | 172 |
| getRetriever | method |  |  | 177 |
| isInitialized | method |  |  | 182 |
| getBus | method |  |  | 192 |
| recall | method | Y |  | 199 |
| remember | method | Y |  | 211 |
| reset | method |  |  | 224 |

### packages\core\src\infrastructure\adapters\model-registry.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| getExtraModelInfos | fn |  |  | 36 |
| listCompatModels | fn |  |  | 50 |
| listProviders | method |  |  | 72 |
| listModels | method |  |  | 85 |
| listAllProviders | method |  |  | 93 |
| findModel | method |  |  | 101 |
| getDefaultModel | method |  |  | 111 |

### packages\core\src\infrastructure\adapters\model-resolver.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| getKnownProviderSet | fn |  |  | 13 |
| isKnownProvider | fn |  | Y | 31 |
| resolveModel | fn |  | Y | 38 |

### packages\core\src\infrastructure\adapters\pi-agent-core.d.ts（23 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 35 |
| prompt | method |  |  | 53 |
| abort | method |  |  | 57 |
| on | method |  |  | 58 |
| on | method |  |  | 59 |
| on | method |  |  | 60 |
| create | method |  |  | 64 |
| (anon) | ctor |  |  | 76 |
| create | method |  |  | 77 |
| open | method |  |  | 83 |
| list | method |  |  | 84 |
| delete | method |  |  | 92 |
| fork | method |  |  | 93 |
| uuidv7 | fn |  | Y | 104 |
| (anon) | ctor |  |  | 162 |
| getModels | fn |  | Y | 215 |
| getProviders | fn |  | Y | 216 |
| getModel | fn |  | Y | 217 |
| parseJsonWithRepair | fn |  | Y | 218 |
| clampThinkingLevel | fn |  | Y | 219 |
| getSupportedThinkingLevels | fn |  | Y | 220 |
| completeSimple | fn |  | Y | 223 |
| streamSimple | fn |  | Y | 229 |

### packages\core\src\infrastructure\adapters\pi-ai-types.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| optionalProp | fn |  | Y | 23 |

### packages\core\src\infrastructure\adapters\pi-augmentations.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\infrastructure\adapters\pi-bridge\PiBridge.ts（32 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 28 |
| resolveDefaultModel | fn |  | Y | 43 |
| defaultModel | getter |  |  | 192 |
| setDefaultModel | method |  |  | 200 |
| (anon) | ctor |  |  | 210 |
| init | method | Y |  | 251 |
| initGateway | method | Y |  | 279 |
| buildProvider | method | Y |  | 301 |
| registerExtraProvider | method | Y |  | 358 |
| ready | getter |  |  | 370 |
| listModels | method |  |  | 379 |
| listProviders | method |  |  | 400 |
| findModel | method |  |  | 411 |
| generateText | method | Y |  | 435 |
| generateTextOnce | method | Y |  | 461 |
| recordLlmCall | method |  |  | 562 |
| estimateCost | method |  |  | 621 |
| createAgentHarness | method | Y |  | 641 |
| generateChatStream | method | Y |  | 720 |
| createAgentSessionId | method |  |  | 752 |
| createJsonlSessionRepo | method |  |  | 762 |
| generateUuid | method |  |  | 770 |
| uuidv7 | method |  |  | 779 |
| createNodeEnv | method |  |  | 784 |
| createSessionRepo | method |  |  | 789 |
| AgentHarnessClass | getter |  |  | 794 |
| SessionRepoClass | getter |  |  | 799 |
| NodeEnvClass | getter |  |  | 804 |
| parseModel | method |  |  | 818 |
| extractText | method |  |  | 823 |
| getSharedPiBridge | fn |  | Y | 854 |
| resetSharedPiBridge | fn |  | Y | 864 |

### packages\core\src\infrastructure\adapters\pi-bridge\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\infrastructure\adapters\pi-bridge\yamlConfig.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| isExtraLlmUsable | fn |  | Y | 70 |
| getEnabledExtraLlms | fn |  | Y | 79 |
| parseYaml | fn |  | Y | 89 |
| readEnv | fn |  | Y | 150 |
| resolveEnvRefs | fn |  | Y | 178 |
| loadMorpexConfig | fn |  | Y | 191 |
| loadEmbeddingConfig | fn |  | Y | 234 |

### packages\core\src\infrastructure\adapters\pi-types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\infrastructure\adapters\pi-utils.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\infrastructure\adapters\thinking-level.ts（5 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| getCached | fn |  |  | 22 |
| getSupportedLevels | method |  |  | 38 |
| clampLevel | method |  |  | 49 |
| parseThinkingLevel | method |  |  | 59 |
| clearCache | method |  |  | 64 |

### packages\core\src\infrastructure\common\EncryptionService.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 28 |
| encrypt | method |  |  | 44 |
| decrypt | method |  |  | 57 |

### packages\core\src\infrastructure\common\EventBus.ts（27 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| isProjectedEvent | fn |  | Y | 54 |
| (anon) | ctor |  |  | 116 |
| setContracts | method |  |  | 131 |
| getContracts | method |  |  | 138 |
| setContractValidationEnabled | method |  |  | 146 |
| isContractValidationEnabled | method |  |  | 153 |
| reconcileEvents | method |  |  | 161 |
| validateContract | method |  |  | 168 |
| setCurrentDomain | method |  |  | 184 |
| getCurrentDomain | method |  |  | 193 |
| emit | method |  |  | 200 |
| triggerWildcard | method |  |  | 326 |
| on | method |  |  | 352 |
| once | method |  |  | 364 |
| off | method |  |  | 375 |
| onProjected | method |  |  | 389 |
| getHistory | method |  |  | 403 |
| listenerCount | method |  |  | 414 |
| emitToDomain | method |  |  | 437 |
| onDomain | method |  |  | 504 |
| broadcastCrossDomain | method |  |  | 533 |
| getDomainEventTypes | method |  |  | 571 |
| getRegisteredDomains | method |  |  | 580 |
| getEventTypes | method |  |  | 587 |
| getProjectedHistory | method |  |  | 597 |
| getMetrics | method |  |  | 614 |
| clear | method |  |  | 656 |

### packages\core\src\infrastructure\common\ExecutionIdentity.ts（16 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| shortUUID | fn |  |  | 47 |
| todayDate | fn |  |  | 54 |
| generate | method |  |  | 77 |
| createExecutionId | method |  |  | 82 |
| createTraceId | method |  |  | 87 |
| createSessionId | method |  |  | 92 |
| createEventId | method |  |  | 97 |
| createArtifactId | method |  |  | 102 |
| create | method |  |  | 112 |
| link | method |  |  | 134 |
| getChain | method |  |  | 149 |
| parse | method |  |  | 160 |
| isValid | method |  |  | 173 |
| getType | method |  |  | 180 |
| getDate | method |  |  | 188 |
| clearChains | method |  |  | 196 |

### packages\core\src\infrastructure\common\ModelRegistry.ts（5 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| listProviders | fn |  | Y | 19 |
| listModels | fn |  | Y | 26 |
| listAllProviders | fn |  | Y | 33 |
| findModel | fn |  | Y | 44 |
| getDefaultModel | fn |  | Y | 51 |

### packages\core\src\infrastructure\common\PluginSystem.ts（15 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| getInstance | method |  |  | 47 |
| resetSingleton | method |  |  | 58 |
| (anon) | ctor |  |  | 70 |
| register | method |  |  | 81 |
| get | method |  |  | 110 |
| getAll | method |  |  | 117 |
| startAll | method | Y |  | 131 |
| stopAll | method | Y |  | 163 |
| checkDependencies | method |  |  | 186 |
| getStatus | method |  |  | 202 |
| count | getter |  |  | 214 |
| initializePlugin | method | Y |  | 221 |
| startPlugin | method | Y |  | 245 |
| stopPlugin | method | Y |  | 263 |
| topologicalSort | method |  |  | 286 |

### packages\core\src\infrastructure\common\ProgressCallback.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| makeProgressEvent | fn |  | Y | 56 |

### packages\core\src\infrastructure\common\ThinkingLevelControl.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| getSupportedLevels | fn |  | Y | 34 |
| clampLevel | fn |  | Y | 41 |
| parseThinkingLevel | fn |  | Y | 48 |
| clearModelCache | fn |  | Y | 54 |

### packages\core\src\infrastructure\common\ToolQualityTracker.ts（8 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| recordCall | method |  |  | 62 |
| getStats | method |  |  | 96 |
| getToolStats | method |  |  | 127 |
| getBestTool | method |  |  | 137 |
| getBestToolByCapability | method |  |  | 152 |
| reset | method |  |  | 168 |
| connectToRegistry | method |  |  | 180 |
| getSummary | method |  |  | 192 |

### packages\core\src\infrastructure\common\contracts\eventContractCatalog.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| isRecord | fn |  |  | 27 |
| reqStr | fn |  |  | 32 |
| reqStrArray | fn |  |  | 37 |
| errorsOf | fn |  |  | 44 |
| registerCoreEventContracts | fn |  | Y | 325 |
| getEventContractReconcile | fn |  | Y | 338 |

### packages\core\src\infrastructure\common\eventContract.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| defineContract | fn |  | Y | 65 |
| buildContractMap | fn |  | Y | 72 |
| assertEventContract | fn |  | Y | 91 |
| validateEventPayload | fn |  | Y | 100 |
| enumEventTypes | fn |  | Y | 119 |
| reconcileKnownEvents | fn |  | Y | 146 |

### packages\core\src\infrastructure\common\resilience\CircuitBreaker.ts（9 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 19 |
| (anon) | ctor |  |  | 56 |
| execute | method | Y |  | 72 |
| recordSuccess | method |  |  | 97 |
| recordFailure | method |  |  | 115 |
| getState | method |  |  | 136 |
| getStats | method |  |  | 142 |
| reset | method |  |  | 152 |
| evaluateState | method |  |  | 163 |

### packages\core\src\infrastructure\common\resilience\ErrorHandlerService.ts（12 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 62 |
| registerPolicy | method |  |  | 71 |
| registerBreaker | method |  |  | 78 |
| executeWithRecovery | method | Y |  | 92 |
| getErrorLog | method |  |  | 181 |
| getBreakerStates | method |  |  | 191 |
| resetBreaker | method |  |  | 202 |
| resetAllBreakers | method |  |  | 209 |
| getPolicy | method |  |  | 217 |
| getOrCreateBreaker | method |  |  | 221 |
| emitError | method |  |  | 236 |
| delay | method |  |  | 261 |

### packages\core\src\infrastructure\common\resilience\RetryPolicy.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 48 |
| getDelay | method |  |  | 62 |
| shouldRetry | method |  |  | 96 |
| fast | method |  |  | 119 |
| standard | method |  |  | 124 |
| robust | method |  |  | 129 |
| noRetry | method |  |  | 134 |

### packages\core\src\infrastructure\common\resilience\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\infrastructure\common\secureExec.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| scrubEnv | fn |  | Y | 36 |
| runCommand | fn |  | Y | 91 |
| finish | const-fn |  |  | 127 |
| makePrivateTempDir | fn | Y | Y | 171 |
| randomPrivateFilePath | fn |  | Y | 182 |
| writeExclusive | fn | Y | Y | 192 |
| cleanupTempDir | fn | Y | Y | 206 |

### packages\core\src\infrastructure\common\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\infrastructure\observability\CompactionService.ts（13 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 64 |
| compact | method | Y |  | 77 |
| startAuto | method |  |  | 105 |
| stopAuto | method |  |  | 115 |
| getDbStats | method |  |  | 125 |
| getConfig | method |  |  | 137 |
| pruneOldEvents | method |  |  | 143 |
| pruneSnapshots | method |  |  | 150 |
| pruneArtifactVersions | method |  |  | 169 |
| vacuum | method |  |  | 188 |
| getDbFileSize | method |  |  | 193 |
| getWalFileSize | method |  |  | 199 |
| shouldCompactBySize | method |  |  | 205 |

### packages\core\src\infrastructure\observability\HealthCheckService.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 27 |
| register | method |  |  | 31 |
| unregister | method |  |  | 35 |
| run | method | Y |  | 39 |

### packages\core\src\infrastructure\observability\MetricsCollector.ts（13 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 31 |
| record | method |  |  | 42 |
| getSeries | method |  |  | 70 |
| getLatest | method |  |  | 86 |
| aggregate | method |  |  | 100 |
| getMetricNames | method |  |  | 119 |
| reset | method |  |  | 126 |
| recordTeamFormation | method |  |  | 133 |
| recordSharedMemoryConflict | method |  |  | 139 |
| recordMarketplaceBid | method |  |  | 144 |
| recordDistributedMessage | method |  |  | 149 |
| recordCircuitBreakerTrip | method |  |  | 155 |
| getV9Metrics | method |  |  | 160 |

### packages\core\src\infrastructure\observability\ObservabilityBootstrap.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| bootstrapObservability | fn |  | Y | 29 |

### packages\core\src\infrastructure\observability\PrometheusExporter.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 23 |
| export | method |  |  | 25 |
| exportV9Json | method |  |  | 67 |
| getApproxCpuPercent | method |  |  | 71 |

### packages\core\src\infrastructure\observability\TraceManager.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| startSpan | method |  |  | 45 |
| endSpan | method |  |  | 74 |
| getTrace | method |  |  | 91 |
| getActiveTraces | method |  |  | 120 |
| exportTree | method |  |  | 137 |
| render | const-fn |  |  | 156 |

### packages\core\src\infrastructure\observability\WorkflowMetrics.ts（10 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| recordExecution | method |  |  | 41 |
| recordRetry | method |  |  | 53 |
| recordHumanIntervention | method |  |  | 60 |
| recordSandboxRejection | method |  |  | 67 |
| recordBudgetLimit | method |  |  | 74 |
| recordVerification | method |  |  | 81 |
| setActiveCount | method |  |  | 88 |
| snapshot | method |  |  | 95 |
| getStats | method |  |  | 125 |
| reset | method |  |  | 132 |

### packages\core\src\infrastructure\observability\deblackbox\DeblackboxDetailStore.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| attachDatabase | method |  |  | 53 |
| isPersistent | getter |  |  | 61 |
| append | method |  |  | 66 |
| queryByCategory | method |  |  | 94 |
| deleteBefore | method |  |  | 109 |
| count | method |  |  | 126 |
| rowToRecord | method |  |  | 138 |

### packages\core\src\infrastructure\observability\deblackbox\DeblackboxRecorder.ts（17 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| configure | method |  |  | 71 |
| isConfigured | getter |  |  | 90 |
| getRecordPolicy | method |  |  | 94 |
| getDetailStore | method |  |  | 98 |
| record | method |  |  | 110 |
| recordDecision | method |  |  | 157 |
| recordStateSnapshot | method |  |  | 172 |
| stats | method |  |  | 199 |
| getRecent | method |  |  | 204 |
| on | method |  |  | 210 |
| emit | method |  |  | 218 |
| buildDecision | method |  |  | 230 |
| writeDecision | method | Y |  | 259 |
| writeSummary | method | Y |  | 264 |
| writeDetail | method |  |  | 278 |
| getSharedDeblackboxRecorder | fn |  | Y | 300 |
| resetSharedDeblackboxRecorder | fn |  | Y | 308 |

### packages\core\src\infrastructure\observability\deblackbox\RecordCleaner.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 34 |
| getLastRun | method |  |  | 40 |
| runCleanup | method |  |  | 50 |
| schedule | method |  |  | 91 |
| tick | const-fn |  |  | 93 |
| stop | method |  |  | 114 |
| deleteByCategory | method |  |  | 121 |

### packages\core\src\infrastructure\observability\deblackbox\RecordPolicy.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 60 |
| shouldRecord | method |  |  | 73 |
| shouldRecordDetail | method |  |  | 86 |
| getTtlMs | method |  |  | 99 |
| setSamplingRate | method |  |  | 108 |
| setTtl | method |  |  | 114 |
| snapshot | method |  |  | 119 |

### packages\core\src\infrastructure\observability\deblackbox\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\infrastructure\observability\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\infrastructure\protocol\contracts\artifact-lifecycle.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\infrastructure\protocol\contracts\goal.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\infrastructure\protocol\events\BaseEvent.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| isStandardEvent | fn |  | Y | 69 |
| isEventInLayer | fn |  | Y | 80 |
| extractEventLayer | fn |  | Y | 95 |

### packages\core\src\infrastructure\protocol\events\DecisionEvent.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| createDecisionEvent | fn |  | Y | 112 |
| decisionToBaseEvent | fn |  | Y | 131 |

### packages\core\src\infrastructure\protocol\events\EventType.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| getAllEventTypes | fn |  | Y | 415 |

### packages\core\src\infrastructure\protocol\events\EventTypes.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\infrastructure\protocol\events\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\infrastructure\protocol\events\store\EventProjection.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| projectMission | method |  |  | 79 |
| projectSystem | method |  |  | 187 |
| validateStream | method |  |  | 237 |
| rebuildState | method |  |  | 293 |

### packages\core\src\infrastructure\protocol\events\store\EventRepository.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 48 |
| query | method | Y |  | 58 |
| getLatest | method | Y |  | 106 |
| count | method | Y |  | 116 |
| aggregate | method | Y |  | 125 |
| getTimeline | method | Y |  | 158 |
| getStateAt | method | Y |  | 171 |

### packages\core\src\infrastructure\protocol\events\store\IEventStore.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\infrastructure\protocol\events\store\SqliteEventStore.ts（23 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 427 |
| enableAutoCompaction | method |  |  | 438 |
| disableAutoCompaction | method |  |  | 458 |
| append | method | Y |  | 469 |
| appendBatch | method | Y |  | 489 |
| appendDecision | method | Y |  | 517 |
| query | method | Y |  | 539 |
| queryDecisions | method | Y |  | 551 |
| replay | method | Y |  | 563 |
| getLatestSequence | method | Y |  | 574 |
| getStats | method | Y |  | 579 |
| clear | method | Y |  | 604 |
| close | method | Y |  | 610 |
| getDatabase | method |  |  | 620 |
| initialize | method |  |  | 628 |
| nextSequence | method |  |  | 647 |
| buildWhereClause | method |  |  | 651 |
| buildDecisionWhereClause | method |  |  | 668 |
| rowToEvent | method |  |  | 683 |
| rowToDecision | method |  |  | 696 |
| getCompactionService | method |  |  | 715 |
| _getBetterSqlite3 | fn | Y |  | 735 |
| createSqliteEventStore | fn | Y | Y | 754 |

### packages\core\src\infrastructure\protocol\events\store\UnifiedEventStore.ts（20 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 31 |
| init | method | Y |  | 46 |
| ensureDb | method | Y |  | 58 |
| append | method | Y |  | 67 |
| appendBatch | method | Y |  | 72 |
| appendDecision | method | Y |  | 77 |
| query | method | Y |  | 82 |
| queryDecisions | method | Y |  | 87 |
| replay | method |  |  | 92 |
| lazyReplay | method | Y |  | 99 |
| getLatestSequence | method | Y |  | 104 |
| replayStream | method | Y |  | 114 |
| replayByType | method | Y |  | 119 |
| getSystemStats | method | Y |  | 124 |
| getStats | method | Y |  | 138 |
| clear | method | Y |  | 143 |
| close | method | Y |  | 148 |
| getDatabase | method |  |  | 165 |
| enableAutoCompaction | method | Y |  | 177 |
| disableAutoCompaction | method | Y |  | 185 |

### packages\core\src\infrastructure\protocol\events\store\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\infrastructure\protocol\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\infrastructure\protocol\message-gateway.ts（17 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 51 |
| running | getter |  |  | 58 |
| registeredAdapters | getter |  |  | 65 |
| activeSessionCount | getter |  |  | 72 |
| start | method | Y |  | 85 |
| stop | method | Y |  | 125 |
| registerAdapter | method |  |  | 165 |
| unregisterAdapter | method |  |  | 195 |
| getAdapter | method |  |  | 212 |
| setMessageHandler | method |  |  | 228 |
| clearMessageHandler | method |  |  | 235 |
| receive | method | Y |  | 251 |
| trackSession | method |  |  | 355 |
| getSession | method |  |  | 379 |
| listSessions | method |  |  | 386 |
| pruneSessions | method |  |  | 396 |
| closeSession | method |  |  | 415 |

### packages\core\src\infrastructure\protocol\message-types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\infrastructure\tools\DomainPrimitiveRegistry.ts（13 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| register | method |  |  | 74 |
| registerMultiple | method |  |  | 94 |
| effect | method |  |  | 128 |
| unregister | method |  |  | 150 |
| match | method |  |  | 157 |
| matchBest | method |  |  | 180 |
| execute | method | Y |  | 187 |
| get | method |  |  | 208 |
| list | method |  |  | 212 |
| listNames | method |  |  | 216 |
| isRegistered | method |  |  | 220 |
| getStats | method |  |  | 224 |
| clear | method |  |  | 239 |

### packages\core\src\infrastructure\tools\ForkExecuteTool.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 40 |
| execute | method | Y |  | 44 |
| createForkExecuteTool | fn |  | Y | 105 |

### packages\core\src\infrastructure\tools\ReadArtifactTool.ts（8 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 26 |
| execute | method | Y |  | 30 |
| getSummary | method |  |  | 66 |
| extractSection | method |  |  | 87 |
| getSections | method |  |  | 114 |
| formatContent | method |  |  | 123 |
| escapeRegex | method |  |  | 129 |
| createReadArtifactTool | fn |  | Y | 134 |

### packages\core\src\infrastructure\tools\TeamSayTool.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 42 |
| execute | method | Y |  | 47 |
| createTeamSayTool | fn |  | Y | 83 |

### packages\core\src\infrastructure\tools\ToolExecutionProxy.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 32 |
| execute | method | Y |  | 42 |
| terminateWorker | method |  |  | 128 |
| cleanup | method |  |  | 137 |
| abortAll | method | Y |  | 144 |
| (anon) | ctor |  |  | 155 |

### packages\core\src\infrastructure\tools\ToolFactory.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 78 |
| setLLMCaller | method |  |  | 83 |
| generateToolForTask | method | Y |  | 87 |
| matchPreset | method |  |  | 121 |
| llmGenerate | method | Y |  | 135 |
| generateCodeImpl | method |  |  | 169 |
| generateAndRegister | method | Y |  | 181 |

### packages\core\src\infrastructure\tools\ToolRegistry.ts（10 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| init | method |  |  | 36 |
| register | method | Y |  | 40 |
| get | method |  |  | 73 |
| findByName | method |  |  | 77 |
| list | method |  |  | 81 |
| updateStats | method |  |  | 86 |
| getTopTools | method |  |  | 111 |
| clear | method |  |  | 121 |
| getStats | method |  |  | 125 |
| getQualityReport | method |  |  | 137 |

### packages\core\src\infrastructure\tools\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\infrastructure\tools\memory-search-tool.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| textContent | fn |  |  | 19 |
| createMemorySearchTool | fn |  | Y | 23 |

### packages\core\src\infrastructure\tools\ontologyTools.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| createOntologyToolExecutor | fn |  | Y | 101 |

### packages\core\src\infrastructure\tools\paramCompleter.ts（5 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| getRequiredParams | fn |  | Y | 19 |
| validatePrimitiveParams | fn |  | Y | 25 |
| buildExtractPrompt | fn |  | Y | 39 |
| isGenerativePrimitive | fn |  | Y | 56 |
| inferArtifactType | fn |  | Y | 64 |

### packages\core\src\infrastructure\tools\primitiveAgentTools.ts（10 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| isEmptyValue | fn |  |  | 121 |
| enrichSchemaForTool | fn |  |  | 133 |
| validateRequiredParams | fn |  | Y | 160 |
| buildMissingParamMessage | fn |  | Y | 179 |
| createPrimitiveAgentTools | fn |  | Y | 207 |
| recallTaskTool | fn |  |  | 299 |
| createPrimitiveBeforeToolCall | fn |  | Y | 342 |
| listPrimitiveAgentToolNames | fn |  | Y | 378 |
| createMailTool | fn |  |  | 387 |
| sayUnavailable | const-fn |  |  | 390 |

### packages\core\src\infrastructure\tools\primitives\APICallPrimitive.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| setHttpExecutor | method |  |  | 52 |
| canHandle | method |  |  | 65 |
| execute | method | Y |  | 76 |

### packages\core\src\infrastructure\tools\primitives\ArtifactGenerationPrimitive.ts（10 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| setPiBridge | fn |  | Y | 42 |
| getPiBridge | fn |  |  | 50 |
| initializeOntologyGateForArtifact | fn |  | Y | 57 |
| getOntologyGuard | fn |  |  | 70 |
| setVerificationHook | method |  |  | 146 |
| registerGenerator | method |  |  | 154 |
| setLLMCaller | method |  |  | 161 |
| setFileWriter | method |  |  | 168 |
| canHandle | method |  |  | 172 |
| execute | method | Y |  | 183 |

### packages\core\src\infrastructure\tools\primitives\FileOperationPrimitive.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| setConnectorExecutor | method |  |  | 55 |
| canHandle | method |  |  | 61 |
| execute | method | Y |  | 72 |

### packages\core\src\infrastructure\tools\primitives\KnowledgeQueryPrimitive.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| setPiBridge | fn |  | Y | 38 |
| getPiBridge | fn |  |  | 46 |
| initializeOntologyGate | fn |  | Y | 53 |
| getOntologyGuard | fn |  |  | 69 |
| registerSource | method |  |  | 116 |
| canHandle | method |  |  | 122 |
| execute | method | Y |  | 146 |

### packages\core\src\infrastructure\tools\primitives\ShellExecutionPrimitive.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| setShellExecutor | method |  |  | 58 |
| setAllowedCommands | method |  |  | 73 |
| canHandle | method |  |  | 77 |
| execute | method | Y |  | 88 |
| normalizeShellOutcome | fn |  |  | 154 |
| scrubExecutorEnv | fn |  | Y | 181 |

### packages\core\src\infrastructure\tools\primitives\gateBinding.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| gateReadonly | method |  |  | 29 |
| gateDestructive | method |  |  | 51 |
| recordGateDecision | fn |  |  | 75 |

### packages\core\src\infrastructure\tools\primitives\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\infrastructure\tools\primitives\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\infrastructure\utils\AsyncResourceLocker.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| acquire | method | Y |  | 23 |
| resolveUnlock | const-fn |  |  | 30 |
| withLock | method | Y |  | 50 |
| queueDepth | getter |  |  | 60 |
| isLocked | method |  |  | 65 |
| clear | method |  |  | 70 |
| (anon) | ctor |  |  | 81 |

### packages\core\src\infrastructure\utils\extractJson.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| extractJson | fn |  | Y | 19 |
| extractJsonAsync | fn | Y | Y | 78 |
| extractBraceJson | fn |  |  | 105 |
| repairTruncatedJson | fn |  |  | 168 |
| findMatchingBracket | fn |  |  | 284 |
| trimPartialToken | fn |  |  | 319 |
| retryWithLLM | fn | Y |  | 351 |

### packages\core\src\infrastructure\utils\jsonl.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| readJSONLLines | fn |  | Y | 9 |

### packages\core\src\infrastructure\utils\toposort.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| topologicalSort | fn |  | Y | 14 |

### packages\core\src\knowledge\artifact\ArtifactBlueprint.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| fromGoal | method |  |  | 18 |

### packages\core\src\knowledge\artifact\ArtifactFacade.ts（22 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 26 |
| setPersistentStore | method |  |  | 31 |
| setEventStore | method |  |  | 38 |
| restoreFromEvents | method | Y |  | 48 |
| ensureLoaded | method |  |  | 109 |
| saveSnapshot | method |  |  | 131 |
| restoreFromSnapshot | method | Y |  | 145 |
| scheduleSnapshot | method |  |  | 167 |
| create | method |  |  | 175 |
| transition | method |  |  | 212 |
| addLineage | method |  |  | 242 |
| getLineage | method |  |  | 247 |
| getByTask | method |  |  | 252 |
| get | method |  |  | 257 |
| createFromTask | method | Y |  | 263 |
| getAll | method |  |  | 270 |
| emit | method |  |  | 275 |
| setBlueprints | method |  |  | 291 |
| getPendingBlueprints | method |  |  | 295 |
| getNextReadyBlueprint | method |  |  | 299 |
| markBlueprintCompleted | method |  |  | 305 |
| getAllBlueprints | method |  |  | 310 |

### packages\core\src\knowledge\artifact\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\knowledge\artifact\registry\ArtifactDependencyResolver.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 17 |
| resolve | method |  |  | 20 |
| dfs | const-fn |  |  | 40 |
| detectCycles | method |  |  | 83 |
| getMissingDependencies | method |  |  | 88 |
| validate | method |  |  | 101 |
| getExecutionOrder | method |  |  | 125 |

### packages\core\src\knowledge\artifact\registry\ArtifactEmbedding.ts（16 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 20 |
| register | method |  |  | 25 |
| get | method |  |  | 30 |
| remove | method |  |  | 35 |
| generate | method |  |  | 40 |
| generateAll | method |  |  | 54 |
| findSimilar | method |  |  | 59 |
| search | method |  |  | 77 |
| size | method |  |  | 100 |
| clear | method |  |  | 103 |
| toJSON | method |  |  | 106 |
| fromJSON | method |  |  | 109 |
| cosineSimilarity | method |  |  | 116 |
| extractFeatures | method |  |  | 129 |
| setNodeCache | method |  |  | 162 |
| findNodeById | method |  |  | 164 |

### packages\core\src\knowledge\artifact\registry\ArtifactEvaluator.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| evaluate | method |  |  | 10 |
| evaluateAll | method |  |  | 35 |
| compare | method |  |  | 40 |
| evaluateConsistency | method |  |  | 61 |
| evaluateCompleteness | method |  |  | 83 |
| evaluateUsability | method |  |  | 100 |

### packages\core\src\knowledge\artifact\registry\ArtifactGraph.ts（17 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| addNode | method |  |  | 13 |
| getNode | method |  |  | 15 |
| hasNode | method |  |  | 17 |
| getAllNodes | method |  |  | 19 |
| addEdge | method |  |  | 21 |
| getOutgoing | method |  |  | 26 |
| getIncoming | method |  |  | 30 |
| getDependencyChain | method |  |  | 35 |
| traverse | const-fn |  |  | 38 |
| getDependents | method |  |  | 50 |
| traverse | const-fn |  |  | 53 |
| impactAnalysis | method |  |  | 65 |
| removeNode | method |  |  | 74 |
| size | method |  |  | 79 |
| edgeCount | method |  |  | 80 |
| toJSON | method |  |  | 83 |
| fromJSON | method |  |  | 88 |

### packages\core\src\knowledge\artifact\registry\ArtifactLineage.ts（9 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 10 |
| query | method |  |  | 13 |
| getFullLineage | method |  |  | 30 |
| areSiblings | method |  |  | 38 |
| findLCA | method |  |  | 45 |
| traceDownstream | method |  |  | 54 |
| traverse | const-fn |  |  | 60 |
| traceUpstream | method |  |  | 77 |
| traverse | const-fn |  |  | 83 |

### packages\core\src\knowledge\artifact\registry\ArtifactRegistry.ts（23 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 85 |
| _scheduleAutoSave | method |  |  | 95 |
| register | method | Y |  | 108 |
| update | method | Y |  | 156 |
| get | method |  |  | 208 |
| search | method |  |  | 213 |
| getAll | method |  |  | 230 |
| getVersions | method |  |  | 235 |
| count | getter |  |  | 240 |
| createRelation | method |  |  | 247 |
| getRelations | method |  |  | 262 |
| getGraph | method |  |  | 267 |
| buildURI | method |  |  | 288 |
| parseURI | method |  |  | 295 |
| resolve | method |  |  | 315 |
| listByDomain | method |  |  | 324 |
| getStatsByType | method |  |  | 331 |
| saveToDisk | method | Y |  | 344 |
| loadFromDisk | method | Y |  | 379 |
| clear | method |  |  | 428 |
| createArtifact | method |  |  | 447 |
| updateContent | method |  |  | 474 |
| changeStatus | method |  |  | 479 |

### packages\core\src\knowledge\artifact\registry\ArtifactVersion.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| createVersionSnapshot | fn |  | Y | 14 |
| rollbackToVersion | fn |  | Y | 30 |
| formatVersion | fn |  | Y | 49 |

### packages\core\src\knowledge\artifact\registry\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\knowledge\artifact\registry\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\knowledge\context\ContextArchive.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| loadByTaskRef | fn | Y | Y | 49 |
| listTaskRefs | fn | Y | Y | 70 |
| listRecentArchived | fn | Y | Y | 87 |
| loadMerged | fn | Y | Y | 138 |

### packages\core\src\knowledge\context\ContextAssemblyEngine.ts（27 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| defaultRiskGrader | fn |  | Y | 106 |
| (anon) | ctor |  |  | 125 |
| assemble | method | Y |  | 152 |
| sourceFilter | const-fn |  |  | 170 |
| assertModelVisibleReconstructable | method |  |  | 430 |
| recordRetrievalDecision | method |  |  | 460 |
| attachAssemblyTelemetry | method |  |  | 503 |
| getContext | method |  |  | 551 |
| loadContext | method |  |  | 559 |
| resolvePersistence | method |  |  | 569 |
| setPersistenceProvider | method |  |  | 583 |
| getConfig | method |  |  | 590 |
| updateConfig | method |  |  | 597 |
| setRecentSummaryReader | method |  |  | 607 |
| setRetriever | method |  |  | 615 |
| setRiskGrader | method |  |  | 622 |
| getRegistry | method |  |  | 629 |
| getVersioner | method |  |  | 636 |
| getTemplateRepository | method |  |  | 643 |
| getEnricherPipeline | method |  |  | 650 |
| generateFallbackFragment | method |  |  | 662 |
| selectTemplate | method |  |  | 769 |
| collectFragmentsWithTimeout | method | Y |  | 789 |
| estimateFragmentTokens | fn |  |  | 822 |
| buildWorkingLayer | fn |  |  | 837 |
| buildSemanticItems | fn |  |  | 862 |
| selectLayerItems | fn |  |  | 890 |

### packages\core\src\knowledge\context\ContextBuilder.ts（11 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| addFragment | method |  |  | 103 |
| addFragments | method |  |  | 111 |
| setBaseData | method |  |  | 119 |
| setSessionData | method |  |  | 127 |
| setEphemeralData | method |  |  | 135 |
| build | method |  |  | 149 |
| reset | method |  |  | 184 |
| getCurrentVersion | method |  |  | 194 |
| getLastContextId | method |  |  | 201 |
| generateContextId | method |  |  | 213 |
| simpleHash | method |  |  | 221 |

### packages\core\src\knowledge\context\ContextEnricher.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| register | method |  |  | 36 |
| unregister | method |  |  | 47 |
| enrich | method | Y |  | 63 |
| listEnrichers | method |  |  | 80 |
| count | method |  |  | 87 |
| clear | method |  |  | 94 |

### packages\core\src\knowledge\context\ContextFragmentRegistry.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| register | method |  |  | 102 |
| unregister | method |  |  | 111 |
| getProvider | method |  |  | 118 |
| listSources | method |  |  | 125 |
| collectAll | method | Y |  | 139 |
| count | method |  |  | 163 |
| clear | method |  |  | 170 |

### packages\core\src\knowledge\context\ContextPersistence.ts（11 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 34 |
| save | method |  |  | 45 |
| loadLatest | method |  |  | 89 |
| loadVersion | method |  |  | 104 |
| getHistory | method |  |  | 118 |
| loadByMission | method |  |  | 130 |
| loadRecent | method |  |  | 147 |
| loadByTaskRef | method |  |  | 161 |
| prune | method |  |  | 181 |
| delete | method |  |  | 201 |
| hydrate | method |  |  | 212 |

### packages\core\src\knowledge\context\ContextTemplateRepository.ts（8 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 85 |
| register | method |  |  | 95 |
| get | method |  |  | 102 |
| remove | method |  |  | 111 |
| match | method |  |  | 124 |
| listAll | method |  |  | 152 |
| count | method |  |  | 159 |
| clear | method |  |  | 166 |

### packages\core\src\knowledge\context\ContextVersioner.ts（11 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 58 |
| snapshot | method |  |  | 73 |
| getCurrent | method |  |  | 102 |
| getVersion | method |  |  | 111 |
| getHistory | method |  |  | 122 |
| diff | method |  |  | 139 |
| rollback | method |  |  | 200 |
| has | method |  |  | 212 |
| loadFromDb | method |  |  | 224 |
| clear | method |  |  | 249 |
| getPersistence | method |  |  | 257 |

### packages\core\src\knowledge\context\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\knowledge\context\providers\realProviders.ts（12 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| taskRefOf | fn |  |  | 31 |
| (anon) | ctor |  |  | 48 |
| collect | method | Y |  | 50 |
| (anon) | ctor |  |  | 105 |
| collect | method | Y |  | 107 |
| (anon) | ctor |  |  | 162 |
| collect | method | Y |  | 164 |
| (anon) | ctor |  |  | 221 |
| collect | method | Y |  | 223 |
| (anon) | ctor |  |  | 268 |
| collect | method | Y |  | 270 |
| collect | method | Y |  | 327 |

### packages\core\src\knowledge\context\retrieval\ContextDistiller.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 33 |
| distill | method | Y |  | 41 |
| extractKeyLines | method |  |  | 66 |

### packages\core\src\knowledge\context\retrieval\ContextRetriever.ts（5 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 86 |
| retrieveRelevant | method | Y |  | 95 |
| gatherCandidates | method | Y |  | 155 |
| fuse | method |  |  | 188 |
| rankBy | method |  |  | 204 |

### packages\core\src\knowledge\context\retrieval\Reranker.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 42 |
| rerank | method | Y |  | 67 |
| clearCache | method |  |  | 111 |
| cacheKey | method |  |  | 119 |

### packages\core\src\knowledge\context\retrieval\SparseRetriever.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| tokenize | fn |  | Y | 17 |
| scoreAll | method |  |  | 47 |
| idf | const-fn |  |  | 61 |

### packages\core\src\knowledge\context\retrieval\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\knowledge\graph\SystemMetadataGraph.ts（15 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| stableKey | fn |  |  | 40 |
| setEventStore | method |  |  | 67 |
| restoreFromEvents | method | Y |  | 78 |
| ensureLoaded | method |  |  | 151 |
| saveSnapshot | method |  |  | 187 |
| restoreFromSnapshot | method | Y |  | 207 |
| scheduleSnapshot | method |  |  | 240 |
| registerEntity | method |  |  | 255 |
| addRelation | method |  |  | 298 |
| getRelations | method |  |  | 316 |
| findRelated | method |  |  | 321 |
| getEntities | method |  |  | 330 |
| getAllRelations | method |  |  | 339 |
| getStats | method |  |  | 341 |
| findPath | method |  |  | 348 |

### packages\core\src\knowledge\graph\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\knowledge\graph\knowledge\KnowledgeGraph.ts（27 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 47 |
| _loadAll | method |  |  | 83 |
| _migrateLegacyJsonl | method |  |  | 112 |
| _generateId | method |  |  | 154 |
| flush | method | Y |  | 159 |
| addEntity | method |  |  | 163 |
| addEntities | method |  |  | 188 |
| addRelation | method |  |  | 198 |
| get | method |  |  | 224 |
| searchEntities | method |  |  | 228 |
| getNeighborhood | method |  |  | 257 |
| traverse | const-fn |  |  | 263 |
| findPath | method |  |  | 286 |
| getStats | method |  |  | 325 |
| importFromArtifact | method |  |  | 332 |
| importFromMemory | method |  |  | 342 |
| importFromExecution | method |  |  | 352 |
| toJSON | method |  |  | 362 |
| fromJSON | method |  |  | 369 |
| loadFromDisk | method |  |  | 379 |
| correctEntity | method |  |  | 395 |
| searchCrossDomain | method |  |  | 408 |
| removeEntity | method |  |  | 417 |
| clear | method |  |  | 426 |
| saveSnapshot | method | Y |  | 432 |
| getStatus | method |  |  | 437 |
| close | method |  |  | 441 |

### packages\core\src\knowledge\graph\knowledge\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\knowledge\memory\CompanyKnowledge.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| initializeCompanyMemory | fn |  | Y | 19 |
| isCompanyMemoryInitialized | fn |  | Y | 23 |
| queryCompanyKnowledge | fn | Y | Y | 42 |

### packages\core\src\knowledge\memory\MemoryActivationEngine.ts（16 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| setMemoryStore | method |  |  | 65 |
| addMemory | method |  |  | 68 |
| addMemories | method |  |  | 71 |
| setSource | method |  |  | 74 |
| refresh | method | Y |  | 81 |
| isSourceAvailable | method | Y |  | 97 |
| lastRefreshedAt | getter |  |  | 103 |
| activate | method |  |  | 106 |
| calcStateRelevance | method |  |  | 143 |
| calcTaskRelevance | method |  |  | 160 |
| calcExecutionRelevance | method |  |  | 180 |
| calcRecency | method |  |  | 202 |
| calcFrequency | method |  |  | 210 |
| generateContextBias | method |  |  | 216 |
| memoryCount | getter |  |  | 242 |
| clear | method |  |  | 245 |

### packages\core\src\knowledge\memory\MemoryApiBus.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| createMemoryApiBus | fn |  | Y | 16 |
| remember | method | Y |  | 18 |
| recall | method | Y |  | 47 |
| createMemoryActivationSource | fn |  | Y | 61 |
| available | method | Y |  | 66 |
| load | method | Y |  | 74 |
| hitToMemoryRecord | fn |  | Y | 89 |

### packages\core\src\knowledge\memory\MemoryHooks.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| calculateImportance | fn |  | Y | 45 |
| createAutoMemoryHook | fn |  | Y | 75 |
| createReasoningMemoryHook | fn |  | Y | 122 |
| buildHintMessage | fn |  |  | 158 |
| extractText | fn |  |  | 172 |
| createActivationMemoryHook | fn |  | Y | 193 |

### packages\core\src\knowledge\memory\MemoryMessages.ts（5 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| isMemoryHintMessage | fn |  | Y | 25 |
| isDagNodeStatusMessage | fn |  | Y | 32 |
| convertMemoryHintToLlm | fn |  | Y | 46 |
| convertDagNodeStatusToLlm | fn |  | Y | 63 |
| createCustomConvertToLlm | fn |  | Y | 95 |

### packages\core\src\knowledge\memory\activationRegistry.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| setGlobalActivationEngine | fn |  | Y | 16 |
| getGlobalActivationEngine | fn |  | Y | 21 |

### packages\core\src\knowledge\memory\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\knowledge\memory\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\knowledge\ontology\FeedbackService.ts（5 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 28 |
| submit | method | Y |  | 39 |
| listTestCases | method | Y |  | 85 |
| listByTarget | method | Y |  | 97 |
| getStats | method | Y |  | 108 |

### packages\core\src\knowledge\ontology\ObjectTypeRegistry.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 12 |
| register | method |  |  | 19 |
| get | method |  |  | 26 |
| validateProperties | method |  |  | 35 |
| list | method |  |  | 45 |
| has | method |  |  | 52 |
| getDefaultStatus | method |  |  | 59 |

### packages\core\src\knowledge\ontology\OntologyService.ts（17 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| setBulkProjection | method |  |  | 33 |
| (anon) | ctor |  |  | 49 |
| restoreFromEvents | method | Y |  | 61 |
| normalizeEntityType | method |  |  | 75 |
| normalizeRelationType | method |  |  | 83 |
| refreshCache | method |  |  | 89 |
| invalidateCache | method |  |  | 99 |
| queryObjects | method | Y |  | 113 |
| getObject | method | Y |  | 163 |
| getRelated | method | Y |  | 182 |
| getCurrentState | method | Y |  | 212 |
| upsertObject | method | Y |  | 244 |
| ensureRelation | method | Y |  | 345 |
| listByType | method | Y |  | 372 |
| toOntologyObject | method |  |  | 379 |
| toRelation | method |  |  | 398 |
| looseEqual | fn |  |  | 418 |

### packages\core\src\knowledge\ontology\bootstrapFromDocs.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| bootstrapFromWorkflowDocs | fn | Y | Y | 67 |

### packages\core\src\knowledge\ontology\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\knowledge\ontology\objectTypes.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\knowledge\ontology\projectors\ArtifactProjector.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 17 |
| projectAll | method | Y |  | 28 |
| projectOne | method | Y |  | 72 |

### packages\core\src\knowledge\ontology\projectors\MissionProjector.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 17 |
| projectAll | method | Y |  | 28 |
| projectOne | method | Y |  | 65 |

### packages\core\src\knowledge\ontology\projectors\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\knowledge\ontology\prompts\expert-prompt.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| compileExpertPrompt | fn |  | Y | 75 |

### packages\core\src\knowledge\ontology\prompts\forced-query-system.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| buildReasoningUserPrompt | fn |  | Y | 54 |

### packages\core\src\knowledge\ontology\prompts\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\core\src\knowledge\ontology\prompts\leader-prompt.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| compileLeaderPrompt | fn |  | Y | 69 |

### packages\core\src\knowledge\ontology\prompts\prompt-types.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| createAstroMTrace | fn |  | Y | 93 |

### packages\core\src\workflow\WorkflowProvider.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| register | method |  |  | 24 |
| get | method |  |  | 28 |
| findForGoal | method |  |  | 32 |
| getAll | method |  |  | 36 |

### packages\core\src\workflow\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\memory\src\api\MemoryApi.ts（13 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 47 |
| query | method | Y |  | 58 |
| queryForGate | method | Y |  | 74 |
| rememberEpisode | method | Y |  | 93 |
| upsert | method | Y |  | 108 |
| confirm | method | Y |  | 164 |
| listPendingConfirmations | method | Y |  | 174 |
| invalidate | method | Y |  | 180 |
| listInvalidations | method |  |  | 185 |
| reflect | method | Y |  | 191 |
| decayTick | method | Y |  | 222 |
| close | method |  |  | 227 |
| buildFactText | fn |  |  | 233 |

### packages\memory\src\api\factory.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| createMemoryApi | fn |  | Y | 20 |

### packages\memory\src\confirmation\queue.ts（9 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 29 |
| enqueue | method |  |  | 58 |
| listPending | method |  |  | 76 |
| resolve | method |  |  | 91 |
| get | method |  |  | 99 |
| logInvalidate | method |  |  | 117 |
| listInvalidations | method |  |  | 128 |
| expirePending | method |  |  | 142 |
| close | method |  |  | 150 |

### packages\memory\src\engines\cognee\CogneeEngine.ts（13 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| toEngineHit | fn |  |  | 16 |
| (anon) | ctor |  |  | 36 |
| remember | method | Y |  | 38 |
| recall | method | Y |  | 45 |
| searchGraph | method | Y |  | 53 |
| searchGraphEvidence | method | Y |  | 59 |
| searchAnswer | method | Y |  | 96 |
| searchHybrid | method | Y |  | 101 |
| searchTemporal | method | Y |  | 106 |
| forget | method | Y |  | 111 |
| available | method | Y |  | 115 |
| mapStrings | method |  |  | 120 |
| ngrams | fn |  |  | 131 |

### packages\memory\src\engines\cognee\client.ts（9 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 27 |
| headers | method |  |  | 29 |
| post | method | Y |  | 36 |
| remember | method | Y |  | 57 |
| recall | method | Y |  | 95 |
| search | method | Y |  | 104 |
| forget | method | Y |  | 113 |
| getGraph | method | Y |  | 118 |
| available | method | Y |  | 132 |

### packages\memory\src\engines\factory.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| createEngine | fn |  | Y | 21 |

### packages\memory\src\engines\mock\MockEngine.ts（9 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| ngrams | fn |  |  | 16 |
| setOnline | method |  |  | 31 |
| remember | method | Y |  | 35 |
| recall | method | Y |  | 41 |
| searchGraph | method | Y |  | 45 |
| searchHybrid | method | Y |  | 49 |
| forget | method | Y |  | 53 |
| available | method | Y |  | 57 |
| match | method |  |  | 61 |

### packages\memory\src\gate\ForceRetrieve.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 29 |
| retrieve | method | Y |  | 31 |
| buildEvidenceContext | fn |  | Y | 145 |

### packages\memory\src\gate\domain.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| isCompanyKnowledgeDomain | fn |  | Y | 8 |
| requiresGraphFacts | fn |  | Y | 14 |

### packages\memory\src\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\memory\src\memory-types.ts（0 个）
- （无顶层函数/方法提取）
### packages\memory\src\ontology\schema.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| isEntityType | fn |  | Y | 56 |
| isRelationType | fn |  | Y | 60 |
| entitiesForDomain | fn |  | Y | 64 |
| relationsForDomain | fn |  | Y | 68 |

### packages\memory\src\ontology\validate.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| validateUpsert | fn |  | Y | 19 |

### packages\memory\src\storage\Compactor.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 47 |
| compact | method | Y |  | 58 |

### packages\memory\src\storage\HistoryStore.ts（16 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 88 |
| initialize | method | Y |  | 92 |
| _loadFile | method | Y |  | 103 |
| addCycle | method |  |  | 118 |
| updateCycle | method |  |  | 124 |
| getCycles | method |  |  | 131 |
| addTask | method |  |  | 137 |
| updateTask | method |  |  | 143 |
| getTasks | method |  |  | 150 |
| setWiki | method |  |  | 155 |
| getTasksByExecution | method |  |  | 159 |
| addExecution | method |  |  | 182 |
| updateExecution | method |  |  | 188 |
| getExecutions | method |  |  | 195 |
| getStats | method |  |  | 201 |
| close | method |  |  | 212 |

### packages\memory\src\storage\JSONLWriter.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 38 |
| append | method |  |  | 58 |
| flush | method |  |  | 81 |
| shutdown | method |  |  | 116 |
| pending | getter |  |  | 124 |
| closed | getter |  |  | 131 |

### packages\memory\src\storage\LogRotator.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 47 |
| currentPath | getter |  |  | 57 |
| currentSize | getter |  |  | 62 |
| writeCount | getter |  |  | 67 |
| maybeRotate | method | Y |  | 75 |
| rotate | method | Y |  | 101 |
| cleanupOldFiles | method | Y |  | 145 |

### packages\memory\src\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\memory\src\wiki\DocTopology.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 26 |
| buildTopology | method | Y |  | 38 |
| extractTitle | method |  |  | 121 |
| extractMarkdownLinks | method |  |  | 127 |
| resolveLink | method |  |  | 138 |
| findAllMd | method |  |  | 145 |

### packages\memory\src\wiki\DocWatcher.ts（10 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 44 |
| start | method | Y |  | 58 |
| stop | method |  |  | 89 |
| indexAll | method | Y |  | 105 |
| processPending | method | Y |  | 118 |
| indexFile | method | Y |  | 136 |
| unindexFile | method | Y |  | 177 |
| extractTags | method |  |  | 193 |
| chunkMarkdown | method |  |  | 208 |
| findAllMdFiles | method |  |  | 231 |

### packages\memory\src\wiki\MemoryRetriever.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 70 |
| retrieveForTask | method |  |  | 85 |
| retrieveForError | method |  |  | 147 |
| retrieveForUncertainty | method |  |  | 211 |
| retrieveForCode | method |  |  | 246 |
| extractKeywords | method |  |  | 285 |

### packages\memory\src\wiki\MemoryWiki.ts（28 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 47 |
| ready | getter |  |  | 55 |
| initialize | method | Y |  | 59 |
| remember | method | Y |  | 85 |
| rememberMany | method | Y |  | 145 |
| buildDomainInsert | method |  |  | 167 |
| getPlanRecordsByTask | method |  |  | 374 |
| getScoreTrend | method |  |  | 385 |
| queryByTags | method |  |  | 403 |
| getRecentEpisodes | method |  |  | 420 |
| getById | method |  |  | 428 |
| queryByField | method |  |  | 436 |
| getFullEntity | method |  |  | 447 |
| getIntelligenceState | method |  |  | 471 |
| getErrorLogs | method |  |  | 477 |
| getTemplateLineages | method |  |  | 488 |
| getPlanTemplates | method |  |  | 499 |
| getToolQuality | method |  |  | 510 |
| getErrorReports | method |  |  | 521 |
| getDecisionTraces | method |  |  | 532 |
| getDeviationLogs | method |  |  | 543 |
| getCheckpointsByExecution | method |  |  | 554 |
| getMemoryEntries | method |  |  | 563 |
| sql | method |  |  | 576 |
| run | method |  |  | 584 |
| queryByTimeRange | method |  |  | 593 |
| getStats | method |  |  | 613 |
| close | method |  |  | 629 |

### packages\memory\src\wiki\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\memory\src\wiki\migrate.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| getMigrationSources | fn |  | Y | 17 |
| resolveJsonl | const-fn |  |  | 18 |
| migrateJSONLtoSQLite | fn | Y | Y | 204 |

### packages\memory\src\wiki\schema.ts（0 个）
- （无顶层函数/方法提取）
### packages\memory\src\wiki\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\studio\server\RuntimeAPI.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| registerRuntimeRoutes | fn |  | Y | 12 |

### packages\studio\server\SessionStore.ts（13 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 30 |
| isValidSessionId | method |  |  | 37 |
| loadSessionNames | method |  |  | 45 |
| getSessionName | method |  |  | 57 |
| setSessionName | method |  |  | 61 |
| saveSessionNames | method |  |  | 66 |
| listSessions | method |  |  | 85 |
| deleteSession | method |  |  | 113 |
| appendChatMessage | method |  |  | 136 |
| patchLastUserMessage | method |  |  | 162 |
| getChatHistory | method |  |  | 187 |
| appendTaskMessage | method |  |  | 211 |
| getTaskMessages | method |  |  | 223 |

### packages\studio\server\StudioServer.ts（17 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| sanitizeFileName | fn |  |  | 75 |
| mimeOf | fn |  |  | 80 |
| isTextLike | fn |  |  | 85 |
| isTextViewable | fn |  |  | 92 |
| generateTaskSummary | fn | Y |  | 100 |
| routeTaskToSpace | fn | Y |  | 129 |
| buildAttachmentContext | fn |  |  | 156 |
| calcOverallRate | method |  |  | 195 |
| (anon) | ctor |  |  | 205 |
| start | method | Y |  | 212 |
| getPort | method |  |  | 273 |
| registerIdealRoutes | method |  |  | 281 |
| collectHumanDecisions | const-fn |  |  | 679 |
| llmRoute | const-fn |  |  | 851 |
| registerSSE | method |  |  | 1146 |
| cleanup | const-fn |  |  | 1170 |
| stop | method | Y |  | 1178 |

### packages\studio\server\index.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| main | fn | Y |  | 18 |

### packages\studio\server\observability\agent-tracer.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| instrumentAgentScheduler | fn |  | Y | 16 |
| instrumentCollaborationManager | fn |  | Y | 47 |

### packages\studio\server\observability\architecture-auditor.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 42 |
| audit | method |  |  | 47 |

### packages\studio\server\observability\architecture-contract.ts（0 个）
- （无顶层函数/方法提取）
### packages\studio\server\observability\coverage-engine.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| calculate | method |  |  | 60 |
| calculateLegacy | method |  |  | 147 |

### packages\studio\server\observability\dag-tracer.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| instrumentDAGDispatcher | fn |  | Y | 23 |

### packages\studio\server\observability\event-bus.ts（10 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 18 |
| getInstance | method |  |  | 22 |
| init | method |  |  | 29 |
| emit | method |  |  | 35 |
| addWsClient | method |  |  | 67 |
| removeWsClient | method |  |  | 71 |
| onEvent | method |  |  | 75 |
| getStore | method |  |  | 82 |
| getWsClientCount | method |  |  | 86 |
| setStore | method |  |  | 91 |

### packages\studio\server\observability\execution-tracer.ts（17 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| genId | fn |  |  | 28 |
| createTaskCtx | fn |  |  | 48 |
| fork | method |  |  | 56 |
| end | method |  |  | 72 |
| getSpans | method |  |  | 79 |
| (anon) | ctor |  |  | 105 |
| startTask | method |  |  | 113 |
| endTask | method |  |  | 120 |
| getContext | method |  |  | 135 |
| traceNode | method | Y |  | 139 |
| traceFSMTransition | method |  |  | 152 |
| traceAgentAssignment | method | Y |  | 156 |
| traceToolCall | method | Y |  | 165 |
| getStats | method |  |  | 174 |
| getActiveTaskCount | method |  |  | 183 |
| flushSpans | method |  |  | 187 |
| createExecutionTracer | fn |  | Y | 195 |

### packages\studio\server\observability\exercise-all.ts（14 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| safe | fn |  |  | 96 |
| emitEvent | fn |  |  | 110 |
| (anon) | ctor |  |  | 138 |
| getRootCtx | method |  |  | 143 |
| getCtx | method |  |  | 148 |
| getAll | method |  |  | 153 |
| invoke | method | Y |  | 163 |
| invokeIf | method | Y |  | 209 |
| exerciseAllModules | fn | Y | Y | 251 |
| emit | fn |  |  | 256 |
| exerciseViaEvents | fn |  | Y | 650 |
| registerExerciseContext | fn |  | Y | 663 |
| getExerciseContext | fn |  | Y | 668 |
| exerciseAllFromGlobal | fn | Y | Y | 673 |

### packages\studio\server\observability\fsm-tracer.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| instrumentFSM | fn |  | Y | 19 |
| wrapped | const-fn |  |  | 37 |

### packages\studio\server\observability\graph-builder.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 12 |
| buildTaskGraph | method |  |  | 14 |
| buildAllTaskGraphs | method |  |  | 86 |
| getTimeline | method |  |  | 101 |

### packages\studio\server\observability\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\studio\server\observability\llm-tracer.ts（8 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| mapToEntry | fn |  |  | 55 |
| (anon) | ctor |  |  | 84 |
| start | method |  |  | 89 |
| stop | method |  |  | 104 |
| isStarted | getter |  |  | 110 |
| query | method |  |  | 115 |
| stats | method |  |  | 130 |
| clear | method |  |  | 161 |

### packages\studio\server\observability\observability-api.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| createObservabilityRouter | fn |  | Y | 29 |
| getServices | const-fn |  |  | 353 |

### packages\studio\server\observability\observable-module.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| register | method |  |  | 26 |
| execute | method | Y |  | 44 |
| run | method |  |  | 113 |

### packages\studio\server\observability\observation-adapter.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| adaptTraceEvent | fn |  | Y | 11 |
| wireObservationAdapter | fn |  | Y | 47 |

### packages\studio\server\observability\observation.ts（24 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| ctxId | fn |  |  | 64 |
| createExecutionContext | fn |  | Y | 68 |
| forkContext | fn |  | Y | 81 |
| mapToDisplay | fn |  | Y | 108 |
| onStateChange | method |  |  | 142 |
| apply | method |  |  | 146 |
| get | method |  |  | 204 |
| getAll | method |  |  | 205 |
| getExercised | method |  |  | 207 |
| clear | method |  |  | 220 |
| registerModule | method |  |  | 232 |
| collect | method |  |  | 248 |
| onStateChange | method |  |  | 256 |
| getObservations | method |  |  | 260 |
| getObservationsByTask | method |  |  | 261 |
| getObservationsByTrace | method |  |  | 262 |
| getModuleStates | method |  |  | 263 |
| getModuleState | method |  |  | 264 |
| getExercisedModules | method |  |  | 265 |
| getSpanTree | method |  |  | 267 |
| getTopology | method |  |  | 273 |
| getStats | method |  |  | 289 |
| clear | method |  |  | 304 |
| reset | method |  |  | 308 |

### packages\studio\server\observability\replay-engine.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| archive | method |  |  | 37 |
| listSessions | method |  |  | 50 |
| getSession | method |  |  | 54 |
| replay | method |  |  | 59 |
| diff | method |  |  | 90 |
| getStats | method |  |  | 117 |

### packages\studio\server\observability\runtime-bridge.ts（7 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| resolve | fn |  |  | 55 |
| resolveStatus | fn |  |  | 62 |
| bridgeEvent | fn |  |  | 76 |
| collectSpan | fn |  |  | 98 |
| startObservabilityBridge | fn |  | Y | 121 |
| wireObservabilityServices | fn |  | Y | 131 |
| resetBridgeState | fn |  | Y | 141 |

### packages\studio\server\observability\runtime-invoker.ts（5 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| call | method | Y |  | 26 |
| callWithSpan | method | Y |  | 104 |
| heartbeat | method |  |  | 177 |
| fsmTransition | method |  |  | 195 |
| metric | method |  |  | 219 |

### packages\studio\server\observability\task-generator.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| running | getter |  |  | 139 |
| generateTasks | method | Y |  | 143 |
| worker | const-fn | Y |  | 158 |
| runSingleTask | method | Y |  | 185 |
| delay | method |  |  | 260 |
| abort | method |  |  | 264 |

### packages\studio\server\observability\tool-tracer.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| instrumentSandbox | fn |  | Y | 18 |
| instrumentVerifier | fn |  | Y | 47 |

### packages\studio\server\observability\trace-store.ts（22 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 22 |
| initTables | method |  |  | 37 |
| loadRecentIntoBuffer | method |  |  | 68 |
| rowToEvent | method |  |  | 80 |
| safeParse | method |  |  | 98 |
| append | method |  |  | 106 |
| getEventsByTask | method |  |  | 136 |
| getAllEvents | method |  |  | 140 |
| getRecentEvents | method |  |  | 144 |
| getEventsByModule | method |  |  | 148 |
| getEventsByType | method |  |  | 152 |
| registerModule | method |  |  | 156 |
| getRegisteredModules | method |  |  | 167 |
| heartbeat | method |  |  | 183 |
| syncFromObservation | method |  |  | 205 |
| getHeartbeats | method |  |  | 214 |
| getHealthReport | method |  |  | 218 |
| clear | method |  |  | 263 |
| clearAll | method |  |  | 269 |
| resetToDefaults | method |  |  | 277 |
| clearRegistry | method |  |  | 284 |
| close | method |  |  | 289 |

### packages\studio\server\observability\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\studio\server\observability\ws-handler.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| setupWebSocket | fn |  | Y | 14 |

### packages\studio\server\security-middleware.ts（9 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 37 |
| check | method |  |  | 43 |
| createSecurityMiddleware | fn |  | Y | 79 |
| requireApiKey | fn |  |  | 91 |
| securityHeaders | fn |  |  | 117 |
| corsHeaders | fn |  |  | 130 |
| rateLimit | fn |  |  | 141 |
| inputValidation | fn |  |  | 173 |
| applySecurityMiddleware | fn |  | Y | 205 |

### packages\workflow-sdk\src\IWorkflowAdapter.ts（0 个）
- （无顶层函数/方法提取）
### packages\workflow-sdk\src\PiModelRegistry.ts（5 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 39 |
| ready | getter |  |  | 47 |
| modelUsed | getter |  |  | 51 |
| generate | method | Y |  | 60 |
| directHttpGenerate | method | Y |  | 95 |

### packages\workflow-sdk\src\WorkflowContext.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| createWorkflowContext | fn |  | Y | 20 |
| createExecutionResult | fn |  | Y | 54 |
| calculateQualityScore | fn |  |  | 93 |
| mergeContexts | fn |  | Y | 112 |

### packages\workflow-sdk\src\WorkflowRuntime.ts（16 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 111 |
| install | method | Y |  | 140 |
| uninstall | method | Y |  | 195 |
| enable | method | Y |  | 204 |
| disable | method | Y |  | 214 |
| execute | method | Y |  | 236 |
| runSimulation | method | Y |  | 422 |
| list | method | Y |  | 464 |
| getStatus | method | Y |  | 471 |
| getMetrics | method | Y |  | 493 |
| optimize | method | Y |  | 537 |
| listVersions | method | Y |  | 594 |
| rollback | method | Y |  | 632 |
| calculateQualityScore | method |  |  | 647 |
| getAggregatedQuality | method |  |  | 672 |
| incrementVersion | fn |  |  | 682 |

### packages\workflow-sdk\src\WorkflowSDK.ts（18 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| (anon) | ctor |  |  | 67 |
| createFromDir | method | Y |  | 84 |
| create | method | Y |  | 143 |
| install | method | Y |  | 178 |
| registerAdapter | method |  |  | 203 |
| getAdapter | method |  |  | 210 |
| unregisterAdapter | method |  |  | 217 |
| execute | method | Y |  | 233 |
| optimize | method | Y |  | 270 |
| listVersions | method | Y |  | 281 |
| rollback | method | Y |  | 292 |
| getStatus | method | Y |  | 303 |
| getMetrics | method | Y |  | 310 |
| list | method | Y |  | 317 |
| parseYamlDefinition | method |  |  | 331 |
| downloadPackage | method | Y |  | 426 |
| isWorkflowPackage | fn |  |  | 435 |
| pathToFileURL | fn |  |  | 448 |

### packages\workflow-sdk\src\bootstrap.ts（22 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| loadEnvFile | fn | Y |  | 48 |
| (anon) | ctor |  |  | 76 |
| createPlan | method | Y |  | 78 |
| replan | method | Y |  | 151 |
| fallbackPlan | method |  |  | 157 |
| (anon) | ctor |  |  | 190 |
| executeMission | method | Y |  | 194 |
| simulate | method | Y |  | 224 |
| (anon) | ctor |  |  | 247 |
| execute | method | Y |  | 251 |
| buildFromSteps | method |  |  | 271 |
| (anon) | ctor |  |  | 292 |
| register | method |  |  | 296 |
| get | method |  |  | 305 |
| activate | method |  |  | 331 |
| recordExecution | method |  |  | 335 |
| getAll | method |  |  | 339 |
| (anon) | ctor |  |  | 354 |
| execute | method | Y |  | 358 |
| (anon) | ctor |  |  | 381 |
| optimize | method | Y |  | 385 |
| createWorkflowRuntime | fn | Y | Y | 430 |

### packages\workflow-sdk\src\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\workflow-sdk\src\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\workflows\ecommerce\actions\amazon.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| execute | method | Y |  | 14 |
| execute | method | Y |  | 23 |
| execute | method | Y |  | 32 |

### packages\workflows\ecommerce\artifacts\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\workflows\ecommerce\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\workflows\ecommerce\src\actions\amazon-primitives.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| canHandle | method |  |  | 22 |
| execute | method | Y |  | 27 |
| canHandle | method |  |  | 43 |
| execute | method | Y |  | 48 |
| canHandle | method |  |  | 64 |
| execute | method | Y |  | 69 |

### packages\workflows\ecommerce\src\bootstrap.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| bootstrapEcommerceWorkflow | fn | Y | Y | 11 |

### packages\workflows\ecommerce\src\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\workflows\ecommerce\src\rules\amazon-rules.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| registerAmazonRules | fn |  | Y | 16 |

### packages\workflows\ecommerce\src\rules\rule-register.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| registerDomainRules | fn |  | Y | 24 |

### packages\workflows\ecommerce\validators\amazon-policy.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| check | method |  |  | 7 |

### packages\workflows\ecommerce\workflow-provider.ts（0 个）
- （无顶层函数/方法提取）
### packages\workflows\hardware\firmware\actions\build_project.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| buildProjectAction | fn | Y | Y | 27 |

### packages\workflows\hardware\firmware\actions\compile.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| compileAction | fn | Y | Y | 36 |

### packages\workflows\hardware\firmware\actions\generate.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| generateAction | fn | Y | Y | 32 |

### packages\workflows\hardware\firmware\artifacts\types.ts（0 个）
- （无顶层函数/方法提取）
### packages\workflows\hardware\firmware\index.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| run | fn | Y | Y | 29 |

### packages\workflows\hardware\simulation\actions\debug.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| debugAction | fn | Y | Y | 30 |

### packages\workflows\hardware\simulation\actions\flash.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| flashAction | fn | Y | Y | 30 |

### packages\workflows\hardware\simulation\index.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| run | fn | Y | Y | 21 |

### packages\workflows\hardware\src\actions\hardware-actions.ts（11 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| toResult | fn |  |  | 15 |
| canHandle | method |  |  | 32 |
| execute | method | Y |  | 37 |
| canHandle | method |  |  | 59 |
| execute | method | Y |  | 64 |
| canHandle | method |  |  | 86 |
| execute | method | Y |  | 91 |
| canHandle | method |  |  | 112 |
| execute | method | Y |  | 117 |
| canHandle | method |  |  | 137 |
| execute | method | Y |  | 142 |

### packages\workflows\hardware\src\bootstrap.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| bootstrapHardwareWorkflow | fn | Y | Y | 16 |

### packages\workflows\hardware\src\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\workflows\hardware\src\rules\hardware-rules.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| registerHardwareRules | fn |  | Y | 15 |

### packages\workflows\hardware\workflow-provider.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| toResult | fn |  |  | 42 |

### packages\workflows\software\src\actions\software-actions.ts（6 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| canHandle | method |  |  | 21 |
| execute | method | Y |  | 26 |
| canHandle | method |  |  | 49 |
| execute | method | Y |  | 54 |
| canHandle | method |  |  | 77 |
| execute | method | Y |  | 82 |

### packages\workflows\software\src\bootstrap.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| bootstrapSoftwareWorkflow | fn | Y | Y | 12 |

### packages\workflows\software\src\index.ts（0 个）
- （无顶层函数/方法提取）
### packages\workflows\software\src\rules\ast-utils.ts（9 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| parseSource | fn |  | Y | 27 |
| typeCheck | fn |  | Y | 48 |
| formatDiagnostic | fn |  | Y | 83 |
| findVarDeclarations | fn |  | Y | 107 |
| visit | fn |  |  | 111 |
| findEvalCalls | fn |  | Y | 141 |
| visit | fn |  |  | 143 |
| fixVarToLetConst | fn |  | Y | 175 |
| visit | fn |  |  | 190 |

### packages\workflows\software\src\rules\custom-detectors.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| check | method |  |  | 22 |
| registerSoftwareDetectors | fn |  | Y | 43 |

### packages\workflows\software\src\rules\structural-ast-tsc.ts（5 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| check | method |  |  | 46 |
| check | method |  |  | 96 |
| canHandle | method |  |  | 137 |
| correct | method | Y |  | 143 |
| registerSoftwareAstTscAdapters | fn |  | Y | 182 |

### packages\workflows\software\src\rules\structural-eslint.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| canHandle | method |  |  | 38 |
| correct | method | Y |  | 41 |
| check | method |  |  | 90 |
| registerSoftwareStructuralCorrector | fn |  | Y | 118 |

### packages\workflows\software\workflow-provider.ts（0 个）
- （无顶层函数/方法提取）
### packages\workflows\xjmcu\src\actions\compile.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| canHandle | method |  |  | 29 |
| execute | method | Y |  | 34 |
| (anon) | fn | Y | Y | 63 |

### packages\workflows\xjmcu\src\actions\generate.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| canHandle | method |  |  | 24 |
| execute | method | Y |  | 29 |
| (anon) | fn | Y | Y | 46 |

### packages\workflows\xjmcu\src\actions\pipeline.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| canHandle | method |  |  | 31 |
| execute | method | Y |  | 36 |
| (anon) | fn | Y | Y | 82 |

### packages\workflows\xjmcu\src\bootstrap.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| bootstrapXJMcuWorkflow | fn | Y | Y | 12 |

### packages\workflows\xjmcu\src\index.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| run | fn | Y | Y | 15 |

### packages\workflows\xjmcu\src\rules\platform-rule.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| registerPlatformRules | fn |  | Y | 19 |

### packages\workflows\xjmcu\toolchain\scripts\import_sfr_to_memory.cjs（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| gen_data_bits | fn |  |  | 196 |
| gen_gpio_bits | fn |  |  | 210 |
| gen_mux_bits | fn |  |  | 220 |
| gen_mux_bits2 | fn |  |  | 233 |

### packages\workflows\xjmcu\workflow-provider.ts（0 个）
- （无顶层函数/方法提取）
### scripts\_backend-code-analyze.ts（8 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| analyzeFile | fn |  |  | 35 |
| isExported | const-fn |  |  | 44 |
| lineOf | const-fn |  |  | 46 |
| visit | fn |  |  | 48 |
| collect | fn |  |  | 79 |
| run | fn |  |  | 113 |
| renderMd | fn |  |  | 138 |
| isMain | const-fn |  |  | 208 |

### scripts\_mission-session.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| main | fn | Y |  | 7 |
| stage | const-fn |  |  | 19 |

### scripts\analyze-trace-reports.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| main | fn |  |  | 47 |
| extractClassMethods | fn |  |  | 105 |

### scripts\batch-run.ts（8 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| currentAdaptiveConcurrency | fn |  | Y | 88 |
| sleep | fn |  |  | 115 |
| retryableWaitMs | fn |  | Y | 127 |
| withTimeout | fn | Y |  | 138 |
| main | fn | Y |  | 164 |
| runOneTask | fn | Y |  | 227 |
| renderReport | fn |  |  | 373 |
| escapeMd | fn |  |  | 413 |

### scripts\batch-tasks.ts（0 个）
- （无顶层函数/方法提取）
### scripts\check-llm.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| main | fn | Y |  | 14 |

### scripts\compact-entity-events.cjs（0 个）
- （无顶层函数/方法提取）
### scripts\dev-fast.mjs（0 个）
- （无顶层函数/方法提取）
### scripts\k6-load-test.js（9 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| setup | fn |  | Y | 83 |
| teardown | fn |  | Y | 107 |
| (anon) | fn |  | Y | 120 |
| testMissionLifecycle | fn |  |  | 149 |
| testEventBusPublish | fn |  |  | 219 |
| testPipelineExecution | fn |  |  | 271 |
| testHealthCheck | fn |  |  | 305 |
| testReadQueries | fn |  |  | 332 |
| generateRandomMission | fn |  | Y | 359 |

### scripts\k6-smoke.js（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| setup | fn |  | Y | 36 |
| (anon) | fn |  | Y | 50 |

### scripts\ops-validate.ts（3 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| count | fn |  |  | 20 |
| main | fn | Y |  | 24 |
| base | const-fn |  |  | 35 |

### scripts\production-check.cjs（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| main | fn | Y |  | 31 |

### scripts\run-all-production-tests.ts（2 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| runStep | fn | Y |  | 40 |
| main | fn | Y |  | 91 |

### scripts\run-all-tests.ts（0 个）
- （无顶层函数/方法提取）
### scripts\run-everything.ts（4 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| run | fn |  |  | 45 |
| exists | fn |  |  | 80 |
| main | fn | Y |  | 105 |
| finish | fn |  |  | 165 |

### scripts\start.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| main | fn | Y |  | 32 |

### scripts\tracing\TraceRecorder.ts（8 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| summarize | fn |  | Y | 31 |
| createTraceSession | fn |  | Y | 71 |
| shouldRecord | fn |  |  | 82 |
| record | fn |  |  | 95 |
| wrapOne | fn |  |  | 99 |
| finish | const-fn |  |  | 114 |
| wrap | fn |  |  | 152 |
| renderCallChain | fn |  | Y | 189 |

### scripts\validate-architecture.js（5 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| walkFiles | fn |  |  | 45 |
| isRelevantSource | fn |  |  | 66 |
| basename | fn |  |  | 74 |
| matchLines | fn |  |  | 269 |
| namedImportsFrom | fn |  |  | 399 |

### scripts\verify-e2e.ts（1 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| main | fn | Y |  | 17 |

### scripts\workflow-cli.ts（15 个）
| 函数 | kind | async | export | 行 |
|---|---|---|---|---|
| loadState | fn | Y |  | 39 |
| saveState | fn | Y |  | 49 |
| printHelp | fn |  |  | 60 |
| parseArgs | fn |  |  | 93 |
| readStdin | fn |  |  | 120 |
| cmdCreate | fn | Y |  | 136 |
| cmdInstall | fn | Y |  | 178 |
| cmdRun | fn | Y |  | 208 |
| cmdList | fn | Y |  | 287 |
| cmdOptimize | fn | Y |  | 315 |
| cmdVersions | fn | Y |  | 330 |
| cmdRollback | fn | Y |  | 343 |
| cmdStatus | fn | Y |  | 354 |
| cmdMetrics | fn | Y |  | 363 |
| main | fn | Y |  | 380 |

## 3. 核心执行链关系链（函数级，自动生成）

> 对 8 层主链/装配/服务器/shell 链的关键入口文件，列出其内部实际出现的调用目标（去重+频次，取自上节 CALLS 实证数据）。横向跨文件链：文件→import 已在第 1 节；此处聚焦入口函数内部调用了什么。

### packages/connectors/src/ConnectorRegistry.ts
| 调用目标 | 频次 | | 调用目标 | 频次 |
|---|---|---|---|---|
| this.connectors.values | 3 || this.globMatch | 2 | 
| this.connectors.has | 1 || connector.initialize | 1 | 
| this.connectors.set | 1 || this.metaCache.set | 1 | 
| connector.getMeta | 1 || this.connectors.delete | 1 | 
| this.metaCache.delete | 1 || this.connectors.get | 1 | 
| this.metaCache.get | 1 || this.metaCache.values | 1 | 
| c.capabilities.some | 1 || this.findConnectorForAction | 1 | 
| this.checkPermission | 1 || connector.validate | 1 | 
| connector.execute | 1 || this.execute | 1 | 

### packages/connectors/src/ShellConnector.ts
| 调用目标 | 频次 | | 调用目标 | 频次 |
|---|---|---|---|---|
| tokens.push | 3 || String | 3 | 
| parseCommandLine | 2 || Math.min | 2 | 
| Number | 2 || runCommand | 2 | 
| /\s/.test | 1 || super | 1 | 
| super.validate | 1 || this.allowlist.has | 1 | 
| super.execute | 1 || makePrivateTempDir | 1 | 
| randomPrivateFilePath | 1 || writeExclusive | 1 | 
| cleanupTempDir | 1 | |  | 

### packages/core/src/execution/UnifiedExecutionEngine.ts
| 调用目标 | 频次 | | 调用目标 | 频次 |
|---|---|---|---|---|
| Date.now | 17 || request.onProgress | 6 | 
| makeProgressEvent | 6 || this.eventBus.emit | 4 | 
| Math.random | 4 || this.recordExecutionPath | 3 | 
| this.executionRecords.set | 2 || runOnce | 2 | 
| String | 2 || this.analyzeComplexity | 2 | 
| this.executeViaOrchestrator | 2 || this.executionRecords.get | 2 | 
| DepartmentContext.partitionKey | 1 || request.goal.substring | 1 | 
| this.executeAuto | 1 || this.recordExecutionQuality | 1 | 
| goal.split | 1 || /\n\s*\d+\.\s/.test | 1 | 

### packages/core/src/execution/orchestration/OrchestratorAgent.ts
| 调用目标 | 频次 | | 调用目标 | 频次 |
|---|---|---|---|---|
| tokenCount | 10 || lines.push | 8 | 
| Date.now | 6 || this.llm.generateText | 5 | 
| this.opts.onTokenUsage | 5 || chargeTokens | 5 | 
| this.opts.sessionStore.appendCustom | 5 || Array.isArray | 3 | 
| toStringList | 3 || extractJsonObject | 3 | 
| capSteps | 3 || results.set | 3 | 
| JSON.stringify | 2 || this.opts.sessionStore.createSession | 2 | 
| ANALYSIS_PROMPT | 2 || parseAnalysis | 2 | 
| this.formatResults | 2 || stepFailures.entries | 2 | 

### packages/core/src/facade/CompanyFacade.ts
| 调用目标 | 频次 | | 调用目标 | 频次 |
|---|---|---|---|---|
| Date.now | 7 || '='.repeat | 6 | 
| lines.push | 5 || goal.substring | 4 | 
| String | 4 || this.departmentManager.findByName | 3 | 
| this.departmentManager.listDepartments | 2 || lines.join | 2 | 
| import | 1 || this.departmentManager.createDepartment | 1 | 
| this.roleRegistry.defineRole | 1 || this.executeGoal | 1 | 
| this.departmentManager.getStats | 1 || this.ensureBootstrapped | 1 | 
| this.goalIntelligence.understandGoal | 1 || IntentClassifier.classify | 1 | 
| this.chatStreamer | 1 || this.llmProvider | 1 | 

### packages/core/src/gate/ForcedQueryGuard.ts
| 调用目标 | 频次 | | 调用目标 | 频次 |
|---|---|---|---|---|
| this.traces.get | 6 || ids.push | 2 | 
| trace.toolCalls.push | 1 || this.safeStringify | 1 | 
| Date.now | 1 || this.extractIds | 1 | 
| trace.retrievedObjectIds.add | 1 || this.traces.set | 1 | 
| referencedIds.filter | 1 || known.has | 1 | 
| Array.from | 1 || this.traces.delete | 1 | 
| this.missionIds.set | 1 || this.missionIds.get | 1 | 
| this.onTraceCallback | 1 || this.traces.keys | 1 | 
| this.flushTrace | 1 || this.traces.clear | 1 | 

### packages/core/src/gate/runOntologyGroundedReasoning.ts
| 调用目标 | 频次 | | 调用目标 | 频次 |
|---|---|---|---|---|
| Date.now | 10 || eventStore.append | 6 | 
| Array.isArray | 5 || withGateRetry | 4 | 
| piBridge.generateText | 4 || ruleViolations.filter | 4 | 
| countTokens | 3 || ruleEnforcementCheck | 3 | 
| ruleDomainOf | 3 || extractBalancedJSON | 3 | 
| JSON.parse | 3 || gateRetryPolicy.shouldRetry | 2 | 
| groundingCache.delete | 2 || options.onTokenUsage | 2 | 
| sanitizeQueryPlan | 2 || parseQueryPlanRobust | 2 | 
| toolExecutor | 2 || createQueryMissEvent | 2 | 

### packages/core/src/governance/control-plane/ControlPlane.ts
| 调用目标 | 频次 | | 调用目标 | 频次 |
|---|---|---|---|---|
| this.agent.findForCapability | 2 || lower.includes | 2 | 
| this.goal.process | 1 || this.policy.evaluate | 1 | 
| this.policy.checkGoalPolicy | 1 || inferGoalCapabilities | 1 | 
| this.resource.check | 1 || this.resource.checkAvailability | 1 | 
| goal.toLowerCase | 1 || CapabilityRegistry.getAll | 1 | 
| c.name.toLowerCase | 1 || nameWords.some | 1 | 
| domainWords.some | 1 | |  | 

### packages/core/src/infrastructure/common/EventBus.ts
| 调用目标 | 频次 | | 调用目标 | 频次 |
|---|---|---|---|---|
| handler | 9 || domainMap.get | 7 | 
| Date.now | 6 || this.listeners.get | 6 | 
| this.onceListeners.get | 4 || this.domainListeners.get | 3 | 
| Math.floor | 3 || type.startsWith | 2 | 
| this.emitCounts.entries | 2 || this.validateContract | 2 | 
| this.emitCounts.set | 2 || this.emitCounts.get | 2 | 
| this.eventCounters.set | 2 || event.type.endsWith | 2 | 
| String | 2 || this.history.push | 2 | 
| this.history.shift | 2 || isProjectedEvent | 2 | 

### packages/core/src/infrastructure/common/PluginSystem.ts
| 调用目标 | 频次 | | 调用目标 | 频次 |
|---|---|---|---|---|
| this.plugins.get | 6 || this.plugins.values | 3 | 
| this.plugins.has | 2 || this.topologicalSort | 2 | 
| this.plugins.set | 1 || Date.now | 1 | 
| this.initializePlugin | 1 || this.startPlugin | 1 | 
| sorted.reverse | 1 || this.stopPlugin | 1 | 
| deps.every | 1 || plugin.initialize | 1 | 
| plugin.start | 1 || plugin.stop | 1 | 
| tsort | 1 | |  | 

### packages/core/src/infrastructure/tools/DomainPrimitiveRegistry.ts
| 调用目标 | 频次 | | 调用目标 | 频次 |
|---|---|---|---|---|
| DomainPrimitiveRegistry.primitives.has | 2 || Date.now | 2 | 
| d | 2 || DomainPrimitiveRegistry.primitives.get | 2 | 
| DomainPrimitiveRegistry.primitives.values | 2 || DomainPrimitiveRegistry.primitives.set | 1 | 
| DomainPrimitiveRegistry.unregister | 1 || primitives.map | 1 | 
| DomainPrimitiveRegistry.register | 1 || DomainPrimitiveRegistry.primitives.delete | 1 | 
| reg.primitive.canHandle | 1 || results.push | 1 | 
| results.sort | 1 || DomainPrimitiveRegistry.match | 1 | 
| reg.primitive.execute | 1 || DomainPrimitiveRegistry.primitives.keys | 1 | 
| items.reduce | 1 || items.sort | 1 | 

### packages/core/src/infrastructure/tools/primitives/KnowledgeQueryPrimitive.ts
| 调用目标 | 频次 | | 调用目标 | 频次 |
|---|---|---|---|---|
| query0.trim | 2 || params.goal.trim | 2 | 
| guard.recordToolCall | 2 || KnowledgeQueryPrimitive.sources.push | 1 | 
| KnowledgeQueryPrimitive.sources.sort | 1 || task.toLowerCase | 1 | 
| query.slice | 1 || Date.now | 1 | 
| query.trim | 1 || getOntologyGuard | 1 | 
| runOntologyGroundedReasoning | 1 || getPiBridge | 1 | 
| ontologyResult.proposal.referenced_object_ids.map | 1 || JSON.stringify | 1 | 
| items.slice | 1 || query.substring | 1 | 

### packages/core/src/infrastructure/tools/primitives/ShellExecutionPrimitive.ts
| 调用目标 | 频次 | | 调用目标 | 频次 |
|---|---|---|---|---|
| task.toLowerCase | 1 || /打包|部署|测试|install|deploy|test|build|release/.test | 1 | 
| command?.trim | 1 || command.split | 1 | 
| ShellExecutionPrimitive.allowedCommands.includes | 1 || ShellExecutionPrimitive.allowedCommands.join | 1 | 
| READONLY_SHELL_COMMANDS.has | 1 || PrimitiveGate.gateReadonly | 1 | 
| PrimitiveGate.gateDestructive | 1 || ShellExecutionPrimitive.shellExec | 1 | 
| normalizeShellOutcome | 1 || scrubEnv | 1 | 

### packages/studio/server/StudioServer.ts
| 调用目标 | 频次 | | 调用目标 | 频次 |
|---|---|---|---|---|
| res.status | 67 || res.json | 57 | 
| this.app.get | 31 || Date.now | 15 | 
| this.app.post | 15 || path.resolve | 12 | 
| String | 12 || getSharedPiBridge | 5 | 
| fs.readFileSync | 5 || Number | 5 | 
| JSON.stringify | 5 || history.filter | 5 | 
| path.join | 4 || fs.existsSync | 4 | 
| /^[A-Za-z0-9_-]{1,128}$/.test | 4 || path.basename | 3 | 
| path.extname | 3 || Math.random | 3 | 


### 主链值说明（8 层架构）
- 入口：`CompanyFacade.executeGoal`（L1 之上）→ ControlPlane.checkAll（L1 治理）→ Ontology Gate `runOntologyGroundedReasoning`（L3）→ `UnifiedExecutionEngine`（L5 执行，简单→原语快路径/复杂→OrchestratorAgent）→ L6 Evaluation → L7 Evolution
- 装配：`bootstrapUnified`（L8）→ PiBridge → `DomainPrimitiveRegistry.registerMultiple`（5 通用原语）→ `PluginSystem.startAll`（G2 接入，插件级 stop 可回卷）
- 服务器：`StudioServer`（HTTP/SSE :5473）→ RuntimeAPI → core 执行链 → EventBus（at-least-once + 事件契约校验）→ observability trace
- Shell 链：`ShellExecutionPrimitive.execute` → ConnectorRegistry shell.exec → `ShellConnector` → `runCommand`(secureExec：shell:false / scrubEnv / ExecOutcome 正交上报)
