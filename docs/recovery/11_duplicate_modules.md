# 11 — Duplicate Modules Detection

> **Phase 8**: Semantic duplication (same responsibility, different files)
> **Date**: 2026-07-18
> **Confidence**: HIGH

---

## ✅ RESOLVED — Items Cleaned Up

- Duplicate Group 1 (`types/` vs `planning-types/`): `planning-types/` **DELETED**
- Duplicate Group 4 (ThinkingLevel adapters vs common): `adapters/thinking-level.ts` remains but unused — kept for reference
- Duplicate Group 5 (ModelRegistry): `adapters/model-resolver.ts` remains but unused — kept for reference

## DUPLICATE GROUP 1: `types/` vs `planning-types/` (RESOLVED ✅)

| Aspect | `types/` | `planning-types/` |
|--------|----------|-------------------|
| **Path** | `extensions/planning/types/` | `extensions/planning/planning-types/` |
| **Files** | 8 files + index.ts | 11 files + index.ts |
| **Purpose** | Planning type definitions | Planning type definitions |
| **Same responsibility?** | **YES** — Both define types for the planning system |
| **Same data?** | **PARTIALLY** — Different structures for same concepts |
| **Same runtime role?** | **YES** — Both are type definitions |
| **Same output?** | **YES** — TypeScript types only, no runtime code |
| **Active/Dead?** | ✅ ACTIVE (imported by MetaPlanner, PipelineExecutor) | ❌ DEAD (zero imports) |

**Verdict**: `planning-types/` is an abandoned duplicate. When types were restructured, the old directory was left behind instead of deleted.

**Evidence**:
- `grep -r "from.*types/" packages/core/src/extensions/planning/` → many results (active)
- `grep -r "from.*planning-types" packages/core/` → zero results (dead)
- Compare: `types/config.ts` vs `planning-types/config.ts` — both have planning config types
- Compare: `types/pipeline-types.ts` vs `planning-types/pipeline-types.ts` — both have PipelineInput/PipelineOutput types but different structures

---

## DUPLICATE GROUP 2: ExecutionGateway vs ContractGateway

| Aspect | ExecutionGateway | ContractGateway |
|--------|-----------------|-----------------|
| **Path** | `core/src/gateway/ExecutionGateway.ts` | `core/src/gateway/ContractGateway.ts` |
| **Purpose** | Route execution requests to adapters | Route execution requests to adapters (new contract-based) |
| **Same responsibility?** | **YES** — Both route execution requests |
| **Same data?** | **NO** — Different request/response types |
| **Same runtime role?** | **YES** — Both are gateways |
| **Same output?** | **YES** — Both return execution results |
| **Active/Dead?** | ⚠️ PARTIALLY ACTIVE (PiAdapter registered, but execution bypasses) | ❌ DEAD (registered but execute() never called) |

**Verdict**: ContractGateway was created for migration to contract-based AgentRuntimePort, but the migration was never completed. Both gateways coexist, and neither actually handles LLM execution (both are bypassed).

**Evidence**:
- `packages/core/src/gateway/ExecutionGateway.ts` — `registerAdapter()`, `execute()`
- `packages/core/src/gateway/ContractGateway.ts` — `register()`, `execute()`
- Both imported by `Kernel.ts`, both registered during `kernel.start()`
- But actual execution goes through DomainCluster → AgentFactory → AgentHarness (bypassing both)

---

## DUPLICATE GROUP 3: PiAdapter vs PiAdapterBridge

| Aspect | PiAdapter | PiAdapterBridge |
|--------|-----------|-----------------|
| **Path** | `core/src/gateway/adapters/PiAdapter.ts` | `core/src/gateway/PiAdapterBridge.ts` |
| **Purpose** | Bridge PiRuntime ↔ EventBus | Wrap PiAdapter as AgentRuntimePort |
| **Same responsibility?** | **NO** — PiAdapter is primary, Bridge is adapter |
| **Same runtime role?** | **NO** — Different interface |
| **Active/Dead?** | ✅ PiAdapter is partially active | ⚠️ PiAdapterBridge wraps PiAdapter but ContractGateway.execute() is never called |

**Verdict**: Not a true duplicate — PiAdapterBridge wraps PiAdapter for ContractGateway compatibility. But since ContractGateway is never used, PiAdapterBridge is effectively dead code.

---

## DUPLICATE GROUP 4: ThinkingLevel bits vs alt format

| Aspect | `adapters/thinking-level.ts` | `common/ThinkingLevelControl.ts` |
|--------|------------------------------|----------------------------------|
| **Path** | `core/src/adapters/thinking-level.ts` | `core/src/common/ThinkingLevelControl.ts` |
| **Purpose** | Thinking level types + helpers | Thinking level types + helpers |
| **Same responsibility?** | **YES** — Both define ThinkingLevel types and utilities |
| **Same data?** | **PARTIALLY** — Different level values |
| **Same runtime role?** | **YES** |
| **Active/Dead?** | ❌ UNUSED (no production imports) | ✅ ACTIVE (exported from core index.ts) |

**Verdict**: `adapters/thinking-level.ts` was created during Pi adapter migration but unused. The active version is in `common/ThinkingLevelControl.ts`.

**Evidence**:
- `grep -r "thinking-level" packages/ --include="*.ts"` → only self-references
- `grep -r "ThinkingLevelControl" packages/ --include="*.ts"` → imported by core index.ts and others

---

## DUPLICATE GROUP 5: ModelRegistry bits

| Aspect | `adapters/model-resolver.ts` | `common/ModelRegistry.ts` |
|--------|------------------------------|---------------------------|
| **Path** | `core/src/adapters/model-resolver.ts` | `core/src/common/ModelRegistry.ts` |
| **Purpose** | Model resolution | Model resolution |
| **Same responsibility?** | **YES** |
| **Active/Dead?** | ❌ UNUSED | ✅ ACTIVE |

**Verdict**: Same pattern — adapter migration left behind unused duplicates.

---

## DUPLICATE GROUP 6: IntentPlugin vs IntentResolver inline

| Aspect | IntentPlugin/IntentResolver (proper) | StudioOrchestrator inline |
|--------|--------------------------------------|--------------------------|
| **Path** | `core/src/planes/control-plane/intent/` | `studio/server/StudioOrchestrator.ts` |
| **Purpose** | Intent classification | Intent classification |
| **Same responsibility?** | **YES** — Both classify user intent as chat vs task |
| **Same output?** | **YES** — Both return intent type |
| **Active/Dead?** | ❌ BYPASSED (IntentResolver never called) | ✅ ACTIVE (inline classification) |

**Verdict**: The proper IntentResolver class at `control-plane/intent/IntentResolver.ts` was created as part of the plane architecture but never connected. StudioOrchestrator does intent classification inline, duplicating the logic.

---

## DUPLICATE GROUP 7: KnowledgeGraph (core) vs KnowledgeGraph-like in memory

| Aspect | KnowledgeGraph (core) | MemoryWiki/ECLCognifyEngine (memory) |
|--------|----------------------|--------------------------------------|
| **Path** | `core/src/planes/knowledge-plane/knowledge/KnowledgeGraph.ts` | `memory/src/wiki/MemoryWiki.ts`, `memory/src/core/ECLCognifyEngine.ts` |
| **Purpose** | Knowledge graph | Knowledge-like storage (graph relations) |
| **Overlap** | Memory's ECLCognifyEngine imports KnowledgeGraph from core (REVERSE DEPENDENCY) |

**Verdict**: Not a direct duplicate, but the reverse dependency (memory → core KnowledgeGraph) is a design smell. Memory should not depend on core.

---

## DUPLICATE GROUP 8: StudioOrchestrator vs ExecutionOrchestrator

| Aspect | StudioOrchestrator | ExecutionOrchestrator |
|--------|-------------------|----------------------|
| **Path** | `studio/server/StudioOrchestrator.ts` | `core/src/planes/control-plane/orchestrator/ExecutionOrchestrator.ts` |
| **Purpose** | Route user messages to execution | Orchestrate execution of DAG plans |
| **Overlap** | Both orchestrate execution flows |
| **Active/Dead?** | ✅ ACTIVE | ❌ NEVER CONSTRUCTED |

**Verdict**: ExecutionOrchestrator was created as part of the control-plane architecture but never constructed or wired. StudioOrchestrator handles orchestration directly.

---

## Duplicate Summary

| Group | Files | Lines (est.) | Severity |
|-------|-------|-------------|----------|
| 1. types/ vs planning-types/ | 19 files | ~2,000 | 🔴 P0 |
| 2. ExecutionGateway vs ContractGateway | 2 files | ~300 | 🟡 P1 |
| 3. PiAdapter vs PiAdapterBridge | 2 files | ~200 | 🟡 P1 |
| 4. ThinkingLevel (adapters vs common) | 2 files | ~100 | 🟢 P2 |
| 5. ModelRegistry (adapters vs common) | 2 files | ~80 | 🟢 P2 |
| 6. IntentResolver vs inline | 2 locations | ~100 | 🔴 P0 |
| 7. StudioOrchestrator vs ExecutionOrchestrator | 2 files | ~200 | 🟡 P1 |
| **TOTAL** | **~29 files** | **~3,000 lines** | |
