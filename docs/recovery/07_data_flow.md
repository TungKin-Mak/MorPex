# 07 — Data Flow Recovery

> **Phase 5**: Recover the REAL data flow through the system
> **Date**: 2026-07-18
> **Confidence**: HIGH

---

## Core Data Objects

| Object | Type | Source | Consumer | Persistence |
|--------|------|--------|----------|-------------|
| `UserInput` | string | HTTP Request | SessionManager | SessionStore (JSONL) |
| `Intent` | string (chat/task) | StudioOrchestrator | Router/Planner | None (transient) |
| `ExecutionDAG` | DAG graph | CrossDomainRouter | DomainDispatcher | SessionStore |
| `DAGNode` | task node | CrossDomainRouter | DomainDispatcher | SessionStore |
| `Artifact` | artifact object | DomainCluster | ArtifactRegistry | File system |
| `MorPexEvent` | event object | Any component | EventBus consumers | EventStore (JSONL) |
| `MemoryPayload` | memory item | MemoryBusListner | MemoryBus | ZVec + JSONL |
| `PlanTemplate` | plan template | MetaPlanner | PlanExperienceStore | JSONL |
| `ToolCall` | tool call | AgentHarness | ToolExecutionProxy | ToolCallTracker |

---

## Flow 1: User Message → Response (Chat Mode)

```
[Input] UserMessage (string)
  ↓
HTTP POST /api/chat/message
  ↓
StudioServer.setupRoutes()
  ↓
StudioOrchestrator.routeMessage()
  ↓
[INLINE Intent Classification via LLM]
  → "direct_chat"
  ↓
LLMProvider.call() → pi-ai streamSimple()
  ↓
[Output] ChatResponse (string)
  ↓
Returned as JSON to frontend
```

**Data Path**: `UserMessage → HTTP → StudioServer → StudioOrchestrator → LLMProvider → pi-ai → DeepSeek → Response`

**Broken Flow?**: NO — This path works correctly.

---

## Flow 2: User Message → Task Execution (Task Mode)

```
[Input] UserMessage (string)
  ↓
HTTP POST /api/chat/message
  ↓
StudioServer → StudioOrchestrator
  ↓
[INLINE Intent Classification]
  → "dag_plan"
  ↓
CrossDomainRouter.decompose()
  → [LLM call to decompose into domain DAG]
  ↓
[Optional] MetaPlanner.process()
  → PipelineExecutor.execute() [7-stage pipeline]
  → [LLM calls for each stage]
  ↓
ExecutionDAG (nodes with domain, goal, deps)
  ↓
DomainDispatcher.dispatch()
  ↓
[For each DAG node, topological order]
  DomainDispatcher.executeNode()
  ↓
DomainClusterManager.getCluster(domainId)
  ↓
DomainCluster.execute()
  → DomainCluster.wake()
    → AgentFactory.spawnAgent()
      → new AgentHarness()
        → AgentHarness.run() with domain tools
          → pi-ai streamSimple()
  ↓
[Output] DAGExecutionResult (aggregated)
  ↓
Returned via SSE events + final JSON response
```

**Data Path**: `UserMessage → HTTP → StudioOrchestrator → CrossDomainRouter → [MetaPlanner] → DomainDispatcher → DomainCluster → AgentFactory → AgentHarness → pi-ai → DeepSeek → Result`

**Broken Flow?**: PARTIALLY — IntentResolver class is bypassed (inline classification instead).

---

## Flow 3: Event Propagation

```
[Producer] Any system component
  ↓
EventBus.emit(event: MorPexEvent)
  ↓
┌──────────────────────────────────────────────┐
│ Event Consumers (parallel, non-blocking)      │
├──────────────────────────────────────────────┤
│ ExecutionMirror → JSONLStorage.append()      │
│ EventStoreSubscriber → EventStore.append()   │
│ MemoryBusListener → MemoryBus.remember()     │
│ SessionProjection → Update read model        │
│ StudioServer SSE → Frontend EventSource      │
└──────────────────────────────────────────────┘
```

**Data Path**: `Producer → EventBus → [Mirror, Store, Memory, Projection, SSE]`

**Broken Flow?**: NO — This flow is clean and well-structured.

---

## Flow 4: Memory Write Pipeline

```
[Input] Content to remember
  ↓
MemoryBus.remember()
  ↓
WriteGate.evaluate()
  → Score: importance, recency, relevance
  → Decision: store / reject / archive
  ↓
[If approved] ZVecStorage.store()
  → Vector embedding + metadata
  ↓
[If archive] Move to Archive pool
  ↓
HistoryStore.append()
  → JSONL file persistence
```

**Data Path**: `Content → MemoryBus → WriteGate → ZVecStorage (+ HistoryStore)`

**Broken Flow?**: PARTIALLY — MemoryBusListener auto-archives events to MemoryBus, but MemoryBus and MemoryWiki are separate stores with no synchronization.

---

## Flow 5: Memory Read Pipeline

```
[Query] User/Agent question
  ↓
MemoryRetriever.query()
  ↓
MemoryWiki.query() [SQLite + ZVec hybrid]
  ↓
Vector search → Similarity ranking
  ↓
Results returned
```

**Alternative Path**:
```
MemoryBus.recall()
  ↓
ZVecStorage.search() [vector search]
  ↓
Rank by WriteGate scoring
  ↓
Results returned
```

**Broken Flow?**: YES — Two parallel memory read paths (MemoryBus vs MemoryWiki) with different data and no synchronization.

---

## Broken Flow Analysis

### BF-1: Dual Memory Read Paths

| Aspect | MemoryBus Path | MemoryWiki Path |
|--------|---------------|-----------------|
| **Storage** | ZVec + JSONL | SQLite + ZVec |
| **Write path** | MemoryBus.remember() | MemoryWiki.insert() |
| **Consumer** | MetaPlanner, MemoryRetriever | DocWatcher, DocTopology |
| **Data overlap** | Unknown — no sync mechanism | Unknown |
| **Status** | ⚠️ NOT SYNCHRONIZED | ⚠️ NOT SYNCHRONIZED |

**Verdict**: Two parallel memory systems with different backends and no synchronization. Data written to one is not visible to the other.

### BF-2: IntentResolver Bypass

| Aspect | Documented | Actual |
|--------|-----------|--------|
| **Module** | IntentResolver class | Inline LLM call in StudioOrchestrator |
| **Path** | `control-plane/intent/IntentResolver.ts` | `StudioOrchestrator.routeMessage()` |
| **Registration** | Via IntentPlugin | No registration — inline code |
| **Status** | Code exists but never called | Working but in wrong place |

**Verdict**: The documented intent resolution architecture is bypassed. Working but not extensible.

### BF-3: Gateway Bypass

| Aspect | Documented | Actual |
|--------|-----------|--------|
| **Agent execution** | ExecutionGateway → PiAdapter | DomainCluster → AgentFactory → AgentHarness (direct pi-agent-core) |
| **Event bridge** | PiAdapter bridges PiRuntime ↔ EventBus | PiRuntime events go through EventBus BUT actual LLM calls bypass |
| **ContractGateway** | New migration target | Register() called but execute() never called |
| **Status** | Gateway is partially active for events but completely bypassed for LLM execution | |

**Verdict**: The ExecutionGateway abstraction is hollow — all LLM execution goes directly through pi-agent-core.

### BF-4: Missing Consumer — CheckpointManager

**Producer**: MetaPlanner (could produce checkpoints)
**Consumer**: CheckpointManager (exists, registered, but NEVER called)
**Status**: Dead end — no code calls `CheckpointManager.save()` or `CheckpointManager.restore()`

### BF-5: Duplicate Producer — Planning Types

**Producer A**: `packages/core/src/extensions/planning/types/` (10 type files)
**Producer B**: `packages/core/src/extensions/planning/planning-types/` (11 type files)
**Consumer**: Planning modules
**Status**: TWO identical directories with different internal structures — both exporting similar types

---

## Data Flow Summary

| Flow | Status | Issue |
|------|--------|-------|
| User → Chat Response | ✅ WORKING | — |
| User → Task Execution | ⚠️ WORKING | IntentResolver bypassed, MetaPlanner optional |
| Event Propagation | ✅ WORKING | Well-designed EventBus |
| Memory Write | ⚠️ WORKING | Dual write paths, no sync |
| Memory Read | ❌ BROKEN | Dual read paths, different data |
| Gateway Execution | ❌ BYPASSED | Real LLM flow goes around Gateway |
| Checkpoint Restore | ❌ DEAD END | CheckpointManager never called |
| Adapter Integration | ❌ DEAD END | pi-ai/pi-agent-core adapters never wired |
