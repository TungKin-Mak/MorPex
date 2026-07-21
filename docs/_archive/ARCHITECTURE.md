# MorPex Architecture

> **Version**: 4.0 (Contracts-based Architecture)
> **Status**: In Migration
> **Last Updated**: 2026-07-17

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Package Layout](#2-package-layout)
3. [Core Abstractions (Contracts)](#3-core-abstractions-contracts)
4. [Ports and Adapters](#4-ports-and-adapters)
5. [Control Ownership](#5-control-ownership)
6. [Event Flow](#6-event-flow)
7. [Dependency Rules](#7-dependency-rules)
8. [Migration Status](#8-migration-status)

---

## 1. Architecture Overview

MorPexCore is the **top-level task scheduler and harness owner**. It orchestrates execution across Control Plane, Runtime Kernel, Agent Plane, and Knowledge Plane. Inference and agent runtime execution are delegated to replaceable backends through stable **Port** interfaces.

```
┌─────────────────────────────────────────────────────────────┐
│                     MorPexCore (Harness)                     │
│  ┌────────────┐ ┌───────────────┐ ┌──────────┐ ┌─────────┐ │
│  │Control     │ │Runtime Kernel │ │Agent     │ │Knowledge│ │
│  │Plane       │ │(DAG, FSM,     │ │Plane     │ │Plane    │ │
│  │(Intent,    │ │ Execution)    │ │(Swarm,   │ │(Memory, │ │
│  │Orchestrator│ │               │ │Orchestr.)│ │Artifact)│ │
│  └────────────┘ └───────────────┘ └──────────┘ └─────────┘ │
│                           │                                  │
│                   ┌───────┴───────┐                         │
│                   │  Contracts    │  ← Stable Ports          │
│                   │  (Inference,  │                          │
│                   │   Agent, Tool)│                          │
│                   └───────┬───────┘                          │
│                           │                                  │
│                   ┌───────┴───────┐                          │
│                   │   Gateway     │  ← Routes to adapters    │
│                   │   (Contracts  │                          │
│                   │    Gateway)   │                          │
│                   └───────┬───────┘                          │
└───────────────────────────┼──────────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
        ┌─────┴────┐ ┌─────┴────┐ ┌─────┴────┐
        │PiAIAdapter│ │PiAgent   │ │Mock      │
        │(pi-ai)   │ │CoreAdapter│ │Runtime   │
        │          │ │(pi-agent) │ │Adapter   │
        └──────────┘ └──────────┘ └──────────┘
              │             │
        ┌─────┴────┐ ┌─────┴────┐
        │  pi-ai   │ │pi-agent  │
        │ ^0.79.10 │ │-core     │
        │          │ │^0.79.10  │
        └──────────┘ └──────────┘
```

## 2. Package Layout

```
packages/
├─ contracts/          ← Zero-dependency stable interfaces (THE source of truth)
│  ├─ inference.ts     ← InferencePort, GenerateRequest, InferenceEvent
│  ├─ agent-runtime.ts ← AgentRuntimePort, AgentRunRequest, AgentRuntimeEvent
│  ├─ tool.ts          ← ToolDefinition, ToolCall, ToolResult
│  ├─ errors.ts        ← RuntimeError, ErrorCategory, classifyError()
│  ├─ capabilities.ts  ← InferenceCapabilities, AgentRuntimeCapabilities
│  ├─ runtime-events.ts← MorPexRuntimeEvent (EventBus-level events)
│  └─ index.ts         ← Barrel export
│
├─ core/               ← MorPexCore Engine
│  ├─ src/
│  │  ├─ common/       ← EventBus, ExecutionIdentity, Kernel, types
│  │  ├─ gateway/      ← ExecutionGateway (legacy) + ContractsGateway (new)
│  │  ├─ planes/       ← Control Plane, Runtime Kernel, Agent Plane, Knowledge Plane
│  │  ├─ domains/      ← DomainCluster, DomainClusterManager
│  │  ├─ services/     ← AgentFactory, AgentService
│  │  ├─ tools/        ← Built-in tools (ask-user, memory-search, etc.)
│  │  ├─ extensions/   ← Planning, Checkpoint, Lineage, ContextPruner
│  │  ├─ adapters/     ← Internal adapters (identity: uuid shim)
│  │  └─ ...
│  └─ index.ts
│
├─ adapters/           ← Inference/Agent runtime implementations
│  ├─ pi-ai/           ← PiAIAdapter (wraps @earendil-works/pi-ai)
│  ├─ pi-agent-core/   ← PiAgentCoreAdapter (wraps @earendil-works/pi-agent-core)
│  ├─ mock-runtime/    ← MockRuntimeAdapter (for testing)
│  └─ __tests__/       ← Adapter contract tests
│
├─ memory/             ← Memory system (VectorStore, MemoryBus, HistoryStore)
│
├─ studio/             ← Studio UI + Server
│  ├─ server/          ← Express-based API server
│  └─ ui/              ← Vite-based frontend
│
└─ workflows/          ← Workflow definitions
```

## 3. Core Abstractions (Contracts)

### InferencePort — One-shot model inference

```typescript
interface InferencePort {
  generate(
    request: GenerateRequest,
    context?: ExecutionContext
  ): AsyncIterable<InferenceEvent>;

  abort?(runId: string, reason?: string): Promise<void>;
  getCapabilities?(): Promise<InferenceCapabilities>;
}
```

### AgentRuntimePort — Full agent execution

```typescript
interface AgentRuntimePort {
  execute(
    request: AgentRunRequest,
    context?: ExecutionContext
  ): AsyncIterable<AgentRuntimeEvent>;

  cancel(runId: string, reason?: string): Promise<void>;
  resume?(checkpoint: RuntimeCheckpoint, context?: ExecutionContext): AsyncIterable<AgentRuntimeEvent>;
  getCapabilities?(): Promise<AgentRuntimeCapabilities>;
}
```

### Event Model (Discriminated Union)

Both `InferenceEvent` and `AgentRuntimeEvent` use discriminated unions with a stable `type` field:

- **InferenceEvent**: `stream.started` → `token` / `reasoning` / `tool.call` → `stream.completed` | `stream.failed` | `stream.cancelled`
- **AgentRuntimeEvent**: `run.started` → `assistant.delta` / `tool.requested` / `reasoning.delta` → `run.completed` | `run.failed` | `run.cancelled`

## 4. Ports and Adapters

### Adapter Implementations

| Adapter | Package | Implements | Capabilities |
|---------|---------|------------|--------------|
| `PiAIAdapter` | `@earendil-works/pi-ai` | `InferencePort` | Streaming, reasoning, cancellation |
| `PiAgentCoreAdapter` | `@earendil-works/pi-agent-core` | `AgentRuntimePort` | Streaming, tool calls (seq+parallel), cancellation, compaction |
| `MockRuntimeAdapter` | (none) | Both | All (deterministic, for tests) |

### Adapter Responsibilities

1. **Type Translation**: Convert MorPex contract types ↔ Pi native types
2. **Event Translation**: Convert Pi events → MorPex `AgentRuntimeEvent` / `InferenceEvent`
3. **Error Wrapping**: Convert Pi errors → MorPex `RuntimeError` (no Pi error types leaked)
4. **Capability Reporting**: Implement `getCapabilities()` to report actual backend capabilities
5. **Cancellation Propagation**: Forward `AbortSignal` → Pi's native cancellation

### Tool Execution Ownership

- **MorPexCore** defines tools as `ToolDefinition[]` (name, description, parameters)
- **Adapter** converts `ToolDefinition[]` → Pi-native tool format
- **Pi backend** executes the tool
- **Adapter** converts Pi tool events → `ToolResult` events
- **Rule**: MorPexCore and the Pi backend never execute the **same** tool call

## 5. Control Ownership

### MorPexCore Owns:

| Concern | Implementation |
|---------|----------------|
| Global run ID | `ExecutionIdentity` (no Pi dependency) |
| DAG node lifecycle | `DAGEngine` in Runtime Kernel |
| Task state machine | `FSMEngine` in Runtime Kernel |
| Priority scheduling | Control Plane Orchestrator |
| Agent selection & orchestration | Agent Plane |
| Cross-domain routing & arbitration | CrossDomainRouter |
| Top-level timeout & cancellation | ContractsGateway |
| Top-level retry strategy | Control Plane |
| Checkpoint metadata | CheckpointManager |
| Artifact submission | ArtifactRegistry |
| MemoryBus writes | Memory system |
| Audit & domain events | EventBus + EventStore |

### Pi Backend Owns:

| Concern | Implementation |
|---------|----------------|
| Single agent run execution | AgentHarness / Agent loop |
| Given model, messages, tools, config | Pi-native configuration |
| Output standardized events | Events mapped by adapter |
| Receive and respond to cancellation | AbortSignal → harness.abort() |
| Return standardized usage, tool, error info | Wrapped by adapter |

### Separation Rules

1. MorPexCore and Pi **never** simultaneously auto-retry the same execution unit
2. MorPexCore and Pi **never** maintain session state at the same level
3. MorPexCore and Pi **never** execute the same tool call
4. No recursive call chain: Pi → Extension → MorPex → Pi

## 6. Event Flow

```
User Request → ContractsGateway
  → Adapter.execute(request)
    → Pi backend starts agent run
    → Pi emits events
    → Adapter converts → AgentRuntimeEvent
    → ContractsGateway collects + broadcasts to EventBus
    → ExecutionMirror records
    → Subscribers update UI/Memory/Store
```

## 7. Dependency Rules

### Enforced by `.dependency-cruiser.js`

| From ↓ | Can Import → |
|--------|--------------|
| `packages/contracts/` | Nothing (zero deps) |
| `packages/core/` | `@morpex/contracts`, Node built-ins |
| `packages/adapters/` | `@morpex/contracts`, their Pi package |
| `packages/memory/` | `@morpex/contracts`, Node built-ins |
| `packages/studio/` | `@morpex/core`, `@morpex/memory`, `@morpex/contracts` |

### Forbidden

❌ `packages/core/` importing `@earendil-works/pi-*` directly
❌ `packages/contracts/` importing `packages/core/` or `packages/adapters/`
❌ `packages/adapters/` importing `packages/core/`
❌ Circular dependencies between packages

## 8. Migration Status

| Phase | Status | Description |
|-------|--------|-------------|
| 1. Audit | ✅ Complete | Identified 23 files with direct Pi imports |
| 2. Contracts | ✅ Complete | Created `packages/contracts/` with zero deps |
| 3. Mock Adapter | ✅ Complete | Created `MockRuntimeAdapter` for tests |
| 4. PiAIAdapter | ✅ Complete | Created inference adapter for pi-ai |
| 5. PiAgentCoreAdapter | ✅ Complete | Created agent runtime adapter for pi-agent-core |
| 6. Core Migration | 🔄 In Progress | Refactoring core to use contracts |
| 7. Boundary Checks | ✅ Complete | Added `.dependency-cruiser.js` rules |
| 8. Upgrade Automation | ✅ Complete | Added `renovate.json` config |
| 9. Documentation | ✅ Complete | This file + PI-UPGRADE-GUIDE.md |

---

*For questions about this architecture, contact the MorPex Core Team.*
