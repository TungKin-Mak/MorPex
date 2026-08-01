# MorPex 全功能测试方案（v1）

> 目标：**一条命令可测整个项目的所有功能**，且每项功能都有明确归属的测试用例。
> 基线日期：2026-08-02（master `3b467e6`，AICOS-Core 8 层架构）

---

## 1. 测试基线（现状实测）

| 层 | 命令 | 状态 | 结果 |
|----|------|------|------|
| TypeScript 编译 | `npx tsc --noEmit` | ✅ | 0 错误 |
| 架构对齐校验 | `node scripts/validate-architecture.js` | ✅ | 100%（无违规） |
| Vitest（单元/集成/契约） | `npx vitest run` | ✅ | **35 文件 / 264 测试**（2 skip） |
| 系统套件（脚本式） | `npx tsx tests/run-all.ts` | ✅ | 11/11（arch/unit/integration/scenarios/chaos） |
| API 契约 | vitest 内 `packages/studio/server/__tests__/api-contract.test.ts` | ✅ | 26 测试 / 24+ 端点 |
| Workflow CLI | `npx tsx tests/cli/run-workflow-cli.ts` | ✅ | 11 测试（~45s） |
| 生产检查 | `node scripts/production-check.cjs` | ✅ | 8 步全过 |
| 依赖边界 | `npx depcheck` / dependency-cruiser | ✅ | 无违规 |

### ⚠️ 阻断"一条命令测全部"的断裂引用（已实证）

| # | 断裂点 | 证据 | 影响 |
|---|--------|------|------|
| 1 | `npm run test:e2e` → `packages/core/e2e-test.ts` | 文件不存在 | e2e 命令必失败 |
| 2 | `npm run test:all` → `scripts/run-all-tests.ts` | 其 testScripts 数组只引用 `test-full-pipeline.ts`（不存在） | test:all 必失败 |
| 3 | `.github/workflows/ci.yml` → `tests/e2e/v15-full-cycle.test.ts` | 文件不存在 | CI 必失败 |
| 4 | `.github/workflows/e2e-tests.yml` → `scripts/run-e2e-tests.ts` + `packages/studio/ui` | 两者均不存在（前端已移除，后端仅 API 模式） | workflow 全废 |
| 5 | `docs/testing-guide.md` | 大量引用不存在的 UI/Playwright 配置 | 文档误导 |

---

## 2. 测试分层（金字塔）

```
                  ┌──────────────┐
                  │   E2E/系统    │  ← 跨层闭环：Goal→Mission→Artifact→Evaluation→Evolution
                  │  (tests/run- │     真实服务（cognee 可选）+ mock LLM
                  │   all.ts)    │
               ┌──┴──────────────┴──┐
               │   集成/契约层        │  ← 8 层间握手 + API 契约 + CLI + 事件总线
               │  (vitest: api-     │     跨模块真实装配（内存态，不依赖外部服务）
               │   contract,        │
               │   integration)     │
            ┌──┴────────────────────┴──┐
            │      单元层               │  ← 每层核心组件行为（FSM/DAG/Gate/Guard/控制器）
            │      (vitest:            │     mock EventBus + mock LLM，隔离验证
            │       *_test.ts)         │
         ┌──┴──────────────────────────┴──┐
         │  架构/静态层                    │  ← tsc / validate-architecture / depcheck /
         │  (CI 前置，秒级)                 │     check-boundaries / dependency-cruiser
         └─────────────────────────────────┘

横向切片（贯穿各层）：
  · 混沌/韧性：Agent 崩溃、Tool 失败、恢复（tests/chaos + tests/scenarios/failure-recovery）
  · 性能：k6 负载（scripts/k6-load-test.js，需 k6 环境，CI 可选）
  · 安全：Prompt Injection、沙箱隔离、路径穿越（security-prompt-injection / production-sandbox / connectors）
```

**比例目标**：单元 60% / 集成+契约 25% / 系统+E2E 10% / 架构静态 5%。

---

## 3. 功能覆盖矩阵（10 层 × 功能点 → 测试归属）

> 图例：✅ 已覆盖（文件）｜⚠️ 薄弱（间接/缺失断言）｜❌ 无覆盖

### L1 入口与治理层
| 功能点 | 状态 | 归属测试 |
|--------|------|----------|
| CompanyFacade.executeGoal（mission 模式） | ✅ | `phase0-smoke.test.ts`（19 用例：部门路由+审批策略） |
| CompanyFacade 非 mission 规划模式 | ✅ | `planner-non-mission.test.ts` |
| ControlPlane 装配与部门路由 | ✅ | `phase0-smoke` / `governance-controllers.test.ts` |
| GoalController（目标解析/拆解） | ✅ | `governance-controllers.test.ts` |
| PolicyController（策略热更新） | ✅ | `feature-regression` / `governance-controllers` |
| ResourceController（资源配额） | ✅ | `governance-controllers.test.ts` |
| AgentController（agent 管理） | ⚠️ | 仅 `architecture-audit-fixes` 提及，无行为断言 |
| **EvolutionController（演化提案控制）** | ❌ | 无任何测试引用 |
| **PolicyEngine（13 条策略规则引擎）** | ❌ | 无直接测试（被间接使用） |
| ApprovalGate / 审批门禁 | ✅ | `phase0-smoke`（execute_goal 分级审批） |
| CostController / AlertEngine / AuditTrail | ⚠️ | 无直接测试 |

### L2 Ontology Gate 层
| 功能点 | 状态 | 归属测试 |
|--------|------|----------|
| ForcedQueryGuard（强制先查后推） | ✅ | `bounded-autonomy` / `company-knowledge` / `feature-regression` |
| runOntologyGroundedReasoning（两阶段） | ✅ | `ontology-gate-tiering.test.ts` |
| tier-0/1/2 分级（tier-0 禁缓存） | ✅ | `ontology-gate-tiering.test.ts` |
| QueryMiss 事件→反馈回路 | ✅ | `ontology-gate-tiering` / `company-knowledge` |
| 引用校验（ontologyRefs 可审计） | ⚠️ | 部分覆盖，建议补断言 |

### L3 规划层
| 功能点 | 状态 | 归属测试 |
|--------|------|----------|
| HierarchicalPlanner（HTN 拆解） | ✅ | `v13-planner.test.ts` |
| DeliveryPlanner（交付规划+重规划） | ✅ | `v13-planner` / `brainfacade-facade` / `planner-non-mission` |
| CrossDepartmentArbitrationEngine | ⚠️ | 无独立测试 |
| Plan.ontologyRefs 携带 | ⚠️ | 建议补 |

### L4 认知与大脑层
| 功能点 | 状态 | 归属测试 |
|--------|------|----------|
| BrainFacade（聚合门面） | ✅ | `brainfacade-facade.test.ts`（6 用例） |
| ReflectionEngine（反思） | ✅ | `v13-brain.test.ts` |
| MetaLearner（元学习） | ✅ | `v13-brain.test.ts` |
| LearningLoop / SelfImprovementLoop | ✅ | `learning-loop-impl.test.ts` |
| CrossDepartmentKnowledgeSynthesizer | ⚠️ | 装配存在，无行为测试 |
| PersonalBrain / BrainPersistor（记忆化） | ✅ | `memory-activation` / `unified-memory.spec` |

### L5 执行层
| 功能点 | 状态 | 归属测试 |
|--------|------|----------|
| UnifiedExecutionEngine（迭代/成本上限） | ✅ | `bounded-autonomy.test.ts` |
| SubAgentFork（maxIterations/maxCostTokens） | ✅ | `bounded-autonomy.test.ts` |
| MorPexRuntime（9 Phase FSM） | ⚠️ | 间接（`critical-cognitive-pipeline` 覆盖 pipeline）；无直接 FSM 状态机测试（tests/unit/fsm 是通用 FSM） |
| ExecutionFabric / DependencyCoordinator | ⚠️ | 无直接测试 |
| PersistentMissionStore / ArtifactStore | ✅ | `stage1-persistence`（脚本式）/ `recovery-lifecycle` |

### L6 评价层
| 功能点 | 状态 | 归属测试 |
|--------|------|----------|
| **EvaluationEngine（5 维评分）** | ❌ | 无直接测试 |
| QualityScorer / ontologyCompliance 维度 | ❌ | 无直接测试 |
| ComplianceChecker | ⚠️ | 无直接测试 |

### L7 知识与记忆层
| 功能点 | 状态 | 归属测试 |
|--------|------|----------|
| SystemMetadataGraph（8 实体×10 关系） | ✅ | `company-knowledge` / `feature-regression` |
| KnowledgeGraph SQLite 持久化 | ✅ | `knowledgegraph-sqlite.test.ts`（4 用例） |
| OntologyService（query/upsert/ensureRelation） | ✅ | `ontology-gate-tiering` / `company-knowledge` |
| MemoryAPI（统一记忆层，白名单/确认队列） | ✅ | `unified-memory.spec.ts`（8 用例） |
| MemoryApiBus / MemoryActivationEngine | ✅ | `memory-activation.test.ts` |
| Cognee 引擎（HTTP 适配器） | ⚠️ | mock 覆盖；真实联调需外部服务（降级跳过） |
| ArtifactFacade / ArtifactBlueprint | ⚠️ | `artifact-lifecycle`（脚本式）存在但未纳入 vitest |
| UnifiedEventStore（追加写/回放） | ✅ | `unified-eventstore`（脚本式）+ `eventbus-idempotency` |

### L8 演化层
| 功能点 | 状态 | 归属测试 |
|--------|------|----------|
| EvolutionSandbox（沙箱试跑） | ✅ | `evolution-closed-loop.test.ts` |
| apply/revert/verify 自动回滚 | ✅ | `evolution-closed-loop.test.ts`（8 用例：幂等/补偿） |
| ExperienceMiner / FailureAnalyzer | ✅ | `evolution-closed-loop` |
| PatternExtractor / PatternMigrationEngine | ⚠️ | 无直接测试 |
| ActiveEvolutionTrigger / KnowledgeGapListener | ⚠️ | 无直接测试 |

### L9 Workflow 插件层
| 功能点 | 状态 | 归属测试 |
|--------|------|----------|
| 4 provider 加载（xjmcu/ecommerce/hardware/software） | ✅ | `workflow-plugins.test.ts`（3 用例） |
| mock 降级（凭证缺失时） | ✅ | `workflow-plugins.test.ts` |
| 领域动作（amazon 上架/firmware 编译等真实逻辑） | ⚠️ | 环境就绪才生效，建议加"环境探测+降级"测试 |

### L10 基础设施层
| 功能点 | 状态 | 归属测试 |
|--------|------|----------|
| EventBus（at-least-once + 消费幂等） | ✅ | `eventbus-idempotency.test.ts`（10 用例） |
| ConnectorRegistry（注册/权限/隔离） | ✅ | `packages/connectors/__tests__/connectors.test.ts`（13 用例） |
| FileSystemConnector（路径穿越防护） | ✅ | 同上 |
| ShellConnector（安全命令） | ✅ | 同上 |
| 可观测性（exercise-all 72 模块 / coverage-engine） | ✅ | 启动时自动演练（`exercise-all.ts`） |
| 模拟层 simulation（7 组件） | ✅ | `simulation/__tests__/`（7 文件） |
| 验证层 verification（6 组件） | ✅ | `verification/__tests__/`（6 文件） |

### 接口面
| 接口 | 状态 | 归属测试 |
|------|------|----------|
| StudioServer REST API（24+ 端点） | ✅ | `api-contract.test.ts`（26 测试：可达性+结构） |
| RuntimeAPI（runtime/artifacts/memory/learning） | ✅ | 同上 |
| SSE 流（/api/stream/global、/api/events/stream） | ⚠️ | 契约测试仅验证端点存在；**无真实 SSE 推送/事件流断言** |
| /api/execute 真实执行链 | ⚠️ | 契约测试为轻量调用；无"执行→artifact→评估"闭环断言 |
| Workflow CLI（10 子命令） | ✅ | `tests/cli/run-workflow-cli.ts`（11 测试） |
| 记忆引擎 cognee（真实 HTTP） | ⚠️ | 需 `scripts/run-all.sh` 起服务；降级时跳过 |

---

## 4. 统一执行方案（一条命令测全部）

### 4.1 入口设计（建议新增 `scripts/run-tests.ts` 作为唯一总入口）

```bash
npx tsx scripts/run-tests.ts                  # 全部（默认快速档：跳过 k6/真实 cognee）
npx tsx scripts/run-tests.ts --full           # 全量（含 k6、真实 cognee、生产脚本式）
npx tsx scripts/run-tests.ts --layer=unit     # 单层
npx tsx scripts/run-tests.ts --skip-tsc       # 跳过编译检查（迭代用）
```

### 4.2 执行编排（顺序 = 依赖关系）

| 阶段 | 内容 | 命令 | 超时 | 失败即停 |
|------|------|------|------|:---:|
| 0 前置 | tsc 编译检查 | `npx tsc --noEmit` | 60s | ✅ |
| 0 前置 | 架构校验 | `node scripts/validate-architecture.js` | 30s | ✅ |
| 0 前置 | 依赖边界 | `npx depcheck` + `dependency-cruiser` | 60s | ✅ |
| 1 单元 | vitest 全量 | `npx vitest run` | 180s | 否（继续收集） |
| 2 系统 | 系统套件 | `npx tsx tests/run-all.ts` | 180s | 否 |
| 3 CLI | CLI 契约 | `npx tsx tests/cli/run-workflow-cli.ts` | 120s | 否 |
| 4 生产 | 脚本式生产测试（8 个 production/critical） | `npx tsx scripts/run-all-production-tests.ts --skip-tsc --quick` | 300s | 否 |
| 5 混沌 | chaos 套件（已在 2 中） | — | — | — |
| 6 性能 | k6 负载（仅 --full） | `bash scripts/run-k6-test.sh --smoke` | 300s | 否 |
| 7 真实记忆 | cognee 真实链路（仅 --full，探测 8001） | `scripts/run-all.sh` + 探测脚本 | 120s | 否（探测失败→skip 并报告） |

### 4.3 测试数据隔离

- **vitest / 契约测试**：内存态或 `data/test-*` 临时目录，结束即清；不污染 `data/mirror`、`data/artifacts.db` 等生产数据。
- **系统套件**：已有 `--keep` 参数控制是否保留测试数据（`tests/run-all.ts` 写 `data/system-health-report.*`）。
- **CLI 测试**：使用临时工作目录 + 隔离的 workflow 注册表。
- **生产脚本式测试**：已有 mock LLM/内存态约定，无需外部服务。
- 约定：**任何测试不得写入 `data/` 根级生产文件**，统一写入 `data/test-output/`（gitignore）。

### 4.4 外部依赖降级策略

| 依赖 | 探测 | 不可用时的行为 |
|------|------|----------------|
| cognee (:8001) | HTTP GET /health | 记忆真实链路 skip，输出 "⚠️ SKIPPED: cognee 未启动（npx tsx scripts/start.ts）" |
| LLM API key | 环境变量探测 | 一律 mock LLM（项目已有约定），永不在测试中真调 LLM |
| k6 | `which k6` | skip 并提示 |
| 领域工具链（buildcli 等） | 环境探测 | 降级为"插件加载+mock 动作"断言 |

---

## 5. CI 接线修复方案（让 CI 也能跑"全部"）

| 断裂点 | 修复动作 |
|--------|----------|
| `package.json` test:e2e | 改为 `npx tsx tests/cli/run-workflow-cli.ts`（真实存在的 e2e 级 CLI 测试），或指向新总入口 |
| `scripts/run-all-tests.ts` | 重写为调用统一入口 `scripts/run-tests.ts`（当前 testScripts 引用不存在的文件） |
| `ci.yml` v15-full-cycle 步骤 | 移除或替换为 `npx tsx tests/run-all.ts` |
| `e2e-tests.yml` | **整文件删除或重写**为"后端 API 契约 + CLI"流水线（UI 已不存在，Playwright 无对象可测） |
| `docs/testing-guide.md` | 标注"UI 已移除，仅保留 API/CLI 部分"，或归档至 `docs/_archive/` |
| `architecture-check.yml` production-check `|| true` | 去掉 `|| true`（8/8 已稳定，失败应真正红） |

---

## 6. 覆盖度量（落地指标）

| 指标 | 采集方式 | 当前 | 目标 |
|------|----------|------|------|
| 层覆盖（10 层有测试归属） | 矩阵人工核对（§3） | L6 ❌、L1 部分 ❌ | 10/10 层 ✅ |
| 组件级引用覆盖 | grep 测试文件引用核心模块 | 32 核心组件 7 个 ❌ / 8 个 ⚠️ | ❌→0，⚠️→≤3 |
| 测试数 | vitest | 264 | ≥400 |
| 用例通过率 | 统一入口报告 | 100% | ≥98% |
| 架构违规 | validate-architecture | 0 | 0 |
| 静态错误 | tsc | 0 | 0 |

每次运行统一入口后生成 `data/test-output/test-report.{json,txt}`，含各层通过率 + skip 原因 + 耗时，可对接 CI 产物。

---

## 7. 测试建设路线图

### 🔴 P0（立即可做，打通"一条命令"）
1. 新建 `scripts/run-tests.ts` 统一入口（§4 编排）
2. 修复 4 处断裂引用（§5：package.json / run-all-tests.ts / ci.yml / e2e-tests.yml）
3. 归档过期 `docs/testing-guide.md`
4. 测试数据目录 `data/test-output/` 加入 .gitignore

### 🟡 P1（补齐缺口，达到"所有功能可测"）
5. **EvaluationEngine 5 维评分测试**（L6 唯一全空层，最高优先）
6. **EvolutionController + PolicyEngine 测试**（L1 两个 ❌ 组件）
7. **ArtifactFacade / MorPexRuntime FSM 状态机直接测试**（转正脚本式测试或补 vitest）
8. **SSE 流真实推送测试**（事件流断言，补 api-contract 只验端点的空洞）
9. **/api/execute 闭环测试**（execute→artifact→评估 断言）
10. 补 ⚠️ 组件：CrossDepartmentKnowledgeSynthesizer / ExecutionFabric / PatternMigrationEngine / ActiveEvolutionTrigger

### 🟢 P2（增强与自动化）
11. k6 负载测试纳入 --full 档 + CI 可选 job
12. cognee 真实链路测试纳入 --full 档
13. 覆盖率报告接入（c8/v8 provider），CI 产物展示
14. 领域插件真实工具链测试（环境探测驱动）
15. 混沌注入扩展：EventBus 消费者崩溃、存储写满、并发 TOCTOU

---

## 8. 验收标准（Definition of Done）

- [ ] `npx tsx scripts/run-tests.ts` 一键跑完，退出码 0 或明确列出 skip 原因
- [ ] 10 层覆盖矩阵全部 ✅ 或 ⚠️（无 ❌）
- [ ] 所有 npm scripts 无断裂引用（`npm run` 列出的每条命令都有真实目标）
- [ ] CI 三个 workflow 全部真实可运行（不再引用不存在的文件）
- [ ] 每次运行产出 `data/test-output/test-report.json`（层通过率+耗时+skip 原因）
- [ ] tsc 0 错误 + 架构 0 违规 + vitest ≥98% 通过

---

## 9. 运行速查

```bash
# 开发迭代（快）
npx vitest run

# 完整全功能（推荐）
npx tsx scripts/run-tests.ts

# 全量（含 k6 / 真实 cognee）
npx tsx scripts/run-tests.ts --full

# 生产就绪检查
node scripts/production-check.cjs
```
