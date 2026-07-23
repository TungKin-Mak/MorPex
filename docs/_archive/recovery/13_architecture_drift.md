# 13 — Architecture Drift

> **Phase 10**: Compare documented architecture vs actual runtime architecture
> **Date**: 2026-07-18
> **Confidence**: MEDIUM-HIGH (documents may describe intended future state)

---

## Key Documents Analyzed

| Document | Claims | Trust Level |
|----------|--------|-------------|
| `docs/ARCHITECTURE.md` | v3.0 architecture | ⚠️ PARTIALLY OUTDATED |
| `docs/ARCHITECTURE-v4.0.md` | v4.0 architecture | ⚠️ ASPIRATIONAL (not yet reality) |
| `docs/docsARCHITECTURE-v3.2-optimized.md` | v3.2 optimized | ⚠️ MIXED (some correct, some aspirational) |
| `docs/features-and-architecture.md` | Feature list | ⚠️ OUTDATED |
| `docs/WIKI.md` | Wiki documentation | ⚠️ OUTDATED |

---

## Drift 1: Layer Architecture (L0-L5) vs Reality

### Documented (ARCHITECTURE-v4.0.md):

```
L5: UI Layer (React)
L4: Agent Layer (Agent Orchestrator, Swarm Engine)
L3: Runtime Kernel (FSM, DAG, Scheduler, Execution Graph)
L2: Control Plane (Intent Resolver, Execution Orchestrator)
L1: Knowledge Plane (Memory, Knowledge Graph, Artifacts)
L0: Contracts & Events
```

### Actual:

```
HTTP Layer: StudioServer (Express REST + SSE)
Session Layer: SessionManager → SessionStore
Orchestration: StudioOrchestrator (inline intent classification)
Routing: CrossDomainRouter → DomainDispatcher
Domain Execution: DomainCluster → AgentFactory → AgentHarness (pi-agent-core)
Memory: MemoryBus + MemoryWiki (dual, unsynchronized)
Events: EventBus → ExecutionMirror + EventStore + SSE
```

**Key Differences**:
- No clean L0-L5 separation at runtime
- `Control Plane` (IntentResolver, ExecutionOrchestrator) is bypassed
- `Runtime Kernel` (FSM, DAG, Scheduler, ExecutionGraph) are all ghost modules
- `Agent Layer` (AgentOrchestrator, SwarmEngine) are ghost modules
- StudioServer is actually the orchestrator, not a thin bridge

**Evidence**: All plane engines instantiated but never called (see dead code report).

---

## Drift 2: Gateway Architecture

### Documented:
```
User → ExecutionGateway → PiAdapter → AgentRuntime
```

### Actual:
```
User → DomainDispatcher → DomainCluster → AgentFactory → AgentHarness (pi-agent-core)
```

**Key Differences**:
- `ExecutionGateway.execute()` is never called for LLM execution
- `PiAdapter` only bridges events, not execution
- `ContractGateway` is registered but `execute()` never called
- Real LLM execution path completely bypasses both gateways

**Evidence**: `packages/core/src/gateway/` files vs `packages/core/src/domains/DomainCluster.ts`

---

## Drift 3: Adapter Architecture

### Documented:
```
packages/adapters/ contain PiAIAdapter and PiAgentCoreAdapter
These wrap external runtimes for the ContractGateway
```

### Actual:
```
StudioServer imports @earendil-works/pi-ai directly
LLMProvider.set() uses pi-ai's streamSimple() directly
All adapter code in packages/adapters/ is disconnected
```

**Evidence**: `packages/studio/server/StudioServer.ts:initControlPlane()` uses `import('@earendil-works/pi-ai')` directly, not through any adapter.

---

## Drift 4: Plugin System

### Documented:
```
All engines register as plugins with PluginSystem
PluginSystem.startAll() initializes everything
```

### Actual:
- Only 2 of 12 plugin.ts files are registered with PluginSystem
- Most engines are instantiated directly by StudioServer
- The `plugin.ts` files exist but their `register()` method is never called
- MetaPlanner is initialized separately, not through PluginSystem

**Evidence**: `packages/core/src/common/PluginSystem.ts` vs which plugins are actually registered in `Kernel.start()`.

---

## Drift 5: Memory Architecture

### Documented:
```
Single unified memory system
```

### Actual:
Three parallel memory stores with no synchronization:
1. **MemoryBus** (memory package) — ZVec + JSONL, three pools (main/archive/temp)
2. **MemoryWiki** (memory package) — SQLite + ZVec hybrid
3. **HistoryStore** (memory package) — JSONL file-based chat history
4. **KnowledgeGraph** (core package) — In-memory graph (separate from above)

**Key Differences**:
- MemoryBridge exists to bridge these but is only initialized, not actively synchronizing
- Data written to MemoryBus is not visible in MemoryWiki and vice versa
- KnowledgeGraph is in core package, memory stores are in memory package

**Evidence**: Memory stores are independently initialized in `StudioServer.initMemoryStorage()`.

---

## Drift 6: Intent Classification

### Documented:
```
IntentPlugin → IntentResolver → classify intent
Registered with PluginSystem, uses LLM
```

### Actual:
```
StudioOrchestrator.routeMessage() → inline LLM call → classify intent
IntentPlugin is registered but its resolver is never called
```

**Evidence**: `StudioOrchestrator.ts` does inline classification. `IntentResolver.ts` exists in `control-plane/intent/` but is never imported by any runtime code.

---

## Drift 7: Tool System

### Documented:
```
Tools registered through ToolExecutionProxy → PermissionEngine → execute
```

### Actual:
- Tools are built by `DomainCluster.buildTools()` per domain
- PermissionEngine is instantiated but with default rules
- ToolCallTracker tracks tool calls but there's no evidence it's wired to the actual tool execution path
- Actual tool execution happens inside `AgentHarness` (pi-agent-core), not through MorPexCore's tool system

**Evidence**: `packages/core/src/tools/ToolExecutionProxy.ts` — verify if it's actually used in the DomainCluster execution path.

---

## Drift 8: Extension System

### Documented:
```
Extensions are registered with ExtensionRegistry
ExtensionRegistry is part of the plugin system
```

### Actual:
- `ExtensionRegistryImpl` is created inside MetaPlanner's own context
- `MetaPlanner` manages its own extensions (DeviationGuard, RuntimeController)
- The global ExtensionRegistry from `extensions/ExtensionRegistry.ts` is never used as a registry
- LineageTracker, ContextPruner, McpProcessGuard are instantiated but never called

**Evidence**: `packages/core/src/extensions/ExtensionRegistry.ts` vs MetaPlanner's internal extension management.

---

## Drift 9: Architecture Documentation Versions

### Problem:
Multiple architecture documents exist describing different versions:

| Document | Version | Status vs Actual |
|----------|---------|-----------------|
| `docs/ARCHITECTURE.md` | v3.0 | Outdated |
| `docs/docsARCHITECTURE-v3.2-optimized.md` | v3.2 | Partially accurate |
| `docs/ARCHITECTURE-v4.0.md` | v4.0 | Aspirational (not yet reality) |
| `docs/features-and-architecture.md` | Mixed | Outdated |
| `docs/_archive/*` (27 files) | Various | All archived/outdated |

### Impact:
A new developer cannot trust ANY architecture document. Must read source code to understand the actual system.

---

## Drift 10: Package Export Boundaries

### Documented:
```
@morpex/core → Public API via index.ts → src/index.ts
Packages respect their barrel exports
```

### Actual:
- StudioServer imports from `packages/core/src/...` (deep imports) — 30+ instances
- StudioServer imports from `packages/memory/src/...` (deep imports)
- The public API at `@morpex/core` is almost entirely unused by StudioServer

**Evidence**: Every `import` in `StudioServer.ts` that starts with `../../core/src/` or `../../memory/src/` bypasses the package's public API.

---

## Drift Summary

| # | Drift | Severity | Effort to Fix |
|---|-------|----------|---------------|
| 1 | Layer Architecture (L0-L5 not real) | 🔴 P0 | High |
| 2 | Gateway Architecture (bypassed) | 🔴 P0 | High |
| 3 | Adapter Architecture (disconnected) | 🔴 P0 | Medium |
| 4 | Plugin System (2/12 registered) | 🟡 P1 | Medium |
| 5 | Memory Architecture (dual stores) | 🟡 P1 | High |
| 6 | Intent Classification (bypassed) | 🟡 P1 | Low |
| 7 | Tool System (not wired) | 🟡 P1 | Medium |
| 8 | Extension System (not used) | 🟢 P2 | Low |
| 9 | Architecture Docs (outdated) | 🟢 P2 | Medium |
| 10 | Package Boundaries (violated) | 🟡 P1 | High |
