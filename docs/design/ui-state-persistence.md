# UI 状态持久化优化方案（第一性原理推导）

> 规则：AGENTS.md §3.0「真相源第一」。本文档按该铁律盘点当前 MorPex UI 全部状态的真源，
> 提出「任务状态投影 + 决策持久化 + 前端恢复」三段式优化。目标：**任何时刻刷新/切视图/后端重启，UI 可重建**。

## 1. 现状真相源盘点（实证）

| 状态 | 当前真源 | 缺口 | 违反 §3.0 点 |
|---|---|---|---|
| 任务执行状态（steps/DAG/progress/phase） | ❌ 无投影（mission 事件仅在 EventStore 溯源，无"当前状态"可查投影） | 切视图/重启前端无法重建工作台 | 1,2,5 |
| pending 决策（plan/ask/approval） | ❌ 服务端内存 Map（PlanGateService/UserAskService/ApprovalGate） | 后端重启丢，任务可能卡死 | 1,5 |
| 任务列表摘要 | 前端 localStorage（仅摘要） | 非服务端真相，换设备/清缓存丢 | 1,2 |
| 消息历史 | ✅ chat-history jsonl | — | — |
| step-agent 会话 | ✅ AgentSessionStore jsonl | — | — |
| 执行事件流 | ✅ EventStore（SQLite） | 只存"发生过"，无任务级投影 | — |

## 2. 深层根因：任务级关联键缺失（比"没落盘"更根本）

实证：`execution.step.started/result` 的 `executionId = 'step_{nodeId}'`；`execution.dag` 的 `executionId = '{graphId}'`；
它们**都不携带 missionId / goal / 用户会话**。前端 17i.2 只能靠 `matchMissionGoal`（goal 文本 endsWith）把事件模糊归到 run。

推论：
- 事件不是"任务级"的，是"节点/步骤级"的 → 任何任务级投影无法可靠组装。
- 文本匹配在「多任务并发 + 相似目标」下必然错位（第一性原理：**ID 关联代替文本匹配**）。

## 3. 优化架构（三段式）

```
持久化真相源（新增）
├─ data/tasks/<executionId>.json   ← 任务状态投影（TaskStateProjector）
│     { executionId, missionId?, goal, spaceId, departmentId, phase, status,
│       progress, steps:[{nodeId,name,status}], dag:{nodes,edges},
│       approvals[], asks[], plan?, createdAt, updatedAt }
├─ data/decisions.jsonl            ← 未决决策持久化（DecisionStore）
│     每行 { id, kind, goal, question, options, meta, createdAt, status }
└─ data/tasks/index.json           ← 任务列表轻量索引（供 GET /api/tasks）

实时     EventBus（已有）→ TaskStateProjector / DecisionStore 增量更新 → 防抖落盘
恢复     GET /api/tasks/:id、/api/tasks、/api/decisions/pending（已有）
```

### 3.1 任务级关联键（前置改造，最关键）

给步骤/DAG事件补**执行上下文键**，由高层执行器（DAGRuntime / StepAgentExecutor 的上游）注入：
```
MorPexRuntime.run(missionId, executionId, ...)
  → 种子 ExecutionContext: { executionId, missionId, goal, spaceId, departmentId }
  → pipeline 运行时把 ExecutionContext 透传：
      execution.dag        payload += { executionId, missionId, goal }
      execution.step.*     payload += { executionId, missionId, goal }
      workflow.step_*      payload += { missionId }
```
- 事件消费端（前端 + TaskStateProjector）用 `executionId/missionId` 精确归集，**废弃 goal 文本匹配兜底**。
- 契约：`EventContext`（新增单文件类型，前后端共用）。

### 3.2 TaskStateProjector（服务端真源，新增 core/src/execution/TaskStateProjector.ts）
- 订阅：`execution.dag` / `execution.step.started|result` / `workflow.step_*` / `approval.*` / `user.ask` / `plan.ready`（+ mission 状态若上游有）。
- 维护 `Map<executionId, TaskProjection>`；事件到达 → 更新（幂等）→ 500ms 防抖落盘 `data/tasks/<execId>.json`。
- 恢复：启动扫描 data/tasks/ 载入；缺失/损坏 → 从 EventStore 按 executionId 重放事件重建（兜底，保留事件溯源正确性）。
- 暴露 `get(execId)` / `list()`。

### 3.3 DecisionStore（未决决策持久化，新增 core/src/execution/DecisionStore.ts）
- PlanGateService/UserAskService/ApprovalGate 创建 pending 时注册到 DecisionStore；落盘 `data/decisions.jsonl`（append）+ 启动 restore 回内存。
- `GET /api/decisions/pending` 由统一存储读（含重启后恢复的）。
- 决议时写 resolved 行（或删除）；重启可恢复未决项 → 任务不再因重启卡死。

### 3.4 前端恢复（web）
- 进入任务/切回时：内存无 run → `GET /api/tasks/:id`（executionId）重建工作台（进度/方块/DAG/决策）+ 决策卡片（现有 /api/decisions/pending 已接）。
- 刷新：任务列表首源 = `GET /api/tasks`（服务端），localStorage 仅作缓存回退。
- 事件关联改用 executionId/missionId（弃 goal 文本匹配）。

## 4. 新契约（草案）

```ts
// packages/core/src/execution/task-context.ts（新增，前后端共用）
export interface TaskContext {
  executionId: string;
  missionId?: string;
  goal: string;
  spaceId?: string;
  departmentId?: string;
}

// packages/core/src/execution/TaskStateProjector.ts
export interface TaskProjection {
  executionId: string; missionId?: string; goal: string;
  spaceId?: string; departmentId?: string;
  phase?: string; status?: string; progress?: number;
  steps: Array<{ nodeId: string; name: string; status: 'pending'|'running'|'done'|'failed' }>;
  dag?: { nodes: Array<{ id: string; name: string; deps: string[] }>; edges: Array<{ from: string; to: string }> };
  approvals: Array<{ id: string; title: string; status: 'pending'|'resolved' }>;
  asks: Array<{ askId: string; question: string; options?: string[]; answered?: boolean }>;
  plan?: { planId: string; goal: string; planFile: string; stepNames: string[]; confirmed?: boolean } | null;
  createdAt: number; updatedAt: number;
}
```

## 5. 新端点
```
GET /api/tasks              → { ok, tasks: TaskSummaryLite[] }（列表：id/goal/status/progress/updatedAt）
GET /api/tasks/:id          → { ok, task: TaskProjection | null }
```
`/api/decisions/pending` 改为读 DecisionStore（向后兼容）。

## 6. 实施计划（分 3 波）
- **P-A 后端关联键 + TaskStateProjector**：DAGRuntime/StepAgentExecutor 事件补 TaskContext；新增 TaskStateProjector + 端点 + bootstrap 装配；EventStore 重放兜底。门禁：根 tsc + api-contract 新增用例。
- **P-B 后端 DecisionStore**：三个 Gate 的 pending 落盘 + restore；`/api/decisions/pending` 改统一存储。门禁同上。
- **P-C 前端恢复**：console.ts 进任务/切回 → GET /api/tasks/:id 重建工作台；任务列表服务端首源；事件关联改 ID。门禁：web tsc + build。

## 7. 风险
1. 事件补 TaskContext 是传播改造（MorPexRuntime → DAGRuntime → StepAgentExecutor …… 多文件），需逐层透传，注意不破坏现有 emit 契约（新字段纯加法）。
2. 前端弃 goal 文本匹配后，旧会话/无 TaskContext 事件降级回文本匹配（兼容）。
3. 投影是"当前状态"缓存，事件溯源仍是根本真源（投影损坏 → 重放兜底）。
4. P-A 涉及 core 执行链，改动面大，逐文件 tsc 验证。