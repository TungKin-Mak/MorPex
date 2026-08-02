# MorPex 全功能测试方案（v1）

> 目标：**一条命令可测整个项目的所有功能**，且每项功能都有明确归属的测试用例。
> 基线日期：2026-08-02（master `3b467e6`，AICOS-Core 8 层架构）

---

## 1. 测试基线（现状实测）

| 层 | 命令 | 状态 | 结果 |
|----|------|------|------|
| TypeScript 编译 | `npx tsc --noEmit` | ✅ | 0 错误 |
| 架构对齐校验 | `node scripts/validate-architecture.js` | ✅ | 100%（无违规） |
| Vitest（单元/集成/契约） | `npx vitest run` | ✅ | **38 文件 / 350 测试**（2 skip） |
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
| **EvolutionController（演化提案控制）** | ✅ | `policy-engine.test.ts`（孪生集成/策略模拟/分析/观测） |
| **PolicyEngine（13 条策略规则引擎）** | ✅ | `policy-engine.test.ts`（默认规则优先级/workflow 策略/agent 策略/execute 副作用，25 用例） |
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
| CrossDepartmentKnowledgeSynthesizer | ✅ | `synthesizer-fabric.test.ts`（依赖注入/跨部门融合/模式迁移/事件，10 用例） |
| PersonalBrain / BrainPersistor（记忆化） | ✅ | `memory-activation` / `unified-memory.spec` |

### L5 执行层
| 功能点 | 状态 | 归属测试 |
|--------|------|----------|
| UnifiedExecutionEngine（迭代/成本上限） | ✅ | `bounded-autonomy.test.ts` |
| SubAgentFork（maxIterations/maxCostTokens） | ✅ | `bounded-autonomy.test.ts` |
| MorPexRuntime（9 Phase FSM） | ✅ | `morpex-runtime.test.ts`（stub engine 闭环：Pipeline→Simulation→Engine→Artifact→Verification→Mission COMPLETED）+ `execution-fsm.test.ts`（ExecutionFSM 状态机直接测试） |
| ExecutionFabric / DependencyCoordinator | ✅ | `synthesizer-fabric.test.ts`（能力注册/解析执行/覆盖/重试/agentId 直连，8 用例） |
| PersistentMissionStore / ArtifactStore | ✅ | `stage1-persistence`（脚本式）/ `recovery-lifecycle` |

### L6 评价层
| 功能点 | 状态 | 归属测试 |
|--------|------|----------|
| **EvaluationEngine（5 维评分）** | ✅ | `evaluation-matrix.test.ts`（聚合/决策/硬门禁） |
| QualityScorer / ontologyCompliance 维度 | ✅ | `evaluation-matrix.test.ts`（加权/边界/合规评分） |
| SafetyMonitor（安全阈值监控） | ✅ | `evaluation-matrix.test.ts`（默认/自定义阈值+EventBus 广播） |
| **OrganizationTwin（4 角色孪生）** | ✅ | `organization-twin.test.ts`（角色装配/审批逻辑/上市投票） |
| **DomainPrimitiveRegistry + 5 原语** | ✅ | `primitives-registry.test.ts`（热注册/匹配/执行注入/白名单/部门隔离） |
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
| ArtifactFacade / ArtifactBlueprint | ✅ | `artifact-facade.test.ts`（产物状态机 VALID_TRANSITIONS + Blueprint 依赖编排，15 用例） |
| UnifiedEventStore（追加写/回放） | ✅ | `unified-eventstore`（脚本式）+ `eventbus-idempotency` |

### L8 演化层
| 功能点 | 状态 | 归属测试 |
|--------|------|----------|
| EvolutionSandbox（沙箱试跑） | ✅ | `evolution-closed-loop.test.ts` |
| apply/revert/verify 自动回滚 | ✅ | `evolution-closed-loop.test.ts`（8 用例：幂等/补偿） |
| ExperienceMiner / FailureAnalyzer | ✅ | `evolution-closed-loop` |
| PatternExtractor / PatternMigrationEngine | ✅ | `evolution-closed-loop`（接线）+ `synthesizer-fabric.test.ts`（migratePattern adapted/partial/failed） |
| ActiveEvolutionTrigger / KnowledgeGapListener | ✅ | `evolution-closed-loop.test.ts`（连续失败触发 + 配置阈值） |

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
| SSE 流（/api/stream/global、/api/events/stream） | ✅ | `sse-execute-e2e.test.ts`（真实建连 + connected 首帧 + 执行事件实时推送断言） |
| /api/execute 真实执行链 | ✅ | `sse-execute-e2e.test.ts`（execute→SSE 事件流闭环）+ `morpex-runtime.test.ts`（execute→artifact→评估） |
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
| 测试数 | vitest | 566 | ≥580 |
| 用例通过率 | 统一入口报告 | 100% | ≥98% |
| 行覆盖 | `npx vitest run --coverage` | 37.23% | ≥38%（S30-S33 四轮补测达 37.2%+，持续提升） |
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
- [x] ~~**EvaluationEngine 5 维评分测试**~~ ✅（`evaluation-matrix.test.ts`：QualityScorer 加权/decide 边界/EvaluationEngine 聚合/Ontology 硬门禁/SafetyMonitor 阈值，26 用例）
- [x] ~~**primitives 原语注册表**~~ ✅（`primitives-registry.test.ts`：DomainPrimitiveRegistry 热注册/匹配/统计 + 5 原语执行注入/白名单/部门隔离，40 用例）
- [x] ~~**OrganizationTwin 4 角色**~~ ✅（`organization-twin.test.ts`：角色装配/simulateDecision 审批/上市投票，20 用例）
- [x] ~~**ArtifactFacade / MorPexRuntime FSM 状态机直接测试**~~ ✅（`artifact-facade.test.ts`：产物生命周期状态机 VALID_TRANSITIONS + Blueprint 依赖编排 + 事件广播，15 用例；`execution-fsm.test.ts`：ExecutionFSM 合法/非法转换 + 回调审计 + 持久化恢复，15 用例；`morpex-runtime.test.ts`：run() 9 阶段闭环 execute→artifact→verification→mission COMPLETED，5 用例）
- [x] ~~**SSE 流真实推送测试**~~ ✅（`sse-execute-e2e.test.ts`：建连收 connected 首帧 + POST /api/execute 触发后 SSE 实时收到 execution.engine.started，含竞态防护——先等订阅就绪再触发）
- [x] ~~**/api/execute 闭环测试**~~ ✅（`sse-execute-e2e.test.ts` HTTP 执行→事件流透传 + `morpex-runtime.test.ts` execute→artifact→评估 全链路）
- [x] ~~**EvolutionController + PolicyEngine 测试**~~ ✅（`policy-engine.test.ts`：默认规则优先级/自定义规则/execute 副作用/workflow+agent 策略/EvolutionController 集成，25 用例）
- [x] ~~**补 ⚠️ 组件**~~ ✅（`synthesizer-fabric.test.ts`：CrossDepartmentKnowledgeSynthesizer 融合+迁移 10 用例 + ExecutionFabric 能力/重试 8 用例；PatternMigrationEngine/ActiveEvolutionTrigger 已由 evolution-closed-loop 覆盖）

### 🟢 P2（增强与自动化）
- [x] ~~**k6 负载测试纳入 --full 档 + CI 可选 job**~~ ✅（`scripts/k6-smoke.js` 针对真实端点 :8080 只读冒烟 + `run-k6-test.sh --smoke` 校准端口/脚本选择 + CI k6-smoke job（Docker））
- [x] ~~**覆盖率报告接入（c8/v8 provider），CI 产物展示**~~ ✅（`@vitest/coverage-v8` + vitest.config coverage 配置（阈值 25/20/24/27 防回退）+ `npm run test:coverage` + runner `--with-coverage` 阶段 + CI coverage job 上传报告）
- [x] ~~**cognee 真实链路测试纳入 --full 档**~~ ✅（`cognee-integration.spec.ts`：探活离线安全跳过 + COGNEE_E2E=1 时执行真实 write→recall→search→防幻觉，4 用例；`npm run test:cognee` / runner `--e2e` 触发；**已实测 4/4 全过**——本机 cognee 1.4.0 在线验证 remember ok:true + 语义召回命中 899 元事实）
- [x] ~~**security-middleware 认证用例**~~ ✅（`packages/studio/server/__tests__/security-middleware.test.ts`：API Key 认证/安全头/CORS/速率限制/输入校验/应用注册，17 用例）
12. cognee 真实链路测试纳入 --full 档
- [x] ~~**领域插件真实工具链测试（环境探测驱动）**~~ ✅（`plugin-toolchain.test.ts`：vi.mock child_process 模拟 buildcli 缺失 → xjmcu compile 优雅降级 / pipeline 部分降级 / generate 纯 fs 真实产出，7 用例）
- [x] ~~**混沌注入扩展**~~ ✅（`chaos-concurrency.test.ts`：EventBus 崩溃韧性 4 用例 + EvolutionSandbox TOCTOU 并发守卫 2 用例；`storage-resilience.spec.ts`：JSONLWriter 存储写满重试/丢弃 + LogRotator 轮转/防并发/清理 9 用例）

## 10. 架构可观测（S34 新增 — 落地要求：所有功能模块可观测、流程可溯源、绕过可检测）

### 问题（此前观测面是空壳）
- `/api/observability/audit` **503**（ArchitectureAuditor 从未初始化）
- `/heartbeats` 全部 `status:unknown`（模块声明但运行时从不心跳）
- `/observations`、`/topology`、`/modules-v2` 全空（ObservationCollector 从未接入真实运行时）

### 修复（`observability/runtime-bridge.ts` + StudioServer 接线）
| 能力 | 端点 | 接线后 |
|------|------|--------|
| 运行流程 | `/observations` `/span-tree/:taskId` `/topology` | 真实执行 → 带层标注（L1-L10）的调用链 |
| 每层模块健康 | `/modules-v2` `/heartbeats` `/exercise-status` | 实际执行模块 → `online/ACTIVE/exercised` |
| 绕过检测 | `/audit` | ArchitectureAuditor 活：报告 `REQUIRED_MODULE_NEVER_CALLED` 等 |
| 回放 | `/replay/*` | ReplayEngine 已接线 |

### 验证（`observability-bridge.test.ts`，7 用例）
- /audit 200（不再 503）+ 报告含 findings（绕过检测真实输出）
- POST /api/execute 真实执行 → observations 记录 L5-execution 调用链 + executionId 可查
- span-tree 含 parentId 父子链（首 span 为根）
- modules-v2 显示 executed 模块 online/ACTIVE/exercised + callCount
- /audit 检测到绕过：直连 execute 未走治理层 → `REQUIRED_MODULE_NEVER_CALLED`

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
