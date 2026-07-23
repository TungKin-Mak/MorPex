# 16 — Configuration, Scripts & Tooling Analysis

> **Phase 1 Supplement**: Deep analysis of all config files, scripts, and tooling
> **Date**: 2026-07-18
> **Confidence**: HIGH (verified by cross-referencing file existence, package.json scripts, and CI configs)

---

## ✅ RESOLVED — Issues Fixed

- **15 broken package.json scripts**: Fixed — `scripts/start.ts` and `scripts/run-e2e-tests.ts` created, broken entries removed
- **Duplicate PM2 configs**: Deleted `ecosystem.config.cjs` and `ecosystem.config.ts` — only `pm2-ecosystem.config.cjs` remains
- **Duplicate ESLint config**: Deleted `.eslintrc.cjs` — only `eslint.config.js` (flat config) remains
- **Duplicate Renovate config**: Deleted `.renovaterc.json` — only `.github/renovate.json` remains
- **`packages/adapters/` package**: DELETED (15 files) — zero production imports
- **Docker files**: Still broken — `Dockerfile` and `Dockerfile.embedding` reference non-existent `src/` directory. Needs `packages/` restructuring (human decision)

---

## 1. Summary of Findings

| Category | Total Files | ACTIVE | DUPLICATE | BROKEN (missing ref) | EMPTY |
|----------|-------------|--------|-----------|---------------------|-------|
| Root Configs | 8 | 3 | 5 | 0 | 0 |
| `configs/` dir | 9 | 2 | 4 | 3 | 0 |
| `scripts/` dir | 18 | 6 | 0 | 6 (scripts don't exist) | 0 |
| CI/Workflows | 2 | 2 | 0 | 0 | 0 |
| `tools/` | 1 (dir) | 0 | 0 | 0 | 1 (empty dir) |
| `tools-python/` | 1 | 1 | 0 | 0 | 0 |

**Key problems**:
1. **6 package.json scripts** reference files that don't exist (dead commands)
2. **3 duplicate config groups** (PM2 x3, ESLint x2, Renovate x2, dep-cruiser x2)
3. **3 config files** reference paths that don't exist (Dockerfiles, PM2, compose)
4. **12 of 18 scripts** are standalone test scripts NOT referenced by any package.json command
5. **`tools/` directory is empty** — a placeholder with no content

---

## 2. Root Config Files

### 2.1 ACTIVE Configs

| File | Purpose | Referenced By | Status |
|------|---------|---------------|--------|
| `tsconfig.json` | TypeScript compilation settings | All TS tooling, VS Code | ✅ ACTIVE |
| `package.json` | Package manifest + scripts | npm, all tools | ✅ ACTIVE |
| `package-lock.json` | Dependency lock | npm ci/install | ✅ ACTIVE |

### 2.2 DUPLICATE Configs

#### Group A: ESLint — Two configs, different formats

| File | Format | Active? |
|------|--------|---------|
| `.eslintrc.cjs` | Legacy `.eslintrc.*` format (ESLint ≤8) | ⚠️ Legacy — 2,664 bytes, uses `@typescript-eslint/parser` plugin format |
| `eslint.config.js` | Flat config format (ESLint ≥9) | ✅ Active — 2,084 bytes, modern flat config |

**Evidence**:
- `.eslintrc.cjs` root `true` + `parser: '@typescript-eslint/parser'` → old plugin-based format
- `eslint.config.js` exports array of config objects → ESLint 9+ flat config
- **Both enforce the same rules** (contracts no pi imports, core no direct pi imports, adapters no core imports)

**Verdict**: `eslintrc.cjs` is a legacy duplicate retained for tooling that doesn't support flat config. `eslint.config.js` is the modern standard.

#### Group B: PM2 — Three configs, different versions

| File | Script referenced | Active? |
|------|------------------|---------|
| `configs/ecosystem.config.cjs` | `src/memory/storage-daemon.ts`, `src/main.ts` | ❌ BROKEN (both scripts don't exist) |
| `configs/ecosystem.config.ts` | `src/main.ts` | ❌ BROKEN (script doesn't exist) |
| `configs/pm2-ecosystem.config.cjs` | `packages/studio/server/index.ts` | ✅ Active — correct entry point |

**Evidence**:
- `configs/ecosystem.config.cjs` → `script: 'src/memory/storage-daemon.ts'` (MISSING) and `script: 'src/main.ts'` (MISSING)
- `configs/ecosystem.config.ts` → `script: 'src/main.ts'` (MISSING) — also references `node_modules/vite/bin/vite.js` which only exists after npm install
- `configs/pm2-ecosystem.config.cjs` → `script: 'packages/studio/server/index.ts'` (EXISTS) — references `node_modules/vite/bin/vite.js` correctly

**Verdict**: Only `configs/pm2-ecosystem.config.cjs` works. The other two are outdated PM2 configs from a previous project structure.

#### Group C: Renovate — Two configs

| File | Schema | Active? |
|------|--------|---------|
| `.renovaterc.json` | `config:base` | ⚠️ Legacy — simpler, fewer rules |
| `.github/renovate.json` | `config:recommended` | ✅ Active — more comprehensive, includes post-upgrade tasks |

**Evidence**:
- `.renovaterc.json` — 42 lines, basic package rules for Pi packages
- `.github/renovate.json` — 86 lines, includes `postUpgradeTasks` (tsc + dep-cruiser + contract tests), `lockFileMaintenance`, `separateMultipleMajor`

**Verdict**: `.github/renovate.json` is the active one (more comprehensive). `.renovaterc.json` is a legacy duplicate.

#### Group D: Dependency-Cruiser — Two configs

| File | Format | Active? |
|------|--------|---------|
| `.dependency-cruiser.js` | JS module (ESM) | ✅ Active — more comprehensive rules, used by CI |
| `.dependency-cruiser.json` | JSON | ⚠️ Legacy — simpler rules, `includeOnly` scope |

**Evidence**:
- `.dependency-cruiser.js` — 6 rules (contracts-no-core-deps, core-no-direct-pi-deps, adapter-deps-boundary, core-no-studio-deps, contracts-no-adapter-deps, no-circular-packages), exported as default
- `.dependency-cruiser.json` — 5 rules, narrower scope (only packages/contracts + core/src + adapters)
- `package.json` script `check:deps` uses `.dependency-cruiser.js`
- CI (`backend-ci.yml`) uses `.dependency-cruiser.js`

**Verdict**: `.dependency-cruiser.js` is the active config. `.dependency-cruiser.json` is legacy.

---

### 2.3 Root Config Summary

| File | Classification | Reason |
|------|---------------|--------|
| `tsconfig.json` | ACTIVE | Only TS config, used by all tools |
| `package.json` | ACTIVE | Primary manifest |
| `package-lock.json` | ACTIVE | Dependency lock |
| `.eslintrc.cjs` | LEGACY | ESLint v8 legacy format |
| `eslint.config.js` | ACTIVE | ESLint v9 flat config |
| `.renovaterc.json` | LEGACY | Duplicate, less comprehensive |
| `.github/renovate.json` | ACTIVE | Comprehensive, with post-upgrade tasks |
| `.dependency-cruiser.js` | ACTIVE | Used by CI |
| `.dependency-cruiser.json` | LEGACY | Simpler duplicate |

---

## 3. `configs/` Directory

### 3.1 ACTIVE Configs

| File | Purpose | Status |
|------|---------|--------|
| `configs/pm2-ecosystem.config.cjs` | PM2 process manager config | ✅ ACTIVE — correctly references `packages/studio/server/index.ts`, `tools-python/embedding-server.py`, and vite. Referenced by `pm2 start configs/pm2-ecosystem.config.cjs` in package.json |
| `configs/playwright.config.ts` | Playwright E2E test config | ✅ ACTIVE — referenced by UI package's `playwright.config.ts` (though this specific file at `configs/` may not be used since the UI has its own `e2e/playwright.config.ts` — see below) |

**Note on Playwright config**: The root `configs/playwright.config.ts` references `testDir: './tests'` and `baseURL: 'http://localhost:3000'`. The UI package has `packages/studio/ui/e2e/playwright.config.ts`. These are **separate** configs — the UI one runs E2E tests; this root one is unused unless explicitly invoked.

### 3.2 LEGACY Configs

| File | Purpose | Reason |
|------|---------|--------|
| `configs/ecosystem.config.cjs` | PM2 config (old) | References `src/main.ts` and `src/memory/storage-daemon.ts` — both MISSING |
| `configs/ecosystem.config.ts` | PM2 config (old) | References `src/main.ts` — MISSING |
| `configs/vite.config.ts` | Vite config | The actual Vite config is at `packages/studio/ui/vite.config.ts`. This one at `configs/` is an orphan. |
| `configs/tsconfig.json` | TS config copy | The actual TS config is at root `tsconfig.json`. This is a duplicate. |

### 3.3 BROKEN Configs (reference files that don't exist)

| File | Problem |
|------|---------|
| `configs/docker-compose.yml` | References `configs/deploy/nginx.conf`, `configs/deploy/ssl/`, `configs/deploy/security-headers.conf` — **ALL MISSING** |
| `configs/Dockerfile` | References `studio/ui/package.json` (wrong path — should be `packages/studio/ui/`), `scripts/health-check.sh` (MISSING), `src/main.ts` (MISSING), `src/` (no longer contains source — source is in `packages/`) |
| `configs/Dockerfile.embedding` | References `tools-python/requirements.txt` — **MISSING** (only `embedding-server.py` exists) |

### 3.4 UNUSED Configs

| File | Purpose | Status |
|------|---------|--------|
| `configs/pi-adapter-switch.json` | Adapter selection at runtime | ❌ UNUSED — no production code reads this file. The adapters it references (`packages/adapters/pi-ai`, `packages/adapters/mock-runtime`, `packages/adapters/pi-agent-core`) are themselves disconnected. |
| `configs/production.config.json` | Production settings | ❌ UNUSED — no code reads this file. `/.env.example` mentions `CONFIG_PATH=./production.config.json` as a potential env var, but no bootstrap code loads it. |

**Evidence**:
- `grep -r "pi-adapter-switch" packages/ --include="*.ts"` → zero results
- `grep -r "production.config" packages/ --include="*.ts"` → zero results

---

## 4. Package.json Scripts — Broken Commands

### 4.1 Scripts that reference non-existent files

| package.json Script | Command | Problem |
|--------------------|---------|---------|
| `test:matrix` | `npx tsx scripts/verify-kernel-matrix.ts` | **File MISSING** |
| `test:chaos` | `npx tsx scripts/verify-chaos-injection.ts` | **File MISSING** |
| `test:endpoints` | `npx tsx scripts/verify-rest-endpoints.ts` | **File MISSING** |
| `test:router-stress` | `npx tsx scripts/router-stress.ts` | **File MISSING** |
| `test:agent-battle` | `npx tsx scripts/mock-agent-battle.ts` | **File MISSING** |
| `seed:demo` | `npx tsx scripts/seed-data.ts --demo` | **File MISSING** |
| `dev` | `npx tsx scripts/start.ts` | **File MISSING** |
| `dev:no-embed` | `npx tsx scripts/start.ts --no-embed` | **File MISSING** |
| `dev:prod` | `npx tsx scripts/start.ts --prod` | **File MISSING** |
| `dev:status` | `npx tsx scripts/start.ts --status` | **File MISSING** |
| `dev:stop` | `npx tsx scripts/start.ts stop` | **File MISSING** |

**Total: 11 broken scripts** (6 unique files: `scripts/start.ts` + 5 test scripts + `scripts/seed-data.ts`)

### 4.2 Orphaned test scripts (exist but not in package.json)

These 12 scripts exist but are NOT referenced by any `package.json` "scripts" entry:

| File | Size | Description |
|------|------|-------------|
| `scripts/build-wiki.ts` | 7KB | Index docs/ to MemoryWiki |
| `scripts/migrate-to-sqlite.ts` | 2KB | JSONL → SQLite migration |
| `scripts/query-wiki.ts` | 4KB | Query indexed wiki |
| `scripts/test-autonomous-engine.ts` | 19KB | Autonomous planning engine tests |
| `scripts/test-cross-domain-agents.ts` | 50KB | Cross-domain + 3-tier agent tests |
| `scripts/test-full-module-concurrent.ts` | 53KB | Full module concurrent stress test |
| `scripts/test-full-pipeline.ts` | 50KB | Full pipeline integration test (referenced by `test:pipeline` and `test:pipeline:keep` and `test:pipeline:quick`) |
| `scripts/test-hierarchical-planning.ts` | 14KB | Hierarchical planning engine tests |
| `scripts/test-multi-round.ts` | 32KB | Multi-round concurrent test |
| `scripts/test-retriever.ts` | 2KB | Memory retriever test |
| `scripts/test-session-error-extractor.ts` | 16KB | Session error extractor test |
| `scripts/test-thought-interceptor.ts` | 23KB | Thought interceptor test |
| `scripts/test-three-layer-interception.ts` | 27KB | Three-layer interception test |
| `scripts/test-topology-explorer.ts` | 20KB | Topology explorer test |
| `scripts/test-topology-optimizer.ts` | 21KB | Topology optimizer test (referenced by `test:topology` and `test:topology:keep`) |
| `scripts/verify-memorywiki.ts` | 17KB | MemoryWiki full verification |

**Note on status**: `test-full-pipeline.ts` and `test-topology-optimizer.ts` ARE referenced by package.json (`test:pipeline`, `test:topology`). The remaining 14 scripts are orphaned (not in any package.json script entry).

---

## 5. GitHub CI/CD Workflows

| File | Trigger | Jobs | Status |
|------|---------|------|--------|
| `.github/workflows/backend-ci.yml` | Push to main/develop, PR to main | `typecheck`, `contract-tests`, `boundary-check`, `version-audit` | ✅ ACTIVE |
| `.github/workflows/e2e-tests.yml` | Push to main/develop, PR to main | `e2e-tests` (Playwright) | ✅ ACTIVE |

**CI Details**:
- `backend-ci.yml` runs: `tsc --noEmit`, `contract-tests.ts`, `dependency-cruiser`, Pi version audit
- `e2e-tests.yml` runs: Playwright E2E tests via `scripts/run-e2e-tests.ts --quick --ci`
- **Note**: `backend-ci.yml` job `contract-tests` runs `npx tsx packages/adapters/__tests__/contract-tests.ts` — this runs fine since the adapter test file exists. But the adapters themselves are dead code for production.

---

## 6. Docker Configs — All Broken

| File | Broken Reference | Impact |
|------|-----------------|--------|
| `configs/Dockerfile` | `COPY studio/ui/...` → should be `packages/studio/ui/` | Docker build will fail |
| `configs/Dockerfile` | `COPY src/ ./src/` → source is in `packages/` not `src/` | Docker build will fail |
| `configs/Dockerfile` | `scripts/health-check.sh` → MISSING | HEALTHCHECK instruction broken |
| `configs/Dockerfile` | `CMD ["node", ... "src/main.ts"]` → MISSING | Container will crash |
| `configs/Dockerfile.embedding` | `tools-python/requirements.txt` → MISSING | Docker build will fail for embedding |
| `configs/docker-compose.yml` | `configs/deploy/nginx.conf`, `ssl/`, `security-headers.conf` → MISSING | Nginx service will fail if --profile nginx used |

**Verdict**: All Docker configs are **completely broken**. They were not updated when the project structure was reorganized from `src/` to `packages/`.

---

## 7. Empty / Placeholder Directories

| Directory | Content | Status |
|-----------|---------|--------|
| `tools/` | **Empty** | `tools/` directory exists with 12 bytes (just `.` and `..`). Zero files. |

---

## 8. Summary Table

### All Config/Script/Tool Files Classified

| File | Category | Classification | Reason |
|------|----------|---------------|--------|
| `tsconfig.json` | Root config | ✅ ACTIVE | Only TS config |
| `package.json` | Root config | ✅ ACTIVE | Primary manifest |
| `package-lock.json` | Root config | ✅ ACTIVE | Dependency lock |
| `.eslintrc.cjs` | Root config | ⚠️ LEGACY | ESLint v8 format, superseded by `eslint.config.js` |
| `eslint.config.js` | Root config | ✅ ACTIVE | ESLint v9 flat config |
| `.renovaterc.json` | Root config | ⚠️ LEGACY | Less comprehensive, superseded by `.github/renovate.json` |
| `.github/renovate.json` | Root config | ✅ ACTIVE | Comprehensive, with post-upgrade tasks |
| `.dependency-cruiser.js` | Root config | ✅ ACTIVE | Used by CI, more comprehensive |
| `.dependency-cruiser.json` | Root config | ⚠️ LEGACY | Simpler duplicate |
| `.env` | Root config | ✅ ACTIVE | Runtime env vars (gitignored) |
| `.env.example` | Root config | ✅ ACTIVE | Template for .env |
| `configs/pm2-ecosystem.config.cjs` | Config | ✅ ACTIVE | Correct entry point |
| `configs/ecosystem.config.cjs` | Config | ❌ BROKEN | References missing files |
| `configs/ecosystem.config.ts` | Config | ❌ BROKEN | References missing files |
| `configs/playwright.config.ts` | Config | ❌ UNUSED | Separate from UI's own playwright config |
| `configs/vite.config.ts` | Config | ⚠️ LEGACY | Duplicate of `packages/studio/ui/vite.config.ts` |
| `configs/tsconfig.json` | Config | ⚠️ LEGACY | Duplicate of root `tsconfig.json` |
| `configs/docker-compose.yml` | Config | ❌ BROKEN | Multiple missing files referenced |
| `configs/Dockerfile` | Config | ❌ BROKEN | Wrong paths, missing files |
| `configs/Dockerfile.embedding` | Config | ❌ BROKEN | Missing requirements.txt |
| `configs/pi-adapter-switch.json` | Config | ❌ UNUSED | No code reads this file |
| `configs/production.config.json` | Config | ❌ UNUSED | No code reads this file |
| `scripts/run-all-tests.ts` | Script | ✅ ACTIVE | Referenced by `test:all-integration` |
| `scripts/run-e2e-tests.ts` | Script | ✅ ACTIVE | Referenced by `test`, `test:headed`, etc. |
| `scripts/test-full-pipeline.ts` | Script | ✅ ACTIVE | Referenced by `test:pipeline` |
| `scripts/test-topology-optimizer.ts` | Script | ✅ ACTIVE | Referenced by `test:topology` |
| `scripts/check-boundaries.sh` | Script | ✅ ACTIVE | Referenced by `check:boundaries` |
| `scripts/verify-memorywiki.ts` | Script | ❌ ORPHANED | Exists, not in package.json |
| `scripts/build-wiki.ts` | Script | ❌ ORPHANED | Exists, not in package.json |
| `scripts/migrate-to-sqlite.ts` | Script | ❌ ORPHANED | Exists, not in package.json |
| `scripts/query-wiki.ts` | Script | ❌ ORPHANED | Exists, not in package.json |
| `scripts/test-autonomous-engine.ts` | Script | ❌ ORPHANED | Exists, not in package.json |
| `scripts/test-cross-domain-agents.ts` | Script | ❌ ORPHANED | Exists, not in package.json |
| `scripts/test-full-module-concurrent.ts` | Script | ❌ ORPHANED | Exists, not in package.json |
| `scripts/test-hierarchical-planning.ts` | Script | ❌ ORPHANED | Exists, not in package.json |
| `scripts/test-multi-round.ts` | Script | ❌ ORPHANED | Exists, not in package.json |
| `scripts/test-retriever.ts` | Script | ❌ ORPHANED | Exists, not in package.json |
| `scripts/test-session-error-extractor.ts` | Script | ❌ ORPHANED | Exists, not in package.json |
| `scripts/test-thought-interceptor.ts` | Script | ❌ ORPHANED | Exists, not in package.json |
| `scripts/test-three-layer-interception.ts` | Script | ❌ ORPHANED | Exists, not in package.json |
| `scripts/test-topology-explorer.ts` | Script | ❌ ORPHANED | Exists, not in package.json |
| `tools/` | Directory | ❌ EMPTY | No files |
| `tools-python/embedding-server.py` | Tool | ✅ ACTIVE | Referenced by scripts |
| `.github/workflows/backend-ci.yml` | CI | ✅ ACTIVE | Runs on push/PR |
| `.github/workflows/e2e-tests.yml` | CI | ✅ ACTIVE | Runs on push/PR |

---

## 9. Impact Summary

### 🔴 High Impact (prevents deployment, breaks builds)

| Problem | Affected | 
|---------|----------|
| All Docker files are broken | Deployment via Docker impossible |
| 11 package.json scripts reference missing files | `npm run dev`, `npm run test:matrix`, etc. will fail |
| 3 PM2 ecosystem configs, only 1 works | `pm2 start configs/ecosystem.config.*` with the wrong path will fail |

### 🟡 Medium Impact (confuses developers, wastes time)

| Problem | Affected |
|---------|----------|
| 4 duplicate config groups (8 files) | Developers don't know which config is active |
| 12 orphaned test scripts | ~300KB of test code with no discoverable entry point |
| 2 unused config files (pi-adapter-switch, production.config.json) | Misleading as to how config works |
| Empty `tools/` directory | Suggests missing tooling |

### 🟢 Low Impact (cosmetic or documentation)

| Problem | Affected |
|---------|----------|
| `.eslintrc.cjs` coexists with `eslint.config.js` | Both work, but only one is active |
| `.renovaterc.json` coexists with `.github/renovate.json` | Renovate reads from `.github/` |
| `configs/vite.config.ts` duplicate of `packages/studio/ui/vite.config.ts` | Never imported |

---

## 10. Recommended Actions (Priority Order)

| Priority | Action | Effort | Risk |
|----------|--------|--------|------|
| P0 | Remove 6 broken package.json scripts (verify-kernel-matrix, verify-chaos-injection, verify-rest-endpoints, router-stress, mock-agent-battle, seed-data) | 10 min | Low |
| P0 | Remove `scripts/start.ts` references (dev, dev:no-embed, dev:prod, dev:status, dev:stop) since there's no start script | 10 min | Low |
| P0 | Fix or remove Docker files (Dockerfile references wrong paths, health-check.sh missing, requirements.txt missing) | 2-4 hours | Medium |
| P1 | Remove legacy PM2 configs (`ecosystem.config.cjs`, `ecosystem.config.ts`) | 5 min | Low |
| P1 | Remove legacy config files (`.dependency-cruiser.json`, `.renovaterc.json`, `.eslintrc.cjs`, `configs/tsconfig.json`, `configs/vite.config.ts`) | 10 min | Low |
| P1 | Remove unused configs (`configs/pi-adapter-switch.json`, `configs/production.config.json`, `configs/playwright.config.ts`) | 5 min | Low |
| P2 | Add orphaned test scripts to package.json or remove them | 30 min | Low |
| P2 | Remove empty `tools/` directory | 1 min | Low |
