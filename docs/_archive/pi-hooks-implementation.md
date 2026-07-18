# 中间件 / 权限引擎 / 上下文压缩 —— pi 原生能力对照与实现方案

> 回答：AgentScope 的 6 拦截点、5 种权限模式、上下文压缩在 pi 中是否有等效能力？MorPex 应该如何实现？

---

## 一、AgentScope 6 拦截点 → pi 原生等效

AgentScope 的洋葱中间件有 6 个 hook point。pi 的 `harness.on()` 提供了 **13 个类型化 hook**，覆盖了全部 6 个：

| AgentScope Hook | 语义 | pi 等效 | pi 的差异 |
|:--|:--|:--|:--|
| `on_reply` | 拦截整个 ReAct 循环 | `harness.on('before_agent_start')` + `shouldStopAfterTurn` | pi 拆成 start/stop 两端，不在中间包洋葱 |
| `on_reasoning` | 拦截 LLM 推理阶段 | `harness.on('context')` + `harness.on('before_provider_request')` + `harness.on('before_provider_payload')` | pi 更细粒度：可改 context、改请求参数、改实际 payload |
| `on_acting` | 拦截工具执行 | `AgentLoopConfig.beforeToolCall` + `AgentLoopConfig.afterToolCall` | pi 拆成 before/after 两个 hook，不是洋葱包 |
| `on_model_call` | 拦截原始 API 调用 | `harness.on('before_provider_payload')` + `harness.on('after_provider_response')` | pi 给了 payload 级别的检查和修改能力 |
| `on_system_prompt` | 变换 system prompt | `harness.on('before_agent_start')` → return `{ systemPrompt }` | pi 可以完整替换 |
| `on_compress_context` | 拦截上下文压缩 | `harness.on('session_before_compact')` → return `{ cancel?, compaction? }` | pi 可以取消或覆盖压缩结果 |

**结论**：不需要新建中间件框架。pi 的 `harness.on()` 已经是完整的拦截系统，只是 API 风格是**事件驱动**（注册 handler → 返回结果），而不是 AgentScope 的**洋葱链**（async generator 嵌套）。

---

## 二、pi 完整 Hook 清单（13 个类型化 hook）

```typescript
// pi-agent-core AgentHarnessEventResultMap — 所有 hook 点
type HookMap = {
  before_agent_start:       BeforeAgentStartResult      // 修改 systemPrompt, 注入 messages
  context:                  ContextResult                // 修改 LLM 上下文
  before_provider_request:  BeforeProviderRequestResult  // 修改 stream options
  before_provider_payload:  BeforeProviderPayloadResult  // 修改 API payload
  after_provider_response:  undefined                    // 检查 HTTP 响应
  tool_call:                ToolCallResult               // 阻止工具调用 (block + reason)
  tool_result:              ToolResultPatch              // 修改工具结果 (content/isError/terminate)
  session_before_compact:   SessionBeforeCompactResult   // 取消/覆盖压缩
  session_compact:          undefined                    // 压缩完成通知
  session_before_tree:      SessionBeforeTreeResult      // 取消/覆盖分支跳转
  session_tree:             undefined                    // 分支跳转完成
  model_update:             undefined                    // 模型切换通知
  thinking_level_update:    undefined                    // 思考级别切换通知
}
```

加上 `AgentLoopConfig` 的 7 个回调：

```typescript
// AgentLoopConfig — 循环级别的拦截
{
  beforeToolCall,        // 工具执行前 → 权限检查点
  afterToolCall,         // 工具执行后 → 结果修正
  shouldStopAfterTurn,   // 是否停止
  transformContext,      // 上下文变换
  prepareNextTurn,       // 下一轮的状态
  getSteeringMessages,   // 运行中注入 steering
  getFollowUpMessages,   // 停止后注入 followUp
}
```

**总计 20 个拦截点，全部类型安全，返回类型精确匹配。**

---

## 三、权限引擎：基于 pi 的 beforeToolCall 实现

### 3.1 pi 已经给了什么

```typescript
// pi 原生 — beforeToolCall
beforeToolCall?: (
  context: BeforeToolCallContext,
  signal?: AbortSignal
) => Promise<BeforeToolCallResult | undefined>;

interface BeforeToolCallContext {
  assistantMessage: AssistantMessage;  // 触发工具调用的消息
  toolCall: AgentToolCall;             // { id, name, arguments }
  args: unknown;                       // 已验证的参数
  context: AgentContext;               // 当前 Agent 上下文
}

interface BeforeToolCallResult {
  block?: boolean;    // true = 阻止执行，自动生成 error tool result
  reason?: string;    // 阻止原因，会出现在 tool result 中
}
```

### 3.2 MorPex 需要做的：薄封装

```typescript
// packages/core/permission/PermissionEngine.ts

type PermissionMode = "default" | "explore" | "accept_edits" | "bypass" | "dont_ask";

interface PermissionRule {
  toolName: string;
  pattern?: string;      // glob for files, prefix for commands
  behavior: "allow" | "deny" | "ask";
}

class PermissionEngine {
  constructor(
    private mode: PermissionMode,
    private rules: PermissionRule[],
    private workingDirs: string[]
  ) {}

  // 直接作为 AgentLoopConfig.beforeToolCall 的值
  beforeToolCall = async (
    ctx: BeforeToolCallContext
  ): Promise<BeforeToolCallResult | undefined> => {
    
    // 1. deny rules → block
    const denyMatch = this.matchRule(ctx, "deny");
    if (denyMatch) return { block: true, reason: `Denied: ${denyMatch}` };

    // 2. ask rules → block (halt for user confirmation)
    const askMatch = this.matchRule(ctx, "ask");
    if (askMatch) return { block: true, reason: `Requires confirmation: ${askMatch}` };

    // 3. allow rules → pass through
    const allowMatch = this.matchRule(ctx, "allow");
    if (allowMatch) return undefined; // undefined = allow

    // 4. mode-specific logic
    switch (this.mode) {
      case "explore":
        // Read-only: block all writes
        if (!this.isReadOnly(ctx.toolCall.name, ctx.args))
          return { block: true, reason: "Explore mode: write operations denied" };
        return undefined;
      
      case "accept_edits":
        // Auto-allow edits in working dirs
        if (this.isInWorkingDir(ctx.args))
          return undefined;
        return { block: true, reason: "Outside working directory" };
      
      case "bypass":
        return undefined; // Allow everything
      
      case "dont_ask":
        // Block everything that needs confirmation
        return { block: true, reason: "DONT_ASK mode: user unavailable" };
      
      default: // "default"
        return { block: true, reason: "Default mode: requires explicit permission" };
    }
  };
}
```

**关键**：pi 的 `beforeToolCall` 返回 `{ block: true }` 时，AgentLoop **自动生成一个 error ToolResult** 并继续。这正是 AgentScope 的 `DENY → FINISHED` 路径。不需要 MorPex 自己写 tool result 生成逻辑。

---

## 四、上下文压缩：基于 pi 的 compact() 实现

### 4.1 pi 已经给了什么

```typescript
// pi 原生 — AgentHarness.compact()
const result = await harness.compact(customInstructions?: string);
// → { summary, firstKeptEntryId, tokensBefore, details? }

// pi 原生 — session_before_compact hook
harness.on('session_before_compact', async (event) => {
  // event.preparation = {
  //   firstKeptEntryId, messagesToSummarize, turnPrefixMessages,
  //   isSplitTurn, tokensBefore, previousSummary, fileOps, settings
  // }
  return {
    cancel: false,              // true = 跳过此次压缩
    compaction: {               // 覆盖压缩结果
      summary: "...",
      firstKeptEntryId: "...",
      tokensBefore: 12345,
    }
  };
});

// pi 原生 — 压缩设置
// AgentLoopConfig 支持 token 估算和 transformContext
```

### 4.2 AgentScope 的压缩流程 vs pi

```
AgentScope:
  每次 _reasoning() 前自动调用 compress_context()
    ├── 计算当前 token 数
    ├── 超过阈值 → 拆分 [to_compress | boundary | to_reserve]
    ├── to_compress → LLM 摘要 → 存入 state.summary
    ├── 大 tool_result → offload 到文件
    └── boundary 按 block 级别拆分（不拆散 tool_call/tool_result 配对）

pi:
  显式调用 harness.compact(customInstructions?)
    ├── 内部计算 token 数 (estimateContextTokens)
    ├── 生成摘要 (generateSummary)
    ├── 创建 CompactionEntry 写入 session tree
    ├── emit session_before_compact / session_compact 事件
    └── 摘要自动注入到后续 LLM 上下文中
```

### 4.3 MorPex 需要做的

pi 的 `compact()` 是手动触发的。需要加**自动触发策略**：

```typescript
// packages/core/compaction/CompactionPolicy.ts

class CompactionPolicy {
  constructor(
    private harness: AgentHarness,
    private threshold: number = 80000,  // token 阈值
    private keepRecent: number = 16000
  ) {}

  // 在 harness.on('context') 中调用
  async maybeCompact(messages: AgentMessage[]): Promise<void> {
    const estimated = estimateContextTokens(messages);
    
    if (estimated.total > this.threshold) {
      await this.harness.compact(
        "保留最近的技术决策和当前任务上下文。压缩旧的对话为摘要。"
      );
    }
  }
}
```

**Tool result offloading**（AgentScope 的超大结果存文件）：

```typescript
// pi 的 afterToolCall 可以做到
afterToolCall: async (ctx) => {
  const text = ctx.result.content.map(c => c.type === 'text' ? c.text : '').join('');
  
  if (text.length > 10000) {
    // 存文件
    const path = await writeToFile(text);
    // 替换为引用
    return {
      content: [{ type: 'text', text: `[结果已保存到 ${path}，共 ${text.length} 字符]` }],
    };
  }
  return undefined; // 保持原结果
}
```

---

## 五、完整实现路线（按优先级）

| 顺序 | 模块 | 基于 pi 的什么 | 工作量 | 收益 |
|:--|:--|:--|:--|:--|
| **1** | **PermissionEngine** | `beforeToolCall` — 直接返回 `{block, reason}` | 小 (~150行) | 极高 — 安全底线 |
| **2** | **CompactionPolicy** | `harness.compact()` + `session_before_compact` hook | 小 (~80行) | 高 — 长对话质量 |
| **3** | **ToolCallTracker** | `tool_call` hook + `tool_execution_*` AgentEvents | 小 (~100行) | 高 — 状态机可视化 |
| **4** | **ToolResultOffloader** | `afterToolCall` — 截断 + 存文件 + 替换引用 | 小 (~60行) | 中 — Token 节省 |
| **5** | **MorPexMiddlewareComposer** | 组合 pi 的 13 个 `on()` hook 为 MorPex 中间件接口 | 中 (~200行) | 中 — 开发体验 |
| **6** | **SessionProjection** | `EventBus.broadcastCrossDomain()` | 中 (~150行) | 中 — 多领域 UX |

---

## 六、关键洞察

1. **pi 已经有所有拦截点，不需要再造中间件框架。** AgentScope 的 6 个 hook 在 pi 中有 20 个等效 hook（更细粒度）。

2. **权限引擎只需实现决策逻辑。** pi 的 `beforeToolCall` 返回 `{ block: true }` → AgentLoop 自动生成 error ToolResult。MorPex 不需要写工具执行/结果生成逻辑。

3. **上下文压缩 pi 已实现核心，缺自动触发。** `harness.compact()` 已包含摘要生成、session tree 写入、增量注入。MorPex 只需加 token 阈值检测和自动调用。

4. **不要包洋葱。** pi 的 API 风格是事件驱动 handler，不是 Python async generator 嵌套。MorPex 应该用 pi 原生的 `harness.on('event', handler)` 风格，而不是自己再包一层中间件链。
