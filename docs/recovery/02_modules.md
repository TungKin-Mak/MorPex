# 02 — Module Discovery

> **Phase 2**: Every module identified with exports, imports, dependencies, and registration status
> **Date**: 2026-07-18
> **Confidence**: HIGH (based on source code analysis)

---

## Module Index

| # | Module | Package | Status |
|---|--------|---------|--------|
| 1 | MorPexKernel | core | ✅ ACTIVE |
| 2 | EventBus | core | ✅ ACTIVE |
| 3 | PluginSystem | core | ✅ ACTIVE |
| 4 | ExecutionIdentity | core | ✅ ACTIVE |
| 5 | ExecutionGateway | core | ✅ ACTIVE |
| 6 | ContractGateway | core | ⚠️ LEGACY |
| 7 | PiAdapter | core | ✅ ACTIVE |
| 8 | PiAdapterBridge | core | ⚠️ UNUSED |
| 9 | ExecutionMirror | core | ✅ ACTIVE |
| 10 | ExecutionRecordingEngine | core | ⚠️ UNUSED |
| 11 | EventStore | core | ✅ ACTIVE |
| 12 | EventStoreSubscriber | core | ✅ ACTIVE |
| 13 | EngineSubscriber | core | ✅ ACTIVE |
| 14 | AgentFactory | core | ✅ ACTIVE |
| 15 | AgentService | core | ⚠️ UNUSED |
| 16 | LLMProvider | core | ✅ ACTIVE |
| 17 | MetaPlanner | core | ✅ ACTIVE |
| 18 | PipelineExecutor | core | ✅ ACTIVE |
| 19 | PlanExperienceStore | core | ✅ ACTIVE |
| 20 | PlanAnalyzer | core | ✅ ACTIVE |
| 21 | PlanningIntelligenceEngine | core | ✅ ACTIVE |
| 22 | CrossDomainRouter | core | ✅ ACTIVE |
| 23 | DomainDispatcher | core | ✅ ACTIVE |
| 24 | ArbitrationHandler | core | ✅ ACTIVE |
| 25 | DomainCluster | core | ✅ ACTIVE |
| 26 | DomainClusterManager | core | ✅ ACTIVE |
| 27 | NegotiationEngine | core | ✅ ACTIVE |
| 28 | PermissionEngine | core | ✅ ACTIVE |
| 29 | SessionProjection | core | ✅ ACTIVE |
| 30 | IntentPlugin | core | ✅ ACTIVE |
| 31 | IntentResolver | core | ❌ BYPASSED |
| 32 | MemoryBridge | core | ⚠️ UNUSED |
| 33 | MemoryBusListener | core | ✅ ACTIVE |
| 34 | MemoryBus | memory | ✅ ACTIVE |
| 35 | ZVecStorage | memory | ✅ ACTIVE |
| 36 | MemoryWiki | memory | ✅ ACTIVE |
| 37 | HistoryStore | memory | ✅ ACTIVE |
| 38 | StudioServer | studio/server | ✅ ACTIVE |
| 39 | StudioOrchestrator | studio/server | ✅ ACTIVE |
| 40 | SessionManager | studio/server | ✅ ACTIVE |
| 41 | FSMEngine | core | ❌ GHOST |
| 42 | DAGEngine | core | ❌ GHOST |
| 43 | SchedulerEngine | core | ❌ GHOST |
| 44 | SwarmEngine | core | ❌ GHOST |
| 45 | ExecutionGraphEngine | core | ❌ GHOST |
| 46 | AgentOrchestrator | core | ❌ GHOST |
| 47 | ExtensionRegistry | core | ❌ GHOST |
| 48 | LineageTracker | core | ❌ GHOST |
| 49 | ContextPruner | core | ❌ GHOST |
| 50 | McpProcessGuard | core | ❌ GHOST |
| 51 | CheckpointManager | core | ❌ GHOST |
| 52 | ToolCallTracker | core | ✅ ACTIVE |
| 53 | McpRuntimeManager | core | ❌ GHOST |
| 54 | PiAIAdapter | adapters | ❌ DISCONNECTED |
| 55 | PiAgentCoreAdapter | adapters | ❌ DISCONNECTED |

---

## Detailed Module Report

### 1. MorPexKernel

| Attribute | Value |
|-----------|-------|
| **Path** | `packages/core/src/common/Kernel.ts` |
| **Responsibility** | System lifecycle management — initializes all core components |
| **Exports** | `MorPexKernel` class, `KernelConfig` interface |
| **Imports** | EventBus, ExecutionIdentity, PluginSystem, ExecutionGateway, PiAdapter, ContractGateway, PiAdapterBridge, ExecutionMirror, JSONLStorage, EventStore, EngineSubscriber |
| **Used By** | `bootstrap.ts`, `StudioServer.ts` |
| **Entry Point** | `new MorPexKernel(config)`, called from `StudioServer.start()` |
| **Runtime Registration** | Instantiated in StudioServer constructor |
| **Confidence** | HIGH |

### 2. EventBus

| Attribute | Value |
|-----------|-------|
| **Path** | `packages/core/src/common/EventBus.ts` |
| **Responsibility** | In-process event publish/subscribe with domain scoping |
| **Exports** | `EventBus` class |
| **Imports** | Core types only |
| **Used By** | Kernel, Mirror, StudioServer, all plugins |
| **Entry Point** | Created in Kernel constructor |
| **Confidence** | HIGH |

### 3. MetaPlanner

| Attribute | Value |
|-----------|-------|
| **Path** | `packages/core/src/extensions/planning/MetaPlanner.ts` |
| **Responsibility** | Self-improving plan orchestrator — manages 7-stage pipeline, deviation guard, experience store |
| **Exports** | `MetaPlanner` class |
| **Imports** | PipelineExecutor, PlanExperienceStore, PlanAnalyzer, PlanningIntelligenceEngine, ExtensionRegistry, SessionErrorExtractor, TemplateManager, ToolQualityManager, DeviationGuard, RuntimeController, PipelineLogger, Prompts config |
| **Used By** | `StudioServer.ts` (initialized in `initMetaPlanner()`) |
| **Entry Point** | `new MetaPlanner()`, called from StudioServer.initMetaPlanner() |
| **Runtime Registration** | initialized with `initialize(ctx)` then `start()` |
| **Confidence** | HIGH |

### 4. PipelineExecutor

| Attribute | Value |
|-----------|-------|
| **Path** | `packages/core/src/extensions/planning/pipeline/PipelineExecutor.ts` |
| **Responsibility** | Orchestrates 7-stage planning pipeline |
| **Exports** | `PipelineExecutor` class |
| **Imports** | All 7 pipeline stages, PipelineLogger |
| **Used By** | MetaPlanner |
| **Confidence** | HIGH |

### 5. CrossDomainRouter

| Attribute | Value |
|-----------|-------|
| **Path** | `packages/core/src/router/CrossDomainRouter.ts` |
| **Responsibility** | Decomposes user intent into cross-domain DAG |
| **Exports** | `CrossDomainRouter` class |
| **Imports** | DomainClusterManager, LLM types |
| **Used By** | StudioServer (via StudioOrchestrator) |
| **Confidence** | HIGH |

### 6. DomainDispatcher

| Attribute | Value |
|-----------|-------|
| **Path** | `packages/core/src/router/DomainDispatcher.ts` |
| **Responsibility** | Executes DAG nodes against DomainClusters |
| **Exports** | `DomainDispatcher` class, NodeResult, DAGExecutionResult |
| **Imports** | DomainClusterManager, NegotiationEngine, ArbitrationHandler, AsyncResourceLocker |
| **Used By** | StudioServer (via StudioOrchestrator) |
| **Confidence** | HIGH |

### 7. DomainCluster

| Attribute | Value |
|-----------|-------|
| **Path** | `packages/core/src/domains/DomainCluster.ts` |
| **Responsibility** | Manages a domain's agent lifecycle (wake/sleep/execute) |
| **Exports** | `DomainCluster` class |
| **Imports** | pi-agent-core (AgentHarness), AgentFactory |
| **Used By** | DomainClusterManager |
| **Confidence** | HIGH |

### 8. StudioServer

| Attribute | Value |
|-----------|-------|
| **Path** | `packages/studio/server/StudioServer.ts` |
| **Responsibility** | Assembles ALL components, exposes REST API + SSE, bridges frontend ↔ kernel |
| **Exports** | `StudioServer` class, `StudioServerConfig` |
| **Imports** | Kernel, ALL engine classes, memory subsystem, adapters, tools |
| **Used By** | `packages/studio/server/index.ts` (main()) |
| **Entry Point** | `new StudioServer(config).start()` |
| **Runtime Registration** | Creates EVERYTHING — God Object anti-pattern |
| **Confidence** | HIGH |

### 9. IntentPlugin / IntentResolver

| Attribute | Value |
|-----------|-------|
| **Path** | `packages/core/src/planes/control-plane/intent/` |
| **Responsibility** | Classifies user intent (chat vs task) |
| **Exports** | `IntentPlugin` (plugin.ts), `IntentResolver` (IntentResolver.ts) |
| **Imports** | Core types, LLMProvider |
| **Used By** | IntentPlugin registered in Kernel; IntentResolver **bypassed** — StudioOrchestrator does intent classification inline |
| **Confidence** | HIGH |

### 10. MemoryBus (memory package)

| Attribute | Value |
|-----------|-------|
| **Path** | `packages/memory/src/core/MemoryBus.ts` |
| **Responsibility** | Three-pool memory system (Main + Archive + Temp) with gating |
| **Exports** | `MemoryBus` class, factory `createMemoryBus()` |
| **Imports** | ZVecStorage, WriteGate, Compactor, types |
| **Used By** | StudioServer.initMemoryStorage(), MetaPlanner |
| **Confidence** | HIGH |

### 11. MemoryWiki

| Attribute | Value |
|-----------|-------|
| **Path** | `packages/memory/src/wiki/MemoryWiki.ts` |
| **Responsibility** | SQLite + ZVec backed wiki memory |
| **Exports** | `MemoryWiki` class |
| **Imports** | better-sqlite3, zvec, EmbeddingClient |
| **Used By** | StudioServer.initMemoryStorage(), DocWatcher, DocTopology, MemoryRetriever |
| **Confidence** | HIGH |

### 12. FSMEngine (GHOST MODULE)

| Attribute | Value |
|-----------|-------|
| **Path** | `packages/core/src/planes/runtime-kernel/fsm/FSMEngine.ts` |
| **Responsibility** | Finite state machine engine |
| **Exports** | `FSMEngine` class, `plugin.ts` |
| **Imports** | Core types |
| **Used By** | Instantiated in StudioServer.initAIEngines() but **never called** |
| **Registration** | Plugin NOT registered with Kernel.PluginSystem |
| **Confidence** | HIGH |

### 13-17. Other Ghost Modules

The following are all instantiated in `StudioServer.initAIEngines()` but **never executed**:

- **DAGEngine** — `packages/core/src/planes/runtime-kernel/dag/DAGEngine.ts`
- **SchedulerEngine** — `packages/core/src/planes/runtime-kernel/scheduler/SchedulerEngine.ts`
- **SwarmEngine** — `packages/core/src/planes/agent-plane/swarm/SwarmEngine.ts`
- **ExecutionGraphEngine** — `packages/core/src/planes/runtime-kernel/execution-graph/ExecutionGraph.ts`
- **AgentOrchestrator** — `packages/core/src/planes/agent-plane/orchestrator/AgentOrchestrator.ts`
- **ExtensionRegistryImpl** — `packages/core/src/extensions/ExtensionRegistry.ts`
- **LineageTracker** — `packages/core/src/extensions/LineageTracker.ts`
- **ContextPruner** — `packages/core/src/extensions/ContextPruner.ts`
- **McpProcessGuard** — `packages/core/src/extensions/McpProcessGuard.ts`
- **CheckpointManager** — `packages/core/src/extensions/CheckpointManager.ts`

### 18. PiAIAdapter / PiAgentCoreAdapter (DISCONNECTED)

| Attribute | Value |
|-----------|-------|
| **Path** | `packages/adapters/pi-ai/PiAIAdapter.ts` |
| **Responsibility** | Wraps pi-ai as an AgentRuntimePort |
| **Used By** | **Never imported** by any production code in core or server |
| **Confidence** | HIGH |

---

## Registration Summary

### Plugins Registered with PluginSystem: **2 of 12**

| Plugin | Registered? | File |
|--------|------------|------|
| IntentPlugin | ✅ YES | `plugins/control-plane/intent/plugin.ts` |
| IndustryPlugin | ✅ YES | `industry/plugin.ts` |
| FSMEngine plugin | ❌ NO | `runtime-kernel/fsm/plugin.ts` |
| DAGEngine plugin | ❌ NO | `runtime-kernel/dag/plugin.ts` |
| SchedulerEngine plugin | ❌ NO | `runtime-kernel/scheduler/plugin.ts` |
| ExecutionGraph plugin | ❌ NO | `runtime-kernel/execution-graph/plugin.ts` |
| AgentOrchestrator plugin | ❌ NO | `agent-plane/orchestrator/plugin.ts` |
| SwarmEngine plugin | ❌ NO | `agent-plane/swarm/plugin.ts` |
| ArtifactRegistry plugin | ❌ NO | `knowledge-plane/artifacts/plugin.ts` |
| KnowledgeGraph plugin | ❌ NO | `knowledge-plane/knowledge/plugin.ts` |
| Memory plugin | ❌ NO | `knowledge-plane/memory/plugin.ts` |
| MetaPlanner | ❌ NO (handled separately) | `extensions/planning/MetaPlanner.ts` |

### Adapters Registered with Kernel: **1 of 4**

| Adapter | Registered? | Notes |
|---------|------------|-------|
| PiAdapter | ✅ YES | Via kernel.registerPiRuntime() |
| PiAdapterBridge | ✅ YES | Via ContractGateway.register() |
| PiAIAdapter | ❌ NO | Never wired |
| PiAgentCoreAdapter | ❌ NO | Never wired |
