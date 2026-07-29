# MorPex 全景架构与数据流报告

> 生成来源: codebase-memory-mcp v0.9.0 知识图谱
> 图谱数据: 12,391 节点 · 34,223 边 · 916 源文件
> 生成时间: 2026-07-29

---

## 一、系统架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│  CEO 层: CompanyFacade（统一入口）                                   │
│  构造时强制要求: MorPexRuntime + ControlPlane                        │
│  executeGoal() 必经管线:                                             │
│    ControlPlane.checkAll() → MorPexRuntime.run()                     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│  ControlPlane（强制检查层）                                           │
│  ├─ GoalController.process()    ← 关键词过滤 + GoalIntelligence     │
│  │   └─ RiskAnalyzer.assessMission() ← 风险评估                    │
│  ├─ PolicyController.checkGoalPolicy() ← 策略合规                  │
│  │   └─ CostController 预算检查                                    │
│  └─ ResourceController.checkAvailability() ← 资源可用性             │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│  MorPexRuntime.run(goal, options?)                                   │
│  options: { simulationHardFail, ontologyHardFail, awaitApproval }    │
│                                                                      │
│  Phase 1:  Pipeline Orchestrator.orchestrate()                       │
│    ├─ GoalIntelligenceFacade.understandGoal() ← 目标理解              │
│    ├─ MissionController.createMission()       ← Mission 创建         │
│    ├─ WorkflowRegistry.findForGoal()          ← 工作流匹配           │
│    ├─ DynamicTeamOrchestrator.orchestrate()   ← 动态组队             │
│    └─ ArtifactBlueprintBuilder.fromGoal()     ← 产物蓝图              │
│                                                                      │
│  Phase 1.5: ExecutionSimulator.simulate()     ← 执行前模拟           │
│    └─ simulationHardFail=true ⇒ 不可行直接返回                        │
│                                                                      │
│  Phase 1.7: Ontology Grounded Reasoning       ← 本体推理             │
│    └─ ontologyHardFail=true ⇒ 失败中止                               │
│                                                                      │
│  Phase 2:  UnifiedExecutionEngine.execute()   ← 统一执行             │
│    ├─ resolveMode() → auto/mission/dag/fabric                        │
│    ├─ executeViaMission()  ← 轮询等待完成（非伪成功）                  │
│    ├─ executeViaDAG()      ← DAG 调度                               │
│    └─ executeViaFabric()   ← 直连执行                                │
│                                                                      │
│  Phase 3:  ArtifactFacade.create()           ← 产物创建（仅此处）      │
│                                                                      │
│  Phase 4:  Verification + Compliance + Approval                      │
│    ├─ VerificationEngine.verify()            ← 质量验证               │
│    ├─ ComplianceChecker.check()              ← 合规检查               │
│    ├─ ApprovalGate.requestApproval()         ← 审批门                 │
│    └─ awaitApproval=true ⇒ 阻塞等待人工决策                          │
│                                                                      │
│  Phase 5:  ExperienceMiner.mineFromCompletedTask() ← 经验挖掘         │
│  Phase 6:  Mission → COMPLETED                                       │
│  Phase 7:  SystemMetadataGraph.registerEntity()   ← 元数据注册        │
│  Phase 8:  SafetyMonitor.observe()                ← 安全监控          │
│  Phase 9:  SelfImprovementLoop.evolve()          ← 自我进化           │
│  Phase 9.5: EvaluationEngine.evaluate()           ← 整体评估           │
└──────────────────────────────────────────────────────────────────────┘
```

## 二、模块分布与内聚度（Leiden 社区检测）

| 排名 | 成员数 | 内聚度 | 集群标签 | 代表节点 |
|------|--------|--------|----------|----------|
| 1 | 249 | 0.978 | packages (通用工具层) | print, get, len, str |
| 2 | 142 | 0.853 | packages (代理/运行时) | initMultiAgentPlane, start |
| 3 | 102 | 0.918 | packages (编排器) | main, setupMetaPlannerEngines |
| 4 | 89 | 0.929 | bootstrap 集群 | bootstrapV16..V12, constructor |
| 5 | 80 | 0.809 | 核心运行时 | initV8Modules, emitInitTrace |
| 6 | 67 | 0.929 | 测试集群 | AssertionContext, ExecutionFSM |
| 7 | 66 | 0.946 | EventStore 子系统 | ensureDb, query, SqliteEventStore |
| 8 | 61 | 0.861 | Kernel/引导层 | bootstrapMorPexCore, spawn |
| 9 | 56 | 0.942 | LLM 调用层 | callLLM, extractJson, parseResponse |
| 10 | 51 | 0.930 | Agent 子系统 | spawnSubAgent, execute |
| 11 | 48 | 0.952 | PiBridge/执行层 | PiBridge, executeTask, executeAuto |
| 12 | 46 | 1.000 | 能力系统 | getAllCapabilities, getNodeId |

## 三、数据流闭环

```
输入 Goal
   │
   ▼
ControlPlane.checkAll()  ─── 强制检查层
   │
   ▼
PipelineOrchestrator.orchestrate()
   │
   ▼
ExecutionSimulator.simulate()  ── simulationHardFail?
   │
   ▼
Ontology Grounded Reasoning  ── ontologyHardFail?
   │
   ▼
UnifiedExecutionEngine.execute()
   ├─── MissionRuntime (FSM)
   ├─── DAGRuntime (DAG)
   └─── ExecutionFabric (直连)
   │
   ▼
ArtifactFacade.create()  ← 仅此一处创建产物
   │
   ▼
VerificationEngine + ComplianceChecker
   │
   ▼
ApprovalGate  ── awaitApproval?
   │
   ▼
ExperienceMiner
   │
   ▼
SafetyMonitor + SelfImprovementLoop
   │
   ▼
EvaluationEngine
   │
   ├─── 成功: COMPLETED
   └─── 失败: BLOCK + errors
   │
   └─── 学习闭环: Experience → CapabilityRegistry
                  Evolution → 下次规划影响
```

## 四、关键架构模式

1. **Facade 模式**: CompanyFacade / UnifiedExecutionEngine / BrainFacade
   - 对外统一 API，对内委托给具体实现
   - PiBridge 隔离层：唯一直接导入 pi-ai 的文件

2. **硬管道化执行（v16 重构后）**:
   - ControlPlane 不可跳过（构造时注入）
   - Simulation 可配置硬中止 (simulationHardFail)
   - Ontology 可配置硬中止 (ontologyHardFail)
   - Approval 可配置阻塞等待 (awaitApproval)
   - 无降级 stub 路径（Runtime 始终存在）

3. **事件驱动架构**:
   - EventBus 全局事件骨干（97 条 LISTENS_ON 边）
   - EventStore 事件溯源（SQLite 持久化）
   - 4,220 条 CALLS 边连接各模块

4. **五处状态源（待统一）**:
   - MissionController / SystemMetadataGraph / Ontology
   - ArtifactFacade / EventStore
   - 当前以 EventStore 为建议真相源

## 五、包间依赖关系

| 包 | 节点数 | 依赖方向 |
|----|--------|----------|
| core | 3,753 | → studio, workflows, memory, connectors |
| studio | 417 | → core, memory |
| archived | 399 | 无运行时依赖（已归档） |
| workflows | 291 | → core (WorkflowProvider) |
| memory | 119 | → core (MemoryWiki) |
| workflow-sdk | 74 | 独立 SDK |
| connectors | 37 | → core (IActionConnector) |

核心包 core 占全部节点的 **43%**（3753/8738），是系统绝对中心。

## 六、推荐使用方式

```typescript
// ✅ 推荐（v16 Unified — 唯一入口）
import { bootstrapUnified } from "./core/src/bootstrap-unified.js";
const { companyFacade } = await bootstrapUnified();
const result = await companyFacade.executeGoal("...");
// 必经管线: ControlPlane → Runtime(Sim/Onto/Exec/Verif/Approval/Experience)

// ❌ 废弃（旧版本 bootstrap，标记 @deprecated）
// bootstrapV12 / V13 / V14 / V15 / V15-integration / V16
```

---

*报告由 codebase-memory-mcp v0.9.0 知识图谱引擎生成*
*图谱验证: 13 个架构集群, 34,223 条关系边, 916 个源文件*
