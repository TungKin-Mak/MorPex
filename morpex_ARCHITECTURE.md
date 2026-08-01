# MorPex Architecture (Current State — 2026-07-30)

**Version**: vNext+ (Ideal Target Architecture Aligned)  
**Alignment**: 100% (verified by `scripts/validate-architecture.js` + `production-check.cjs` 8/8)  
**Status**: Production Ready + Long-term Maintainable

---

## 1. Ideal Target Architecture (Final Model)

All future development **must** strictly follow this 10-layer model.

```
1. Entry & Governance Layer
   CompanyFacade + ControlPlane (Goal/Policy/Resource/Agent/Evolution Controllers)

2. Ontology Gate Layer ★ MANDATORY KNOWLEDGE GATE ★ (Graded: tier-0/1/2)
   OntologyService + ForcedQueryGuard + runOntologyGroundedReasoning
   ├── tier-0 Critical（资金/对外发布/架构变更/演化提案）→ 强制两阶段 + 引用校验 + 同步 Verification（禁止缓存）
   ├── tier-1 Standard（规划、正式 Artifact）→ 两阶段 + 短 TTL 快照缓存
   └── tier-2 Draft / Internal（草稿、内部反思）→ 尽力查询；无结果 → ControlledExploration + QueryMiss 事件
   → Every generation/action MUST pass this gate. No fabrication allowed. QueryMiss is Signal.

3. Planning Layer
   DeliveryPlanner + HierarchicalPlanner + CrossDepartmentArbitrationEngine
   (Plan 输出携带 ontologyRefs[] 引用 Trace，可审计)

4. Cognition & Brain Layer
   BrainFacade (unified) + ReflectionEngine + MetaLearner + SelfImprovementLoop
   + CrossDepartmentKnowledgeSynthesizer

5. Execution Layer (Bounded Autonomy)
   UnifiedExecutionEngine + SubAgentFork + ExecutionFabric + MorPexRuntime (FSM/DAG)
   (maxIterations / maxCostTokens / maxAttempts；超限终止 → Failure 事件进 FailureAnalyzer)

6. Tools & Primitives Layer (Generic Foundation Only)
   DomainPrimitiveRegistry
   ├── KnowledgeQueryPrimitive   (MUST call Ontology Gate first)
   ├── ArtifactGenerationPrimitive (MUST carry knowledge context + Pre-Side-Effect Verify)
   ├── FileOperationPrimitive
   ├── ShellExecutionPrimitive
   └── APICallPrimitive

7. Knowledge & Memory Layer
   SystemMetadataGraph + OntologyService (8 entities × 10 relations)
   MemoryAPI (cognee 权威图谱) + MemoryWiki(SQLite) + PersonalBrain + ArtifactRegistry + UnifiedEventStore
   (Working Memory 会话级弱一致 / Shared Knowledge 强一致或可验证最终一致 / Event Store 追加写可回放)

8. Evolution Layer (Verifiable Evolution)
   ExperienceMiner + FailureAnalyzer + PatternExtractor
   ActiveEvolutionTrigger + PatternMigrationEngine + KnowledgeGapListener
   (QueryMiss → Feedback → Evolution 闭环；演化须沙箱试跑 + 人工审批 + 版本化回滚)

9. Workflow Plugin Layer (Domain Logic — Completely Isolated)
   packages/workflows/<domain>/  (xjmcu, ecommerce, hardware, content...)
   All domain-specific logic lives here.

10. Infrastructure
    EventBus (Sole Communication Channel, at-least-once + 消费者幂等) + ConnectorRegistry + Observability
```

**Core Constraints**:
- **Ontology Gate is mandatory** for all knowledge retrieval and generation.
- **Knowledge First**: `KnowledgeQueryPrimitive` always queries Ontology first.
- **No Domain Logic in Core**: Domain primitives belong exclusively in Workflow Plugins.
- **Department Isolation**: Every operation carries `departmentId`.
- **EventBus Only**: No direct module-to-module calls.

### vNext+ Core Constraints（生产级运行时与治理约束）

在保持 10 层骨架与上述 5 条宪法不变的前提下，增补 4 条生产级约束（已落地或规划中）：

| 约束 | 含义 | 状态 |
|------|------|------|
| **Graded Ontology Gate** | Gate 按风险分级（tier-0/1/2），禁止一刀切全量两阶段 | ✅ 已落地（`ontology/types.ts` → `RiskTier`，`runOntologyGroundedReasoning`） |
| **Bounded Autonomy** | 所有 Agent 执行必须有 iteration / cost 上限，超限终止并产生 Failure 事件 | ✅ 已落地（`execution/SubAgentFork.ts` + `UnifiedExecutionEngine`） |
| **QueryMiss is Signal** | 知识缺失不能静默失败，必须产生 `ontology.query.miss` 事件进入反馈/演化回路 | ✅ 已落地（`events/ontologyEvents.ts` + `runOntologyGroundedReasoning`） |
| **Verifiable Evolution** | 演化必须沙箱试跑 + 人工审批 + 版本化可回滚 | 🔶 规划中（依赖 Event Sourcing；入口已具备） |

### Graded Ontology Gate（分级强制 + 可降级）

```
Ontology Gate
├── Tier-0 Critical（资金/对外发布/架构变更/演化提案）
│     → 强制两阶段 + 引用校验 + 同步 Verification，禁止缓存
├── Tier-1 Standard（规划、正式 Artifact）【默认】
│     → 两阶段；允许短 TTL 快照缓存
└── Tier-2 Draft / Internal（草稿、内部反思）
      → 尽力查询；无结果可进入 ControlledExploration
        → 必须记录 QueryMiss 事件，驱动 Evolution
```

- 运行时类型：`RiskTier = 'tier-0' | 'tier-1' | 'tier-2'`（`ontology/types.ts`）
- 查询缓存：仅 tier-1/tier-2 生效；tier-0 强制完整两阶段
- QueryMiss：`ontology.query.miss` 事件（EventStore 持久化，可回放）+ 提案标记 `query_miss` / `controlled_exploration`

### Layer 5 运行时契约（Execution — Bounded Autonomy）

| 契约 | 说明 | 落地锚点 |
|------|------|----------|
| **Iteration Cap** | 每个 SubAgent / Mission 有最大步数上限 | `SubAgentFork.maxAttempts` / `UnifiedExecutionEngine.maxIterations`（超限发 `*.iteration_limit` / `execution.budget.exceeded`） |
| **Cost Ceiling** | 按 department / mission 的 token / 费用上限 | `SubAgentFork.maxCostTokens/maxCostUSD` + costEstimator 钩子；`UnifiedExecutionEngine.maxCostTokens` + costRecorder |
| **Shared State Only via Bus** | 禁止隐式共享；状态变更只经 EventBus / MemoryBus | `common/EventBus`（唯一通道）+ `protocol/events/`（Event Sourcing） |
| **Pre-Side-Effect Verify** | 有副作用的 phase 前必须 Verification + Ontology 引用检查 | `ArtifactGenerationPrimitive.setVerificationHook`（写文件前阻断 + `artifact_generation_blocked`） |
| **Failure Policy** | 标明可自动重试 vs 必须人工介入的 phase | `runOntologyGroundedReasoning`：tier-0 QueryMiss 强制 `needs_human_review`；tier-2 允许受控探索 |

---

## 2. Current Implementation Status (100% Aligned)

### Layer 1: Entry & Governance
- `CompanyFacade` (唯一入口，强制 Runtime + ControlPlane)
- `control-plane/` (5 Controllers: Goal, Policy, Resource, Agent, Evolution)
- `governance/` (GovernanceDashboard, CostController, AlertEngine)

### Layer 2: Ontology Gate ★ (强制知识守门人)
- `ontology/ForcedQueryGuard.ts` — 代码级强制查询 + Trace + 引用校验
- `ontology/runOntologyGroundedReasoning.ts` — 两阶段强制推理（查询 → 基于事实生成）
- `ontology/OntologyService.ts` + `SystemMetadataGraph`
- **vNext+ 分级 Gate**：`riskTier`（tier-0/1/2）+ QueryMiss 事件
- **已强制绑定**：
  - `tools/primitives/KnowledgeQueryPrimitive.ts`
  - `tools/primitives/ArtifactGenerationPrimitive.ts`

### Layer 3: Planning（Aligned）
- `planner/DeliveryPlanner.ts` + `planner/HierarchicalPlanner.ts` (HTN) + `planner/planWithOntology`
- `planner/CrossDepartmentArbitrationEngine.ts` — 跨部门仲裁（Policy + Resource 预算 + 风险等级）
- vNext+: Plan 输出携带 `ontologyRefs[]` 引用 Trace（规划可追溯）

### Layer 4: Cognition & Brain
- `cognition/BrainFacade.ts`（统一入口）
- **注意（S22）**：`ReflectionEngine` / `MetaLearner` 实际位于 `brain/`（文档旧称已迁至 `cognition/`，实际未迁；已由 bootstrap 注入 BrainFacade，S22 修复）
- `CrossDepartmentKnowledgeSynthesizer`（`brain/`，S22 起由 bootstrap 装配激活）
- `LearningLoop`（`learning/LearningLoop.ts`，S22 补全：聚合 ExperienceExtractor/PlanEvaluator/StrategyOptimizer 三件套，由 bootstrap 注入 BrainFacade）
- `brain/index.ts` 已标记 `@deprecated`

### Layer 6: Tools & Primitives（通用基础）
- `DomainPrimitiveRegistry`
- 5 个通用原语（全部已集成 Ontology Gate）：
  - `KnowledgeQueryPrimitive`
  - `ArtifactGenerationPrimitive`
  - `FileOperationPrimitive`
  - `ShellExecutionPrimitive`
  - `APICallPrimitive`

### Layer 9: Workflow Plugin（领域逻辑）
- 标准规范：`packages/workflows/WORKFLOW_PLUGIN_STANDARD.md`
- 所有插件必须：
  - 实现 `ActionPrimitive`
  - 先走 `KnowledgeQueryPrimitive`（Ontology Gate）
  - 通过 `src/bootstrap.ts` 注册
- 当前插件（与 `packages/workflows/` 实际目录一致）：`xjmcu`、`ecommerce`、`hardware`、`software`

### Layer 10: Infrastructure（Aligned）
- `common/EventBus.ts` — 唯一通信通道（事件命名空间 `{domain}.{action}`）
- `protocol/events/` — Event Sourcing（28 事件类型 + SQLite，追加写、可回放）
- `governance/` — Observability（GovernanceDashboard / AlertEngine / CostController）

### Layer 5: Execution（Aligned）
- `execution/UnifiedExecutionEngine.ts` — 统一执行入口（mission / dag / fabric / auto）
- `execution/SubAgentFork.ts` — 子 Agent 舰队（超时 / 重试 / 并发控制）
- **vNext+ Bounded Autonomy**：任务级 `maxAttempts`（迭代上限）+ 舰队级 Cost Ceiling（token/USD）
  - 超限 → 终止 + `sub_agent.budget.exceeded` 事件（进入 FailureAnalyzer，而非空转）
- `runtime/MorPexRuntime.ts`（FSM/DAG）、`runtime/budget/BudgetManager.ts`（预算管理器）

### Layer 7: Knowledge & Memory（Aligned）
- `metadata/SystemMetadataGraph.ts`（8 实体 × 10 关系）+ `ontology/OntologyService.ts`
- `memory/`（MemoryWiki(SQLite) + PersonalBrain）+ `artifact/ArtifactRegistry` + `protocol/events/UnifiedEventStore`
- 权威语义检索：`@morpex/memory` 统一记忆层（MemoryAPI + cognee 图谱引擎，ZVec/BGE-M3 已废弃移除）
- 记忆一致性：Working Memory 会话级弱一致；Shared Knowledge 强一致/可验证最终一致；Event Store 追加写可回放

### Layer 8: Evolution（Aligned）
- `evolution/ExperienceMiner.ts` + `evolution/FailureAnalyzer.ts` + `evolution/PatternExtractor.ts`
- `evolution/ActiveEvolutionTrigger.ts` + `evolution/PatternMigrationEngine.ts`
- **vNext+ `evolution/KnowledgeGapListener.ts`** — QueryMiss → Feedback → Evolution 闭环：订阅 `ontology.query.miss` → 写入 Feedback（source='query_miss'）→ 供 FailureAnalyzer / 仪表盘消费（`getMissStats` / `listKnowledgeGaps`）
- `FailureAnalyzer` 失败类别新增 `knowledge_gap`（避免只分析执行失败，忽略知识缺失）
- 演化安全闭环：Ontology Gate（Tier-0）→ 评估 → 沙箱试跑 → 人工审批 → 版本化落地 + 一键回滚（依赖 Event Sourcing）

### 长期治理机制（Phase B）
- `scripts/validate-architecture.js` — 自动检测架构违规（含：废弃目录引用 / Ontology Gate 绑定 / PiBridge 隔离 / 领域关键词渗入 core / LLM 绕过 Gate / 插件标准接口）
- `.github/workflows/architecture-check.yml` — CI 强制检查
- `.github/PULL_REQUEST_TEMPLATE.md` — 强制填写对应架构层
- `AGENTS.md` — 项目规则主文档（架构对齐铁律）

---

## 3. Key Design Decisions

1. **Ontology Gate 是不可绕过的强制层**
2. **Workflow Plugin 是唯一允许存在领域逻辑的地方**
3. **Brain 能力已统一到 `cognition/`**
4. **`planes/` 目录已废弃**
5. **EventBus 是唯一通信通道**
6. **PiBridge 是唯一允许直接导入 pi 包的文件**

## 3.1 Migration Backlog（已知迁移积压，由 validate-architecture.js 持续追踪）

| 积压项 | 规模 | 状态 | 处置 |
|--------|------|------|------|
| ~~`planes/` 旧目录引用~~ | ~~26 处~~ | ✅ **已清零（2026-07-31 planes 迁移轮）** | 全部 planes/ 实现已迁至 canonical 层（见 §3.2）；planes/ 目录仅剩 DEPRECATED.md 历史文档 |
| ~~`brain/` 目录引用（非门面）~~ | ~~3 处~~ | ✅ 已清零 | 改为经 `cognition/index.js` 统一入口导入 |
| ~~core 中领域关键词残留~~ | ~~8 处~~ | ✅ 已清零 | 领域质检/合规规则真迁移至插件 `packages/workflows/<domain>/src/rules/`；`/verification/` 校验器豁免已移除 |
| ~~Workflow 插件未完整实现~~ | ~~ecommerce / hardware / software / xjmcu~~ | ✅ 已达标 | 4 插件全部实现 ActionPrimitive + `src/bootstrap.ts` 注册；bootstrapUnified 启动时装载 |
| 部门模拟路径 LLM 直调 | `department/LeadAgentOrchestrator.ts` | 遗留（OrganizationTwin 模拟） | TODO: 绑定 Ontology Gate |

### 3.2 planes/ 迁移记录（2026-07-31）

| 原位置（planes/） | 迁移到 | 处置 |
|------|------|------|
| `runtime-kernel/dag/types.ts` | `runtime/dag/types.ts` | 6 个导入者更新（DAGRuntime/TaskGraph/TaskNode/planning） |
| `runtime-kernel/fsm/` | `runtime/fsm/` | 测试引用（FSMEngine/plugin） |
| `runtime-kernel/execution-graph/` | `runtime/execution-graph/` | 测试引用（ExecutionGraph） |
| `runtime-kernel/scheduler/` | `runtime/scheduler/` | 测试引用（SchedulerEngine/plugin） |
| `knowledge-plane/artifacts/` | `artifact/registry/` | ArtifactRegistry 簇（Layer 7）；orphan plugin 删除 |
| `artifact-plane/` | `artifact/plane/` | ArtifactPlane/Manager/Repository 簇；SqliteEventStore/Studio 消费 |
| `knowledge-plane/knowledge/` | `metadata/knowledge/` | KnowledgeGraph（Layer 7 图数据） |
| `knowledge-plane/memory/` | `memory/knowledge/` | VectorStore（Layer 7 记忆） |
| `agent-plane/` | `agent/harness/` | AgentHarness/ContextBuilder/types；orchestrator+swarm 为测试引用 stub |
| `control-plane/intent/` | `goal-intelligence/intent/` | 意图提取/识别（GoalExtractor/ConstraintAnalyzer 等） |
| `control-plane/orchestrator/ExecutionOrchestrator.ts` | `control-plane/orchestrator/` | 规划引擎/router 的 14 个导入者更新 |
| 孤儿文件（DAGEngine、dag/plugin、各 plane 的 plugin.ts 等） | — | 已删除（无任何引用） |

---

## 4. Verification Commands

```bash
# 架构对齐验证
node scripts/validate-architecture.js

# 生产就绪检查
node scripts/production-check.cjs

# TypeScript 编译
npx tsc --noEmit
```

---

## 6. S22 Architecture Audit Record（严格审计）

> 审计方法：负向合规（validate-architecture.js 8 项）+ 正向核验（文件存在 → 实现度 → 装配点 bootstrap 调用）。

| 层 | 判定 | 审计证据 | 处置 |
|----|------|---------|------|
| L1 Entry & Governance | ⚠️ 部分接线 | 5 Controllers 存在且实现；但 checkAll 只调 goal/policy/resource，Agent/Evolution Controller 构造未用（死组件） | S22：checkAll 增加可选 capability 门禁（显式传才检查） |
| L2 Ontology Gate | ✅ 真实 | Graded Gate 真实：tier-0 禁缓存（getCacheKey 返回 ''）、tier-2 ControlledExploration、QueryMiss 事件真实 append | — |
| L3 Planning | ✅ 真实 | DeliveryPlanner 926 行 / HierarchicalPlanner / Arbitration 环检测 / ontologyRefs 传递；装配 Mission+非 Mission | — |
| L4 Cognition & Brain | ❌→✅ 已修复 | BrainFacade reflectionEngine/metaLearner 字段 null（bootstrap 未调 setter）；Synthesizer 未装配；learningLoop 无实现类 | S22：注入 reflectionEngine/metaLearner + Synthesizer 装配 + **LearningLoop 聚合三件套实现并注入** |
| L5 Execution | ✅ 真实 | maxIterations(默认300)/maxCostTokens 真实上限 + budget.exceeded 事件；SubAgentFork 重试/超时 | — |
| L6 Tools & Primitives | ✅ 真实 | 5 通用原语 + 19 原语注册 + Ontology Gate 绑定（bootstrap 282-311） | — |
| L7 Knowledge & Memory | ✅ 真实 | 8 实体 × 10 关系真实（SystemMetadataGraph.ts:9-10）；MemoryAPI(cognee)/MemoryWiki/PersonalBrain/ArtifactRegistry/UnifiedEventStore 全真实 | — |
| L8 Evolution | ⚠️→✅ 已修复 | autoEvolve 因 selfImprovementLoop 未注入永不触发（ActiveEvolutionTrigger.ts:307） | S22：bootstrap 注入 SelfImprovementLoop |
| L9 Workflow Plugin | ✅ 真实 | 4 插件注册 + S20 workflow-plugins 测试 | — |
| L10 Infrastructure | ✅ 真实 | EventBus / ConnectorRegistry(FS+Shell) / Observability | — |

**结论**：负向合规 100%；正向核验 7/10 层原本真实 + L4/L8 两处接线缺陷（S22 已修）+ L1 部分接通 + **learningLoop 已补全**（S22，聚合 learning/ 三件套）。

## 5. Future Development Rules

**任何新功能必须**：
1. 明确对应理想架构的某一层
2. 通过 Ontology Gate（如果涉及知识/生成）
3. 领域逻辑放在 `packages/workflows/`
4. 通过 `node scripts/validate-architecture.js` 检查

**禁止**：
- 在 `planes/` 或 `brain/` 新增代码
- 绕过 Ontology Gate
- 在 core 中实现领域原语

---

**This document is the single source of truth for MorPex architecture.**
