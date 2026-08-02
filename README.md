# MorPex v16 — 一人公司 AI 工作助理

**Status**: 🟢 Production Ready | **VCOS**: 100/100 🎯
**Version**: 16.0.0
**Stack**: TypeScript | Node.js | pi-ai 0.81.1

---

## AICOS-Core 8 层架构（v2 — Final Model）

**All future iterations, upgrades, and refactoring will strictly follow this model.**
（层编号与 `docs/AICOS_CORE_ARCHITECTURE.md` 定稿一致：L1-L8 + 领域插件非层）

```
1. L1 Governance 治理与授权层
   CompanyFacade + ControlPlane（Goal/Policy/Resource/Agent 4 Controller —— EvolutionController 已移除，演化归 L7）
   (目标级授权；不推理/不执行/不直接查知识)

2. L2 Knowledge 知识权威层
   SystemMetadataGraph + OntologyService (8 entities × 10 relations)
   MemoryAPI (cognee) + MemoryWiki(SQLite) + PersonalBrain + ArtifactRegistry + UnifiedEventStore
   (读写权威 + Tier 写规则：Tier-3 禁覆盖 Tier-0/1；Tier-2 仅 L7 晋升结果可写)

3. L3 Ontology Gate 强制知识防火墙层 ★ MANDATORY KNOWLEDGE GATE ★ (Graded: tier-0/1/2)
   OntologyService + ForcedQueryGuard + runOntologyGroundedReasoning
   ├── tier-0 Critical（资金/对外发布/架构变更/演化提案）→ 强制两阶段 + 引用校验 + 同步 Verification（禁止缓存）
   ├── tier-1 Standard（规划、正式 Artifact）→ 两阶段 + 短 TTL 快照缓存
   └── tier-2 Draft / Internal（草稿、内部反思）→ 尽力查询；无结果 → ControlledExploration + QueryMiss 事件
   → Every generation/action MUST pass this gate. No fabrication allowed. QueryMiss is Signal.
   → 签发 KnowledgeContextPackage 运行时凭证（Artifact 注册/演化晋升入口硬校验）

4. L4 Cognition & Planning 认知与规划层 (纯认知，禁副作用)
   BrainFacade (unified) + ReflectionEngine + MetaLearner + CrossDepartmentKnowledgeSynthesizer
   DeliveryPlanner + HierarchicalPlanner + CrossDepartmentArbitrationEngine
   (Plan 输出携带 ontologyRefs[] 引用 Trace；演化逻辑已剥离至 L7；L4 不得 import 可执行 Primitive / 演化实现)

5. L5 Execution 有界执行层 (Bounded Autonomy)
   UnifiedExecutionEngine + SubAgentFork + ExecutionFabric + MorPexRuntime (FSM/DAG)
   (maxIterations / maxCostTokens / maxAttempts / timeout；超限立即终止 → execution.budget.exceeded 事件)

6. L6 Evaluation 评价层
   EvaluationEngine + QualityScorer + ontologyCompliance + lineageCompliance
   (5 维评分 + 血缘健康；低分只发 evaluation.low_score 事件，不直接触发生产变更)

7. L7 Evolution 可验证演化层
   ActiveEvolutionTrigger + EvolutionSandbox + KnowledgeGapListener + PatternMigrationEngine
   SelfImprovementLoop + EvolutionProposal + ImprovementAnalyzer + FeedbackAwareLearner（自 L4 迁入）
   ExperienceMiner + FailureAnalyzer + PatternExtractor
   (QueryMiss → Feedback → Evolution 闭环；只消费 L6 evaluation.* 事件，禁止被 L4 直接触发；
    演化须沙箱试跑 + 人工审批 + 版本化回滚；晋升写前再过 Gate + 完整 Trace)

8. L8 Infrastructure 基础设施层
   EventBus (Sole Communication Channel, at-least-once + 消费者幂等) + ConnectorRegistry + Observability
   Primitives：KnowledgeQuery / ArtifactGeneration / FileOperation / ShellExecution / APICall
   (通用底座；不含领域逻辑)

领域插件（完全隔离，非层）：packages/workflows/<domain>/ (xjmcu, ecommerce, hardware, software)
```

**Core Constraints**:
- **Ontology Gate is mandatory** for all knowledge retrieval and generation.
- **Knowledge First**: `KnowledgeQueryPrimitive` always queries Ontology first.
- **No Domain Logic in Core**: Domain primitives belong exclusively in Workflow Plugins.
- **Department Isolation**: Every operation carries `departmentId`.
- **EventBus Only**: No direct module-to-module calls.

**Core Constraints（vNext+ 增补）**:
- **Graded Ontology Gate**: Gate 按风险分级（tier-0 强制两阶段 / tier-1 缓存 / tier-2 受控探索），禁止一刀切全量两阶段（`gate/types.ts` → `RiskTier`）。
- **Bounded Autonomy**: 所有 Agent 执行必须有 iteration / cost / timeout 上限，超限立即终止并发事件（`execution/SubAgentFork.ts` + `UnifiedExecutionEngine`）。
- **QueryMiss is Signal**: 知识缺失不能静默失败，必须产生 `ontology.query.miss` 事件进入反馈/演化回路（`gate/ontologyEvents.ts` + `runOntologyGroundedReasoning`）。
- **Verifiable Evolution**: 演化必须沙箱试跑 + 人工审批 + 版本化可回滚（依赖 Event Sourcing）。

See `docs/AICOS_CORE_ARCHITECTURE.md` for the detailed module inventory + layer status aligned to this model.

---

```
                         CEO
                          │
                  CompanyFacade
                   └─ submitFeedback()
                          │
                  Control Plane
        ┌───────┼───────┐
   GoalCtrl  PolicyCtrl  ResourceCtrl
   AgentCtrl
                          │
          ┌───────┼───────┐
      Evaluation     Ontology
   (5维+合规评分)   (LLM 强制查询层)
      │              │
      └──Ontology───┘  
     QueryCompliance    │
          │         OntologyService
     Execution      ForcedQueryGuard
     (9 Phase)      Projectors
          │
     OrganizationTwin  MetadataGraph
     (CEO/CTO/CMO/CFO)  (全实体关系图)
          │
         Event Sourcing (全域事件持久化)
         Evolution (L7 沙箱+审批+版本化回滚)
         FeedbackAwareLearner (消费查询/反馈信号 → L7)
```

### Ontology 层（迭代1-3）

```
ontology/
├── types.ts                   — OntologyObject / OntologyProposal / QueryTrace
├── OntologyService.ts         — 包装 MetadataGraph: query/upsert/ensureRelation
├── ForcedQueryGuard.ts        — 代码级强制: recordToolCall / assertQueried / validateReferences / flushTrace
├── ObjectTypeRegistry.ts      — 8 个核心类型 Schema 与属性校验
├── FeedbackService.ts         — submit / listTestCases
├── runOntologyGroundedReasoning.ts — 共享两阶段推理（查询→推理）
├── bootstrapFromDocs.ts       — 半自动从文档构建图谱
└── projectors/
    ├── MissionProjector.ts    — 从 MissionController 投影
    └── ArtifactProjector.ts   — 从 ArtifactFacade 投影
```

**核心原则**：LLM 必须先查 Ontology 再推理，
所有规划级决策经过 `runOntologyGroundedReasoning` 闸门。



---

---

## Quick Start

### 启动后端（推荐）

```bash
cp .env.example .env    # 设置 DEEPSEEK_API_KEY（记忆/cognee 需要）
MEMORY_ENGINE=mock npm run studio:server   # 仅后端 API（无 cognee，mock 记忆）
./scripts/run-all.sh                       # 全栈：cognee(:8001) + 后端(:8080)
# 健康检查: http://localhost:8080/api/health
```

### 程序化调用

```typescript
import { bootstrapUnified } from './packages/core/src/bootstrap-unified.js';
const { companyFacade } = await bootstrapUnified();
const result = await companyFacade.executeGoal("设计产品并销售到 Amazon");
// → ControlPlane 门禁 → Ontology Gate → 规划 → Mission → 执行 → 产物 → 评估 → 演化
```

### 测试

```bash
npm run test:full        # 一键全部（25 步：tsc/架构/vitest 568 用例/生产/CLI）
npm run test:quick       # 快速回归（~11s）
npm run test:coverage    # 覆盖率报告（行覆盖 37%+，阈值防回退）
npx vitest run           # 仅单元/集成
```

---

## 测试体系与架构可观测（S22-S37）

**测试**：568 用例 / 60 文件，覆盖矩阵 8 层 ❌ 清零；一键 `npm run test:full`（25 步 25/25 绿）；覆盖率行覆盖 37%+（vitest 阈值 34/27/32/36 防回退）。详见 `docs/TESTING_PLAN.md`。

**架构可观测**（真实执行黑盒→可观测）：后端启动后访问 `/api/observability/*`——

| 你想知道 | 端点 |
|---------|------|
| 整个架构怎么运行（每层事件链） | `/api/observability/observations` `/span-tree/:taskId` `/topology` |
| 每层功能模块是否正常 | `/api/observability/modules-v2` `/heartbeats` `/exercise-status` |
| 流程是否有绕过 | `/api/observability/audit`（8 层契约合规检测） |

真实执行（`POST /api/chat/send`）产生 **L1 治理→L3 Gate→L4 规划→L5 执行→L6 评价→L7 演化** 全层事件链；/audit 全链 **0 error + 0 warn**，直连 `/api/execute`（绕过治理）会被检测。运维手册见 `SESSION_LOG.md §6`。

---

## VCOS Score: 100/100 🎯

| 维度 | 满分 | 得分 | 关键提升 |
|------|------|------|----------|
| 🧠 CEO Intelligence | 15 | 15 | ControlPlane + GoalController + OrganizationTwin 战略模拟 |
| 🏢 Organization | 15 | 15 | DynamicTeamOrchestrator + AgentCapabilityGraph 层级能力树 |
| ⚡ Task Execution | 15 | 15 | UnifiedExecutionEngine + 9 Phase Runtime + Event Sourcing |
| 💾 Memory & Knowledge | 15 | 15 | MetadataGraph 全实体关系 + SystemMetadataGraph BFS 路径搜索 |
| 📐 Planning | 10 | 10 | HierarchicalPlanner + ArtifactBlueprint 先于执行 |
| 🛠 Tools & Environment | 10 | 10 | PolicyEngine 统一策略 + Agent Reputation 信誉驱动 |
| 🔭 Observability & Gov. | 10 | 10 | EvaluationEngine 5维评分 + SafetyMonitor 5阈值检测 |
| 🔧 Maintainability | 10 | 10 | 532 .ts 文件 + 22 核心模块 + 52 Golden Tasks 基准 |

---

## 核心模块

| 层 | 模块 | 职责 |
|----|------|------|
| 🎮 **Control** | `control-plane/` | AI System Controller (4 Controllers) |
| 📋 **Policy** | `policy/` | 统一策略引擎 (13 条默认策略) |
| 📊 **Evaluation** | `evaluation/` | 5 维度系统级评分 (Plan/Agent/Tool/Output/Memory) |
| 🧠 **Brain** | `cognition/`（`brain/` 已废弃 deprecated） | ReflectionEngine, MetaLearner, Twins 统一入口 `cognition/BrainFacade` |
| 📐 **Planning** | `planner/` | DeliveryPlanner + HierarchicalPlanner (HTN) + `planWithOntology` |
| ⚡ **Execution** | `execution/` + `runtime/` | UnifiedExecutionEngine + MorPexRuntime (9 Phase) |
| 📦 **Artifact** | `artifact/` | ArtifactBlueprint 先于执行 + 全生命周期 |
| ✅ **Verification** | `verification/` | VerificationEngine + ComplianceChecker + ApprovalGate |
| 🎯 **Mission** | `mission-control/` | MissionController + PersistentMissionStore |
| 🔍 **Goal** | `goal-intelligence/` | GoalIntelligenceFacade (parse/extract/analyze) |
| 🗺️ **Capability** | `capability/` + `agent-capability/` | CapabilityRegistry + 层级能力图 |
| 👥 **Organization** | `organization/` | DynamicTeamOrchestrator + AgentPoolProvider |
| 🔌 **Workflow** | `workflow/`（插件目录 `packages/workflows/<domain>/`：xjmcu, ecommerce, hardware, software） | WorkflowProvider 接口 (插件化)，领域逻辑完全隔离 |
| 🏛️ **Governance** | `governance/` | RuntimeManager + CostController + AlertEngine |
| 🔗 **Metadata** | `metadata/` | SystemMetadataGraph (8 实体 × 10 关系) |
| 🔍 **Trace** | `trace/` | TraceCollector (goal→artifact span) |
| 🏁 **Ontology** | `ontology/` | OntologyService + ForcedQueryGuard + FeedbackService (迭代1-3) |
| 🏆 **Benchmark** | `benchmark/` | 52 Golden Tasks (5 domains) |
| 👥 **Twin** | `cognition/twin/` | OrganizationTwin (CEO/CTO/CMO/CFO 模拟) |
| 📜 **Events** | `protocol/events/` | Event Sourcing (28 事件类型 + SQLite) |

---

## Key Metrics

| Metric | Value |
|--------|-------|
| TypeScript errors | **0** |
| TypeScript source files | **532** |
| Architecture directories | **53** |
| Core modules | **22** |
| Golden Benchmark tasks | **52** (5 domains) |
| VCOS | **100/100** 🎯 |
| Engineering maturity | **90/100** |
| Execution phases | **9** (Goal→Evolution 闭环) |
| Event types | **28** (全域 Event Sourcing) |
| Policy rules | **13** (统一 PolicyEngine) |
| Capability nodes | **27** (4 domains) |
| **测试用例** | **568**（vitest 60 文件，覆盖矩阵 ❌ 清零） |
| **一键测试** | `npm run test:full`（25 步全绿） |
| **行覆盖** | **37%+**（阈值 34/27/32/36 防回退） |
| **架构可观测** | `/api/observability/*`（audit 绕过检测 + 8 层事件链） |

---

## Core Principles

1. **PiBridge Isolation** — Only `PiBridge.ts` imports pi packages directly
2. **Control Plane** — All system behavior passes through 4 Controllers
3. **Event Sourcing** — All state changes persist as events, state rebuilt from replay
4. **Artifact First** — Execution produces Artifacts defined by Blueprint
5. **Evaluation Driven** — Every execution scored on 5 dimensions (incl. ontology compliance)
6. **Self Evolution** — 8-phase safety loop with human approval gates
7. **Plugin Architecture** — Workflow providers are external plugins, not core logic
8. **Ontology Grounding** — LLM must query real facts from Ontology before reasoning (iter1-3)
9. **Feedback Loop** — All feedback and query failures feed into Self Evolution (iter3)
10. **Graded Ontology Gate** — Risk-tiered gate (tier-0/1/2), no one-size-fits-all two-phase
11. **Bounded Autonomy** — Every SubAgent/Mission has iteration & cost ceilings
12. **QueryMiss is Signal** — Knowledge gaps emit `ontology.query.miss` → Feedback → Evolution
13. **Verifiable Evolution** — Sandbox + human approval + versioned rollback
