# MorPexCore 架构升级方案

> 目标：参考 AgentScope 的优点，融入 MorPexCore 壳。pi 核原生能力直接用，不修改 pi 代码。
>
> **最终更新**: 2025-07-10 — 合并四大架构决策（DomainCluster Cgroup、FSM SUSPENDED、TeamSay/Negotiation 分层、ReadArtifact Lazy VFS）

---

## 一、总原则

```
┌─────────────────────────────────────────┐
│  MorPexCore 壳                           │
│  ← 参考 AgentScope，新建薄层，不改 pi     │
│                                          │
│  ┌─────────────────────────────────────┐│
│  │  pi 核 (不改)                        ││
│  │  AgentHarness / AgentEvent /         ││
│  │  beforeToolCall / compact / Session  ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

- **pi 已有的**：直接用，不包装、不翻译、不二次封装
- **pi 有 hook 的**：在 hook 上接入 MorPex 逻辑
- **pi 没有的**：MorPex 壳新建

---

## 二、整改清单总览

共 **18 项**，按状态分：

| 状态 | 数量 | 内容 |
|:--|:--|:--|
| ✅ 已修复 | 5 | 拓扑排序、Event ID、统一入口 |
| 🔴 必须改 | 1 | pi 事件停止包装、直通 SSE |
| 🟡 高优 | 5 | 权限引擎、压缩策略、ToolCall 状态机、消息扩展、SSE 标准化 |
| 🟢 中优 | 3 | ToolResult 截断、HintBlock、SessionProjection |
| 🔵 设计调整 | 4 | FSM 简化、事件直通、Agent 通信用工具、pi 类型替代自建 |

---

## 三、逐项详情

### ✅ 1-5：已修复

| # | 项 | 改了什么 |
|:--|:--|:--|
| 1 | PluginSystem 拓扑排序 | 内联 DFS → `tsort(plugins, p => p.dependencies ?? [], p => p.name)` |
| 2 | DAGEngine 拓扑排序 | 内联 DFS → `tsort([...nodes], n => n.deps, n => n.id)` |
| 3 | ExecutionGateway Event ID | 手动拼接字符串 → `identity.createEventId()` |
| 4 | Kernel 注入 identity | `new ExecutionGateway(eventBus, executionIdentity)` |
| 5 | 统一入口端点 | 新增 `POST /api/chat/message` → `CrossDomainRouter.dispatch()` |

---

### 🔴 6：pi 事件停止用 MorPexEvent 包装

**当前**：
```
pi 事件 → MorPexEvent { type:"runtime.tool.called", payload: event } → EventBus → SSE
```

**改为**：
```
pi 事件 → harness.subscribe(listener) → SSE 直写
```

**原因**：pi 的 `AgentEvent` 已是 discriminated union（`tool_execution_start` 有 `toolCallId`/`toolName`/`args` 字段），再包一层 `MorPexEvent` 丢失类型安全且前端需解包。

**涉及文件**：`StudioServer.ts`（SSE 广播层）、`FSMEngine.ts`（去掉手动 feed）

**不改 pi**：只是 MorPex 消费 pi 事件的方式变了，不碰 pi 代码。

---

### 🟡 7：PermissionEngine — 5 种权限模式

**借 AgentScope 的什么**：5 种权限模式 + deny/ask/allow 规则优先级

**基于 pi 的什么**：`beforeToolCall(ctx) → { block?, reason? }`

**新建文件**：`packages/core/permission/PermissionEngine.ts`（~150 行）

```
pi 的职责：执行 beforeToolCall → 收到 { block: true } → 自动生成 error ToolResult
MorPex 的职责：
  1. 维护 PermissionMode (default/explore/accept_edits/bypass/dont_ask)
  2. 维护 PermissionRule[] (glob/file/command 匹配)
  3. 在 beforeToolCall 中按优先级判定：deny → ask → allow → mode fallback
```

```typescript
// 使用方式 — 在创建 AgentLoopConfig 时接入
const permission = new PermissionEngine("default", rules, workingDirs);

const loopConfig: AgentLoopConfig = {
  beforeToolCall: (ctx) => permission.check(ctx),  // ← 一行接入
};
```

**不改 pi**：只用 pi 暴露的 `beforeToolCall` 回调签名。

---

### 🟡 8：CompactionPolicy — Token 阈值自动压缩

**借 AgentScope 的什么**：每次 reasoning 前自动检测 token 数，超阈值触发压缩

**基于 pi 的什么**：`harness.compact()` + `session_before_compact` hook

**新建文件**：`packages/core/compaction/CompactionPolicy.ts`（~80 行）

```
pi 的职责：compact() 生成摘要、写入 session tree、自动注入后续上下文
MorPex 的职责：
  1. 在 harness.on('context') 中计算当前 token 数
  2. 超过阈值 → 调用 harness.compact()
  3. 在 session_before_compact hook 中可取消/覆盖压缩结果
```

```typescript
const compaction = new CompactionPolicy(harness, { threshold: 80000 });

// 在每次 LLM 调用前自动检查
harness.on('context', async (event) => {
  await compaction.maybeCompact(event.messages);
  return { messages: event.messages }; // 不改动上下文
});
```

**不改 pi**：只用 `harness.compact()` 和 `harness.on('session_before_compact')`。

---

### 🟡 9：ToolCallTracker — ToolCall 状态机

**借 AgentScope 的什么**：PENDING → ASKING → ALLOWED → EXECUTING → FINISHED 状态流转

**基于 pi 的什么**：`harness.on('tool_call')` + `AgentEvent.tool_execution_*`

**新建文件**：`packages/core/tool/ToolCallTracker.ts`（~100 行）

```
pi 的职责：发出 tool_execution_start/end 事件
MorPex 的职责：
  1. 在 harness.on('tool_call') 中记录 PENDING
  2. 在 beforeToolCall 返回 block 时 → ASKING
  3. 在 tool_execution_start 时 → EXECUTING
  4. 在 tool_execution_end 时 → FINISHED
  5. 通过 EventBus.broadcastCrossDomain() 通知前端状态变化
```

```typescript
const tracker = new ToolCallTracker();

harness.on('tool_call', (event) => {
  tracker.transition(event.toolCallId, 'PENDING');
});

// beforeToolCall 中:
if (blocked) tracker.transition(toolCallId, 'ASKING');
```

**不改 pi**：只消费 pi 事件。

---

### 🟡 10：MorPex 消息类型扩展

**借 AgentScope 的什么**：HintBlock、DataBlock 等专用 Block 类型

**基于 pi 的什么**：`CustomAgentMessages` 声明合并

**新建文件**：`packages/core/messages.ts`（~50 行）

```typescript
// 通过 declaration merging 扩展 pi 的 AgentMessage 联合类型
declare module "@earendil-works/pi-agent-core" {
  interface CustomAgentMessages {
    dagNodeStatus: {
      role: "dagNodeStatus";
      nodeId: string;
      domain: string;
      status: "pending" | "running" | "success" | "failed";
      timestamp: number;
    };
    artifactRef: {
      role: "artifactRef";
      artifactId: string;
      uri: string;
      timestamp: number;
    };
    hint: {
      role: "hint";
      source: string;
      content: string;
      timestamp: number;
    };
  }
}
```

**不改 pi**：TypeScript 声明合并是编译时特性，不修改 pi 代码。

---

### 🟡 11：SSE 协议标准化

**改为**：前端 `unifiedStore.ts` 直接消费 pi 的 `AgentEvent` 类型，不再消费 `MorPexEvent`

```
改前: 前端 match event.type === "runtime.tool.called" → 解包 event.payload
改后: 前端 match event.type === "tool_execution_start" → 直接用 event.toolCallId
```

**不改 pi**：只是前端消费的数据源变了。

---

### 🟢 12：ToolResultOffloader — 大结果截断

**借 AgentScope 的什么**：超大 tool_result 截断到文件，上下文只留引用

**基于 pi 的什么**：`afterToolCall` hook

```typescript
afterToolCall: async (ctx) => {
  const text = extractText(ctx.result.content);
  if (text.length > 10000) {
    const path = await writeWorkspaceFile(ctx.toolCallId, text);
    return {
      content: [{ type: 'text', text: `[结果已保存到 ${path}]` }],
    };
  }
}
```

**不改 pi**。

---

### 🟢 13：HintBlock — 跨领域消息注入

**借 AgentScope 的什么**：系统指令/团队消息作为 HintBlock 注入 LLM 上下文

**基于 pi 的什么**：`CustomAgentMessages` 的 `hint` 类型 + `convertToLlm` 回调

```typescript
// convertToLlm 中将 hint 转为 user message
convertToLlm: (messages) => {
  return messages.map(m => {
    if (m.role === 'hint') {
      return { role: 'user', content: `[系统消息] ${m.content}`, timestamp: m.timestamp };
    }
    return m;
  });
};
```

**不改 pi**。

---

### 🟢 14：SessionProjection — 子领域状态投影

**借 AgentScope 的什么**：子 Agent 等待确认时，卡片投影到父 Agent 的 SSE

**基于 pi 的什么**：MorPex `EventBus.broadcastCrossDomain()`

**新建文件**：`packages/core/projection/SessionProjection.ts`（~150 行）

```
当 DomainCluster B 的 ToolCall 进入 ASKING 状态 →
  EventBus.broadcastCrossDomain() →
  父 DomainCluster A 的 SSE 收到 CustomEvent "subagent_hitl" →
  前端渲染确认卡片
```

**不改 pi**。

---

### 🔵 15-18：设计方向调整

| # | 项 | 从 | 到 |
|:--|:--|:--|:--|
| 15 | FSMEngine 调度 | 大 TRANSITIONS 表 + 手动 feed() | 读 `ToolCallBlock.state` 决定下一步 |
| 16 | 事件传递 | pi事件→MorPexEvent→EventBus→SSE | pi事件→harness.subscribe→SSE |
| 17 | Agent 通信 | Orchestrator 手动创建 CEO/Manager/Worker | Leader 通过 `AgentCreate` 工具动态创建 |
| 18 | 类型体系 | 自建 MorPexEvent/ExecutionContext | 直接用 pi 的 AgentEvent/AgentContext |

---

## 四、文件变更清单

| 文件 | 动作 | 关联项 |
|:--|:--|:--|
| `packages/core/permission/PermissionEngine.ts` | **新建** | #7 |
| `packages/core/compaction/CompactionPolicy.ts` | **新建** | #8 |
| `packages/core/tool/ToolCallTracker.ts` | **新建** | #9 |
| `packages/core/messages.ts` | **新建** | #10, #13 |
| `packages/core/projection/SessionProjection.ts` | **新建** | #14 |
| `packages/studio/server/StudioServer.ts` | 修改 | #6, #11, #16 |
| `packages/core/planes/runtime-kernel/fsm/FSMEngine.ts` | 修改 | #6, #15 |
| `packages/core/planes/agent-plane/orchestrator/AgentOrchestrator.ts` | 修改 | #17 |
| `packages/core/core/EventBus.ts` | 无需改 | #6 只是用法变了 |
| `packages/studio/ui/ts/neuro/unifiedStore.ts` | 修改 | #11 |

---

## 五、不改 pi 核代码的边界

```
pi 暴露的，MorPex 直接用：
  ✅ harness.prompt() / steer() / followUp()
  ✅ harness.compact()
  ✅ harness.subscribe(listener)
  ✅ harness.on('hook', handler)
  ✅ AgentLoopConfig.beforeToolCall / afterToolCall
  ✅ AgentEvent / AgentMessage / CustomAgentMessages
  ✅ Session tree API

MorPex 在 pi 之外新建的：
  ✅ PermissionEngine (实现 beforeToolCall 的决策逻辑)
  ✅ CompactionPolicy (调用 harness.compact() 的策略)
  ✅ ToolCallTracker (消费 AgentEvent 的状态追踪)
  ✅ CustomAgentMessages 扩展 (TypeScript 声明合并)
  ✅ SessionProjection (基于 MorPex EventBus)

pi 代码一行不改。
```

---

## 七、四大架构决策（已确认）

### 7.1 DomainCluster → OS 级 Cgroup（安全沙箱 + 资源配额）

AgentCreate/TeamSay 工具化后，Agent 编组变为 LLM 涌现式，但 DomainCluster 保留为**操作系统级安全沙箱**：

```
LLM 调用 AgentCreate 工具
  → 工具内部调用 DomainCluster.spawnSubAgent()
    → 配额检查 (activeTokenQuota)
    → 工具白名单继承 (Manifest.baseTools ∩ Manifest.allowedTools)
    → 工作目录强锁
    → 创建 AgentHarness
```

- **Token 熔断**：DomainCluster 维护 `activeTokenQuota`，子 Agent 派生前检查，超限拒绝
- **工具隔离**：LLM 不可指定工具，工具链由 DomainCluster 的 Manifest 决定
- **工作目录沙箱**：子 Agent 继承父 Agent 的工作目录，不可越权访问其他领域

```typescript
export class DomainCluster {
  private activeTokenQuota = 2_000_000;

  spawnSubAgent(params: { name: string; description: string; prompt: string }) {
    if (this.usedTokens >= this.activeTokenQuota) {
      throw new Error(`[Cgroup Deny] Domain ${this.name} Token 额度耗尽`);
    }
    return new AgentHarness({
      tools: [...this.baseTools],  // Manifest 白名单，不可由 LLM 指定
      workingDirectory: this.workingDirectory,
      systemPrompt: this.buildSubAgentPrompt(params),
    });
  }
}
```

### 7.2 FSMEngine SUSPENDED 状态（非阻塞挂起 + pi 原生恢复）

PermissionEngine 返回 `{ block: true, reason: "ASYNC_SUSPEND_FOR_USER" }` 时：

1. **FSMEngine** 将任务节点标记为 `SUSPENDED`
2. **Session 快照**序列化到 JSONL（pi 原生支持）
3. **SSE 发出** `REQUIRE_USER_CONFIRM` 事件 → HTTP 请求结束，释放线程
4. **用户确认后** → 调用 `harness.reply_stream(UserConfirmResultEvent)` — **pi 原生恢复机制**

```typescript
// 恢复挂起 — 直接使用 pi 原生的 reply_stream，不"伪造"事件
async resumeSuspendedNode(taskId: string, confirmResult: UserConfirmResultEvent) {
  const harness = await this.restoreHarnessFromSession(taskId);
  // pi 的 _reply_impl 检测到 is_awaiting → _handle_incoming_event → 继续执行
  await harness.reply_stream(confirmResult);
}
```

### 7.3 TeamSay (UDP) + NegotiationEngine (TCP/2PC) 分层共存

| | TeamSay + Inbox | NegotiationEngine |
|:--|:--|:--|
| 语义 | UDP — 异步非阻塞 | TCP — 两阶段提交 |
| 场景 | 咨询、索要参数 | 修改已定稿的不可变产物 |
| 实现 | `harness.steer()` → 下轮 reasoning 自动消费 | ArtifactRegistry.acquireLock() + 工单状态机 |
| 状态 | 无状态 | PENDING → ARGUING → ACCEPTED/REJECTED/ESCALATED |

### 7.4 DAG 产物传递：双层 VFS + ReadArtifactTool（Lazy Hydration）

不用 URI 拼接 prompt，而是**摘要首发 + 按需惰性加载**：

```
下游 Agent 收到:
  systemPrompt += "上游产物: artifact://hardware/spec (摘要: STM32F7主控, 4层PCB...)"
  tools += ReadArtifactTool

LLM 需要细节时:
  调用 ReadArtifact(uri="artifact://hardware/spec", section="BOM")
  → ToolResult 返回 BOM 章节 + 元数据 (版本/创建者/全文大小/可用章节列表)
```

`ReadArtifactTool` 返回结构化元数据，让 LLM 知道"有多大、有哪些章节、可以继续深读"：

```typescript
class ReadArtifactTool {
  async execute(params: { uri: string; section?: string }) {
    const artifact = ArtifactRegistry.resolve(params.uri);
    return {
      content: `[${artifact.name} v${artifact.version}] ${params.section ? extractSection(artifact, params.section) : artifact.summary}`,
      details: {
        artifactId: artifact.id,
        fullSize: artifact.content.length,
        availableSections: artifact.sections,  // ["Overview", "BOM", "PCB", "Firmware"]
      }
    };
  }
}
```

---

## 八、完整架构拓扑（最终版）

```
用户输入 → POST /api/chat/message
  │
  ▼
CrossDomainRouter.dispatch()
  ├── LLM 意图分析 → RoutingAnalysis { isMultiDomain, involvedDomains, deps }
  ├── toposort.ts → DAG 节点排序
  │
  ▼
DomainClusterManager.execute(domainId)
  │
  ▼
DomainCluster (Cgroup 沙箱)
  ├── Token 配额熔断
  ├── 工具白名单 (Manifest)
  ├── 工作目录沙箱
  │
  ▼
AgentHarness.prompt()  ← pi 原生
  ├── ReAct 循环
  │   ├── _reasoning() → LLM 调用
  │   │   ├── CompactionPolicy.maybeCompact()  ← Token 阈值自动压缩
  │   │   └── Mem0Middleware 检索记忆 → HintBlock 注入
  │   │
  │   ├── _acting() → 工具执行
  │   │   ├── beforeToolCall → PermissionEngine.check()
  │   │   │   ├── ALLOW → 执行
  │   │   │   ├── DENY  → 返回 error ToolResult
  │   │   │   └── ASK   → FSMEngine.SUSPENDED → REQUIRE_USER_CONFIRM → 释放线程
  │   │   │              → 用户确认 → harness.reply_stream(UserConfirmResultEvent) → 恢复
  │   │   │
  │   │   ├── AgentCreate → DomainCluster.spawnSubAgent() ← Cgroup 网关
  │   │   ├── TeamSay    → harness.steer() ← UDP 语义
  │   │   └── ReadArtifact → Lazy VFS Hydration
  │   │
  │   └── _check_next_action() → 读 ToolCallBlock.state 决定下一步
  │
  ├── 跨领域通信
  │   ├── NegotiationEngine.createTicket() → 产物加锁 → 两阶段确认
  │   └── SessionProjection → 子领域状态投影到父领域 SSE
  │
  └── 事件直通 SSE (不包装)
      └── harness.subscribe(event → broadcastToSSE(event))
```
