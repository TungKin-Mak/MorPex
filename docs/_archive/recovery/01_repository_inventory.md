# 01 — Repository Inventory

> **Phase 1**: Full file inventory with classification
> **Date**: 2026-07-18
> **Total Files**: ~456 source files (excluding node_modules, .git, data, logs)

---

## Directory Tree (Top Level)

```
MorPex/
├── configs/                     # Docker, PM2, ESLint, Vite configs
├── data/                        # Runtime data (mirror, sessions, wiki, zvec)
├── docs/                        # All documentation
│   ├── _archive/                # Obsolete/outdated design docs (27 files)
│   ├── frontend/                # Frontend API contracts
│   ├── guides/                  # Getting started, development guide
│   ├── modules/                 # Module documentation
│   ├── test-plans/              # Test plans
│   └── recovery/                # ← NEW: This directory
├── logs/                        # Runtime logs
├── node_modules/                # Dependencies
├── packages/                    # Main source code (7 sub-packages)
│   ├── adapters/                # Pi runtime adapters (PI-AI, PI-Agent-Core, Mock)
│   ├── contracts/               # TypeScript type contracts
│   ├── core/                    # ★ Core engine (MorPexCore)
│   ├── integration-tests/       # Cross-package integration tests
│   ├── memory/                  # Memory subsystem (MemoryBus, MemoryWiki, ZVec)
│   └── studio/                  # Studio (server + UI)
│       ├── server/              # StudioServer (HTTP + SSE bridge)
│       └── ui/                  # React frontend (Vite + Three.js)
├── scripts/                     # Utility + test scripts (18 files)
├── tools/                       # Empty
├── tools-python/                # Python embedding server
├── package.json                 # Monorepo root
├── tsconfig.json                # TypeScript config
├── CLAUDE.md                    # Development rules
└── README.md                    # Project readme
```

---

## Package Inventory

### 1. `packages/contracts` — (ACTIVE — Type Contracts)

**Entry**: `index.ts`
**Files**: 8 source files
**Classification**: ACTIVE (core type contracts)

| File | Classification | Notes |
|------|---------------|-------|
| `index.ts` | ACTIVE | Barrel export |
| `agent-runtime.ts` | ACTIVE | AgentRuntimePort interface |
| `capabilities.ts` | ACTIVE | Capability types |
| `errors.ts` | ACTIVE | Runtime error types |
| `inference.ts` | ACTIVE | Inference port types |
| `runtime-events.ts` | ACTIVE | Runtime event types |
| `tool.ts` | ACTIVE | Tool definition types |
| `package.json` | ACTIVE | Package config |

### 2. `packages/adapters` — (LEGACY — External Adapters)

**Entry**: `index.ts`
**Files**: 16 source files
**Classification**: LEGACY (created for migration but never wired)

| File | Classification | Notes |
|------|---------------|-------|
| `index.ts` | ACTIVE | Barrel export (used by root index) |
| `__tests__/contract-tests.ts` | ACTIVE | Contract tests |
| `mock-runtime/index.ts` | UNKNOWN | Not imported by any production code |
| `mock-runtime/MockRuntimeAdapter.ts` | UNKNOWN | Not imported by production code |
| `pi-agent-core/index.ts` | UNKNOWN | Not imported by production code |
| `pi-agent-core/PiAgentCoreAdapter.ts` | UNKNOWN | Not imported by production code |
| `pi-agent-core/model-resolver.ts` | UNKNOWN | Not imported by production code |
| `pi-agent-core/pi-agent-error-mapper.ts` | UNKNOWN | Not imported by production code |
| `pi-agent-core/pi-agent-event-mapper.ts` | UNKNOWN | Not imported by production code |
| `pi-agent-core/pi-agent-request-mapper.ts` | UNKNOWN | Not imported by production code |
| `pi-ai/index.ts` | UNKNOWN | Not imported by production code |
| `pi-ai/PiAIAdapter.ts` | UNKNOWN | Not imported by production code |
| `pi-ai/model-resolver.ts` | UNKNOWN | Not imported by production code |
| `pi-ai/pi-ai-error-mapper.ts` | UNKNOWN | Not imported by production code |
| `pi-ai/pi-ai-event-mapper.ts` | UNKNOWN | Not imported by production code |
| `pi-ai/pi-ai-request-mapper.ts` | UNKNOWN | Not imported by production code |

### 3. `packages/core` — (ACTIVE — Core Engine)

**Entry**: `index.ts` → `src/index.ts`
**Bootstrap**: `bootstrap.ts`
**Files**: ~140 source files
**Classification**: ACTIVE (primary engine)

#### Subdirectories:

| Path | Classification | Notes |
|------|---------------|-------|
| `src/common/` | ACTIVE | Kernel, EventBus, types, PluginSystem, Identity, ModelRegistry |
| `src/gateway/` | ACTIVE | ExecutionGateway, PiAdapter, ContractGateway, PiAdapterBridge |
| `src/mirror/` | ACTIVE | ExecutionMirror, ExecutionRecordingEngine, JSONLStorage |
| `src/event/` | ACTIVE | EventStore, EventStoreSubscriber |
| `src/events/` | ACTIVE | CrossDomainEvents |
| `src/engine/` | ACTIVE | EngineSubscriber |
| `src/memory/` | ACTIVE | MemoryHooks, MemoryMessages, MemoryBusListener, VectorStoreAdapter |
| `src/services/` | ACTIVE | AgentFactory, AgentService, LLMProvider |
| `src/tools/` | ACTIVE | All built-in tools (7 files) |
| `src/extensions/` | ACTIVE | ExtensionRegistry, ContextPruner, LineageTracker, McpProcessGuard, CheckpointManager |
| `src/extensions/planning/` | ACTIVE | MetaPlanner, PipelineExecutor, 7 pipeline stages, types/planning-types |
| `src/domains/` | ACTIVE | DomainCluster, DomainClusterManager, DomainManifestLoader |
| `src/router/` | ACTIVE | CrossDomainRouter, DomainDispatcher, ArbitrationHandler |
| `src/planes/` | ACTIVE | Control/Agent/Knowledge/Runtime-Kernel planes |
| `src/adapters/` | ACTIVE | Memory adapter bridge, pi-ai types, thinking level |
| `src/permission/` | ACTIVE | PermissionEngine |
| `src/projection/` | ACTIVE | SessionProjection |
| `src/negotiation/` | ACTIVE | NegotiationEngine |
| `src/industry/` | ACTIVE | IndustryPlugin, IndustryRegistry |
| `src/prompts/` | ACTIVE | Leader/expert prompts |
| `src/compaction/` | ACTIVE | CompactionPolicy |
| `src/utils/` | ACTIVE | extractJson, jsonl, toposort, AsyncResourceLocker |
| `src/mcp/` | ACTIVE | McpRuntimeManager, McpJsonRpcHandler |
| `__tests__/` | ACTIVE | Core tests |
| `docs/` | GENERATED | Core package docs |

### 4. `packages/memory` — (ACTIVE — Memory Subsystem)

**Entry**: `src/index.ts`
**Files**: ~30 source files
**Classification**: ACTIVE

| Subdirectory | Classification | Notes |
|-------------|---------------|-------|
| `src/core/` | ACTIVE | MemoryBus, WriteGate, ECLCognifyEngine, DocumentIngestion, etc. |
| `src/storage/` | ACTIVE | ZVecStorage, JSONLWriter, HistoryStore, Compactor, LogRotator |
| `src/vector/` | ACTIVE | EmbeddingClient, ZVecLockRecovery |
| `src/wiki/` | ACTIVE | MemoryWiki, DocWatcher, DocTopology, MemoryRetriever, schema, migrate |
| `e2e/` | ACTIVE | Memory bus audit tests |
| `types.ts` | ACTIVE | Core memory types |

### 5. `packages/studio/server` — (ACTIVE — Server Bridge)

**Entry**: `index.ts`
**Files**: 6 source files
**Classification**: ACTIVE

| File | Classification | Notes |
|------|---------------|-------|
| `index.ts` | ACTIVE | Server entry (main()) |
| `StudioServer.ts` | ACTIVE | Main server class (God object, ~700 lines) |
| `StudioOrchestrator.ts` | ACTIVE | Message routing orchestrator |
| `SessionManager.ts` | ACTIVE | Session lifecycle management |
| `SessionStore.ts` | ACTIVE | Session persistence |
| `ArtifactWriter.ts` | ACTIVE | File system artifact writer |

### 6. `packages/studio/ui` — (ACTIVE — Frontend)

**Files**: ~20 source files + dist/
**Classification**: ACTIVE (React + Three.js + Vite)

| Area | Classification | Notes |
|------|---------------|-------|
| `ts/App.tsx` | ACTIVE | Main React app |
| `ts/main.tsx` | ACTIVE | Entry point |
| `ts/stores.ts` | ACTIVE | State management (zustand) |
| `ts/api.ts` | ACTIVE | API client |
| `ts/BrainScene.tsx` | ACTIVE | 3D brain visualization |
| `ts/overlays/` | ACTIVE | Overlay UI components |
| `ts/Zone*.tsx` | ACTIVE | Layout zones |
| `e2e/` | ACTIVE | Playwright E2E tests |

### 7. `packages/integration-tests` — (EXPERIMENTAL)

**File**: `adapter-contract-tests.ts`
**Classification**: EXPERIMENTAL (single file, unconnected)

---

## Configuration Files

| File | Classification | Notes |
|------|---------------|-------|
| `package.json` | ACTIVE | Root monorepo config |
| `tsconfig.json` | ACTIVE | TypeScript config |
| `eslint.config.js` | ACTIVE | ESLint flat config |
| `.eslintrc.cjs` | LEGACY | ESLint legacy config (duplicate) |
| `.dependency-cruiser.js` | ACTIVE | Dependency analysis config |
| `.dependency-cruiser.json` | ACTIVE | Duplicate dep-cruiser config |
| `.env` | ACTIVE | Environment variables |
| `.env.example` | ACTIVE | Example env file |
| `.renovaterc.json` | ACTIVE | Renovate bot config |
| `configs/docker-compose.yml` | ACTIVE | Docker compose |
| `configs/Dockerfile` | ACTIVE | Dockerfile |
| `configs/Dockerfile.embedding` | ACTIVE | Embedding service Dockerfile |
| `configs/ecosystem.config.cjs` | LEGACY | PM2 config (duplicate) |
| `configs/ecosystem.config.ts` | LEGACY | PM2 TypeScript config |
| `configs/pm2-ecosystem.config.cjs` | ACTIVE | PM2 config (used by npm start) |
| `configs/pi-adapter-switch.json` | ACTIVE | Pi adapter routing |
| `configs/playwright.config.ts` | ACTIVE | Playwright config |
| `configs/production.config.json` | ACTIVE | Production settings |
| `configs/tsconfig.json` | ACTIVE | Build tsconfig |
| `configs/vite.config.ts` | ACTIVE | Vite config |
| `packages/studio/ui/vite.config.ts` | ACTIVE | UI Vite config |
| `packages/studio/ui/vitest.config.ts` | ACTIVE | UI Vitest config |

## Entry Points

| Entry | Path | Type |
|-------|------|------|
| Studio Server | `packages/studio/server/index.ts` | HTTP server (main()) |
| Core Package | `packages/core/index.ts` → `src/index.ts` | Library barrel |
| Core Bootstrap | `packages/core/bootstrap.ts` | bootstrapMorPexCore() |
| Memory Package | `packages/memory/src/index.ts` | Library barrel |
| Contracts Package | `packages/contracts/index.ts` | Type barrel |
| Adapters Package | `packages/adapters/index.ts` | Library barrel |
| UI Entry | `packages/studio/ui/ts/main.tsx` | React entry |
| UI HTML | `packages/studio/ui/index.html` | HTML host |

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/build-wiki.ts` | Build MemoryWiki |
| `scripts/check-boundaries.sh` | Check module boundaries |
| `scripts/migrate-to-sqlite.ts` | Migrate JSONL to SQLite |
| `scripts/query-wiki.ts` | Query MemoryWiki |
| `scripts/run-all-tests.ts` | Run all integration tests |
| `scripts/test-*.ts` (14 files) | Various test scripts |
| `scripts/verify-memorywiki.ts` | Verify MemoryWiki |

## Test Files

| Test File | Tests |
|-----------|-------|
| `packages/core/__tests__/morpex-core.test.ts` | Core engine |
| `packages/core/__tests__/morpex-common.test.ts` | Common utilities |
| `packages/core/__tests__/morpex-agent-other.test.ts` | Agent functionality |
| `packages/core/__tests__/morpex-crossdomain.test.ts` | Cross-domain |
| `packages/core/__tests__/morpex-deep-integration.test.ts` | Deep integration |
| `packages/core/__tests__/morpex-extensions.test.ts` | Extensions |
| `packages/core/__tests__/morpex-extensions-crossdomain.test.ts` | Extensions cross-domain |
| `packages/core/__tests__/morpex-knowledge.test.ts` | Knowledge features |
| `packages/core/__tests__/morpex-live-services.test.ts` | Live services |
| `packages/core/__tests__/tc-*.ts` (4 files) | Unit tests |
| `packages/core/__tests__/write-test-files.ts` | Test file generation |
| `packages/core/e2e-test.ts` | E2E test |
| `packages/core/e2e-domains.ts` | Domain E2E |
| `packages/core/e2e-cross-domain.ts` | Cross-domain E2E |
| `packages/memory/e2e/memory-bus-v2-audit.spec.ts` | Memory audit |
| `packages/adapters/__tests__/contract-tests.ts` | Adapter contracts |
| `packages/studio/ui/e2e/*.spec.ts` (12 files) | Frontend E2E |
| `packages/integration-tests/adapter-contract-tests.ts` | Cross-package tests |

## Classification Summary

| Classification | Count | % |
|---------------|-------|---|
| ACTIVE | ~320 | 70% |
| UNKNOWN | ~16 | 3.5% |
| LEGACY | ~30 | 6.5% |
| EXPERIMENTAL | ~5 | 1% |
| GENERATED | ~5 | 1% |
| DEAD CODE | ~80* | 18% |

*Includes: planning-types/ (11 files), unused adapters (15 files), ghost modules, dead scripts, duplicate configs
