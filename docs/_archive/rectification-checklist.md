# MorPex 后端整改清单

> 汇总：架构审计 + AgentScope 对比 + pi 交叉参考，所有需要整改的项目

---

## ✅ 已修复（5 项）

| # | 项 | 文件 | 状态 |
|:--|:--|:--|:--:|
| 1 | PluginSystem 内联 DFS → 复用 `toposort.ts` | `PluginSystem.ts` | ✅ |
| 2 | DAGEngine 内联 DFS → 复用 `toposort.ts` | `DAGEngine.ts` | ✅ |
| 3 | ExecutionGateway 手动拼 Event ID → `createEventId()` | `ExecutionGateway.ts` | ✅ |
| 4 | Kernel 未向 Gateway 传入 ExecutionIdentity | `Kernel.ts` | ✅ |
| 5 | 缺少 `POST /api/chat/message` 统一入口 | `StudioServer.ts` | ✅ |

---

## 🔴 必须整改：pi 事件被泛化包装（1 项）

| # | 问题 | 当前 | 目标 | 文件 |
|:--|:--|:--|:--|:--|
| 6 | **pi 原生事件被包在 `MorPexEvent` 中，丢失类型安全** | `EventBus.emit({ type:"runtime.tool.called", payload: piEvent })` | pi 事件直接透传 SSE，不经过 MorPexEvent 包装层 | `StudioServer.ts`, `EventBus.ts`, `FSMEngine.ts` |

**具体改动**：
```
当前:
  harness.subscribe(event => {
    this.kernel.eventBus.emit({
      id: this.kernel.executionIdentity.createEventId(),
      type: 'runtime.tool.called',  // ← 丢失原始类型
      executionId: execId,
      source: 'pi',
      payload: event                // ← 嵌套一层
    });
  });

目标:
  harness.subscribe(event => {
    this.broadcastToSSE(event);     // ← 直通，零包装
  });
```

---

## 🟡 高优先级：基于 pi 原生 hook 实现（3 项）

| # | 项 | 基于 pi 的什么 | 新文件 | 工作量 |
|:--|:--|:--|:--|:--|
| 7 | **PermissionEngine** — 5 种权限模式 (default/explore/accept_edits/bypass/dont_ask) | `beforeToolCall(ctx) → { block?, reason? }` | `packages/core/permission/PermissionEngine.ts` | ~150 行 |
| 8 | **CompactionPolicy** — Token 阈值自动触发压缩 | `harness.compact()` + `session_before_compact` hook | `packages/core/compaction/CompactionPolicy.ts` | ~80 行 |
| 9 | **ToolCallTracker** — ToolCall 状态机 (PENDING→ASKING→ALLOWED→EXECUTING→FINISHED) | `tool_call` hook + `tool_execution_*` AgentEvents | `packages/core/tool/ToolCallTracker.ts` | ~100 行 |

**这三项严格基于 pi 已有 hook，不重复造轮子。pi 负责执行，MorPex 只加决策/追踪逻辑。**

---

## 🟡 高优先级：消息类型体系对齐 pi（2 项）

| # | 项 | 说明 | 文件 |
|:--|:--|:--|:--|
| 10 | **MorPex 消息扩展** — 通过 `CustomAgentMessages` 声明合并添加 MorPex 特有消息类型 | `dagNodeStatus`, `artifactRef`, `kgRelation` 三种自定义消息 | `packages/core/messages.ts`（新建） |
| 11 | **SSE 协议标准化** — 前端消费 pi 原生 `AgentEvent` (discriminated union)，不再消费泛化 `MorPexEvent` | 前端 `uniﬁedStore.ts` 改为匹配 pi 的 `AgentEvent` 类型 | `packages/studio/ui/ts/neuro/unifiedStore.ts` |

---

## 🟢 中优先级：AgentScope 借鉴（3 项）

| # | 项 | 说明 | 基于 |
|:--|:--|:--|:--|
| 12 | **ToolResultOffloader** — 超大工具结果截断并存文件，上下文里只保留引用 | AgentScope 的 `_split_tool_result_for_compression()` | `afterToolCall` hook |
| 13 | **HintBlock** — 系统指令/跨领域消息通过 `CustomAgentMessages` 的 `hint` 类型注入 LLM | AgentScope 的 `HintBlock` → 喂 LLM 前转为 user message | `convertToLlm` 回调 |
| 14 | **SessionProjection** — 子领域等待用户确认时，状态投影到父领域 SSE | AgentScope 的 `SessionProjection` | `EventBus.broadcastCrossDomain()` |

---

## 🔵 设计方向调整（不涉及具体文件）

| # | 项 | 当前做法 | 应改为 |
|:--|:--|:--|:--|
| 15 | **FSMEngine 调度简化** | 大而全的 `TRANSITIONS` 表 + 手动 `feed()` | 读 `ToolCallBlock.state` 决定下一步（AgentScope 模式） |
| 16 | **事件不再二次包装** | `pi事件 → MorPexEvent → EventBus → SSE` | `pi事件 → harness.subscribe → SSE 直写` |
| 17 | **Agent 通信走工具调用** | Orchestrator 手动创建 CEO/Manager/Worker 并分配任务 | Leader Agent 通过 `AgentCreate` 工具动态创建子 Agent，通信通过 MessageBus inbox |
| 18 | **用 pi 原生类型替代自建类型** | 自建 `MorPexEvent`, `ExecutionContext`, `ExecutionResult` | 直接使用 pi 的 `AgentEvent`, `AgentContext`, `AgentMessage` |

---

## 📊 总览

```
整改项: 18 项
├── ✅ 已修复:   5 项
├── 🔴 必须:     1 项  (停止包装 pi 事件)
├── 🟡 高优:     5 项  (PermissionEngine + CompactionPolicy + ToolCallTracker + 消息扩展 + SSE 标准化)
├── 🟢 中优:     3 项  (ToolResultOffloader + HintBlock + SessionProjection)
└── 🔵 设计调整: 4 项  (FSM 简化 + 事件直通 + Agent 通信走工具 + 用 pi 类型)
```

---

## 📁 涉及文件清单

| 文件 | 整改项 |
|:--|:--|
| `packages/studio/server/StudioServer.ts` | #6 (事件直通), #11 (SSE 标准化) |
| `packages/core/core/EventBus.ts` | #6 (不再包装 pi 事件) |
| `packages/core/planes/runtime-kernel/fsm/FSMEngine.ts` | #6, #15 (简化调度) |
| `packages/core/permission/PermissionEngine.ts` | #7 (新建) |
| `packages/core/compaction/CompactionPolicy.ts` | #8 (新建) |
| `packages/core/tool/ToolCallTracker.ts` | #9 (新建) |
| `packages/core/messages.ts` | #10 (新建), #13 (HintBlock) |
| `packages/studio/ui/ts/neuro/unifiedStore.ts` | #11 (消费 pi 类型) |
| `packages/core/planes/agent-plane/orchestrator/AgentOrchestrator.ts` | #17 (Agent 通信改走工具) |
