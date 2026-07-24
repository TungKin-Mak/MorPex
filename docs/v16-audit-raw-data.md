# MorPex v16 — 审计原始数据

> 提供原始数据用于自行审计，不做结论。
> 版本: v16 (4449b29) | 499 .ts 文件 | 53 架构目录

---

## 目录

1. [控制流数据](#1-控制流数据)
2. [数据流数据](#2-数据流数据)
3. [控制权数据](#3-控制权数据)
4. [长期运行数据](#4-长期运行数据)
5. [商业化/生态数据](#5-商业化生态数据)
6. [过度设计数据](#6-过度设计数据)

---

## 1. 控制流数据

### 1.1 完整调用链

```
CompanyFacade.executeGoal()
  ├─ GoalIntelligenceFacade.understandGoal()        [facade/CompanyFacade.ts:173]
  │   ├─ GoalParser.parse()                         [goal-intelligence/GoalParser.ts]
  │   ├─ RequirementExtractor.extract()             [goal-intelligence/RequirementExtractor.ts]
  │   ├─ ConstraintAnalyzer.analyze()               [goal-intelligence/ConstraintAnalyzer.ts]
  │   └─ GoalValidator.validate()                   [goal-intelligence/GoalValidator.ts]
  │
  ├─ MissionController.createMission()              [mission-control/MissionController.ts:13]
  │     (仅在 bootstrap-v16.ts 中实例化, 无人调用 createMission)
  │
  ├─ CapabilityDiscoverer.discover()                [capability/CapabilityDiscoverer.ts]
  │     (在 DynamicTeamOrchestrator.orchestrate() 中调用)
  │
  ├─ DynamicTeamOrchestrator.orchestrate()           [organization/DynamicTeamOrchestrator.ts:25]
  │   ├─ CapabilityDiscoverer.discover()
  │   ├─ WorkflowRegistry.findForGoal()
  │   ├─ TeamBuilder.buildTeams()
  │   ├─ AgentAllocator.allocate()
  │   └─ DependencyCoordinator.buildGraph()
  │
  ├─ DeliveryPlanner.createPlan()                   [planner/DeliveryPlanner.ts:220]
  │
  ├─ UnifiedExecutionEngine.execute()               [execution/UnifiedExecutionEngine.ts:198]
  │   ├─ executeAuto() → ActionExecutor | Fabric | DAG | Mission
  │   └─ ArtifactFacade.createFromTask() (成功时自动调用) [execution/UnifiedExecutionEngine.ts:263]
  │
  ├─ ArtifactFacade.createFromTask()                [artifact/ArtifactFacade.ts:65]
  │   ├─ ArtifactFacade.create()
  │   └─ transition(CREATED)
  │
  ├─ VerificationEngine.verify()                    [verification/VerificationEngine.ts:13]
  │   (bootstrap 中实例化, 无人调用 verify)
  │
  ├─ ComplianceChecker.check()                      [verification/ComplianceChecker.ts]
  │   (bootstrap 中实例化, 无人调用 check)
  │
  ├─ ApprovalGate.requestApproval()                 [verification/ApprovalGate.ts:23]
  │   (bootstrap 中实例化, 无人调用 requestApproval)
  │
  ├─ BrainFacade.learn()                            [cognition/BrainFacade.ts:568]
  │   (被 bootstrap 事件 'brain.learn.request' 触发, 非 executeGoal 直接调用)
  │
  ├─ ExperienceMiner.mineFromCompletedTask()        [experience/ExperienceMiner.ts:5]
  │   (bootstrap 中实例化, 无人调用 mineFromCompletedTask)
  │
  └─ SelfImprovementLoop.runAnalysis()              [brain/SelfImprovementLoop.ts:26]
      (bootstrap 中实例化, 无人调用 runAnalysis)
```

### 1.2 EventBus 事件清单

```
发射方 → 事件类型                           → 消费者
─────────────────────────────────────────────────────────────
MissionController    mission.created        → (无人监听)
MissionController    mission.blocked        → (无人监听)
BrainFacade          brain.learning.completed → DeliveryPlanner, GovernanceDashboard
BrainFacade          brain.reflection.completed → (无人监听)
BrainFacade          brain.meta.learned     → DeliveryPlanner, GovernanceDashboard
BrainFacade          brain.memory.stored    → MemoryWiki, GovernanceDashboard
BrainFacade          brain.knowledge.synthesized → GovernanceDashboard
DeliveryPlanner      planner.plan.started   → UnifiedExecutionEngine, GovernanceDashboard
DeliveryPlanner      planner.plan.completed → BrainFacade, GovernanceDashboard
DeliveryPlanner      planner.plan.failed    → BrainFacade, GovernanceDashboard
UnifiedExecutionEngine execution.engine.started → GovernanceDashboard
UnifiedExecutionEngine execution.engine.completed → BrainFacade, GovernanceDashboard
UnifiedExecutionEngine execution.engine.failed → BrainFacade, GovernanceDashboard
ToolRegistry         tools.registry.registered → GovernanceDashboard
ToolRegistry         tools.registry.stats_updated → ToolQualityTracker, GovernanceDashboard
DepartmentManager    department.created     → RoleRegistry, KpiTracker
DepartmentManager    department.updated     → ManagementHub
DepartmentManager    department.deleted     → EventBus cleanup
ArtifactFacade       artifact.created       → (无人监听)
ArtifactFacade       artifact.approved      → (无人监听)
ApprovalGate         approval.auto_approved → (无人监听)
ApprovalGate         approval.wait_human    → (无人监听)
```

### 1.3 闭环缺口数据

```
缺口 1: Learning → Goal
  证据: GoalIntelligenceFacade 没有注入 MetaLearner
  grep "MetaLearner\|learnFromTask" packages/core/src/goal-intelligence/  → 空

缺口 2: Verification → Re-execution
  证据: VerificationEngine.verify() 返回 repair plan, 但无人消费
  grep "VerificationEngine\|\.verify(" packages/core/src/execution/  → 空
  grep "VerificationEngine\|\.verify(" packages/core/src/facade/    → 空

缺口 3: MissionController → Execution
  证据: MissionController 只记录事件, 不控制 Execution
  grep "MissionController\|missionController\." packages/core/src/execution/ → 空
  grep "MissionController\|missionController\." packages/core/src/facade/   → 空
```

---

## 2. 数据流数据

### 2.1 核心对象定义位置

| 对象 | 定义文件 | 行数 |
|------|----------|------|
| `GoalContext` | `contracts/goal.ts` | 18 |
| `MissionState` | `mission-control/MissionTypes.ts` | 18 |
| `DynamicTeam` | `organization/types.ts` | 10 |
| `TeamMember` | `organization/types.ts` | 10 |
| `DependencyGraph` | `organization/types.ts` | 8 |
| `ArtifactNode` | `contracts/artifact-lifecycle.ts` | 16 |
| `Artifact` | `contracts/artifact.ts` | 10 |
| `Capability` | `capability/CapabilityRegistry.ts` | 10 |
| `Capability` (old) | `agent/capability/Capability.ts` | 15 |
| `ExecutionResult` | `execution/UnifiedExecutionEngine.ts` | 12 |
| `BrainExperience` | `cognition/BrainFacade.ts` | 12 |
| `GoalContext` (传递) | `facade/CompanyFacade.ts:173` | - |

### 2.2 对象传递路径

```
GoalContext:
  create: GoalIntelligenceFacade.understandGoal() → GoalContext
  consume: DynamicTeamOrchestrator.orchestrate(goalCtx)  ✅
  consume: CapabilityDiscoverer.discover(goalCtx)        ✅
  NOT passed to: DeliveryPlanner, UnifiedExecutionEngine ❌

MissionState:
  create: MissionController.createMission(goalId, objective) → MissionState
  consume: (无人消费 — 仅 bootstrap 实例化)                    ❌
  NOT passed to: any execution path                           ❌

DynamicTeam:
  create: DynamicTeamOrchestrator.orchestrate() → DynamicTeam[]
  consume: (无人消费 — 仅在 bootstrap 中创建)                   ❌
  NOT passed to: ExecutionRequest                              ❌

Capability:
  create: CapabilityRegistry (静态注册, 9 项内置)
  consume: CapabilityDiscoverer.discover() → matched[]        ✅
  consume: DynamicTeamOrchestrator → TeamBuilder              ✅
  NOT updated by: ExperienceMiner (successRate 从不更新)       ❌

ArtifactNode:
  create: ArtifactFacade.create() → ArtifactNode
         ArtifactFacade.createFromTask() (向后兼容)
  consume: (无人 — verify 接口接收 Artifact[] 但从未被调用)     ❌

ExecutionResult:
  create: UnifiedExecutionEngine.execute() → ExecutionResult
  consume: CompanyFacade.executeGoal() → return.execution     ✅
  consume: ArtifactFacade.createFromTask(executionId, ...)    ✅
```

### 2.3 重复模型清单

```
Artifact:
  1. planes/artifact-plane/types.ts (v10, ~12 个类型)
  2. contracts/artifact.ts (v14, Artifact 接口)
  3. contracts/artifact-lifecycle.ts (v16, ArtifactNode + ArtifactLineageEntry)
  → 3 个版本共存

MissionState:
  1. runtime/mission/types.ts (v8, 24 状态 FSM)
  2. mission-control/MissionTypes.ts (v16, 简化 5 状态)
  → 2 个版本, 命名相同但结构不同

Capability:
  1. agent/capability/Capability.ts (v8, Agent 级)
  2. capability/CapabilityRegistry.ts (v16, 工作流级)
  → 2 个版本, 同名词不同结构

PolicyRule:
  1. control/PolicyEngine.ts (v8)
  2. verification/PolicyRuleRegistry.ts (v15)
  → 已用别名解决, 但领域重叠

WorkflowRegistry:
  1. evolution/ (v10, Workflow SDK)
  2. workflow/WorkflowProvider.ts (v15, 插件系统)
  → 已用别名解决
```

### 2.4 数据孤岛清单

```
孤岛 1: TeamContext 未传递到 Execution
  证据: ExecutionRequest 接口没有 teamId/teamName 字段
  grep -n "team\|Team" packages/core/src/execution/UnifiedExecutionEngine.ts | head -5
  → 只出现 "TeamSayTool", 无 DynamicTeam 相关

孤岛 2: MissionController 只写不读
  证据: MissionController 的方法在所有非 bootstrap 代码中引用数为 0
  grep -rn "missionController\.\|\.createMission\|\.addBlock\|\.addRisk" packages/core/src/
  → bootstrap-v16.ts 外: 空

孤岛 3: ApprovalGate 无消费者
  证据: ApprovalGate.requestApproval() 在非 bootstrap 代码中引用数为 0
  grep -rn "approvalGate\.\|\.requestApproval(" packages/core/src/ --include="*.ts"
  → 只有 verification/ApprovalGate.ts 自身和 runtime/approval/ApprovalEngine.ts (不同的类)

孤岛 4: ExecutionSimulator 无消费者
  证据: simulate() 在非 bootstrap 代码中引用数为 0 (除 SelfImprovementLoop)
  grep -rn "executionSimulator\.\|ExecutionSimulator" packages/core/src/
  → 只有 bootstrap-v16.ts 和 simulation/ 自身

孤岛 5: CapabilityRegistry.successRate 从不更新
  证据: 没有任何代码写入 successRate
  grep -rn "successRate\|\.successRate" packages/core/src/capability/
  → 只在 CapabilityRegistry.ts 中定义和读取, 无写入
```

---

## 3. 控制权数据

### 3.1 决策者清单

```
决策                             执行者                          调用方
──────────────────────────────────────────────────────────────────────────
创建团队          DynamicTeamOrchestrator.orchestrate()       bootstrap-v16.ts
选择 Workflow     WorkflowRegistry.findForGoal()              DynamicTeamOrchestrator
选择执行模式      UnifiedExecutionEngine.resolveMode()       UnifiedExecutionEngine.execute()
                   (auto: fabric→dag→mission 降级链)
调整计划          ConflictResolver.suggestReplan()            (无人调用)
重试              (ExecutionEngine 内部 retry, 无外部控制)     -
降级              CostController.suggestAction()              (无人调用)
请求人工审批      ApprovalGate.requestApproval()              (无人调用)
修改架构          SelfImprovementLoop.runAnalysis()           (无人调用)
                  → EvolutionProposal (只提案不改代码)
创建 Mission      MissionController.createMission()           (无人调用)
添加阻塞          MissionController.addBlock()                (无人调用)
```

### 3.2 决策链路

```
目标理解:    GoalIntelligenceFacade (独立, 无外部输入)
能力发现:    CapabilityDiscoverer (静态, 基于 CapabilityRegistry)
工作流匹配:  WorkflowRegistry (静态注册, 无运行时加载)
团队创建:    DynamicTeamOrchestrator (基于能力+工作流, 无人工确认)
执行模式:    UnifiedExecutionEngine (auto 模式, 内部决策, 外部不可见)
产物创建:    ArtifactFacade (执行成功后自动, 无确认)
验证:        VerificationEngine (接口已定义, 无调用方)
合规检查:    ComplianceChecker (接口已定义, 无调用方)
审批门:      ApprovalGate (LOW+PASS→自动, BLOCK/HIGH→等人)
提案:        SelfImprovementLoop (只提案, 不改代码)
```

### 3.3 架构腐化证据

```
Planner 控制 Execution: ❌
  证据: DeliveryPlanner 产出 Plan, UnifiedExecutionEngine 消费 Plan
  Plan 是纯数据对象, 不包含可执行代码

Execution 修改 Plan: ❌
  证据: UnifiedExecutionEngine.execute() 不修改 request 中的 plan
  grep "plan\." packages/core/src/execution/UnifiedExecutionEngine.ts | head -5
  → 只读取 request.goal, 无 plan 字段

Agent 自决策架构: ❌
  证据: agent/ 下的文件不 import architecture 模块
  grep -rn "import.*brain\|import.*planner\|import.*execution" packages/core/src/agent/ | head -5
  → 只 import common/EventBus, 无架构模块

绕过 EventBus 通信: ❌
  证据: 所有跨模块调用通过 EventBus 事件
```

---

## 4. 长期运行数据

### 4.1 存储方式

```
模块            存储结构              持久化?
─────────────────────────────────────────────
MissionState     Map<string, MissionState>    ❌ 内存
ArtifactNode     Map<string, ArtifactNode>    ❌ 内存
CapabilityStore  Map<string, Capability>      ❌ 内存 (静态类)
SOPRegistry      Map<string, SOP>            ❌ 内存 (静态类)
Experience       Map (内部)                   ❌ 内存
BrainFacade      Array fallbackStore          ❌ 内存
Evolution        Map (内部)                   ❌ 内存
DynamicTeam      Map<string, DynamicTeam>     ❌ 内存
TaskGraph        Map (内部)                   ❌ 内存
```

### 4.2 持久化基础设施 (已存在但未接入)

```
EventStore (packages/core/src/protocol/events/store/):
  ├── IEventStore.ts        — 接口定义 (append/query/replay)
  ├── SqliteEventStore.ts   — SQLite 实现
  ├── UnifiedEventStore.ts  — 统一封装
  ├── EventRepository.ts    — 查询层
  └── MigrationRunner.ts    — 数据库迁移

现有测试:
  packages/core/__tests__/unified-eventstore.test.ts  (14 测试, 全部通过)
  支持: append/query/replay/batch/stream/decision
```

### 4.3 30 天任务推演数据

```
Day 1:  产品规划
  GoalIntelligence.understandGoal() → GoalContext { objective, caps }
  MissionController.createMission() → MissionState { phase:'DISCOVERY' }
  → 全部在内存, 系统重启后丢失

Day 7:  传感器缺货
  假设: 外部调用 MissionController.addBlock('RESOURCE_UNAVAILABLE', '传感器缺货')
  → status: 'BLOCKED', 但 Execution 不知道, 继续执行后续步骤

Day 15: PCB 失败 3 次
  假设: 外部调用 MissionController.addRisk('HIGH', 'PCB良率低', 0.8)
  → risks[] 追加, 但无人消费这个风险

Day 20: 重新设计
  ConflictResolver.suggestReplan() → 返回建议字符串
  → 无人消费, 不触发任何重新规划

Day 30: 上线
  MissionController.updateMission({status:'COMPLETED'})
  → timeline 记录, 但 ArtifactFacade 和 MissionController 不联动
```

---

## 5. 商业化/生态数据

### 5.1 Workflow Plugin 现状

```
Core 接口:   workflow/WorkflowProvider.ts (29 行)
  - WorkflowProvider (interface) — 4 方法: getActions/getArtifactTypes/getValidators/matchGoal
  - WorkflowRegistry (static class) — 4 方法: register/get/findForGoal/getAll
  - WorkflowAction (interface) — execute(params, context)

Workflow 包: packages/workflows/
  ├── ecommerce/
  │   ├── manifest.json        — 声明 actions/artifacts/validators
  │   ├── actions/amazon.ts    — 3 个 mock action (createListing/uploadImage/updatePrice)
  │   ├── artifacts/types.ts   — 3 个类型 (ListingJSON/ProductImage/KeywordReport)
  │   ├── validators/amazon-policy.ts — 1 个 checker (标题/描述/价格)
  │   └── index.ts             — barrel
  ├── hardware/manifest.json   — 空壳 (仅 manifest)
  └── software/manifest.json   — 空壳 (仅 manifest)
```

### 5.2 Core 对 Workflow 的感知度

```
Core 是否 import 任何 workflow 包?
  find packages/core -name "*.ts" -exec grep -l "ecommerce\|hardware\|software" {} \;
  → 空 (Core 完全不知道具体 workflow)

Core 是否依赖 Workflow 包的接口?
  WorkflowProvider 接口在 packages/core/src/workflow/ 中定义
  WorkflowProvider 接口无任何实现类 (implements)
  → Core 只定义接口, 不依赖实现

Workflow 包是否依赖 Core?
  packages/workflows/ecommerce/actions/amazon.ts
  import: 无 (纯独立类型)
  → Workflow 包可以独立发布
```

### 5.3 商业化缺失清单

```
缺失 1: 无包管理 CLI
  morpex install ecommerce  → 不存在
  morpex list               → 不存在
  morpex remove ecommerce   → 不存在

缺失 2: 无动态加载
  WorkflowRegistry.register() 需要显式调用
  没有从 packages/workflows/*/manifest.json 自动发现和加载

缺失 3: 无版本管理
  manifest.json 有 version 字段, 但无 semver 检查
  无依赖解析 (workflow-b 依赖 workflow-a)
  无兼容性检查

缺失 4: 无实现类
  grep -rn "implements WorkflowProvider" packages/  → 空
  所有 workflow 包的 actions 都定义了函数, 但没有类实现 WorkflowProvider 接口
```

---

## 6. 过度设计数据

### 6.1 模块大小

```
模块              行数     文件数    平均行数/文件
──────────────────────────────────────────────────
cognition         7,429    24        310    ← 最大 (含 BrainFacade 1034 行)
evolution         4,161    21        198    ← 第二大
execution         1,823     5        365    ← 第三
planner           1,117     3        372
organization        768     8         96
brain               632     7         90
governance          507     5        101
verification        312     9         35
goal-intelligence   138     7         20
experience          118     5         24
artifact             98     2         49
capability           87     3         29
simulation           72     2         36
workflow             41     2         21
mission-control     169     5         34
```

### 6.2 壳文件清单 (仅 export 转发, 无业务逻辑)

```
文件                                                行数
────────────────────────────────────────────────────────
packages/core/src/agent/registry/index.ts             1
packages/core/src/agent/benchmark/index.ts             2
packages/core/src/agent/capability/index.ts            2
packages/core/src/agent/communication/index.ts         2
packages/core/src/agent/context/index.ts               2
packages/core/src/agent/evolution/index.ts             2
packages/core/src/agent/lifecycle/index.ts             2
packages/core/src/agent/memory/index.ts                2
packages/core/src/agent/optimizer/index.ts             2
packages/core/src/agent/ranking/index.ts               2
packages/core/src/evolution/workflow/contract/index.ts 2
packages/core/src/evolution/workflow/testing/index.ts  2
packages/core/src/runtime/budget/index.ts              2
packages/core/src/runtime/compensation/index.ts        2
packages/core/src/runtime/sandbox/index.ts             2
packages/core/src/runtime/state-machine/index.ts       2
packages/core/src/simulation/index.ts                  2
packages/core/src/workflow/index.ts                    2
packages/core/src/agent/scheduler/index.ts             3
packages/core/src/artifact/index.ts                    3
packages/core/src/mirror/storage/index.ts              3
```

### 6.3 有接口无实现的模块

```
模块/类                  接口定义         实现状态
──────────────────────────────────────────────────────
WorkflowProvider         workflow/        packages/workflows/ 有文件但无 implements
WorkflowAction           workflow/        packages/workflows/ 的函数未实现 ActionHandler 接口
ProposalSimulator        brain/SelfImprovementLoop.ts    接口已定义, 未注入
SimulationEngineLike     planner/DeliveryPlanner.ts      接口已定义, 未注入
MetaPlannerLike          planner/DeliveryPlanner.ts      接口已定义, 未注入
CognitivePipelineLike    planner/DeliveryPlanner.ts      接口已定义, 未注入
ExecutionFabricLike      execution/UnifiedExecutionEngine.ts 接口已定义, 未注入
MissionRuntimeLike       execution/UnifiedExecutionEngine.ts 接口已定义, 已注入 MissionRuntime
DAGRuntimeLike           execution/UnifiedExecutionEngine.ts 接口已定义, 已注入 DAGRuntime
```

### 6.4 模块引用计数 (bootstrap 之外的运行时引用)

```
模块                    bootstrap 外引用数    是否活跃
─────────────────────────────────────────────────────
MissionController       0                     ❌ 幽灵
CapabilityDiscoverer    1                     ✅ (DynamicTeamOrchestrator)
CapabilityRegistry      1                     ✅ (CapabilityDiscoverer)
ExecutionSimulator      0                     ❌ 幽灵
ApprovalGate            0                     ❌ 幽灵
ArtifactFacade          1                     ✅ (UnifiedExecutionEngine)
VerificationEngine      0                     ❌ 幽灵
ComplianceChecker       0                     ❌ 幽灵
ExperienceMiner         0                     ❌ 幽灵
SelfImprovementLoop     0                     ❌ 幽灵
ConflictResolver        0                     ❌ 幽灵
ProgressTracker         0                     ❌ 幽灵
DynamicTeamOrchestrator 0                     ❌ 幽灵
RuntimeManager          0                     ❌ 幽灵
CostController          0                     ❌ 幽灵
AlertEngine             0                     ❌ 幽灵
```

### 6.5 模块增长曲线

```
版本     模块目录数  新增
──────────────────────
v11      79         原始
v12      26         -53 (归档)
v13      +5         brain, governance, planner增强, tools增强
v14      +6         goal-intelligence, artifact, verification, experience, contracts, simulation
v15      +5         organization增强, workflow, capability, verification增强, governance增强
v16      +4         mission-control, capability, simulation, contracts增加

趋势: 每版本 +4~6 目录, 维持此速度 v20 将达 ~70 目录
```

---

## 附录: 关键命令

```bash
# 编译验证
npx tsc --noEmit

# 生产检查
node scripts/production-check.cjs

# 运行 v13 测试
npx vitest run packages/core/__tests__/v13-*

# 查找模块引用
grep -rn "MissionController" packages/core/src/ --include="*.ts" | grep -v "bootstrap"

# 查找重复标识符
grep -rn "interface Artifact\b" packages/core/src/contracts/
grep -rn "enum MissionState\b" packages/core/src/runtime/mission/

# 查找壳文件
find packages/core/src -name "index.ts" -exec wc -l {} + | sort -n | head -20

# 查找未消费接口
grep -rn "interface.*Like\b" packages/core/src/execution/UnifiedExecutionEngine.ts
```
