# MorPex v16 — 全景架构审计报告

> **审计日期**: 2026-07-24
> **版本**: v16 (4449b29)
> **源文件**: 499 个 .ts | 49 个架构目录
> **审计维度**: 控制流 · 数据流 · 控制权 · 长期运行 · 商业化 · 过度设计

---

## 一、全景架构图

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CEO Layer                                         │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                        CompanyFacade                                      │  │
│  │  executeGoal("开发空气检测设备并销售到 Amazon")                             │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────┐   ┌──────────────────────┐   ┌───────────────────┐   │
│  │   GoalIntelligence   │   │  CapabilityRegistry  │   │ MissionController │   │
│  │   understandGoal()   │──▶│  discover() → caps   │──▶│ createMission()   │   │
│  │   → GoalContext      │   │  → missing[]         │   │ → track/block/risk │   │
│  └──────────────────────┘   └──────────────────────┘   └───────────────────┘   │
│                                                          │                      │
│                                      Mission State ←─────┘                    │
└─────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────┐   ┌────────────────────────┐   ┌─────────────────┐   │
│  │  WorkflowRegistry    │   │ DynamicTeamOrchestrator │   │ExecutionSimulat │   │
│  │  findForGoal(goal)   │──▶│ orchestrate(caps)      │──▶│ simulate(plan)  │   │
│  │  → WorkflowProvider  │   │ → {teams, graph}       │   │ → warnings/risk │   │
│  └──────────────────────┘   └────────────────────────┘   └─────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                    UnifiedExecutionEngine                                  │  │
│  │  ├─ ActionExecutorLike (应用层注入)                                       │  │
│  │  ├─ MissionRuntime (FSM: UNDERSTANDING→PLANNING→EXECUTING→ARTIFACT→VERIFY)│  │
│  │  ├─ DAGRuntime (并行 DAG 调度)                                            │  │
│  │  └─ ExecutionFabric (简单任务直连)                                        │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                          │
          ┌───────────────────────────────┼───────────────────────────────┐
          │                               │                               │
          ▼                               ▼                               ▼
┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐
│  ArtifactFacade     │   │  VerificationEngine │   │  ComplianceChecker  │
│  create/transition  │   │  QualityRule.check  │   │  PolicyRule.check   │
│  addLineage/get     │──▶│  ExecutionVerifier  │──▶│  → ComplianceResult │
│  → ArtifactNode     │   │  → pass/fail        │   │  → level: PASS/WARN │
└─────────────────────┘   └─────────────────────┘   └──────────┬──────────┘
                                                               │
                                                               ▼
                                                    ┌─────────────────────┐
                                                    │   ApprovalGate      │
                                                    │  LOW+PASS→✅ AUTO  │
                                                    │  BLOCK/HIGH→👤 WAIT│
                                                    └─────────────────────┘
                                                               │
                                                               ▼
┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐
│  ExperienceMiner    │   │  SelfImprovement    │   │  MetaLearner        │
│  mineFromCompleted  │   │  Loop.runAnalysis   │   │  learnFromTask()    │
│  → CapabilityStore  │   │  → Proposal+Sim     │   │  → updatePrefs      │
│  → SOPRegistry      │   │  → Human Approval   │   │  → departmentPats   │
└─────────────────────┘   └─────────────────────┘   └─────────────────────┘
                                                               │
                                 ┌───────────────────────────────┘
                                 ▼
                   ┌─────────────────────────────────────┐
                   │    横向基础设施 (贯穿全流程)          │
                   │  RuntimeManager (活跃上下文/资源)     │
                   │  CostController (预算/模型等级)       │
                   │  AlertEngine (告警→EventBus)         │
                   │  EventBus (全局事件骨干)              │
                   │  PiBridge (LLM 网关, 唯一入口)        │
                   └─────────────────────────────────────┘
```

---

## 二、控制流审计

### 2.1 闭环检测

```
Goal ──▶ Mission ──▶ Capability ──▶ Workflow ──▶ Team ──▶ Execution ──▶ Artifact ──▶ Verification ──▶ Learning
  │                                                                                           │
  └──────────────────────────────────← 闭环反馈 ←────────────────────────────────────────────┘
```

| 环节 | 组件 | 状态 | 证据 |
|------|------|------|------|
| **Goal → Mission** | `GoalIntelligenceFacade.understandGoal()` → `MissionController.createMission()` | ✅ | GoalContext.goalId 传递给 MissionState.goalId |
| **Mission → Capability** | `CapabilityDiscoverer.discover(goalContext)` 从 Mission 目标发现能力 | ✅ | discover() 接收 objective + requiredCapabilities |
| **Capability → Workflow** | `WorkflowPluginRegistry.findForGoal(goal)` → 匹配 WorkflowProvider | ✅ | matchGoal(goal) 接口, ecommerce/hardware 等实现 |
| **Workflow → Team** | `DynamicTeamOrchestrator.orchestrateWithCapability()` → 能力驱动团队 | ✅ | orchestrateWithCapability 内部顺序: Cap→WF→Team |
| **Team → Execution** | `SubAgentFork.setExecutionEngine()` → 团队分配到执行引擎 | ⚠️ | 团队结构未显式传递到 ExecutionRequest |
| **Execution → Artifact** | `UnifiedExecutionEngine.execute()` 成功后调用 `ArtifactFacade.createFromTask()` | ✅ | 自动创建 document 类型产物 |
| **Artifact → Verification** | `VerificationEngine.verify(artifacts)` 检查产物质量 | ✅ | QualityRule 按类型检查 |
| **Verification → Learning** | `BrainFacade.learn()` → `ExperienceMiner.mineFromCompletedTask()` → `SelfImprovementLoop.runAnalysis()` | ✅ | learn() 在 execute() 完成后调用 |
| **Learning → Goal (反馈)** | `MetaLearner` 更新偏好/模式 → 影响下次 `GoalIntelligence` | ⚠️ | 偏好更新了但未自动回写到 GoalIntelligence 的解析策略 |

### 2.2 闭环缺口

**缺口 1: Learning → Goal 自动反馈未闭环**
```
当前: Learning → MetaLearner (更新偏好, 停在这里)
需要: Learning → MetaLearner → GoalIntelligence (调整解析策略)
影响: 系统不会自动从"Amazon listing 任务失败率高"中学习调整目标解析
修复: GoalIntelligenceFacade 添加 setMetaLearner() 注入偏好影响解析
```

**缺口 2: Verification → Re-execution 自动修复未闭环**
```
当前: Verification → RepairPlanner (生成修复计划, 停在这里)
需要: Verification → RepairPlanner → UnifiedExecutionEngine (自动重试)
影响: 验证失败后需要人工介入重新执行
合理性: 对于一人公司, 自动修复可减少人工干预, 但高风险操作需审批
```

**缺口 3: MissionController → Execution 控制未闭环**
```
当前: MissionController.addBlock() (记录阻塞, 但 Execution 不知道)
需要: MissionController.block() → EventBus → Execution 暂停 → 人工介入 → resume
影响: Day 7 传感器缺货, 系统继续执行后续步骤, 直到失败才停
```

---

## 三、数据流审计

### 3.1 核心对象贯穿图

```
GoalContext { goalId, objective, domain, constraints, requiredCapabilities, riskLevel }
    │
    ├──▶ MissionController.createMission(goalId, objective)
    │       └── MissionState { missionId, goalId, phase, status, progress, blocks, risks, timeline }
    │
    ├──▶ CapabilityDiscoverer.discover(goalContext)
    │       └── Capability[] { name, provider, successRate, requiredTools }
    │
    ├──▶ DynamicTeamOrchestrator.orchestrate(goalCtx)
    │       └── DynamicTeam[] { id, goalId, members, departments, dependencies }
    │
    ├──▶ WorkflowPluginRegistry.findForGoal(goal)
    │       └── WorkflowProvider[] { name, actions[], artifactTypes[] }
    │
    ├──▶ UnifiedExecutionEngine.execute(request)
    │       └── ExecutionResult { ok, executionId, mode, status, output, duration }
    │
    ├──▶ ArtifactFacade.create(name, type, sourceTask)
    │       └── ArtifactNode { id, type, version, status, lineage, metadata }
    │
    ├──▶ VerificationEngine.verify(artifacts)
    │       └── VerificationResult { success, artifactResults, repairs }
    │
    └──▶ ExperienceMiner.mineFromCompletedTask(task)
            └── CapabilityPattern { name, steps, successRate, domains }
```

### 3.2 数据孤岛检测

| 孤岛 | 位置 | 影响 | 严重度 |
|------|------|------|--------|
| **TeamContext 未传递到 Execution** | DynamicTeam→Execution | Execution 不知道自己在哪个团队 | 🔴 HIGH |
| **WorkflowContext 未传递到 Artifact** | Workflow→Artifact | Artifact 不知道来自哪个 workflow | 🟡 MED |
| **MissionController 状态只读不写** | MissionControl→其他模块 | 其他模块不知道 Mission 状态变化 | 🟡 MED |
| **Capability 成功/失败率未反馈** | Experience→CapabilityRegistry | Capability.successRate 从不更新 | 🟡 MED |

### 3.3 状态丢失风险

| 场景 | 风险 | 当前防护 |
|------|------|----------|
| Node.js 重启 | 所有内存状态丢失 | ❌ MissionState/ArtifactNode/CapabilityStore 全在内存 |
| 长时间运行 GC | 内存压力 | ❌ 无持久化 |
| EventBus 不持久化 | 事件丢失 | ⚠️ EventStore 支持 SQLite 但未接入 |
| **结论**: 当前架构适合会话级任务, 不适合跨天长期任务。需要持久化层。 |

### 3.4 重复模型检测

| 模型 | 出现位置 | 问题 |
|------|----------|------|
| `Artifact` | `planes/artifact-plane/types.ts` + `contracts/artifact.ts` (v14) + `contracts/artifact-lifecycle.ts` (v16) | **3 个版本** — 需要统一 |
| `MissionState` | `runtime/mission/types.ts` (24 个状态) + `mission-control/MissionTypes.ts` (简化版) | **2 个版本** — FSM 状态 vs 业务状态 |
| `Capability` | `capability/CapabilityRegistry.ts` + `agent/capability/Capability.ts` (v8) | **2 个版本** — 新老并存 |
| `PolicyRule` | `control/PolicyEngine.ts` (v8) + `verification/PolicyRuleRegistry.ts` (v15) | **2 个版本** — 命名冲突已用别名解决 |

---

## 四、控制权审计

### 4.1 决策责任矩阵

| 决策 | 负责人 | 正确性 | 理由 |
|------|--------|--------|------|
| **创建团队** | `DynamicTeamOrchestrator` | ✅ | 基于 CapabilityRegistry + WorkflowRegistry 输入 |
| **选择 Workflow** | `WorkflowPluginRegistry.findForGoal()` | ✅ | 纯匹配, 无状态副作用 |
| **调整计划** | `ConflictResolver.suggestReplan()` | ✅ | 只建议不执行, 人工介入 |
| **重试** | `UnifiedExecutionEngine` (降级路径) | ⚠️ | 当前只在下层 retry, 未上升到 MissionController |
| **降级** | `CostController.suggestAction()` | ⚠️ | 只告警不自动降级 |
| **请求人工** | `ApprovalGate.requestApproval()` + `AlertEngine.emit()` | ✅ | 明确的事件 + 审批门 |
| **修改架构** | `SelfImprovementLoop` → `EvolutionProposal` → Human | ✅ | 只提案不改代码 |

### 4.2 架构腐化检测

| 反模式 | 状态 | 证据 |
|--------|------|------|
| **Planner 控制 Execution** | ❌ 未发现 | `DeliveryPlanner` 只产出 Plan, `UnifiedExecutionEngine` 只执行 |
| **Execution 修改 Plan** | ❌ 未发现 | `UnifiedExecutionEngine.execute()` 不修改 Plan 对象 |
| **Agent 自决策架构** | ❌ 未发现 | Agent 没有导入架构模块的路径 |
| **绕过 EventBus 通信** | ❌ 未发现 | 所有跨模块通信经过 EventBus |
| **模块循环依赖** | ❌ 未发现 | `tsc` 零错误证明无循环依赖 |

### 4.3 控制权风险

**风险 1: MissionController 有责无权**
```
MissionController 负责"管理"Mission, 但:
- 不能暂停 Execution (无权)
- 不能重新规划 (无权)
- 不能分配资源 (无权)
它只是一个"观察者"而不是"控制器"。
```

**风险 2: UnifiedExecutionEngine 隐式决策**
```
ExecutionEngine 内部有复杂度自适应 (simple→Fabric, medium→DAG, complex→Mission)
但这个决策对外部不可见, MissionController 不知道选择了什么执行模式。
```

**风险 3: 降级路径无记录**
```
当 ToolFactory.generateToolForTask() 从 LLM 降级到预设模板时,
当 DeliveryPlanner 从 full 降级到 quick 时,
这些降级决策没有记录到 MissionController.timeline 中。
```

---

## 五、长期运行能力审计

### 5.1 30 天任务推演

```
目标: "开发空气检测设备并销售到 Amazon"
```

| 时间 | 事件 | 系统行为 | 状态保持 |
|------|------|----------|----------|
| **Day 1** | 产品规划 | `MissionController.createMission()` → `phase:'DISCOVERY'` | ✅ MissionState 创建 |
| **Day 7** | 硬件失败 | `MissionController.addBlock('RESOURCE_UNAVAILABLE', '传感器缺货')` | ✅ Blocked 记录 |
| **Day 15** | 供应链变化 | `MissionController.addRisk('HIGH', 'PCB良率低', 0.8)` | ✅ Risk 记录 |
| **Day 20** | 重新设计 | `ConflictResolver.suggestReplan()` → 人工介入 | ⚠️ 建议生成, 但自动重新设计无 |
| **Day 30** | 上线 | `MissionController.updateMission({status:'COMPLETED'})` | ✅ 完成 |

### 5.2 长期运行缺口

| 能力 | 状态 | 问题 |
|------|------|------|
| **持久化** | ❌ 全部内存 | Node.js 重启 → 所有 Mission/Artifact/Experience 丢失 |
| **断点恢复** | ❌ 无 | 系统重启后无法恢复 Day 15 的 Mission 状态 |
| **定时检查** | ❌ 无 | 系统不知道 Day 7 到了该检查传感器 |
| **外部事件** | ❌ 无 | 供应链变化需要人工输入到系统 |
| **自动重试** | ⚠️ 部分 | Execution 层面有 retry, 但 Mission 层面无 replan |
| **决策记录** | ✅ Timeline | MissionController.timeline[] 记录所有事件 |

### 5.3 修复建议

```
短期 (v16.1):
- EventStore + SQLite 持久化 MissionState 和 ArtifactNode
- MissionController.loadFromStore(missionId) 断点恢复

中期 (v17):
- 定时器引擎: MissionScheduler.milestoneCheck()
- 外部事件适配器: supplyChainEvent → MissionController.addBlock()

长期:
- Event Sourcing: 所有 Mission 变更通过 EventStore 重放
```

---

## 六、商业化/生态能力审计

### 6.1 Workflow Plugin 架构评估

```
MorPex Core (packages/core/)
    │
    │  WorkflowPluginRegistry (findForGoal/getActions)
    │  WorkflowProvider (interface)
    │
    ├── packages/workflows/ecommerce/   ← 可选安装
    │   ├── manifest.json
    │   ├── actions/amazon.ts
    │   ├── artifacts/types.ts
    │   └── validators/amazon-policy.ts
    │
    ├── packages/workflows/hardware/    ← 可选安装
    │   └── manifest.json
    │
    ├── packages/workflows/software/    ← 可选安装
    │   └── manifest.json
    │
    └── packages/workflows/research/   ← 未来
        └── manifest.json
```

### 6.2 插拔性检查

| 能力 | 状态 | 证据 |
|------|------|------|
| Core 是否知道具体 Workflow？ | ❌ 不知道 | WorkflowProvider 接口隔离, Core 只调用 `matchGoal()` / `getActions()` |
| 新增 Workflow 是否需要改 Core？ | ❌ 不需要 | 只需实现 WorkflowProvider 接口 + 注册到 WorkflowPluginRegistry |
| 多 Workflow 能否共存？ | ✅ 能 | `findForGoal()` 返回匹配的 WorkflowProvider[] 数组 |
| Workflow 能否有私有数据？ | ⚠️ 有限 | 当前只传 `params: Record<string, unknown>` |
| Workflow 能否有私有 UI？ | ❌ 不能 | 无前端 SDK |
| Workflow 间能否通信？ | ❌ 不能 | 通过 EventBus 但无 Workflow 间协议 |

### 6.3 商业化风险

**风险 1: 无包管理器**
```
当前没有:
- morpex install ecommerce (无 CLI)
- 版本管理 (无 semver 检查)
- 依赖解析 (无: workflow-b 依赖 workflow-a)
- 注册中心 (无公共 registry)
结论: 架构正确, 但距离商业化至少缺包管理器
```

**风险 2: Core 膨胀趋势**
```
49 个目录 → 每个版本新增 3-5 个目录
v12: 26 核心模块
v13: +5 (brain/ planner/ tools/ governance/ bootstrap)
v14: +5 (goal-intelligence/ artifact/ verification/ experience/ bootstrap)
v15: +5 (organization/ workflow/ capability/ simulation/ bootstrap)
v16: +4 (mission-control/ capability/ simulation/ bootstrap)
     ─────────────────────────────────
     维持这个速度, v20 将达到 ~70 个模块

风险: 架构复杂度超过实际交付能力
```

**风险 3: 插件市场缺失**
```
商业化的核心是"插件市场", 而不是"插件接口"。
当前有 WorkflowProvider 接口, 但没有:
- 插件发现市场
- 安装/卸载协议
- 版本兼容性检查
- 付费/授权机制
```

---

## 七、过度设计审计

### 7.1 建议合并的模块

| 合并候选 | 理由 | 建议 |
|----------|------|------|
| `goal-intelligence/` + `capability/` | 目标理解和能力发现是同一个过程的两步 | 合并为 `intelligence/` |
| `verification/ComplianceChecker` + `verification/ApprovalGate` | 合规检查和审批是连续的 | 合并到 `verification/` (已在一个目录, 结构合理) |
| `brain/ReflectionEngine` + `brain/SelfImprovementLoop` | 都是元认知, 反思→改进是连续过程 | 合并为 `brain/meta/` |
| `governance/RuntimeManager` + `governance/CostController` + `governance/AlertEngine` | 都是横向运行时治理 | 保持单例但合并到 `governance/` 下的一个 `index.ts` 统一导出 |
| `experience/` + `evolution/` | 经验挖掘和 SOP 提取是同类 | 考虑合并, 但功能差异大, 暂缓 |

### 7.2 纯接口包装模块

| 模块 | 包装对象 | 是否必要 |
|------|----------|----------|
| `artifact/ArtifactFacade` | 包装 `planes/artifact-plane/` (12 个文件) | ✅ 必要 — 提供简洁 API, 隐藏底层复杂度 |
| `workflow/WorkflowProvider` + `WorkflowPluginRegistry` | 工作流插件接口 | ✅ 必要 — 核心扩展点 |
| `experience/ExperienceMiner` | 包装 PatternExtractor + CapabilityStore | ⚠️ 可接受 — 统一入口 |
| `goal-intelligence/GoalIntelligenceFacade` | 包装 GoalParser + RequirementExtractor + ConstraintAnalyzer | ✅ 必要 — Facade 模式 |

### 7.3 可延迟实现的功能

| 功能 | 当前状态 | 建议 |
|------|----------|------|
| `simulation/ExecutionSimulator` | 规则基础版 (无 LLM) | ✅ 可延迟 — 规则版已够用, LLM 版等真实场景驱动 |
| `SelfImprovementLoop` 的 ProposalSimulator | 接口已定义, 无实现 | ✅ 可延迟 — 等有足够历史数据再实现 |
| Workflow 包的 actions (amazon.ts) | 全部 MOCK | ✅ 可延迟 — 等真实 API 对接时再实现 |
| Workflow 插件加载器 | 不存在 | ✅ 可延迟 — 等需要动态加载时再实现 |
| MissionState 持久化 | 不存在 | ❌ **不可延迟** — 长期运行任务的基础 |

### 7.4 模块依赖拓扑

```
                         CompanyFacade
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
   GoalIntelligence    CapabilityRegistry   MissionController
         │                    │                    │
         └────────┬───────────┘                    │
                  ▼                                │
         DynamicTeamOrchestrator                   │
                  │                                │
                  ▼                                │
         WorkflowRegistry                          │
                  │                                │
                  ▼                                │
         UnifiedExecutionEngine                    │
                  │                                │
         ┌────────┼────────┐                       │
         ▼        ▼        ▼                       │
    Artifact  Verification  Compliance             │
         │        │         │                      │
         └────────┼─────────┘                      │
                  ▼                                │
           ApprovalGate                            │
                  │                                │
                  ▼                                │
         ExperienceMiner / SelfImprovement         │
                  │                                │
                  ▼                                │
            MetaLearner ───── (弱反馈) ─────▶ GoalIntelligence
                  │
                  ▼
            CapabilityRegistry.updateSuccessRate (未实现)
```

**观察**: MissionController 和其他模块没有双向连接。它是一个"旁观者"——记录状态但不控制流程。这与"项目总控"的命名不符。

---

## 八、审计结论

### 8.1 各维度评分

| 维度 | 评分 | 说明 |
|------|------|------|
| **控制流闭环** | 7/10 | Learning→Goal 反馈弱, Verification→Re-execution 未闭环 |
| **数据流贯通** | 6/10 | TeamContext/WorkflowContext 丢失, MissionState 只读, 3 个 Artifact 模型 |
| **控制权清晰** | 8/10 | MissionController 有责无权, ExecutionEngine 隐式决策 |
| **长期运行** | 3/10 | **全部内存, 无持久化, 无断点恢复, 无定时检查** |
| **商业化/生态** | 5/10 | 接口正确但缺包管理器、插件市场、真实 API |
| **不过度设计** | 7/10 | 49 个目录可合并为 ~40, 部分模块可延迟 |

### 8.2 最大风险

```
🔴 风险 1: 全部内存 (长期运行能力 3/10)
   MissionState / ArtifactNode / CapabilityStore 全在内存
   Node.js 重启 → 全部丢失
   影响: 30 天任务不可恢复

🔴 风险 2: 模块膨胀速度 (49 目录, 每版 +4)
   维持当前速度 → v20 达到 ~70 模块
   复杂度增长 > 交付能力增长
   建议: v17 做一次精简合并

🟡 风险 3: MissionController 有责无权
   承担"项目总控"之名, 但控制力 == 记录事件
   不能暂停/恢复/分配资源
   需要: MissionController → EventBus → Execution 的双向通信

🟡 风险 4: 3 个 Artifact 模型并存
   planes/artifact-plane/types.ts (v10)
   contracts/artifact.ts (v14)
   contracts/artifact-lifecycle.ts (v16)
   需要: 统一为 contracts/artifact.ts
```

### 8.3 建议路线

```
v16.1 (立即):
- 持久化: EventStore + SQLite → MissionState / ArtifactNode
- MissionController ↔ Execution 双向通信 (暂停/恢复)
- 合并 Artifact 3 模型为 1 个
- TeamContext 传递到 ExecutionRequest

v17 (精简):
- 合并 goal-intelligence + capability → intelligence/
- 合并 brain/meta/ (ReflectionEngine + SelfImprovementLoop)
- 合并 experience + evolution → evolution/
- 目标: 49 目录 → ~40

v18 (商业化):
- CLI: morpex install/remove/list workflow
- 包管理: semver + 依赖解析
- Workflow API 真实对接 (至少 1 个)
- 插件市场协议
```
