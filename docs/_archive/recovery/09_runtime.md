# 09 — Runtime Entry Analysis

> **Phase 6**: How does a user request actually reach the agent?
> **Date**: 2026-07-18
> **Confidence**: HIGH

---

## 1. System Bootstrap Chain

### Step 1: Server Start

```
packages/studio/server/index.ts (main())
  ↓
new StudioServer({ port: 8080, ... })
  ↓
studio.start()
  ↓
├── new MorPexKernel()              ← Core kernel initialization
├── this.initComponents()           ← Initialize ALL engines & components
├── new SessionManager(...)         ← Session lifecycle management
├── new StudioOrchestrator(...)     ← Message routing
├── this.setupRoutes()              ← REST API endpoints
├── this.setupSSE()                 ← Event stream endpoint
├── this.setupStaticFiles()         ← Frontend static files
├── await this.kernel.start()       ← Start kernel (EventBus, Mirror, Gateway, Plugins)
└── Server listen on port 8080      ← HTTP server start
```

**Evidence**: `packages/studio/server/index.ts` and `packages/studio/server/StudioServer.ts:start()`

### Step 2: Kernel Start

```
MorPexKernel.start()
  ↓
├── storage.initialize()              ← JSONL storage
├── new PiAdapter(runtime, eventBus)  ← Wrap PiRuntime
├── gateway.registerAdapter('pi', PiAdapter)
├── new PiAdapterBridge(PiAdapter)
├── contractGateway.register('pi-bridge', bridge)
├── contractGateway.setDefaultAdapter('pi-bridge')
├── mirror.start()                    ← Start execution recording
├── Register config plugins (IntentPlugin, IndustryPlugin)
├── pluginSystem.startAll()           ← Start all registered plugins
└── phase = 'running'
```

**Evidence**: `packages/core/src/common/Kernel.ts:start()`

### Step 3: Component Initialization

```
StudioServer.initComponents()
  ↓
├── initBaseServices()                ← HistoryStore, AgentService, SessionRepo
├── initAIEngines()                   ← FSMEngine, DAGEngine, SchedulerEngine, SwarmEngine,
│                                        ExecutionGraphEngine, AgentOrchestrator
│                                        ⚠️ These are CREATED but NEVER USED
├── initMemoryStorage()               ← KnowledgeGraph, ArtifactRegistry, ZVecStorage,
│                                        MemoryWiki, DocWatcher, DocTopology,
│                                        MemoryRetriever, MemoryBus
├── initControlPlane()                ← LLMProvider.set(), IntentPlugin, IndustryPlugin
├── initCrossDomainModules()          ← DomainLoader, DomainManager, CrossRouter,
│                                        Dispatcher, Negotiation, Arbitration
├── initMetaPlanner()                 ← MetaPlanner (self-learning loop)
├── initSessionProjection()           ← SessionProjection (event-driven read model)
├── initMemoryBridge()                ← MemoryBridge (bridge to memory)
├── initToolCallTracker()             ← ToolCall state machine
├── initPermissionEngine()            ← Permission rules
├── initMemoryBusListener()           ← Auto-archive events
└── initExecutionRecordingEngine()    ← Recording engine (⚠️ NEVER USED)
```

**Evidence**: `packages/studio/server/StudioServer.ts:initComponents()`

---

## 2. How a User Request Reaches the Agent

### Step-by-Step Trace

```
1. Browser → HTTP POST → http://localhost:8080/api/chat/message
   {
     "content": "Build a web app",
     "session_id": "sess_xxx"
   }

2. StudioServer.setupRoutes()
   → POST /api/chat/message handler
   → Calls this.orchestrator.routeMessage(content, execId, sessionId, agent)

3. StudioOrchestrator.routeMessage()
   → [INLINE] Calls LLM to classify intent:
     "Is this chat or task?"
   → Returns { type: 'direct_chat' } or { type: 'dag_plan' }

4a. If CHAT:
   → Calls LLMProvider.call() → pi-ai streamSimple()
   → Returns response directly

4b. If TASK:
   → Calls this.crossDomainRouter.decompose(input, sessionCtx)
     → CrossDomainRouter uses LLM to break intent into DAG:
       {
         nodes: [
           { taskId: "t1", domain: "frontend", goal: "...", deps: [] },
           { taskId: "t2", domain: "backend", goal: "...", deps: ["t1"] }
         ]
       }
   → [Optional] Passes through MetaPlanner for optimization

5. DomainDispatcher.dispatch(executionDAG, sessionCtx)
   → Topological sort of DAG nodes
   → For each node (in order):
     → DomainClusterManager.getCluster(domainId)
     → DomainCluster.execute(node.goal)
       → DomainCluster.wake()
         → AgentFactory.spawnAgent(manifest)
           → new AgentHarness(runtime, ...)  [from pi-agent-core]
         → AgentHarness.run()
           → pi-ai streamSimple() with domain tools
         → Collect result
   → Return aggregated DAGExecutionResult
```

---

## 3. Registration Points

### Agent Registration

| Registration | Where | How |
|-------------|-------|-----|
| PiRuntime | Kernel | `kernel.registerPiRuntime(runtime)` |
| PiAdapter | ExecutionGateway | `gateway.registerAdapter('pi', adapter)` |
| PiAdapterBridge | ContractGateway | `contractGateway.register('pi-bridge', bridge)` |
| IntentPlugin | Kernel.PluginSystem | `kernel.registerPlugin(intentPlugin)` |
| IndustryPlugin | Kernel.PluginSystem | `kernel.registerPlugin(industryPlugin)` |
| DomainClusters | DomainClusterManager | `domainManager.register(manifest)` |
| MetaPlanner | StudioServer | Direct instantiation, not via plugin |
| LLMProvider | Global singleton | `LLMProvider.set(rawCallLLM)` |

### Tool Registration

| Tool | Where Registered |
|------|-----------------|
| ArtifactRegistrySkill | `domainManager` constructor: `builtinTools` array |
| MemorySearchTool | `domainManager` constructor: `builtinTools` array |
| Domain-specific tools | `DomainCluster.buildTools()` (per domain) |
| TeamSayTool | Exported by core, registered externally |
| ForkExecuteTool | Exported by core, registered externally |
| AgentCreateTool | Exported by core, registered externally |

---

## 4. Request Flow Diagram (Runtime)

```
User Browser                    StudioServer (port 8080)
    │                                │
    │  POST /api/chat/message        │
    │──────────────────────────────>│
    │                                │
    │                                ├─ SessionManager.send()
    │                                │
    │                                ├─ StudioOrchestrator.routeMessage()
    │                                │
    │                                ├─ [LLM Intent Classification]
    │                                │
    │                                ├─ CrossDomainRouter.decompose()
    │                                │  └─ [LLM → ExecutionDAG]
    │                                │
    │                                ├─ MetaPlanner.process() (optional)
    │                                │  └─ PipelineExecutor [7-stage]
    │                                │
    │                                ├─ DomainDispatcher.dispatch()
    │                                │
    │                                │  ├─ DomainClusterManager.getCluster()
    │                                │  ├─ DomainCluster.execute()
    │                                │  │  ├─ wake() → AgentFactory
    │                                │  │  ├─ AgentHarness.run()
    │                                │  │  └─ pi-ai streamSimple()
    │                                │  │
    │                                │  └─ [Result collected]
    │                                │
    │  SSE Event Stream              │
    │<══════════════════════════════│
    │                                │
    │  JSON Response                 │
    │<──────────────────────────────│
```

---

## 5. Critical Runtime Findings

### Finding 1: PiAdapter Never Receives Runtime

The `kernel.registerPiRuntime(runtime)` is designed to inject a PiRuntime into the PiAdapter. However:

- `bootstrapMorPexCore()` in `bootstrap.ts` expects a runtime parameter
- `StudioServer` creates `new MorPexKernel()` **without** a piRuntime in config
- `kernel.registerPiRuntime()` is **never called** from StudioServer

**Impact**: PiAdapter has no runtime to execute against. The Gateway's PiAdapter is an event listener only.

**Evidence**: 
- `packages/core/src/common/Kernel.ts` — `registerPiRuntime()` exists but StudioServer never calls it
- `packages/studio/server/StudioServer.ts` — `start()` calls `new MorPexKernel()` with empty config

### Finding 2: ContractGateway.execute() Never Called

`ContractGateway` has an `execute()` method that accepts `AgentRunRequest`. But no code in the production runtime calls this method.

**Evidence**: `packages/core/src/gateway/ContractGateway.ts` — search for `.execute(` calls in production code

### Finding 3: LLMProvider Singleton Bypasses Adapters

The `LLMProvider` in core is set by StudioServer to use pi-ai directly. The adapters package (`PiAIAdapter`, `PiAgentCoreAdapter`) that were designed to wrap LLM calls are completely bypassed.

**Evidence**: `packages/studio/server/StudioServer.ts:initControlPlane()` sets `LLMProvider.set(rawCallLLM)` which uses pi-ai's `streamSimple()` directly.
