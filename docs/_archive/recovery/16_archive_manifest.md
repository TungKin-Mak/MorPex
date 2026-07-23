# 16 — Archive Manifest (Updated)

> **Supplement**: Files that should be archived or deleted
> **Date**: 2026-07-18 (Updated: planning-types/ deleted ✅, configs cleaned ✅)
> **Confidence**: HIGH
> **Note**: Items marked DONE have already been removed.

---

## ✅ Already Archived/Deleted

| Group | Action | Date |
|-------|--------|------|
| `planning-types/` (11 files, 1,300 lines) | **DELETED** — duplicate of `types/` | 2026-07-18 |
| `configs/ecosystem.config.cjs` | **DELETED** — broken PM2 config | 2026-07-18 |
| `configs/ecosystem.config.ts` | **DELETED** — broken PM2 config | 2026-07-18 |
| `.eslintrc.cjs` | **DELETED** — duplicate ESLint config | 2026-07-18 |
| `.renovaterc.json` | **DELETED** — duplicate Renovate config | 2026-07-18 |
| `nul` files (2) | **DELETED** — Windows artifacts | 2026-07-18 |
| `tools/` directory | **DELETED** — empty placeholder | 2026-07-18 |

---

## Remaining Items to Archive

---

## 🔴 GROUP 1: Unused External Adapters — `packages/adapters/`

**Status**: DISCONNECTED — zero production imports  
**Fate**: Archive entire package

These 15 files were created as part of a planned migration from direct pi-ai/pi-agent-core imports to abstracted adapter layer. The migration was never completed. StudioServer imports pi-ai and pi-agent-core directly.

| File | Reason | Archive Target |
|------|--------|---------------|
| `packages/adapters/index.ts` | Barrel — no consumer | `docs/_archive/adapters/index.md` |
| `packages/adapters/pi-ai/index.ts` | Barrel — no consumer | Archive |
| `packages/adapters/pi-ai/PiAIAdapter.ts` | Adapter class — never wired | Archive |
| `packages/adapters/pi-ai/pi-ai-error-mapper.ts` | Error mapping — never used | Archive |
| `packages/adapters/pi-ai/pi-ai-event-mapper.ts` | Event mapping — never used | Archive |
| `packages/adapters/pi-ai/pi-ai-request-mapper.ts` | Request mapping — never used | Archive |
| `packages/adapters/pi-ai/model-resolver.ts` | Model resolution — never used | Archive |
| `packages/adapters/pi-agent-core/index.ts` | Barrel — no consumer | Archive |
| `packages/adapters/pi-agent-core/PiAgentCoreAdapter.ts` | Adapter class — never wired | Archive |
| `packages/adapters/pi-agent-core/pi-agent-error-mapper.ts` | Error mapping — never used | Archive |
| `packages/adapters/pi-agent-core/pi-agent-event-mapper.ts` | Event mapping — never used | Archive |
| `packages/adapters/pi-agent-core/pi-agent-request-mapper.ts` | Request mapping — never used | Archive |
| `packages/adapters/pi-agent-core/model-resolver.ts` | Model resolution — never used | Archive |
| `packages/adapters/mock-runtime/index.ts` | Barrel — no consumer | Archive |
| `packages/adapters/mock-runtime/MockRuntimeAdapter.ts` | Test mock — never used in production | Archive |
| `packages/adapters/__tests__/contract-tests.ts` | Contract tests — orphaned | Keep as test reference |

**Risk if removed**: None. No production code imports these files.
**Evidence**: `grep -r "packages/adapters" packages/ --include="*.ts"` — zero production hits.

---

## 🔴 GROUP 2: Duplicate Type Directory — `planning-types/`

**Status**: DEAD — zero imports from outside directory  
**Fate**: Delete (superseded by `types/`)

| File | Lines | Active Replacement |
|------|-------|-------------------|
| `packages/core/src/extensions/planning/planning-types/autonomous.ts` | ~70 | `types/engines.ts` |
| `packages/core/src/extensions/planning/planning-types/config.ts` | ~50 | `types/config.ts` |
| `packages/core/src/extensions/planning/planning-types/dag-patch.ts` | ~60 | Not needed (no DAG patching at type level) |
| `packages/core/src/extensions/planning/planning-types/evaluation.ts` | ~80 | `types/evaluation.ts` |
| `packages/core/src/extensions/planning/planning-types/execution-records.ts` | ~100 | `types/plan-templates.ts` |
| `packages/core/src/extensions/planning/planning-types/extension-context.ts` | ~40 | `types/extension-lifecycle.ts` |
| `packages/core/src/extensions/planning/planning-types/index.ts` | ~30 | `types/index.ts` |
| `packages/core/src/extensions/planning/planning-types/matching.ts` | ~50 | Not needed |
| `packages/core/src/extensions/planning/planning-types/pipeline-types.ts` | ~400 | `types/pipeline-types.ts` |
| `packages/core/src/extensions/planning/planning-types/plan-templates.ts` | ~200 | `types/plan-templates.ts` |
| `packages/core/src/extensions/planning/planning-types/simulation.ts` | ~80 | `types/simulation.ts` |

**Risk if removed**: None (TypeScript types only, no runtime code).
**Evidence**: `grep -rn "planning-types" packages/ --include="*.ts"` — zero hits from outside the directory.

---

## 🔴 GROUP 3: Plane Engine Classes — Ghost Modules

**Status**: GHOST — instantiated but never called  
**Fate**: Remove or wire into execution path

| File | Class | Created At | Last Usage | Archive If |
|------|-------|-----------|------------|-----------|
| `packages/core/src/planes/runtime-kernel/fsm/FSMEngine.ts` | `FSMEngine` | StudioServer.ts:274 | Tests only | No production code depends on it |
| `packages/core/src/planes/runtime-kernel/dag/DAGEngine.ts` | `DAGEngine` | StudioServer.ts:275 | Tests only | No production code depends on it |
| `packages/core/src/planes/runtime-kernel/scheduler/SchedulerEngine.ts` | `SchedulerEngine` | StudioServer.ts:276 | Tests only | No production code depends on it |
| `packages/core/src/planes/agent-plane/swarm/SwarmEngine.ts` | `SwarmEngine` | StudioServer.ts:277 | Tests only | No production code depends on it |
| `packages/core/src/planes/runtime-kernel/execution-graph/ExecutionGraph.ts` | `ExecutionGraphEngine` | StudioServer.ts:278 | Tests only | No production code depends on it |
| `packages/core/src/planes/agent-plane/orchestrator/AgentOrchestrator.ts` | `AgentOrchestrator` | StudioServer.ts:279 | Tests only | No production code depends on it |

**Risk if removed**: None for production. Test files (`morpex-core.test.ts`, `morpex-agent-other.test.ts`) would need updates.
**Evidence**: No `this.fsmEngine.`, `this.dagEngine.`, etc. calls in production code after instantiation.

---

## 🔴 GROUP 4: Plane Plugin Classes — Never Registered

**Status**: GHOST — exist as classes but never registered with PluginSystem  
**Fate**: Remove or register

| File | Plugin Class | Why Ghost |
|------|-------------|-----------|
| `packages/core/src/planes/runtime-kernel/fsm/plugin.ts` | `FSMPlugin` | Never imported by StudioServer |
| `packages/core/src/planes/runtime-kernel/dag/plugin.ts` | `DAGPlugin` | Never imported by StudioServer |
| `packages/core/src/planes/runtime-kernel/scheduler/plugin.ts` | `SchedulerPlugin` | Never imported by StudioServer |
| `packages/core/src/planes/agent-plane/swarm/plugin.ts` | `SwarmPlugin` | Never imported by StudioServer |
| `packages/core/src/planes/runtime-kernel/execution-graph/plugin.ts` | `ExecutionGraphPlugin` | Never imported by StudioServer |
| `packages/core/src/planes/agent-plane/orchestrator/plugin.ts` | `AgentOrchestratorPlugin` | Never imported by StudioServer |
| `packages/core/src/planes/knowledge-plane/knowledge/plugin.ts` | `KnowledgePlugin` | Never imported by StudioServer |
| `packages/core/src/planes/knowledge-plane/artifacts/plugin.ts` | `ArtifactPlugin` | Never imported by StudioServer |
| `packages/core/src/planes/knowledge-plane/memory/plugin.ts` | `MemoryPlugin` | Never imported by StudioServer |

**Risk if removed**: None. Only `IntentPlugin` and `IndustryPlugin` are actually registered.

---

## 🟡 GROUP 5: Bypassed Gateway Components

**Status**: BYPASSED — created and registered but execution goes through a different path  
**Fate**: Wire into execution path or remove

| File | Component | Active Replacement |
|------|-----------|-------------------|
| `packages/core/src/gateway/ExecutionGateway.ts` | Execution request router | DomainDispatcher.executeNode() → direct AgentHarness |
| `packages/core/src/gateway/ContractGateway.ts` | Contract-based execution router | Same — DomainDispatcher bypasses |
| `packages/core/src/gateway/PiAdapterBridge.ts` | Adapter for contract gateway | No replacement (bypass is direct) |
| `packages/core/src/gateway/adapters/PiAdapter.ts` | PiRuntime event wrapper | Partially active (events only, not execution) |

**Risk if removed**: Medium — PiAdapter bridges events. The other three can be removed without effect.

---

## 🟡 GROUP 6: Intent System — Bypassed

**Status**: BYPASSED — proper intent resolution exists but is not used  
**Fate**: Wire into StudioOrchestrator or remove

| File | Component | Active Replacement |
|------|-----------|-------------------|
| `packages/core/src/planes/control-plane/intent/IntentResolver.ts` | Intent resolution class | StudioOrchestrator.classifyIntent() inline |
| `packages/core/src/planes/control-plane/intent/plugin.ts` | IntentPlugin | Same — no production events sent |

**Risk if removed**: Low. StudioOrchestrator's inline classification works independently.

---

## 🟡 GROUP 7: Extension Ghosts — Instantiated, Never Called

**Status**: GHOST  
**Fate**: Wire into execution path or remove

| File | Class | Why Ghost |
|------|-------|-----------|
| `packages/core/src/extensions/LineageTracker.ts` | Artifact lineage tracking | Only used by ContextPruner (also ghost) |
| `packages/core/src/extensions/ContextPruner.ts` | Context pruning | Never called from production code |
| `packages/core/src/extensions/McpProcessGuard.ts` | MCP process guard | Never called from production code |
| `packages/core/src/extensions/CheckpointManager.ts` | DAG checkpoint/rollback | Declared field, never instantiated |

**Risk if removed**: None for production. ~800 lines of dead code.

---

## 🟢 GROUP 8: Documentation — Outdated Architecture Docs

**Status**: OUTDATED — describe different architecture versions than what runs  
**Fate**: Archive to `docs/_archive/`

| Document | Description | Outdated Since |
|----------|-------------|---------------|
| `docs/ARCHITECTURE.md` | v3.0 architecture | v3.2 migration |
| `docs/ARCHITECTURE-v4.0.md` | v4.0 aspirational architecture | Never implemented |
| `docs/docsARCHITECTURE-v3.2-optimized.md` | v3.2 optimized | Partially implemented |
| `docs/features-and-architecture.md` | Feature descriptions | Many described features are ghosts |
| `docs/WIKI.md` | Wiki documentation | Out of date |
| `docs/MIGRATION-GUIDE.md` | Migration guide | Historical |
| `docs/PI-COMPAT-MATRIX.md` | Pi compatibility matrix | Probably outdated |
| `docs/PI-UPGRADE-GUIDE.md` | Pi upgrade guide | Historical |
| `docs/UPGRADE-MEMORY-WIKI.md` | Memory wiki upgrade | Historical |
| `docs/README.md` | Doc index | Links to ghost components |

**Risk if removed**: Developers lose historical context, but gain clarity about what exists now.

---

## 🟢 GROUP 9: Duplicate Adapter Types (Internal)

**Status**: DUPLICATE — `core/src/adapters/` vs `core/src/common/`  
**Fate**: Consolidate, keep active versions

| File (Abandoned) | Lines | Active Replacement | Location |
|-----------------|-------|-------------------|----------|
| `core/src/adapters/thinking-level.ts` | ~50 | `ThinkingLevelControl.ts` | `core/src/common/` |
| `core/src/adapters/model-resolver.ts` | ~40 | `ModelRegistry.ts` | `core/src/common/` |

**Note**: Other files in `core/src/adapters/` (agent-spawner.ts, domain-cluster.ts, pi-types.ts, pi-utils.ts, memory/index.ts) are ACTIVE and should NOT be archived.

---

## 🟢 GROUP 10: Redundant Config Files

**Status**: REDUNDANT — multiple configs for same purpose  
**Fate**: Consolidate

| File | Duplicates | Keep |
|------|-----------|------|
| `configs/ecosystem.config.cjs` | `configs/ecosystem.config.ts`, `configs/pm2-ecosystem.config.cjs` | Keep one PM2 config |
| `.eslintrc.cjs` | `eslint.config.js` | Dual ESLint configs |

---

## Archive Action Plan

| Step | Action | Files | Effort |
|------|--------|-------|--------|
| 1 | Delete planning-types/ directory | 11 files | 0.5 day |
| 2 | Archive packages/adapters/ to docs/_archive/ | 15 files | 0.5 day |
| 3 | Remove ghost plane engines | 6 files + 6 plugin files | 1 day |
| 4 | Remove bypassed gateways (keep PiAdapter) | 3 files | 0.5 day |
| 5 | Remove ghost extensions | 4 files | 0.5 day |
| 6 | Archive outdated docs | 10 files | 0.5 day |
| 7 | Consolidate duplicate configs | 4 files | 0.5 day |
| | **TOTAL** | **~53 files** | **3.5 days** |
