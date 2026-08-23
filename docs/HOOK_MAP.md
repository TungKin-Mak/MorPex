# HOOK_MAP — MorPex 接入点地图（新功能插在哪 / 在哪个函数前·后）

> 用途：开发流程第二步「找插入点」。当 `CAPABILITY_INDEX.md` 判定"该功能未实现"时，从这里选一个**合法接入点**，并按"前后顺序"插入，保证消息传递与数据流不乱。
> 原则：**优先扩展点，不改核心链**；每个接入点标注"在哪个函数/事件的前还是后 + 消息怎么传"。

---

## 1. 常用接入点速查

| 接入点 | 位置（文件） | 前 / 后顺序 | 消息传递 | 举例 |
|---|---|---|---|---|
| **新通用原语** | `DomainPrimitiveRegistry.register`（`infrastructure/tools/`） | register 后 → agent 工具循环可调 | 经 `primitiveAgentTools` 暴露为 LLM 工具 | 加"发邮件"原语 |
| **领域行动** | `packages/workflows/<domain>/src/actions/`·ActionPrimitive | `matchGoal` 命中 → 执行 | 经 workflows provider 挂载 | ecommerce 加"比价" |
| **新工具** | `infrastructure/tools/`（ToolFactory/ToolRegistry 注册） | 注册后 → step-agent 工具声明 | agent 工具声明含它 | 加爬虫工具 |
| **新事件** | `EventBus.emit` + `eventContractCatalog`（契约） | 挂在对应生命周期**后**（如 mission.completed 后） | 订阅者经 EventBus 收 | 任务完成后"自动汇总"监听 evaluation.profile.scored |
| **新 hook** | 订阅已有事件（`bus.on(type)`）——**最安全（不改核心）** | 被事件驱动 | 事件 → 你的逻辑 | 监听 ontology.query.miss → 通知 |
| **人工决策点** | `UserAskService` / `ApprovalGate` | 需要用户输入时中断执行 → 等答复 → 继续 | human 事件（EVENT_SPEC.human 块） | 选型/确认 |
| **执行后置** | `EvaluationEngine` 之后（evaluation.profile.scored） | 评分后，演化前 | evaluation 事件 → 订阅者 | 生成复盘报告 |
| **LLM 输入/媒体** | `PiBridge.generateText` 前的媒体装配 / `EVENT_PAYLOAD_SPEC.media` | 进 LLM 请求前 | 引用 → MediaAdapter（待建）/ 工具取用 | 传图片给模型 |
| **前端卡片** | `studio/web/src/views/` + 任务投影 `TaskStateProjector` | 事件 → 投影 → 卡片 | SSE + /api/tasks | 加"成本"卡片区 |
| **规则/合规** | `governance/PolicyRuleRegistry` + `gate/rules/` | 决策/生成前 | 前置检查 | 加合规规则 |
| **部门手册（yaml 工作流）** | `execution/runtime/manual/YamlWorkflowRuntime` + `workflows/<domain>/department/manual.yaml` | `UnifiedExecutionEngine.executeAuto` 快路径后、编排前 | `matchManual` 判定 → `YamlWorkflowRuntime.run` 经 `DAGRuntime` + `ask` 人审门 | 加部门 7 步流程 |

## 2. 主流程各阶段的"挂点"（按顺序，知道插在前还是后）

```
用户输入
  ↓ intent 分流（CompanyFacade.executeGoal）
  ↓ L1 治理：ControlPlane.checkAll ──⚠️可插：新增治理检查/审批(human)
  ↓ L3 Gate：runOntologyGroundedReasoning ──⚠️可插：新知识源/规则(rules/*)
  ↓ L4 规划：DeliveryPlanner ──⚠️可插：新规划策略/约束
  ↓ L5 执行：UnifiedExecutionEngine(MissionRuntime)
  │   ├─ 简单→原语(可加原语/hook: tool.called 后)
  │   ├─ 部门手册→YamlWorkflowRuntime（yaml+解释器，match 命中时优先于编排）
  │   └─ 复杂→OrchestratorAgent + step-agent(可加工具/capacity)
  │   ⚠️可插：问用户(UserAskService) / 熔断(BudgetManager) / 沙箱(executor)
  ↓ L6 评价：EvaluationEngine ──⚠️可插：评分后置(evaluation.profile.scored 订阅)
  ↓ L7 演化：ActiveEvolutionTrigger ──⚠️可插：新演化动作(沙箱→审批→版本化)
  ↓ 产物+记忆：ArtifactRegistry / BrainFacade.learn ──⚠️可插：产物后处理/记忆钩子
```

## 3. 三个"别乱插"提醒

1. **不改核心链**（CompanyFacade→ControlPlane→Gate→Engine 的主干）——除非是架构级需求，新功能应经"订阅事件 / 注册原语 / 新 workflow / 新前端视图"这类 hook 接入。
2. **消息格式**：新事件/卡片字段一律按 `docs/EVENT_PAYLOAD_SPEC.md`（Envelope/MessageBox，新块=加 namespace），别在旧 payload 上续字段。
3. **插入后**：按 `DEVELOPMENT.md §6` 同步文档（能力索引/职责/关系链），防"做了没接/接了没记"。

## 4. 快速决策：这个功能该插哪？

| 你想要的 | 首选 hook |
|---|---|
| 判断任务"要不要做/怎么做" | ControlPlane（治理）→ Gate（知识）|
| 让 agent 多一种"手" | 新原语/新工具 |
| 让执行完"自动多做一步" | 订阅 `evaluation.profile.scored` 或 `artifact.created` 事件 |
| 让任务过程中要我确认 | `UserAskService` / `ApprovalGate`（human 块）|
| 让 UI 多展示一块 | TaskStateProjector 投影字段 + 前端视图 |
| 让系统自己长本事 | 演化 hook（沙箱→审批→版本化）|