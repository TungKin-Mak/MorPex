# 04 — Dependency Graph

> **Phase 4**: Text-based dependency graph analysis
> **Date**: 2026-07-18
> **Confidence**: HIGH

---

## 1. Package-Level Dependencies

```
packages/studio/server
  → packages/core (MorPexKernel, ALL plane engines, ALL extensions, router, domains, tools)
  → packages/memory (MemoryBus, MemoryWiki, HistoryStore, ZVecStorage, etc.)
  → @earendil-works/pi-ai (streamSimple, completeSimple, getModel)
  → @earendil-works/pi-agent-core (AgentHarness, InMemorySessionRepo)
  → express, cors, http, fs, path

packages/core
  → packages/contracts (type imports only)
  → @earendil-works/pi-agent-core (PiRuntime types)
  → @earendil-works/pi-ai (streamSimple, completeSimple in initControlPlane)
  → @zvec/zvec (vector storage)
  → better-sqlite3 (in memory/wiki)
  → lru-cache

packages/memory
  → @zvec/zvec (ZVecStorage vector DB)
  → better-sqlite3 (MemoryWiki SQLite)
  → packages/core (⚠️ REVERSE DEPENDENCY: KnowledgeGraph imported in ECLCognifyEngine)

packages/adapters
  → packages/contracts (type imports)
  → @earendil-works/pi-agent-core
  → @earendil-works/pi-ai

packages/contracts
  → (zero internal dependencies — pure types)

packages/studio/ui
  → (React, Three.js, Zustand — purely frontend)
```

---

## 2. Critical Dependency Issues

### ISSUE 1: Memory ← Core (REVERSE DEPENDENCY)

```
packages/memory/src/core/ECLCognifyEngine.ts
  → imports KnowledgeGraph from packages/core/src/planes/knowledge-plane/knowledge/KnowledgeGraph
```

**Why this is critical**: The memory package should be independent of core. This creates a circular dependency risk and violates the intended package boundary.

**Evidence**: `packages/memory/src/core/ECLCognifyEngine.ts` line: `import { KnowledgeGraph } from '../../../core/src/planes/knowledge-plane/knowledge/KnowledgeGraph.js'`

### ISSUE 2: StudioServer imports EVERYTHING directly

```
StudioServer.ts imports:
  - packages/core/index.ts (via ../../core/index)
  - packages/core/src/services/AgentService (deep import)
  - packages/core/src/planes/runtime-kernel/fsm/FSMEngine (deep import)
  - packages/core/src/planes/runtime-kernel/dag/DAGEngine (deep import)
  - packages/core/src/planes/runtime-kernel/scheduler/SchedulerEngine (deep import)
  - packages/core/src/planes/knowledge-plane/knowledge/KnowledgeGraph (deep import)
  - packages/core/src/planes/knowledge-plane/artifacts/ArtifactRegistry (deep import)
  - packages/core/src/planes/agent-plane/orchestrator/AgentOrchestrator (deep import)
  - packages/core/src/planes/agent-plane/swarm/SwarmEngine (deep import)
  - packages/core/src/planes/runtime-kernel/execution-graph/ExecutionGraph (deep import)
  - packages/core/src/planes/control-plane/intent/plugin (deep import)
  - packages/core/src/domains/DomainClusterManager (deep import)
  - packages/core/src/router/CrossDomainRouter (deep import)
  - packages/core/src/router/DomainDispatcher (deep import)
  - packages/core/src/negotiation/NegotiationEngine (deep import)
  - packages/core/src/router/ArbitrationHandler (deep import)
  - packages/core/src/extensions/planning/MetaPlanner (deep import)
  - packages/core/src/extensions/ExtensionRegistry (deep import)
  - packages/core/src/extensions/LineageTracker (deep import)
  - packages/core/src/extensions/ContextPruner (deep import)
  - packages/core/src/extensions/McpProcessGuard (deep import)
  - packages/core/src/permission/PermissionEngine (deep import)
  - packages/core/src/projection/SessionProjection (deep import)
  - packages/core/src/adapters/memory/index (deep import)
  - packages/core/src/tools/ToolCallTracker (deep import)
  - packages/core/src/mirror/ExecutionRecordingEngine (deep import)
  - packages/core/src/memory/MemoryBusListener (deep import)
  - packages/core/src/compaction/CompactionPolicy (deep import)
  - packages/core/src/mcp/McpRuntimeManager (deep import)
  - packages/core/src/services/LLMProvider (deep import)
  - packages/memory/src/index (via ../../memory/src/index)
  - @earendil-works/pi-ai (dynamic import)
  - @earendil-works/pi-agent-core (dynamic import)
```

**Why this is critical**: StudioServer is a God Object that directly imports ~30 internal modules from packages/core without going through the public API (`@morpex/core`).

---

## 3. Key Runtime Dependency Chains

### Chain A: User Request Processing

```
HTTP Request
  → StudioServer.setupRoutes() [studio/server/StudioServer.ts]
    → SessionManager.send() [studio/server/SessionManager.ts]
      → StudioOrchestrator.routeMessage() [studio/server/StudioOrchestrator.ts]
        → CrossDomainRouter.decompose() [core/router/CrossDomainRouter.ts]
          → LLMProvider.call() [core/services/LLMProvider.ts]
            → pi-ai streamSimple() [external]
        → DomainDispatcher.dispatch() [core/router/DomainDispatcher.ts]
          → DomainClusterManager.getCluster() [core/domains/DomainClusterManager.ts]
          → NegotiationEngine.negotiate() [core/negotiation/NegotiationEngine.ts]
          → DomainCluster.execute() [core/domains/DomainCluster.ts]
            → AgentFactory.spawn() [core/services/AgentFactory.ts]
              → pi-agent-core AgentHarness [external]
            → AgentHarness.run() → LLM call
```

### Chain B: Event Flow

```
Any component
  → EventBus.emit(event) [core/common/EventBus.ts]
    → ExecutionMirror.handleEvent() [core/mirror/ExecutionMirror.ts]
      → JSONLStorage.append() [core/mirror/storage/JSONLStorage.ts]
    → EngineSubscriber.handleEvent() [core/engine/engine-subscriber.ts]
      → EventStore.append() [core/event/EventStore.ts]
    → MemoryBusListener.handleEvent() [core/memory/MemoryBusListener.ts]
      → MemoryBus.remember() [memory/core/MemoryBus.ts]
    → StudioServer SSE [studio/server/StudioServer.ts]
      → HTTP Response SSE stream
```

### Chain C: MetaPlanner Pipeline

```
MetaPlanner.process()
  → PipelineExecutor.execute() [planning/pipeline/PipelineExecutor.ts]
    → Stage1: intent-analysis
    → Stage2: experience-retrieval (→ PlanExperienceStore)
    → Stage3: candidate-generation
    → Stage4: plan-simulation (→ LookAheadSimulator)
    → Stage5: plan-evaluation (→ PlanAnalyzer)
    → Stage6: decision-trace
    → Stage7: best-plan
  → Returns optimized ExecutionDAG
  → Passed to DomainDispatcher
```

---

## 4. Isolated/Unused Dependency Chains

### Dead Chain A: Adapters Package

```
packages/adapters/index.ts
  → PiAIAdapter (never imported by StudioServer or Kernel)
  → PiAgentCoreAdapter (never imported by StudioServer or Kernel)
  → MockRuntimeAdapter (never imported by production code)
```

### Dead Chain B: Planning Engines

```
FSMEngine → (no callers, instantiated but never used)
SchedulerEngine → (no callers, instantiated but never used)
SwarmEngine → (no callers, instantiated but never used)
ExecutionGraphEngine → (no callers, instantiated but never used)
AgentOrchestrator → (no callers, instantiated but never used)
```

### Dead Chain C: Extensions

```
ExtensionRegistryImpl → (instantiated but never used as registry)
LineageTracker → (instantiated but never called)
ContextPruner → (instantiated but never called)
McpProcessGuard → (instantiated but depends on McpRuntimeManager which is never used)
CheckpointManager → (registered but never called)
```

### Dead Chain D: McpRuntimeManager

```
McpRuntimeManager → (NEVER imported by any production code)
McpJsonRpcHandler → (NEVER imported by any production code)
```
