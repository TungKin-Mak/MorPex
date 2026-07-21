# 03 — Architecture Reconstruction

> **Phase 3**: Real architecture based on source code analysis, ignoring folder structure
> **Date**: 2026-07-18
> **Confidence**: HIGH

---

## ⚠️ Important Note

The documented architecture describes a clean layer separation (L0-L5). The **actual runtime architecture** is significantly different. This report reconstructs what really happens at runtime.

---

## Real Architecture Layers

### Layer 1: HTTP / Transport Layer

**Purpose**: Accept user requests, serve frontend, stream events

**Runtime Path**:
```
Browser → HTTP POST /api/session/:id/send
       → HTTP POST /api/chat/message  
       → SSE GET /api/stream/global
```

**Main Components**:
- `StudioServer` (Express HTTP server, port 8080)
- SSE event stream (EventBus → frontend)
- Static file server (React dist)

**Evidence**: `packages/studio/server/StudioServer.ts` lines 350-620 (setupRoutes, setupSSE)

---

### Layer 2: Session & State Management

**Purpose**: Manage user sessions, persist chat history, track execution state

**Runtime Path**:
```
HTTP Request → SessionManager.create() → SessionManager.send()
            → SessionStore.appendChatMessage()
            → StudioOrchestrator.routeMessage()
```

**Main Components**:
- `SessionManager` — session create/send/ensureHarness
- `SessionStore` — JSONL file persistence
- `StudioOrchestrator` — message routing hub
- `SessionProjection` — event-driven read model

**Evidence**: 
- `packages/studio/server/SessionManager.ts`
- `packages/studio/server/StudioOrchestrator.ts`

---

### Layer 3: Intent Classification

**Purpose**: Determine if user request is chat or task

**Runtime Path**:
```
StudioOrchestrator.routeMessage()
  → [INLINE CLASSIFICATION using LLM]
  → Returns "direct_chat" or "dag_plan"
```

**Main Components**:
- **Inline intent classification** in StudioOrchestrator (uses LLMProvider)
- `IntentPlugin` (registered with Kernel but **bypassed**)
- `IntentResolver` (exists but **never called**)

**Architecture Drift**: The documented IntentResolver class exists at `packages/core/src/planes/control-plane/intent/IntentResolver.ts` but StudioOrchestrator does intent classification inline instead of using it.

**Evidence**: `packages/studio/server/StudioOrchestrator.ts` - look for intent classification logic

---

### Layer 4: Planning & Decomposition

**Purpose**: Decompose user requests into executable DAG plans

**Runtime Path** (for task mode):
```
StudioOrchestrator → CrossDomainRouter.decompose()
  → [LLM call to decompose into domain DAG]
  → Returns ExecutionDAG (nodes with domain assignments)

Optional: StudioOrchestrator → MetaPlanner → PipelineExecutor
  → 7-stage pipeline (analysis → retrieval → generation → simulation → evaluation → decision)
  → Returns optimized plan
```

**Main Components**:
- `CrossDomainRouter` — DAG decomposition
- `MetaPlanner` — Self-improving planner (optional, enabled by default)
- `PipelineExecutor` — 7-stage pipeline executor
- `PlanningIntelligenceEngine` — template evolution
- `PlanExperienceStore` — past plan storage

**Evidence**:
- `packages/core/src/router/CrossDomainRouter.ts`
- `packages/core/src/extensions/planning/MetaPlanner.ts`
- `packages/core/src/extensions/planning/pipeline/PipelineExecutor.ts`

---

### Layer 5: DAG Execution & Routing

**Purpose**: Execute decomposed DAG across domain clusters

**Runtime Path**:
```
DomainDispatcher.dispatch()
  → Topological sort of DAG nodes
  → For each node:
    DomainDispatcher.executeNode()
      → DomainClusterManager.getCluster(domainId)
      → DomainCluster.execute() (or wake + execute)
      → AgentFactory.spawn() → AgentHarness
      → LLM call with domain tools
  → Collect results
  → Return DAGExecutionResult
```

**Main Components**:
- `DomainDispatcher` — DAG execution engine
- `DomainClusterManager` — cluster registry
- `DomainCluster` — per-domain agent lifecycle
- `AgentFactory` — spawn agents
- `NegotiationEngine` — cross-domain conflict resolution
- `ArbitrationHandler` — conflict arbitration

**Evidence**:
- `packages/core/src/router/DomainDispatcher.ts`
- `packages/core/src/domains/DomainCluster.ts`
- `packages/core/src/services/AgentFactory.ts`

---

### Layer 6: Agent Runtime (The REAL Gateway Bypass)

**Purpose**: Execute LLM calls with domain-specific tools

**Critical Finding**: The documented `ExecutionGateway → PiAdapter` path is **bypassed**.

**Real Path**:
```
DomainCluster.execute()
  → DomainCluster.wake()
    → AgentFactory.spawnAgent(manifest)
      → new AgentHarness() from pi-agent-core
        → Direct pi-ai calls (streamSimple, completeSimple)
```

The `ExecutionGateway` and `PiAdapter` are **only used** for event emission from the PiRuntime events. The actual LLM execution goes directly through pi-agent-core.

**Evidence**: `packages/core/src/domains/DomainCluster.ts` - imports AgentHarness from pi-agent-core directly

---

### Layer 7: LLM Integration

**Purpose**: Call LLM models

**Runtime Path**:
```
AgentHarness → pi-agent-core → pi-ai → DeepSeek API
                               ↕
StudioServer: LLMProvider.set(rawCallLLM)
  → rawCallLLM() uses pi-ai's streamSimple() / completeSimple()
  → Model: deepseek-v4-flash (hardcoded)
```

**Main Components**:
- `@earendil-works/pi-ai` — external inference SDK
- `LLMProvider` — wrapper for LLM calls
- `PiAdapter` — event bridge from PiRuntime
- `ModelRegistry` — model/provider listing

**Evidence**: `packages/studio/server/StudioServer.ts` initControlPlane()

---

### Layer 8: Memory & Knowledge

**Purpose**: Persistent storage, recall, and knowledge management

**Runtime Path**:
```
MemoryBus.remember() / MemoryBus.recall()
  → ZVecStorage (vector search)
  → WriteGate (write quality control)
  → HistoryStore (persistence)

MemoryWiki.query()
  → SQLite + ZVec hybrid

KnowledgeGraph.query()
  → In-memory graph
```

**Main Components**:
- `MemoryBus` — three-pool memory (main/archive/temp)
- `MemoryWiki` — SQLite+ZVec wiki
- `MemoryRetriever` — wiki query tool
- `ZVecStorage` — vector storage
- `KnowledgeGraph` — in-memory graph
- `HistoryStore` — JSONL history
- `DocWatcher` / `DocTopology` — doc indexing

**Evidence**:
- `packages/memory/src/core/MemoryBus.ts`
- `packages/memory/src/wiki/MemoryWiki.ts`
- `packages/core/src/planes/knowledge-plane/knowledge/KnowledgeGraph.ts`

---

### Layer 9: Event & Observability

**Purpose**: System-wide event bus, recording, mirroring

**Runtime Path**:
```
Any component → EventBus.emit(event)
  → ExecutionMirror (record events)
  → EventStore (event sourcing)
  → EngineSubscriber (bridge to EventStore)
  → MemoryBusListener (auto-archive events)
  → StudioServer SSE → Frontend
```

**Main Components**:
- `EventBus` — in-process pub/sub
- `ExecutionMirror` — execution trace recording
- `EventStore` — event sourcing store
- `EngineSubscriber` — event bridge
- `MemoryBusListener` — auto memory archival
- `ExecutionRecordingEngine` — recording engine (unused)

**Evidence**: `packages/core/src/common/EventBus.ts`, `packages/core/src/mirror/`

---

### Layer 10: Tool System

**Purpose**: Provide LLM-accessible tools

**Runtime Path**:
```
AgentHarness → ToolExecutionProxy
  → DomainCluster.buildTools()
    → [domain-specific tools] + [global tools]
    → ArtifactRegistrySkill + MemorySearchTool + etc.
```

**Main Components**:
- `ToolExecutionProxy` — tool execution wrapper
- `ToolCallTracker` — tool call state machine
- `PermissionEngine` — tool call permission checks
- `Builtin tools` — TeamSay, ForkExecute, AgentCreate, MemorySearch, AskUser, ReadArtifact
- `ArtifactRegistrySkill` — artifact CRUD
- `KnowledgeGraphSkill` — knowledge graph query

**Evidence**: `packages/core/src/tools/`

---

### Layer 11: Extensions System

**Purpose**: Pluggable extensions for cross-cutting concerns

**Runtime Path**:
```
Kernel.start()
  → PluginSystem.startAll()
    → [Registered plugins: IntentPlugin, IndustryPlugin]

MetaPlanner (separate initialization path)
  → ExtensionRegistry (not used as plugin)
  → MetaPlanner manages its own extensions
```

**Note**: The ExtensionRegistry at `packages/core/src/extensions/ExtensionRegistry.ts` is instantiated but **never used** as a plugin registry. MetaPlanner does its own extension management.

**Evidence**: `packages/core/src/extensions/`

---

## Architecture Summary Diagram (Text)

```
┌─────────────────────────────────────────────────────────────┐
│  HTTP/Transport Layer (StudioServer:8080)                    │
│  POST /api/session/:id/send → SSE /api/stream/global        │
├─────────────────────────────────────────────────────────────┤
│  Session & State (SessionManager → SessionStore)             │
├─────────────────────────────────────────────────────────────┤
│  Intent Classification (INLINE in StudioOrchestrator)        │
│  ┌─ Chat ─────────────────────┐  ┌─ Task ────────────────┐  │
│  │ Direct LLM reply           │  │ CrossDomainRouter     │  │
│  └────────────────────────────┘  │ (optional MetaPlanner)│  │
│                                  └────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  DAG Execution (DomainDispatcher)                            │
│  → DomainCluster → AgentFactory → AgentHarness              │
│  → pi-agent-core → pi-ai → DeepSeek API                     │
├─────────────────────────────────────────────────────────────┤
│  Memory & Knowledge Layer                                    │
│  MemoryBus / MemoryWiki / KnowledgeGraph                     │
├─────────────────────────────────────────────────────────────┤
│  Event & Observability Layer                                 │
│  EventBus → ExecutionMirror → StudioServer SSE → Frontend   │
└─────────────────────────────────────────────────────────────┘
```
