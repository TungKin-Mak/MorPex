# 15 — Recovery Roadmap (Updated)

> **Phase 12**: Remaining recovery tasks after completed fixes
> **Date**: 2026-07-18 — Updated after catch/planning-types/scripts/config cleanup
> **Estimated effort remaining**: 5-8 days

---

## ✅ Completed Fixes (4.2 days)

| Task | Effort | Impact |
|------|--------|--------|
| ✅ **P0-1: planning-types/ deleted** | 0.5 day | 1,300 lines dead code eliminated |
| ✅ **catch (err: any) → unknown (129 fixes)** | 1.5 days | 52 production files type-safe; err.message no longer unsound |
| ✅ **Broken package.json scripts** | 1.0 day | `scripts/start.ts` + `scripts/run-e2e-tests.ts` created; 6 broken commands removed; `npm run dev` now works |
| ✅ **Duplicate config cleanup** | 0.5 day | Removed: `ecosystem.config.cjs`, `ecosystem.config.ts`, `.eslintrc.cjs`, `.renovaterc.json` |
| ✅ **output: any → unknown in types.ts** | 0.1 day | `ExecutionResult.output` now `unknown` — consumers must validate |
| ✅ **Empty/null file cleanup** | 0.1 day | Removed `nul` files (Windows artifacts), empty `tools/` directory |
| ✅ **Architecture docs updated** | 0.5 day | Health score updated 58→66; recovery plan reflects new state |

---

## 🔴 P0 — Remaining Critical (2-3 days)

### P0-2: Wire PiAdapter with Runtime

**Problem**: `PiAdapter` in `Kernel.ts` is registered but `kernel.registerPiRuntime()` is never called from StudioServer. PiAdapter listens for events but never receives execution requests.

**Action**:
1. Ensure piAgentRuntime is created and passed to `kernel.registerPiRuntime()`
2. Wire the pi-ai model calls through PiAdapter instead of direct imports
3. Verify ExecutionGateway path works end-to-end

**Files**: `packages/studio/server/StudioServer.ts`, `packages/core/src/common/Kernel.ts`
**Risk**: MEDIUM

### P0-3: Decide Gateway Strategy

**Problem**: Three execution paths — only one active (DomainDispatcher → AgentHarness direct). Gateways are dead code.

**Action**: Keep bypass (delete dead gateways) OR fix gateway (wire DomainDispatcher through it).
- **If keep bypass**: Delete ExecutionGateway, ContractGateway, PiAdapterBridge as execution components. Keep PiAdapter for EventBus events.
- **If fix gateway**: Wire DomainDispatcher.executeNode() to use ExecutionGateway.execute().

**Files**: `packages/core/src/gateway/*`
**Risk**: HIGH

### P0-4: Connect or Remove External Adapters

**Problem**: `packages/adapters/` (15 files, ~1,000 lines) has zero production consumers.

**Action**: Either wire PiAIAdapter/PiAgentCoreAdapter into the runtime, or delete the directory entirely.

**Files**: `packages/adapters/*`
**Risk**: LOW (no production dependency)

---

## 🟡 P1 — Architecture (2-3 days)

### P1-1: Unify DAG Execution

**Problem**: `SessionManager.executeDag()` and `DomainDispatcher.executeDAG()` have identical logic. Same input could produce different behavior.

**Action**: Remove duplicate in SessionManager, route luban/task sessions through DomainDispatcher exclusively.

**Files**: `packages/studio/server/SessionManager.ts`
**Risk**: MEDIUM

### P1-2: Unify Memory Systems

**Problem**: MemoryBus (JSONL+ZVec) + MemoryWiki (SQLite+ZVec) store overlapping data with no synchronization.

**Action**: Pick one as source of truth (recommend MemoryWiki for SQLite consistency). Route all writes through chosen system.

**Files**: `packages/memory/src/*`
**Risk**: MEDIUM

### P1-3: Connect or Remove IntentLayer

**Problem**: IntentPlugin/IntentResolver exist but StudioOrchestrator does inline classification.

**Action**: Wire StudioOrchestrator to emit events consumed by IntentPlugin, or remove intent layer.

**Files**: `packages/core/src/planes/control-plane/intent/`
**Risk**: LOW

### P1-4: Remove Plane Ghost Modules

**Problem**: 6 plane engines (FSM, DAG, Scheduler, Swarm, ExecutionGraph, AgentOrchestrator) + 9 plugin files are instantiated but never called (~1,200 lines).

**Action**: Delete all 6 engine classes + 6 plugin files + 3 unused plane plugin files.

**Files**: `packages/core/src/planes/runtime-kernel/*`, `packages/core/src/planes/agent-plane/*`
**Risk**: LOW

### P1-5: Break StudioServer God Object

**Problem**: StudioServer.ts is ~800 lines with 30+ member fields and imports everything directly.

**Action**: Extract component wiring to a dedicated `CompositionRoot` or DI container.

**Files**: `packages/studio/server/StudioServer.ts`
**Risk**: MEDIUM-HIGH

---

## 🟢 P2 — Cleanup (1 day)

### P2-1: Remove Ghost Extensions

**Problem**: LineageTracker, ContextPruner, McpProcessGuard, CheckpointManager (~800 lines) are instantiated but never called.

**Action**: Delete these 4 files + their tests.

**Risk**: LOW

### P2-2: Archive Outdated Architecture Docs

**Problem**: 9 architecture docs in `docs/` describe 4+ different versions; none matches reality.

**Action**: Move all outdated docs to `docs/_archive/`. Keep only one accurate architecture doc derived from recovery reports.

**Files**: 9 files in `docs/`
**Risk**: LOW

### P2-3: Remove Ghost Services

**Problem**: AgentService, McpRuntimeManager, ExecutionRecordingEngine are never used in production.

**Action**: Remove these 3 service files.

**Risk**: LOW

---

## ⚪ P3 — Optimization (1 day)

### P3-1: Replace Deep Relative Imports with Barrel Exports

**Problem**: StudioServer imports core internal modules via relative paths like `../../core/src/...` and `../../memory/src/...`.

**Action**: Add proper barrel exports to core/memory packages. Update imports to use package-name paths.

**Risk**: LOW

### P3-2: Split Large Files

**Problem**: StudioServer.ts (~800 lines), MetaPlanner.ts, MemoryBus.ts are over 500 lines.

**Action**: Split into smaller focused modules.

### P3-3: Normalize Naming Conventions

**Problem**: Multiple orchestrators (StudioOrchestrator, AgentOrchestrator, ExecutionOrchestrator), multiple DAG engines (DAGEngine vs DomainDispatcher).

**Action**: Rename to clarify purpose. Eliminate name collision.
