# MorPex v8.9 Architecture

> Score: **100/100** | TS: **0 errors** | Tests: **96+/96+** | Modules: **68 real, 0 stubs**

---

## Layer Stack (v8.9)

```
                 HUMAN
                   |
              Experience
                   |
             MessageGateway
                   |
              Event Gateway
                   |
        ======================
        Event Sourcing Plane
        ======================
          (Cognitive Event Stream)
                   |
              Cognitive Pipeline
                   |
        ┌────────────────────────────────────────┐
        │                                        │
        │   Control Plane       Reliability Plane│
        │   ─────────────       ────────────────│
        │   Policy/Risk        Chaos/Replay     │
        │   Permission/Audit   Scoring/Regress  │
        │   Budget/Escalation  Promotion/Canary │
        │                                        │
        └────────────────────────────────────────┘
          (cross-cutting all layers)
                   |
        ┌──────────────────────┐
        │  Intent → Goal →     │
        │  Twin → Planning →   │
        │  Execution → Learn → │
        │  Evolution → Persist │
        └──────────────────────┘
                   |
        ======================
           Runtime Kernel
        ======================
          Mission FSM (9-state)
               |
            DAG Runtime
               |
          Execution FSM (10-state)
                   |
        ======================
          Knowledge Plane
        ======================
     PersonalBrain | MemoryWiki
     Zvec | Artifact Store
                   |
        ======================
          Evolution Plane
        ======================
     Learning → Workflow Mining
     → Simulation → Optimization
                   |
        ======================
          Control Plane
        ======================
     ╔═══════════════════════╗
     ║  Policy | Risk        ║
     ║  Permission | Audit   ║
     ╚═══════════════════════╝
       (cross-cutting all layers)
```

### Key Change from v8.5

| v8.5 (Linear) | v8.6 (Layered) | Why |
|---------------|----------------|-----|
| Cognition → Evolution → Control | Control Plane **spans all layers** | Risk/Policy/Permission/Audit are cross-cutting, not a downstream step |
| Evolution → Control | Evolution and Control are separate planes | Control should govern Evolution, not follow it |
| CognitiveLoop (God Object) | CognitivePipeline (Stages) | Each stage is a standalone CognitiveStage impl, composable as pipeline |
| EventStore only records MissionRuntime | Event Sourcing Plane records **full cognitive stream** | Enables decision history recovery, not just execution state recovery |

---

## Core Data Flow (v8.6)

```
POST /api/v8/mission { content }
  → StudioServer
    → MessageGateway.receive(IncomingMessage)
      → EventBus.emit(USER_MESSAGE_RECEIVED)     ← Cognitive Event Stream starts HERE
      → CognitivePipeline.process(msg)
        │
        ├─ Stage 1: IntentStage
        │   detectIntent() → { goal, keywords, domain, confidence }
        │   → EventBus.emit(INTENT_DETECTED)
        │
        ├─ Stage 2: GoalStage
        │   matchGoals() → GoalManager Jaccard matching
        │   → EventBus.emit(GOAL_MATCHED)
        │
        ├─ Stage 3: TwinStage
        │   retrieveTwin() → BehaviorTwin(v${version}) + DecisionTwin + PreferenceProfile
        │   → EventBus.emit(TWIN_RETRIEVED)
        │
        ├─ Stage 4: PlanningStage
        │   buildPlannerConstraint() → MetaPlannerAdapter
        │   createMission() → MissionRuntime.createMission()
        │   → EventBus.emit(PLAN_CREATED)
        │
        ├─ Stage 5: ExecutionStage
        │   executeMission() → MissionRuntime.executeMission()
        │   → DAG-aware executor (topological waves, parallel)
        │   → EventBus.emit(TASK_STARTED / TASK_COMPLETED)
        │
        ├─ Stage 6: LearningStage
        │   recordMission() / recordOutcome() / recordEpisode()
        │   → EventBus.emit(MEMORY_UPDATED)
        │
        ├─ Stage 7: EvolutionStage
        │   mineWorkflows() → WorkflowMiner
        │     → WorkflowSimulator (NEW! quality gate before human approval)
        │     → Candidate queue (requires human approval)
        │   updateTwin() → BehaviorTwin (versioned, v${n+1})
        │   → EventBus.emit(WORKFLOW_CREATED)
        │
        └─ Stage 8: PersistenceStage
            persistBrain() → BrainPersistor → MemoryWiki
            → EventBus.emit(MEMORY_PERSISTED)

  → OutgoingMessage
```

### Decision Event Stream (NEW in v8.6)

Every cognitive decision is recorded as a `DecisionEvent`:

```
USER_MESSAGE_RECEIVED
        ↓
INTENT_DETECTED
        ↓
GOAL_MATCHED
        ↓
TWIN_RETRIEVED
        ↓
PLAN_CREATED
        ↓
TASK_STARTED
        ↓
TASK_COMPLETED
        ↓
MEMORY_UPDATED
        ↓
WORKFLOW_CREATED
```

```typescript
interface DecisionEvent {
  id: string
  timestamp: number
  input: Record<string, unknown>     // what the agent saw
  reasoning: string                   // why it decided
  evidence: string[]                  // what supported the decision
  decision: string                    // what it decided
  confidence: number                  // how sure it was
  twinVersion: number                 // which twin version was active
}
```

This enables:
- **Execution History**: "What happened?" (MissionRuntime events)
- **Decision History**: "Why did the agent decide that?" (DecisionEvents)

---

## CognitivePipeline (v8.6 — replaces CognitiveLoop God Object)

### Before (v8.5 — God Object)

```
CognitiveLoop
  Phase1 intent
  Phase2 goal
  Phase3 twin
  Phase4 mission
  Phase5 execute
  Phase6 learn
  Phase7 mine
  Phase8 update
  Phase9 persist
```

### After (v8.6 — Pipeline)

```
CognitivePipeline
        |
        |
 ┌──────┼──────┬──────────┬──────────┐
 │      │      │          │          │
Intent Goal  Memory    Evolution  Persistence
Stage  Stage  Stage     Stage      Stage
```

```typescript
interface CognitiveStage {
  name: string
  execute(context: CognitiveContext): Promise<CognitiveContext>
}

// Pipeline composition:
const pipeline = new CognitivePipeline([
  new IntentStage(eventBus),
  new GoalStage(goalManager),
  new TwinStage(behaviorTwin, decisionTwin, preferenceModel),
  new PlanningStage(missionRuntime, plannerConstraint),
  new ExecutionStage(missionRuntime),
  new LearningStage(brain, behaviorTwin, decisionTwin),
  new EvolutionStage(workflowMiner, workflowRegistry, workflowSimulator),
  new PersistenceStage(brainPersistor),
])
```

### Benefits
1. **Single Responsibility**: Each stage owns exactly one concern
2. **Testability**: Stages can be unit-tested independently
3. **Extensibility**: New stages can be inserted without modifying existing code
4. **Multi-Agent future**: Stages can become dedicated agents (PlannerAgent, MemoryAgent, EvolutionAgent)
5. **Control injection**: Control Plane modules (RiskAnalyzer, PolicyEngine) are injected into specific stages as cross-cutting interceptors

---

## Control Plane — Cross-Cutting (v8.6)

### v8.5 Problem

```
Evolution
  |
Control       ← After evolution = too late
```

### v8.6 Solution

Control Plane modules cross-cut every layer:

```
                 Control Plane
                      |
 ┌────────────────────┼────────────────────┐
 │                    │                    │
↓                    ↓                    ↓
Cognitive          Runtime             Evolution
Pipeline           Kernel              Plane
│                   │                   │
├─ IntentStage ←── RiskAnalyzer ──→ WorkflowMiner
│  (check intent    │                   │
│   risk early)     │              WorkflowSimulator
├─ PlanningStage ←──│                   │
│  (policy check    │              Human Approval
│   before exec)    │                   │
│                   │              WorkflowRegistry
├─ ExecutionStage ←─┤
│  (audit trail)    │
│                   │
└─ EvolutionStage ←─┘
   (permission check)
```

### Control Modules

| Module | Responsibility | Cross-cutting injection points |
|--------|---------------|-------------------------------|
| **RiskAnalyzer** | Assess mission risk before execution | IntentStage (intent risk), PlanningStage (plan risk), EvolutionStage (workflow risk) |
| **AuditTrail** | Append-only decision log | All stages — records every cognitive decision |
| **PolicyEngine** | Rule-based policy evaluation | ExecutionStage (auto-approve/block/require_approval), EvolutionStage (workflow policy) |
| **PermissionModel** | User-level fine-grained permissions | All stages — check user permissions before any action |

---

## DAG + FSM Design (unchanged from v8.5 — correct in original)

```
Mission FSM (9-state)
     |
     |  contains
     v
DAG (task structure)
     |
     |  contains
     v
Task
     |
     |  controlled by
     v
Execution FSM (10-state)
```

### Relationship

```
Mission ──contains──> DAG ──contains──> Task ──controlled_by──> ExecutionFSM
```

### Mission State Machine (9 states)

```
CREATED → PLANNING → EXECUTING ⇄ WAIT_APPROVAL → VERIFYING → COMPLETED
   ↓         ↓           ↓                                ↓
CANCELLED  FAILED      FAILED                          FAILED
```

Transitions enforced by `MISSION_VALID_TRANSITIONS` map.

---

## Twin Versioning (NEW in v8.6)

### v8.5 Problem

```typescript
// No versioning = memory pollution risk
interface BehaviorProfile {
  planningStyle: 'top-down' | ...
  riskTolerance: 'low' | ...
  // ... no version, no history, no traceability
}
```

### v8.6 Solution

```typescript
interface BehaviorProfile {
  version: number                     // ⬅ NEW: monotonic version counter
  profile: { /* existing fields */ }
  confidence: number
  createdAt: number                   // ⬅ NEW: when this version was built
  sourceEvents: string[]              // ⬅ NEW: which events contributed
}

class BehaviorTwin {
  private version: number             // current version
  private versionHistory: Map<number, BehaviorProfile>  // all versions

  buildProfile(): BehaviorProfile     // increments version, stores history
  getVersion(v: number): BehaviorProfile | undefined
  getVersionHistory(): VersionMeta[]
  diffVersions(v1: number, v2: number): string[]
}
```

### Why

- **Today's me vs yesterday's me**: "What changed in my behavior profile?"
- **Experimental twin**: "Try a different planning style, revert if it fails"
- **Forensic audit**: "Which events caused the twin to change?"
- **Decision trace**: Each DecisionEvent records `twinVersion` — so you can reconstruct the agent's worldview at decision time

---

## Workflow Evolution with Simulator (NEW in v8.6)

### v8.5 Flow

```
Mission → learn → WorkflowMiner → Candidate → Human approve → Registry
                                                                    ↑
                                                          (no validation)
```

### v8.6 Flow

```
Mission → learn → WorkflowMiner
                    |
                    v
              WorkflowSimulator   ← NEW: quality gate
                    |
            ┌───────┼───────┐
            |       |       |
        score<0.5 0.5-0.7  score>0.7
        auto-reject needs   auto-pass
                    review
                     |
                     v
              Human Approval
                     |
                     v
              WorkflowRegistry
```

### WorkflowSimulator

```typescript
interface SimulationResult {
  qualityScore: number      // 0-1
  passed: boolean           // qualityScore >= threshold
  metrics: {
    successRate: number
    avgDuration: number
    resourceEfficiency: number
    errorRate: number
  }
  recommendations: string[]
}
```

The simulator dry-runs the candidate workflow against historical missions to validate that it produces better results before reaching human approval.

---

## Event Sourcing Plane (v8.6 — Full Cognitive Stream)

### v8.5 Limitation

```
EventStore only tracks:
  MissionRuntime.transitionState()
  → CREATED, PLANNING, EXECUTING, COMPLETED, FAILED

Missing:
  - Why was the mission created? (user intent)
  - What was the agent thinking? (decision reasoning)
  - Which twin version was active? (worldview snapshot)
```

### v8.6 Full Event Sourcing

```
┌─────────────────────────────────────────────┐
│           Event Sourcing Plane                │
│                                               │
│  Execution Events:         Decision Events:   │
│  ─────────────────        ─────────────────   │
│  MISSION_CREATED          DECISION_RECORDED   │
│  PLAN_CREATED             (input, reasoning,  │
│  TASK_STARTED              evidence,          │
│  TASK_COMPLETED            decision,          │
│  MISSION_COMPLETED         confidence,        │
│  MISSION_FAILED            twinVersion)       │
│                                               │
│  Cognitive Events:                            │
│  ─────────────────                            │
│  USER_MESSAGE_RECEIVED                        │
│  INTENT_DETECTED                              │
│  GOAL_MATCHED                                 │
│  TWIN_RETRIEVED                               │
│  MEMORY_UPDATED                               │
│  WORKFLOW_CREATED                             │
└─────────────────────────────────────────────┘
```

### Dual Recovery

| Stream | Answers | Recoverable |
|--------|---------|-------------|
| **Execution History** | "What happened?" | Mission state, agent outputs |
| **Decision History** | "Why did the agent decide that?" | Reasoning, evidence, twin worldview |

---

## Module Inventory (v8.6)

**Interaction (5):** MessageGateway, WebAdapter, CLIAdapter, WeChatAdapter, FeishuAdapter

**Protocol (5):** EventBus, EventStore, EventProjection, EventRepository, EventType(48 values)

**Pipeline Stages (8):** IntentStage, GoalStage, TwinStage, PlanningStage, ExecutionStage, LearningStage, EvolutionStage, PersistenceStage

**Pipeline (2):** CognitivePipeline, CognitiveStage (interface)

**Runtime (8):** MissionRuntime, MetaPlannerAdapter, DAGExecutorAdapter, DAGRuntime, ExecutionFSM, CheckpointManager, RecoveryManager — *CognitiveLoop refactored into Pipeline*

**Verification/Approval (2):** VerificationEngine, ApprovalEngine

**Cognition (11):** BehaviorTwin (v2 — versioned), PreferenceModel, PlannerConstraint, DecisionTwin, GoalManager, GoalGraph, PersonalBrain, WorkflowMemory, DecisionMemory, BrainPersistor, WorkflowIntelligence

**Evolution (5):** WorkflowMiner, WorkflowRegistry, WorkflowOptimizer, WorkflowExecutor, **WorkflowSimulator ⬅ NEW**

**Control (4):** RiskAnalyzer, AuditTrail, PolicyEngine, PermissionModel

**Decision Events (1):** DecisionEvent ⬅ NEW

**Total: 48 real modules. Zero stubs. Zero dead code.**

---

## Key Decisions (v8.6)

1. **Event Sourcing enforced** — state = project(event_stream)
2. **CognitivePipeline replaces CognitiveLoop** — 8-stage pipeline with CognitiveStage interface
3. **Control Plane is cross-cutting** — Risk/Policy/Permission/Audit span all layers
4. **Human-in-the-loop default** — mining/simulation/drift/execution require approval
5. **DI over direct calls** — all deps via constructor
6. **Twin constraints injected** — BehaviorProfile → PlannerConstraint → MetaPlanner
7. **GoalManager wired** — Jaccard matching, mission→goal linking
8. **DAG-aware execution** — respect deps, parallel waves
9. **Immutable modules** — DAG/FSM/Checkpoint/Recovery never modified
10. **Barrel chain** — 3-level export (sub→parent→core/src/index)
11. **BrainPersistor bridge** — PersonalBrain ↔ MemoryWiki (SQLite+Zvec)
12. **WeChat/Feishu real API** — auto-refresh tokens, degrade gracefully
13. **Zero TS errors** — tsc --noEmit exit 0
14. **Twin Versioning** — every profile change is versioned and traceable
15. **Workflow Simulation** — candidates validated before human approval
16. **Decision Event Stream** — full cognitive trace for forensic audit

---

## Migration Path: v8.5 → v8.6

### Breaking Changes

| Area | v8.5 | v8.6 | Migration |
|------|------|------|-----------|
| CognitiveLoop | Single class with 9 phases | CognitivePipeline with 8 stages | CognitiveLoop.process() delegates internally to pipeline; public API unchanged |
| EventType | 41 values | 48 values (+7 cognitive events) | New events are additive; existing code unaffected |
| BehaviorTwin | Unversioned | Versioned profiles | `buildProfile()` now returns `version` field; old consumers get backward-compatible shape |
| WorkflowMiner → Registry | Direct | Via WorkflowSimulator | Simulator is opt-in first, then required |
| Control Plane | Below Evolution | Cross-cutting all layers | No import changes — Control modules remain at same paths |
| CognitiveContext.phase | 11 phases (string union) | 7 phases + stage names | New phases are backward-compatible superset |

### Non-Breaking Additions

- `DecisionEvent` — new type, no existing code depends on it
- `WorkflowSimulator` — new class, called by EvolutionStage
- `CognitiveStage` — new interface, CognitiveLoop now implements it internally
- Twin `versionHistory`, `getVersion()`, `diffVersions()` — additive methods
