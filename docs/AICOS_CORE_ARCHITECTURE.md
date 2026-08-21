# AICOS-Core 八层架构（理想架构 v2）

> 📇 **配套文档**：逐文件注册表（功能 + 职责边界）见 [`AICOS_CORE_FILE_REGISTRY.md`](./AICOS_CORE_FILE_REGISTRY.md) — 346 个文件，防止功能碎片化/重复化/职责边界模糊。


> 版本: 2.0 | 日期: 2026-08-01 | 状态: 定稿（取代 morpex_ARCHITECTURE.md 的 10 层模型）
> 本文件是架构的单一真相源，`scripts/validate-architecture.js` 依据本文件做负向合规校验。

## 0. 总览（双轴模型）

```
CompanyFacade（唯一入口）
        │ 请求生命周期（纵轴）
        ▼
  ┌────────────────────────────────────────────────────┐
  │ L1 Governance ─► L4 Cognition&Planning ─► L5 Execution │
  │     └─────────► L6 Evaluation ─► L7 Evolution        │
  └────────────────────────────────────────────────────┘
         ▲ 横轴：权威服务（被纵轴每个 query/generate 层强制调用）
  ┌────────────────────────────────────────────────────┐
  │ L2 Knowledge（读写权威）   L3 Ontology Gate（防火墙）   │
  └────────────────────────────────────────────────────┘
         ▲ 底座
  ┌────────────────────────────────────────────────────┐
  │ L8 Infrastructure（EventBus/原语/连接器/可观测/存储）    │
  └────────────────────────────────────────────────────┘
领域插件（完全隔离，非层）：packages/workflows/<domain>/
```

**关键：L2/L3/L8 是横切服务，不是流水线步骤。** L4/L5/L6/L7 任何产生"对外副作用或权威生成"的动作，必须先调用 L3 Gate。

## 1. L1 Governance 治理与授权层
- 职责：Policy 检查、资源预算、风险评级（资金/对外发布/架构变更/演化晋升→高风险）、Approval Gate（人工确认）、Agent/能力注册表生命周期、演化提案晋升审批。
- 输出：`AuthorizedGoal { goal, budget, constraints, riskLevel, approvalStatus, policyRefs }`
- 不做：不推理/规划、不执行业务动作、不直接查询修改知识。
- 代码锚点：`governance/`（policy/risk/approval/resource/alert/verification + control-plane/ + capability/）

## 2. L2 Knowledge 知识权威层
- 职责：Knowledge Authority Hierarchy（Tier-0 Ontology / Tier-1 Verified / Tier-2 Experience / Tier-3 Session）；SystemMetadataGraph、Artifact Registry、知识版本控制；统一读写接口；**写规则强制：Tier-3 永不覆盖 Tier-0/1，任何写入带来源+置信度**；血缘记录。
- 不做：不强制拦截（Gate 做）、不推理规划、不触发演化。
- 代码锚点：`knowledge/`（ontology-service/graph/artifact/memory/context）

## 3. L3 Ontology Gate 强制知识防火墙层 ★
- 职责：分级处理（tier-0/1/2）；ForcedQueryGuard 禁止无依据生成；输出 `KnowledgeContextPackage { ontologyRefs[], confidence, residualUncertainty, knowledgeTierUsed, queryMisses[], temporaryHypotheses[] }`；QueryMiss 一等信号入演化队列；ControlledExploration。
- 不做：不最终决策/执行、不修改权威知识（只读+信号）。
- 宪法：No fabrication allowed. QueryMiss is Signal.
- 代码锚点：`gate/`（ForcedQueryGuard/runOntologyGroundedReasoning/types/ontologyEvents）

## 4. L4 Cognition & Planning 认知与规划层
- 职责：Brain（Observe→Reason→Reflect→Strategy→Meta-Learning）+ Self-Model；分层规划（Strategic/Hierarchical/Delivery/Cross-Department 仲裁）；输出 `PlanContract { goal, steps[], requiredCapabilities[], resources, risks, ontologyRefs[], expectedArtifacts[], evaluationCriteria[], residualUncertainty, fallbackStrategies[] }`。
- 不做：禁止调用副作用 Primitive、禁止直接修改知识/触发演化。
- 代码锚点：`cognition/`（brain/twin/goal/workflow/decision + planning/ + learning/）

## 5. L5 Execution 有界执行层
- 职责：PlanContract→TaskContract；UnifiedExecutionEngine + FSM/DAG；动态能力组合；SubAgent Fork；所有 Primitive 调用经 Policy Middleware（权限/审计/沙箱/限流/配额）；硬边界（maxIterations/maxCostTokens/maxAttempts/timeout 超限终止+Failure 事件）；Checkpoint/Rollback/补偿；产物带 Execution Trace + ontologyRefs。
- 不做：不重新规划、不最终质量评分、不直接演化。
- 代码锚点：`execution/`（engine/fork/harness + runtime/）

## 6. L6 Evaluation 评价层
- 职责：对 Artifact/任务输出 Performance Profile（Accuracy/Cost/Latency/Risk/Compliance/UserValue）；综合评分+分项诊断；Artifact Lineage（谁生成/依据哪些 refs/过哪些验证/用于什么目标/最终结果）；低分+异常推入演化队列；人工覆盖评分（记录原因）。
- 不做：不直接修改系统行为、不执行业务逻辑。
- 宪法：没有评价，演化就是盲目的。
- 代码锚点：`evaluation/`（EvaluationEngine/QualityScorer/ontologyCompliance）

## 7. L7 Evolution 可验证演化层
- 职责：输入 QueryMiss/Failure/低分/Experience；流水线 ExperienceMiner/FailureAnalyzer/PatternExtractor → Improvement Proposal → Evolution Sandbox 试跑 → Benchmark(old vs new) → 风险分级（低风险灰度晋升/高风险人工审批）→ 版本化迁移+回滚；**演化提案必须重新过 Gate；只有已晋升结果写入 Tier-2（写前再过 Gate）**；完整 Evolution Trace。
- 不做：不绕过 Governance 最终审批、不在生产直接试验高风险变更。
- 代码锚点：`evolution/`（mining/trigger/sandbox/workflow + capability-feedback）

## 8. L8 Infrastructure 基础设施层
- 职责：EventBus（唯一通道，at-least-once+幂等）、Primitive Registry + Policy Middleware、ConnectorRegistry、EventStore（追加写+Replay）、Trace/Metrics/Audit、存储/缓存/认证/加密/网络隔离、资源隔离配额强制。
- 不做：不含领域逻辑、不推理/规划/评价/演化决策。
- 代码锚点：`infrastructure/`（bus/events/primitives/connectors/observability/resilience/protocol/adapters/common/utils）

## 9. 跨层强制规则（宪法）
1. 任何改变外部世界或系统状态的动作，必须先过 Ontology Gate。
2. 所有 Plan/Artifact/Evaluation/Evolution Proposal 必须携带 ontologyRefs[] 与置信度。
3. QueryMiss、Failure、低分 Evaluation 必须产生事件并进入 Evolution 可观测队列。
4. 领域逻辑只能在 packages/workflows/<domain>/，以插件方式挂载。
5. 人类保留对高风险操作的最终 Override 与审批权。

## 10. 事件协议（跨层信号）
- governance.goal.authorized / governance.approval.required
- gate.query.miss / gate.reference.failed / gate.controlled_exploration
- cognition.plan.created
- execution.artifact.created / execution.budget.exceeded / execution.failure
- evaluation.profile.scored / evaluation.low_score
- evolution.proposal.created / evolution.proposal.promoted / evolution.rollback
- 事件契约目录（G1，2026-08-20）：跨层核心事件已在 `infrastructure/common/contracts/eventContractCatalog.ts` 注册 24 条 EventContract（producer/consumers/validatePayload），bootstrap 填充进 EventBus；对账视图 `GET /api/observability/event-contracts`（抓双轨漂移）。

## 11. 目录落地（8 层物理结构 · 已执行完成）
```
packages/core/src/
  facade/            # 唯一入口（CompanyFacade + gateway/）
  governance/        # L1（含 control-plane/ capability/ policy/risk/approval/resource/alert/verification）
  knowledge/         # L2（含 ontology/ graph/ artifact/ memory/ context）
  gate/              # L3（ForcedQueryGuard / runOntologyGroundedReasoning / types / ontologyEvents）
  cognition/         # L4（含 planning/ learning/ brain/ twin/goal/workflow/decision/memory）
  execution/         # L5（含 fabric/ harness/ runtime/）
  evaluation/        # L6（EvaluationEngine / QualityScorer / ontologyCompliance）
  evolution/         # L7（含 workflow/ mining/trigger/sandbox）
  infrastructure/    # L8（含 adapters/ common/ observability/ protocol/ tools/ utils）
  workflow/          # 插件注册（L9 机制）
packages/workflows/  # 领域插件（完全隔离）
```

## 12. 迁移记录（2026-08-01 已执行）
- 从 10 层 → 8 层：Evaluation 独立成 L6（从 governance 拆出）；Planning 并入 Cognition（planner/ → cognition/planning/）；Gate 独立目录（gate/）；Knowledge 聚合（knowledge/ 含 ontology/graph/artifact/memory/context）；Infrastructure 聚合（infrastructure/ 含 common/observability/tools/protocol/utils/adapters）；Governance 聚合（含 control-plane/capability）。
- 全量验证：tsc 0 错误 / validate-architecture 100% / vitest 30 文件 199 用例 / production-check 8/8。
- 校验器 `scripts/validate-architecture.js` 已同步 8 层路径（GENERATION_ALLOWLIST / 领域豁免 / primitives 绑定）。

