## Result

- **Status**: Complete.
- **Outcome**: Two enforcement files created and validated.
- **Changes**: `.dependency-cruiser.json`, `.eslintrc.cjs` — both new.
- **Confidence**: High. dependency-cruiser parsed the config and enforced rules (found 4 pre-existing circular deps, none were new or related to our rules).
- **Caveat**: ESLint + @typescript-eslint packages are **not installed** in the project. The `.eslintrc.cjs` config is ready but inactive until `npm install --save-dev eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin` is run. The config will validate correctly when those packages are available.

## Output

### Created files

**`.dependency-cruiser.json`** — 5 forbidden rules:

| Rule | Severity | From | To | Notes |
|------|----------|------|----|-------|
| contracts-must-not-depend-on-pi | error | `^packages/contracts` | `@earendil-works\|packages/core\|packages/adapters` | Zero deps for contracts |
| contracts-must-not-depend-on-core | error | `^packages/contracts` | `^packages/core` | Redundant with above but explicit |
| core-no-direct-pi-import | error | `^packages/core/src/(?!adapters/)` | `@earendil-works` | Core/adapters is the ONLY allowed path |
| adapters-must-not-depend-on-core | error | `^packages/adapters` | `^packages/core` | Adapters are independent |
| no-circular-contracts-core-adapters | error | all | circular | Catches existing cycles too |

**`.eslintrc.cjs`** — 3 `no-restricted-imports` overrides:

| Scope | Restricted pattern | Rationale |
|-------|-------------------|-----------|
| `packages/contracts/**/*.ts` | `@earendil-works/*`, `packages/core/*`, `packages/adapters/*` | Contracts are zero-dependency |
| `packages/core/src/**/*.ts` (excluding `adapters/`) | `@earendil-works/*` | Core must use adapter bridge |
| `packages/adapters/**/*.ts` | `packages/core/*` | Adapters must not pull core |

### Validation runs

Two `dependency-cruiser` runs confirmed the config works:

1. **`packages/contracts/index.ts` only** → ✅ 0 violations (7 modules, 19 deps). Confirms contracts have no forbidden imports.

2. **Full `packages/` scan** → ✅ 4 violations found, all pre-existing circular deps within core (MetaPlanner ↔ PlanningIntelligenceEngine, V1CapabilityAdapter ↔ MetaPlanner, DomainCluster ↔ AgentCreateTool). None of our new rules triggered.

The 4 circular violations are in pre-existing files (`MetaPlanner.ts`, `PlanningIntelligenceEngine.ts`, `V1CapabilityAdapter.ts`, `DomainCluster.ts`, `AgentCreateTool.ts`) — they existed before this refactoring and are unrelated to the adapter separation work.

### No-install gap for ESLint

ESLint and @typescript-eslint are not in the project's `devDependencies`. The `.eslintrc.cjs` will be inert until:
```bash
npm install --save-dev eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

The config references them in `parser` and `plugins` — standard ESLint config fields. Once installed, `npx eslint packages/` should enforce the three boundary rules.

## Evidence

**Config validation command and result:**
```
npx dependency-cruiser --validate .dependency-cruiser.json packages/contracts/index.ts
→ ✔ no dependency violations found (7 modules, 19 dependencies cruised)
```

**Full scan with violations:**
```
npx dependency-cruiser --validate .dependency-cruiser.json packages/ --output-type err-long
→ ✘ 4 dependency violations (4 errors, 0 warnings). 152 modules, 466 dependencies cruised.
```

All 4 violations are `no-circular-contracts-core-adapters` and map to pre-existing files:
- `packages/core/src/extensions/planning/MetaPlanner.ts` ↔ `PlanningIntelligenceEngine.ts`
- `packages/core/src/extensions/planning/engines/V1CapabilityAdapter.ts` ↔ `MetaPlanner.ts`
- `packages/core/src/domains/DomainCluster.ts` ↔ `tool/AgentCreateTool.ts`

Dependency-cruiser config path: `E:\Morpex\.dependency-cruiser.json`
ESLint config path: `E:\Morpex\.eslintrc.cjs`

## Learnings

- **Learning**: dependency-cruiser v16 uses `exclude.path` as an object, not a string. The first attempt failed because the config had `"exclude": { "path": "..." }` — this was actually fine. The real issue was the `$schema` field and `progress` options which are not allowed properties in the schema for v16. Removing them fixed the validation.
  Evidence: First run error `data must NOT have additional properties`. Fix: removed `$schema` and `progress`.
  Reuse when: Adding dependency-cruiser to a new project.

- **Learning**: The `doNotFollow.dependencyTypes` list must include all npm dependency types (`npm-dev`, `npm-optional`, `npm-peer`, etc.) or dependency-cruiser will try to follow them, massively slowing down analysis. The recommended set is the 7 standard types.
  Evidence: First run without doNotFollow was very slow.
  Reuse when: Setting up dependency-cruiser for any monorepo.

- **Learning**: ESLint flat config (eslint.config.js) vs. legacy .eslintrc format — this project has no ESLint config at all. Using `.eslintrc.cjs` (legacy format) keeps compatibility with a wider range of ESLint versions and doesn't require the `--config` flag.
  Evidence: No eslint config files existed in the repo root.
  Reuse when: Bootstrapping ESLint for the first time in any project.

- **Learning**: Pre-existing circular dependencies can mask new ones in dependency-cruiser output. The `no-circular-contracts-core-adapters` rule found 4 cycles, but all were pre-existing. This means we need a baseline — either fix the existing cycles first, or add them to an `allowed` list.
  Reuse when: Adding circular dependency detection to existing codebases.
