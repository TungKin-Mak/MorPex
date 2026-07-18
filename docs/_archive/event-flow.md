# 事件流详解

> 版本: 2.0.0 | 基于实际代码中所有 `emit()` 调用逆向整理

---

## 1. 事件协议

```typescript
interface MorPexEvent {
  id: string;            // evt_{timestamp}_{random}
  type: string;          // {domain}.{action}  例: fsm.transition
  timestamp: number;
  executionId: string;   // 必带!
  source: string;        // 来源模块 (fsm-plugin, gateway, llm-bridge, ...)
  payload: any;
}
```

**约束**: 所有事件必须带 `executionId`，类型命名空间必须 `{domain}.{action}`。

---

## 2. 实际事件类型全集

> 以下事件类型全部来自 `grep -rn "emit(" packages/core/` 实际调用，按 domain 分组。

### 2.1 FSM — `fsm.*`

| 事件类型 | 触发位置 | payload |
|----------|----------|---------|
| `fsm.transition` | `fsm/plugin.ts:56` | `{ from, to, taskId, goal }` |
| `fsm.completed` | `fsm/plugin.ts:59` | `{ context }` |
| `fsm.failed` | `fsm/plugin.ts:62` | `{ context }` |
| `fsm.cancelled` | `fsm/plugin.ts:65` | `{ context }` |
| `fsm.waiting_user` | `fsm/plugin.ts:68` | `{ context }` |
| `fsm.message_delta` | `fsm/plugin.ts:71` | `{ delta, taskId }` |
| `fsm.status` | `fsm/plugin.ts:87,125` | `{ status, state }` |

**注意**: FSM 事件使用 `fsm.*` 前缀，**不是** `runtime.fsm.*`。

### 2.2 DAG — `dag.*`

| 事件类型 | 触发位置 | 说明 |
|----------|----------|------|
| `dag.mutation` | `dag/plugin.ts:73` | DAG 结构变更 |
| `dag.node.status_changed` | `dag/plugin.ts:77` | 节点状态变更 |
| `dag.node.completed` | `dag/plugin.ts:80` | 节点完成 |
| `dag.node.failed` | `dag/plugin.ts:88` | 节点失败 |
| `dag.aborted` | `dag/plugin.ts:129` | DAG 中止 |
| `dag.validation_result` | `dag/plugin.ts:160` | 校验结果 |
| `dag.build_failed` | `dag/plugin.ts:168` | 构建失败 |
| `dag.built` | `dag/plugin.ts:176` | DAG 构建完成 |
| `dag.deadlock_detected` | `dag/plugin.ts:202` | 死锁检测 |
| `dag.completed` | `dag/plugin.ts:214` | DAG 整体完成 |

### 2.3 Execution Graph — `graph.*`

| 事件类型 | 触发位置 | 说明 |
|----------|----------|------|
| `graph.node.created` | `execution-graph/plugin.ts:70` | 节点创建 |
| `graph.node.status_changed` | `execution-graph/plugin.ts:74` | 节点状态变更 |
| `graph.edge.created` | `execution-graph/plugin.ts:78` | 边创建 |
| `graph.completed` | `execution-graph/plugin.ts:82` | 图完成 |
| `graph.stats` | `execution-graph/plugin.ts:182` | 统计 |

### 2.4 Scheduler — `scheduler.*`

| 事件类型 | 触发位置 | 说明 |
|----------|----------|------|
| `scheduler.task_ready` | `scheduler/plugin.ts:59` | 任务就绪 |
| `scheduler.backpressure` | `scheduler/plugin.ts:67` | 背压 |
| `scheduler.stats` | `scheduler/plugin.ts:73,139` | 调度器统计 |
| `scheduler.task_rejected` | `scheduler/plugin.ts:95` | 任务被拒 |
| `scheduler.task_completed` | `scheduler/plugin.ts:107` | 任务完成 |
| `scheduler.task_failed` | `scheduler/plugin.ts:118` | 任务失败 |
| `scheduler.task_cancelled` | `scheduler/plugin.ts:130` | 任务取消 |

### 2.5 Human In Loop — `human.*`

| 事件类型 | 触发位置 | 说明 |
|----------|----------|------|
| `human.pause.created` | `human-in-loop/plugin.ts:62` | 暂停点创建 |
| `human.pause.resolved` | `human-in-loop/plugin.ts:65` | 暂停点处理 |
| `human.pause.timed_out` | `human-in-loop/plugin.ts:68` | 暂停超时 |
| `human.decision` | `human-in-loop/plugin.ts:104` | 决策 |
| `human.error` | `human-in-loop/plugin.ts:111` | 错误 |
| `human.risk_check_result` | `human-in-loop/plugin.ts:123` | 风险检查 |
| `human.review_check_result` | `human-in-loop/plugin.ts:134` | 审查检查 |

### 2.6 Memory — `memory.*`

| 事件类型 | 触发位置 | 说明 |
|----------|----------|------|
| `memory.stored` | `memory/plugin.ts:57` | 记忆存储 |
| `memory.recalled` | `memory/plugin.ts:61` | 记忆检索 |
| `memory.query_results` | `memory/plugin.ts:100,111` | 查询结果 |
| `memory.related` | `memory/plugin.ts:122` | 关联记忆 |
| `memory.stats` | `memory/plugin.ts:130` | 统计 |

### 2.7 Knowledge Graph — `knowledge.*`

| 事件类型 | 触发位置 | 说明 |
|----------|----------|------|
| `knowledge.entity_added` | `knowledge/plugin.ts:59` | 实体添加 |
| `knowledge.relation_added` | `knowledge/plugin.ts:62` | 关系添加 |
| `knowledge.imported` | `knowledge/plugin.ts:80,100,110` | 外部导入 |
| `knowledge.search_results` | `knowledge/plugin.ts:122` | 搜索结果 |
| `knowledge.path_result` | `knowledge/plugin.ts:132` | 路径查询 |
| `knowledge.neighborhood_result` | `knowledge/plugin.ts:142` | 邻域查询 |
| `knowledge.stats` | `knowledge/plugin.ts:150` | 统计 |

### 2.8 Artifact — `artifact.*`

| 事件类型 | 触发位置 | 说明 |
|----------|----------|------|
| `artifact.created` | `artifacts/plugin.ts:64` | 产物创建 |
| `artifact.updated` | `artifacts/plugin.ts:69` | 产物更新 |
| `artifact.status_changed` | `artifacts/plugin.ts:74` | 状态变更 |
| `artifact.relation_created` | `artifacts/plugin.ts:78` | 关系创建 |
| `artifact.search_results` | `artifacts/plugin.ts:154` | 搜索结果 |

### 2.9 Orchestrator — `orchestrator.*`

| 事件类型 | 触发位置 | 说明 |
|----------|----------|------|
| `orchestrator.agent_created` | `orchestrator/plugin.ts:55` | Agent 创建 |
| `orchestrator.task_assigned` | `orchestrator/plugin.ts:58` | 任务分配 |
| `orchestrator.task_completed` | `orchestrator/plugin.ts:61` | 任务完成 |
| `orchestrator.status` | `orchestrator/plugin.ts:76,105` | 编排状态 |

### 2.10 Swarm — `swarm.*`

| 事件类型 | 触发位置 | 说明 |
|----------|----------|------|
| `swarm.auction_created` | `swarm/plugin.ts:35` | 拍卖创建 |
| `swarm.bid_received` | `swarm/plugin.ts:36` | 投标 |
| `swarm.auction_awarded` | `swarm/plugin.ts:37` | 中标 |
| `swarm.auction_expired` | `swarm/plugin.ts:38` | 拍卖过期 |
| `swarm.stats` | `swarm/plugin.ts:63` | 统计 |

### 2.11 Intent — `intent.*`

| 事件类型 | 触发位置 | 说明 |
|----------|----------|------|
| `intent.llm.request` | `intent/plugin.ts:199` | 意图分类 LLM 请求 |
| `intent.resolved` | `intent/plugin.ts:265` | 意图已识别 |
| `intent.needs_clarification` | `intent/plugin.ts:230,257` | 需要澄清 |
| `intent.rejected` | `intent/plugin.ts:239` | 意图被拒 |
| `intent.clarified` | `intent/plugin.ts:104` | 已澄清 |
| `intent.clarification.abandoned` | `intent/plugin.ts:113` | 澄清放弃 |
| `intent.clarification.questions` | `intent/plugin.ts:117` | 澄清问题 |

### 2.12 Plan — `plan.*`

| 事件类型 | 触发位置 | 说明 |
|----------|----------|------|
| `plan.generated` | `planner/plugin.ts:129` | 计划生成 |
| `plan.failed` | `planner/plugin.ts:133` | 计划失败 |

### 2.13 LLM — `llm.*` / `tool.*`

| 事件类型 | 触发位置 | 说明 |
|----------|----------|------|
| `llm.request` (监听) | `LLMBridge.ts:unsubs` | LLM 调用请求 (外部发) |
| `llm.response` | `LLMBridge.ts:180` | LLM 响应 (含 text + usage) |
| `llm.text_delta` | pi-ai stream 内部 | 流式 token (pi-ai 内部) |
| `intent.llm.request` (监听) | `LLMBridge.ts:unsubs` | 意图 LLM 请求 (外部发) |
| `intent.llm.response` | `LLMBridge.ts:173` | 意图 LLM 响应 |
| `tool.request` (监听) | `LLMBridge.ts:unsubs` | 工具调用请求 (外部发) |
| `tool.response` | `LLMBridge.ts:201,208` | 工具调用结果 |

### 2.14 Runtime — `runtime.*`

| 事件类型 | 触发位置 | 说明 |
|----------|----------|------|
| `runtime.execution.started` | `ExecutionGateway.ts:117` | 执行开始 |
| `runtime.execution.completed` | `ExecutionGateway.ts:128` | 执行完成 |
| `runtime.execution.failed` | `ExecutionGateway.ts:139` | 执行失败 |
| `runtime.execution.aborted` | `ExecutionGateway.ts:169` | 执行中止 |
| `runtime.agent.failed` | `PiAdapter.ts:179` | Agent 失败 |
| `runtime.unknown` | `PiAdapter.ts:131` | 未知运行时事件 |
| `gateway.adapter.registered` | `ExecutionGateway.ts:62` | 适配器注册 |
| `kernel.started` | `Kernel.ts:149` | Kernel 启动完成 |
| `router.set_grayscale` | `bootstrap.ts:56` | 路由器灰度设置 |

---

## 3. StudioServer SSE 映射

EventBus 事件 → SSE 事件 (实现: `StudioServer.ts:mapEventToSSE()`):

| EventBus type (前缀) | SSE type | 前端用途 |
|---------------------|----------|----------|
| `fsm.*` | `runtime.fsm` | FSM 状态更新 |
| `dag.*` | 透传 | DAG 事件 |
| `graph.*` | 透传 | 执行图事件 |
| `scheduler.*` | 透传 | 调度事件 |
| `human.*` | `human.pause` | 人工审批 |
| `memory.*` | `memory.event` | 记忆事件 |
| `knowledge.*` | 透传 | 知识图谱事件 |
| `artifact.*` | 透传 | 产物事件 |
| `orchestrator.*` | 透传 | 编排事件 |
| `swarm.*` | 透传 | 拍卖事件 |
| `intent.*` | 透传 | 意图事件 |
| `plan.*` | 透传 | 规划事件 |
| `llm.response` | `chat.text` (done) | LLM 完成 |
| `llm.text_delta` | `chat.text` (delta) | 流式输出 |
| `runtime.execution.*` | `execution.status` | 执行生命周期 |
| `runtime.agent.*` | `agent.event` | Agent 事件 |
| `kernel.*` / `gateway.*` | 透传 | 系统事件 |

---

## 4. 完整请求生命周期

```
用户输入 "分析市场趋势"
        │
        ▼
[Studio UI] POST /api/prompt { message: "分析市场趋势" }
        │
        ▼
[StudioServer] emit("llm.request", { requestId, prompt })
        │
        ▼  (LLMBridge 监听 llm.request)
[LLMBridge] callPiAi() → pi-ai.stream() → DeepSeek API
        │
        ├── pi-ai 内部: 产生 text_delta 事件
        │   (若 pi-ai 转发到 EventBus → llm.text_delta)
        │
        └── 完成 → emit("llm.response", { requestId, text, usage })
              │
              ▼
        [StudioServer] SSE: { type: "chat.text", data: { delta, done: true } }
              │
              ▼
        [Studio UI] appendStreamDelta() → 对话气泡更新
```

---

## 5. 监听方式

```typescript
// 在 Kernel 内部
eventBus.on('fsm.transition', (e) => console.log(e.payload));
eventBus.on('orchestrator.*', (e) => console.log('编排事件:', e.type));
eventBus.on('*', (e) => console.log('所有事件:', e.type)); // 通配符

// 前端通过 SSE
connectSSE({
  'chat.text': (data) => appendChat(data),
  'runtime.fsm': (data) => updateFSMStatus(data),
});
```
