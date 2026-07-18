# MorPex ↔ pi ↔ AgentScope 架构交叉参考

> 生成日期: 2025-07-10 | 基于 pi-agent-core v0.79.10, pi-ai v0.79.10, AgentScope main

---

## 一、三层分工总览

```
┌──────────────────────────────────────────────────┐
│  MorPex 特有层                                     │
│  CrossDomainRouter, DomainCluster,                 │
│  ArtifactRegistry, KnowledgeGraph,                 │
│  PermissionEngine, ToolCallTracker,                │
│  SessionProjection, NegotiationEngine              │
├──────────────────────────────────────────────────┤
│  pi-agent-core (AgentHarness)  ← 原生能力，勿二次封装 │
│  prompt/steer/followUp, compact/navigateTree       │
│  AgentEvent, beforeToolCall/afterToolCall          │
│  Session tree, CustomAgentMessages extension       │
├──────────────────────────────────────────────────┤
│  pi-ai (底层 LLM)  ← 原生能力，勿二次封装            │
│  AssistantMessageEvent (streaming START/DELTA/END) │
│  TextContent/ThinkingContent/ToolCall              │
│  Usage tracking, Model registry                    │
└──────────────────────────────────────────────────┘
```

---

## 二、pi 模块原生能力清单（MorPex 不应重复实现）

### 2.1 pi-ai：消息与流式协议

| 类型                                                                      | 说明                 | MorPex 应如何用     |
| ----------------------------------------------------------------------- | ------------------ | --------------- |
| `TextContent { type:"text", text }`                                     | 文本块                | 直接透传            |
| `ThinkingContent { type:"thinking", thinking }`                         | 推理块（DeepSeek-R1 等） | 直接透传            |
| `ToolCall { type:"toolCall", id, name, arguments }`                     | 工具调用块              | 直接透传            |
| `ImageContent { type:"image", data, mimeType }`                         | 图片块                | 直接透传            |
| `UserMessage { role:"user", content, timestamp }`                       | 用户消息               | 直接透传            |
| `AssistantMessage { role:"assistant", content, usage, stopReason }`     | 助手消息               | 直接透传            |
| `ToolResultMessage { role:"toolResult", toolCallId, content, isError }` | 工具结果               | 直接透传            |
| `AssistantMessageEvent`                                                 | 流式事件协议             | **直接通过 SSE 透传** |

**pi-ai 流式协议（AssistantMessageEvent）**：
```
start → text_start → text_delta* → text_end
                   → thinking_start → thinking_delta* → thinking_end
                   → toolcall_start → toolcall_delta* → toolcall_end
      → done | error
```

### 2.2 pi-agent-core：Agent 运行时

| 能力 | API | MorPex 应如何用 |
|------|-----|----------------|
| 消息队列 | `harness.steer()` / `followUp()` / `nextTurn()` | 跨领域注入指令 |
| 上下文压缩 | `harness.compact(customInstructions?)` | 长对话自动压缩 |
| 会话树/分支 | `harness.navigateTree(targetId)` | 多方案探索 |
| 工具拦截 | `beforeToolCall(ctx) → { block?, reason? }` | **权限引擎插入点** |
| 工具结果修改 | `afterToolCall(ctx) → { content?, isError?, terminate? }` | 结果后处理 |
| 事件订阅 | `harness.subscribe(listener)` | SSE 广播源 |
| 类型钩子 | `harness.on('tool_call', handler)` | 特定事件处理 |
| 自定义消息 | `CustomAgentMessages` (declaration merging) | MorPex 扩展消息类型 |
| 会话树条目 | `MessageEntry, CompactionEntry, BranchSummaryEntry, CustomEntry` | 持久化 |

### 2.3 pi-agent-core：AgentEvent（原生结构化事件）

```typescript
type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId; toolName; args }
  | { type: "tool_execution_update"; toolCallId; toolName; args; partialResult }
  | { type: "tool_execution_end"; toolCallId; toolName; result; isError }
```

**MorPex 当前问题**：把这些事件包在泛化的 `MorPexEvent { type: string, payload: any }` 中，丢失类型安全。

---

## 三、AgentScope 值得借鉴的设计（pi 不具备的）

### 3.1 ToolCall 状态机

```
PENDING ──(deny)──► FINISHED
  ├──(ask)──► ASKING ──(user deny)──► FINISHED
  │            └──(user approve)──► ALLOWED
  └──(allow)──► ALLOWED
                  ├──(local exec)──► FINISHED
                  └──(external)──► SUBMITTED ──(result)──► FINISHED
```

**pi 原生**: `beforeToolCall` 可以 block 但无状态追踪。
**实现方式**: 基于 `beforeToolCall` + `tool_execution_*` 事件构建薄层 `ToolCallTracker`。

### 3.2 权限引擎（5 种模式）

| 模式 | 语义 |
|------|------|
| `DEFAULT` | 每步需确认 |
| `EXPLORE` | 只读，写操作强制 DENY |
| `ACCEPT_EDITS` | 工作区内编辑自动 ALLOW |
| `BYPASS` | 全自动（沙箱） |
| `DONT_ASK` | 无人值守，ASK→DENY |

**pi 原生**: `beforeToolCall` + `afterToolCall` 可拦截但无模式系统。
**实现方式**: 在 `beforeToolCall` 回调中实现决策逻辑，返回 `{ block: true }` 即 DENY。

### 3.3 HintBlock — 系统/团队指令

AgentScope 的 `HintBlock` 是注入到 LLM 上下文的系统指令块（如团队成员消息）。在发送给 LLM 前转为 user message。

**pi 原生**: `CustomAgentMessages` 声明合并可模拟。
**实现方式**: 扩展 `CustomAgentMessages` 添加 `hint` 类型，在 `convertToLlm` 中转为 user message。

### 3.4 Session Projection — 跨会话 UI 投影

子 Agent 等待用户确认时，待处理卡片自动投影到主 Agent 的 SSE 流。

**pi 原生**: 无。
**实现方式**: MorPex 的 `EventBus.broadcastCrossDomain()` + `SessionProjection` 新模块。

### 3.5 DataBlock — 通用二进制流

支持 Base64Source / URLSource，START → DATA_DELTA → END 流式传输。

**pi 原生**: `ImageContent` 仅图片，无流式二进制协议。
**实现方式**: 扩展 `CustomAgentMessages` 或新建 `DataBlock` 类型。

### 3.6 MessageBus 多模式传输

| 模式 | 用途 |
|------|------|
| A — Drain Queue | 单消费者，读后即删（Agent 收件箱） |
| C — Replay Log | 多消费者，游标独立（SSE 事件回放） |
| D — Broadcast | 瞬态广播（唤醒信号） |
| E — Distributed Lock | 分布式互斥锁（会话串行化） |
| F — Registry Map | 哈希表（后台任务追踪） |

**pi 原生**: 进程内 EventBus。
**实现方式**: 远期，为 EventBus 抽象 Transport 接口。

---

## 四、MorPex 当前违规与修复状态

| # | 违规 | 规则来源 | 状态 |
|---|------|---------|:--:|
| 1 | PluginSystem/DAGEngine 内联拓扑排序 | 必须复用 `toposort.ts` | ✅ 已修复 |
| 2 | ExecutionGateway 手动拼接 Event ID | 必须用 `createEventId()` | ✅ 已修复 |
| 3 | 8 个 Plugin 手动拼接 Event ID | 同上 | ✅ 已修复 |
| 4 | 缺少 `POST /api/chat/message` 统一入口 | 单点写入接口 | ✅ 已修复 |
| 5 | pi 事件被包在泛化 `MorPexEvent` 中 | 不应二次封装 pi 原生类型 | ⚠️ 待优化 |
| 6 | 无权限引擎 | AgentScope PermissionEngine 可借鉴 | ⚠️ 待实现 |
| 7 | 无 ToolCall 状态机 | AgentScope ToolCallState 可借鉴 | ⚠️ 待实现 |

---

## 五、关键文件索引

| 层 | 路径 | 职责 |
|----|------|------|
| pi-ai 类型 | `node_modules/@earendil-works/pi-ai/dist/types.d.ts` | Message, AssistantMessageEvent, ToolCall |
| pi-agent-core 类型 | `node_modules/@earendil-works/pi-agent-core/dist/types.d.ts` | AgentEvent, AgentTool, AgentLoopConfig |
| pi-agent-core Harness | `node_modules/@earendil-works/pi-agent-core/dist/harness/agent-harness.d.ts` | prompt/steer/compact/subscribe |
| MorPex 统一路由 | `packages/core/router/CrossDomainRouter.ts` | dispatch() |
| MorPex 拓扑排序 | `packages/core/utils/toposort.ts` | 5 处复用 |
| MorPex ID 系统 | `packages/core/core/ExecutionIdentity.ts` | createEventId/createExecutionId |
| MorPex 事件总线 | `packages/core/core/EventBus.ts` | emit/on/emitToDomain/broadcastCrossDomain |
| MorPex 桥接层 | `packages/studio/server/StudioServer.ts` | REST + SSE |
| AgentScope Agent | `agentscope/agent/_agent.py` | ReAct 循环 + 中间件 |
| AgentScope Event | `agentscope/event/_event.py` | 结构化事件枚举 |
| AgentScope Message | `agentscope/message/_base.py` + `_block.py` | Block-based 消息 |
| AgentScope Permission | `agentscope/permission/_engine.py` | 5 模式权限引擎 |
