# AICOS-Core 完整架构与数据流全链路

> **权威文档**。本文件描述 MorPex 当前实现的**单一 8 层架构**与端到端数据流。
> 依赖方向：**自顶向下**（高层可使用低层；低层禁止反向依赖，由 `validate-architecture.js` 强制）。
> 唯一架构真相源 = 本文件；逐文件清单 = `AICOS_CORE_FILE_REGISTRY.md`。

---

## 一、8 层架构总览

| 层 | 名称 | 职责（一句话） | 当前核心组件 |
|----|------|----------------|--------------|
| **L1** | Governance 治理与授权 | 目标级授权；不推理/不执行/不直接查知识 | `CompanyFacade` + `ControlPlane`（Goal/Policy/Resource/Agent 4 Controller）+ `PolicyEngine` + `ApprovalGate` + `RiskAnalyzer` |
| **L2** | Knowledge 知识权威 | 读写权威 + Tier 写入规则 | `SystemMetadataGraph` + `OntologyService` + `ArtifactRegistry` + `MemoryWiki` + `PersonalBrain` + `UnifiedEventStore` |
| **L3** | Ontology Gate 强制知识防火墙 | 一切生成/动作前必须过 Gate；QueryMiss 即信号 | `ForcedQueryGuard` + `runOntologyGroundedReasoning` + `gate/context.ts`（`KnowledgeContextPackage` / `TierWriteGuard` / `ProposalStatusGuard`） |
| **L4** | Cognition & Planning 认知与规划 | 纯认知，禁副作用，不触发生产变更 | `BrainFacade` + `ReflectionEngine` + `LearningLoop`（**单一学习入口**）+ `DeliveryPlanner` + `HierarchicalPlanner` + Twins |
| **L5** | Execution 有界执行 | Bounded Autonomy；超限立即终止 | `UnifiedExecutionEngine`（mission/dag/fabric/auto）+ `MorPexRuntime` + `MissionRuntime`(FSM) + `DAGRuntime` + `ExecutionFabric` + `SubAgentFork` |
| **L6** | Evaluation 评价 | 评价单一权威；只发事件不触发变更 | `EvaluationEngine`（质量 + 本体合规 + **血缘健康** 三合一）+ `QualityScorer` + `verification/`（ArtifactChecker/ExecutionVerifier/RepairPlanner） |
| **L7** | Evolution 演化 | 事件驱动演化；Sandbox→审批→晋升 | `ActiveEvolutionTrigger` + `SelfImprovementLoop`（只产提案）+ `EvolutionProposal` + `EvolutionSandbox` + `KnowledgeGapListener` + `ExperienceMiner`/`FailureAnalyzer`/`PatternExtractor` |
| **L8** | Infrastructure 基础设施 | 底座服务；无领域逻辑 | `EventBus` + `ConnectorRegistry` + 5 Primitive（KnowledgeQuery/ArtifactGeneration/FileOperation/Shell/APICall）+ `PiBridge` + `UnifiedEventStore`(IEventStore) + Observability |
| 非层 | 领域插件 | 领域逻辑只允许在 workflows 插件 | `packages/workflows/{xjmcu,ecommerce,hardware,software}` |

---

## 二、端到端主数据流（一次目标执行）

```
 ① 用户/系统入口
    CompanyFacade.executeGoal(goal, options)
    │
    ├─ 部门存在性校验（departmentName）
    │
    ├─ ② L1 治理门禁
    │   ControlPlane.checkAll(goal)
    │     ├─ GoalController   — 目标合法性/风险分级
    │     ├─ PolicyController — PolicyEngine 规则决策（auto_approve/notify/require_approval/block）
    │     ├─ ResourceController — 资源配额/成本预算
    │     └─ AgentController  — 能力匹配/Agent 选择
    │   ✋ 未通过 → 直接拒绝返回
    │
    ├─ ③ L4 规划介入（非 mission 模式）
    │   DeliveryPlanner.createPlan(goal)  → plan{id, tasks, ontologyRefs[]}
    │     └─ 内部经 runOntologyGroundedReasoning（L3 Gate）：强制查询 → 引用校验 → 产出计划
    │   （mission 模式的规划由 MissionRuntime 内 DeliveryPlannerAdapter 承担）
    │
    └─ ④ L5 执行 Runtime
        UnifiedExecutionEngine.run(goal, runOpts)
          ├─ mode='mission' → MissionRuntime（FSM：PLANNING→EXECUTING→VERIFYING→COMPLETED）
          │                    ├─ Gate：runOntologyGroundedReasoning（tier 分级强制查询）
          │                    ├─ 原语调用：经 L8 primitives（ForcedQueryGuard 兜底）
          │                    ├─ Verification：execution VerificationEngine（4 检查点）
          │                    └─ 产出 Artifact → ArtifactRegistry（TierWriteGuard 校验）
          ├─ mode='dag'     → DAGRuntime（TaskGraph 并行/依赖调度）
          ├─ mode='fabric'  → ExecutionFabric（Agent 级执行）
          └─ mode='auto'    → executeAuto（DomainPrimitiveRegistry 简单任务；破坏性原语无 Gate 凭证→硬拦=安全默认）
        │
        └─ ⑤ 任务完成 → BrainFacade.learn()（L4 学习闭环，不阻断）
              └─ LearningLoop（单一入口）：extractExperience（经验）+ learnFromTask（偏好/部门模式）
```

---

## 三、事件驱动链路（L5 → L6 → L7 演化闭环）

```
                    ┌─────────────────────────────────────────────┐
                    │                EventBus (L8)                │
                    └──────┬──────────┬────────────┬──────────────┘
                           │          │            │
  ⑤ 执行结束  ─────────────┘          │            │
     mission.completed / mission.failed
     execution.completed / execution.failed
                           │          │            │
  ⑥ L6 评价    ───────────┘          │            │
     EvaluationEngine.evaluate()（MorPexRuntime 触发，含 ontologyCompliance）
       ├─ evaluation.scored        （总是）
       └─ evaluation.low_score     （质量<阈值 0.6）★ 低分只发事件，不直接触发变更
                           │          │            │
  ⑦ L7 演化    ───────────┘          │            │
     ActiveEvolutionTrigger 订阅：
       ├─ mission.completed  → checkMissionCompleted → autoEvolve
       ├─ evaluation.scored  → recordQuality（部门质量追踪）
       ├─ evaluation.low_score → 质量退化检查
       └─ department.created → 新部门追踪
       │
       └─ SelfImprovementLoop.evolve(metrics)
            ├─ 只产提案（status=pending/DRAFT，绝不自动 APPROVED）
            └─ ImprovementAnalyzer → EvolutionProposal.create（tier-0/1 需 Gate 凭证）
              │
              └─ EvolutionSandbox.approveAndApply(id, gateContext)
                   ├─ ⚠️ 晋升硬校验：requireKnowledgeContext（缺包直接抛错）
                   ├─ 审批后落地（version ledger）
                   └─ 写 Tier-2 前再过 Gate + 完整 Trace
```

**演化安全闭环（L7 唯一晋升路径）**：
```
Proposal 创建(pending) → Sandbox 试跑 + Benchmark 对比 → 人工审批 → approveAndApply(Gate 硬校验) → 晋升写 Tier-2
```
未审批状态只能是 pending；任何旁路（L5 直连、遗留 Controller、内联演化）已剥离（Wave 3/5/6a）。

---

## 四、Gate 强制链（L3 — 运行时硬拦截）

```
runOntologyGroundedReasoning(goal, {riskTier, ontology, guard})
  ├─ Phase 1 强制查询：LLM 输出查询计划 → 执行 ontology 工具 → 记录 QueryTrace
  │    └─ 无结果 → QueryMiss 事件（→ L7 KnowledgeGapListener 订阅）
  ├─ Phase 2 引用校验：proposal.referenced_object_ids ⊆ 已检索集合
  │    └─ 失败 → ReferenceValidationFailed 事件
  └─ 签发 KnowledgeContextPackage（executionId + queryCallCount + referenceCheck + retrievedIds）
       │
       ├─ 原语 execute：ForcedQueryGuard.assertQueried（tier-0/1 缺查询即拒）
       ├─ ArtifactRegistry.register/update：TierWriteGuard
       │    ├─ Tier-3 禁止覆盖 Tier-0/1
       │    └─ Tier-2 仅 L7 晋升结果（promotedByEvolution=true）可写
       ├─ EvolutionProposal.create（tier-0/1 必须持有包）
       └─ EvolutionSandbox.approveAndApply（缺包直接抛 GateContextRequiredError）
```

---

## 五、知识权威写入流（L2）

```
写入方                                    L2 写入接口 (ArtifactRegistry/Knowledge)
  ├─ 普通执行产物      → Tier-3（无凭证 → WARN 计数，不静默）
  ├─ 规划/正式产物     → Tier-1（必须持有 Gate 凭证，缺包抛错）
  ├─ 演化晋升结果      → Tier-2（仅 L7 EvolutionSandbox 晋升，promotedByEvolution=true）
  └─ 权威/架构数据     → Tier-0（必须持有 Gate 凭证 + 引用校验）
```

---

## 六、依赖方向约束（validate-architecture.js 强制）

| 规则 | 强制级别 |
|------|---------|
| L4 禁副作用：cognition/ 不得 import 可执行 Primitive/演化实现 | ERROR |
| L7 边界：evolution/ 不得 import cognition/（仅白名单只读符号） | ERROR |
| L6-L7 解耦：L6 只发事件，L7 只消费事件 | ERROR |
| control-plane 瘦身：禁止重新引入演化/执行逻辑 | ERROR |
| 层间禁止直接 import 内部实现（只能公开 barrel/接口/EventBus） | ERROR |
| 领域隔离：packages/core 内禁止业务领域硬编码（领域逻辑只能在 workflows 插件） | ERROR |
| 全 5 Primitive 必须绑定 Gate | ERROR |
| 跨层 import 白名单（只读符号） | 白名单 |

---

## 七、关键时序（一次完整闭环）

```
t0   executeGoal → ControlPlane.checkAll（L1 授权）
t1   DeliveryPlanner.createPlan（L4 规划 + L3 Gate 强制查询）
t2   UnifiedExecutionEngine → MissionRuntime（L5 执行）
t3   执行中原语调用 → L3 Gate（KnowledgeContextPackage 签发）
t4   产物注册 → L2 ArtifactRegistry（TierWriteGuard）
t5   执行结束 → EventBus 发 mission.completed（L8）
t6   BrainFacade.learn → LearningLoop（L4 学习）
t7   EvaluationEngine.evaluate → evaluation.scored/low_score（L6）
t8   ActiveEvolutionTrigger 消费事件 → SIL 产提案（L7）
t9   EvolutionSandbox.approveAndApply（Gate 硬校验）→ 晋升写 Tier-2（L7→L2）
```

---

## 八、与历史架构的差异（纯净现架构要点）

- **演化单轨**：唯一路径 = AET 事件驱动 → SIL 只产提案 → EvolutionSandbox 晋升（L4/L1/L5 演化逻辑全部剥离）
- **单一学习入口**：LearningLoop（程序性 + 声明性合并，原 MetaLearner 已删除）
- **单一事件存储**：UnifiedEventStore（IEventStore 契约；旧 EventStore 已删）
- **零兼容垫片**：全仓 0 个 @deprecated（Wave 9 清除）
- **评价权威**：L6 = 质量 + 本体合规 + 血缘健康三合一
