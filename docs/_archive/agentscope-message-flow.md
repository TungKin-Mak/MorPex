# AgentScope 消息传递体系深度解析

> 回答核心问题：从用户输入 → LLM 分析意图 → 工具调用 → 多 Agent 质询 → 结果修正 → 最终输出，AgentScope 如何保持消息传递不混乱？

---

## 核心答案：三层统一

AgentScope 的消息体系不混乱，因为它把**所有通信统一到三层抽象**：

| 层 | 统一到什么 | 示例 |
|----|-----------|------|
| **消息内容层** | `Msg.content: ContentBlock[]` | 一个 AssistantMsg 里同时有 text + tool_call + tool_result |
| **事件流层** | `AgentEvent`（单一 discriminated union） | 所有发生的事都是 AgentEvent 的一种 |
| **生命周期层** | `reply_id`（一轮 ReAct 循环共享一个 ID） | 同一轮的 text/tool_call/tool_result 全部绑定到同一个 reply_id |

**关键洞察**：AgentScope 不是"先有消息，再发生事件"，而是 **"事件即消息的增量更新"**。`Msg.append_event()` 方法直接消费事件来构建消息。

---

## 一、消息结构：一切皆是 Block

### 1.1 消息不是字符串，是 Block 数组

```
MorPex 当前：  { role: "assistant", content: "我来设计..." }
AgentScope：   AssistantMsg {
                 role: "assistant",
                 content: [
                   ThinkingBlock { thinking: "用户需要硬件设计..." },
                   TextBlock { text: "我将设计一款智能农业监控硬件..." },
                   ToolCallBlock { id:"tc1", name:"Read", input:'{"file":"spec.md"}' },
                   ToolResultBlock { id:"tc1", name:"Read", output:[TextBlock{...}] },
                   TextBlock { text: "根据规格书，我建议..." },
                   ToolCallBlock { id:"tc2", name:"AgentCreate", input:'{"name":"...}"}' },
                   ToolResultBlock { id:"tc2", name:"AgentCreate", output:[...] },
                   TextBlock { text: "子Agent已创建并开始工作..." },
                 ]
               }
```

**核心优势**：前端可以按 Block 逐一渲染，而不是等整个消息完成。工具调用和工具结果内嵌在同一条 AssistantMsg 中。

### 1.2 Block 类型全景

```
ContentBlock (联合类型)
├── TextBlock         { type:"text", id, text }           — 文本
├── ThinkingBlock     { type:"thinking", id, thinking }   — LLM 推理过程
├── ToolCallBlock     { type:"tool_call", id, name, input, state }  — 工具调用
├── ToolResultBlock   { type:"tool_result", id, name, output, state } — 工具结果
├── DataBlock         { type:"data", id, source:Base64|URL } — 二进制
└── HintBlock         { type:"hint", id, hint, source }   — 系统/团队指令
```

**ToolCallBlock 的状态机**（这是 MorPex 最缺的）：

```
PENDING ──(permission DENY)──► FINISHED
  ├──(permission ASK)──► ASKING
  │      ├──(user denied)──► FINISHED
  │      └──(user approved)──► ALLOWED
  └──(permission ALLOW)──► ALLOWED
         ├──(local exec)──► FINISHED
         └──(external exec)──► SUBMITTED ──(result)──► FINISHED
```

---

## 二、事件流：START → DELTA → END 三段式

### 2.1 流式协议 — 每种 Block 都是三段式

```
LLM 开始回复:
  REPLY_START { reply_id, session_id }

一轮模型调用:
  MODEL_CALL_START { reply_id, model_name }
    TEXT_BLOCK_START { reply_id, block_id:"b1" }
    TEXT_BLOCK_DELTA { reply_id, block_id:"b1", delta:"我将" }
    TEXT_BLOCK_DELTA { reply_id, block_id:"b1", delta:"设计" }
    TEXT_BLOCK_END   { reply_id, block_id:"b1" }
    TOOL_CALL_START  { reply_id, tool_call_id:"tc1", tool_call_name:"Read" }
    TOOL_CALL_DELTA  { reply_id, tool_call_id:"tc1", delta:'{"file"' }
    TOOL_CALL_DELTA  { reply_id, tool_call_id:"tc1", delta:':"spec.md"}' }
    TOOL_CALL_END    { reply_id, tool_call_id:"tc1" }
  MODEL_CALL_END { reply_id, input_tokens, output_tokens }

工具执行:
  TOOL_RESULT_START      { reply_id, tool_call_id:"tc1" }
  TOOL_RESULT_TEXT_DELTA { reply_id, tool_call_id:"tc1", delta:"文件内容..." }
  TOOL_RESULT_END        { reply_id, tool_call_id:"tc1", state:"success" }

需要用户确认:
  REQUIRE_USER_CONFIRM { reply_id, tool_calls:[{ id:"tc2", suggested_rules }] }
  (Agent 暂停，等待外部事件)
  
用户确认后恢复:
  USER_CONFIRM_RESULT { reply_id, confirm_results:[{ confirmed:true, tool_call }] }
  → 继续执行 tc2...

回复结束:
  REPLY_END { reply_id, finished_reason:"completed" }
```

### 2.2 事件即消息 — `Msg.append_event()` 的核心魔法

前端收到的事件流可以直接重建完整消息：

```python
# AgentScope 的核心：消息从事件流重建自身
class Msg:
    def append_event(self, event: AgentEvent) -> Self:
        match event.type:
            case "TEXT_BLOCK_START":
                self.content.append(TextBlock(id=event.block_id, text=""))
            case "TEXT_BLOCK_DELTA":
                block = self._find_block("text", event.block_id)
                block.text += event.delta
            case "TOOL_CALL_START":
                self.content.append(ToolCallBlock(id=event.tool_call_id, ...))
            case "TOOL_CALL_DELTA":
                block = self._find_block("tool_call", event.tool_call_id)
                block.input += event.delta
            case "TOOL_RESULT_START":
                self.content.append(ToolResultBlock(id=event.tool_call_id, ...))
            case "TOOL_RESULT_END":
                block = self._find_block("tool_result", event.tool_call_id)
                block.state = event.state
                # 同时标记对应的 ToolCallBlock 为 FINISHED
                call_block = self._find_block("tool_call", event.tool_call_id)
                call_block.state = ToolCallState.FINISHED
            case "REQUIRE_USER_CONFIRM":
                for tc in event.tool_calls:
                    b = self._find_block("tool_call", tc.id)
                    b.state = ToolCallState.ASKING
```

**这意味着**：前端和存储层不需要理解业务逻辑，只要消费事件流就能得到完整状态。

---

## 三、完整执行流：从用户输入到最终输出

### 3.1 主循环：`_reply_impl()` — 一切从这里开始

```
用户输入
  │
  ▼
Agent.reply_stream(inputs: Msg)  ← 统一入口
  │
  ▼
Agent._reply(inputs)  ← 洋葱中间件包裹
  │
  ▼
Agent._reply_impl(inputs)
  │
  ├── Step 1: 检查是否等待外部事件（用户确认/外部执行结果）
  │     └── 是 → 继续执行被暂停的工具调用
  │     └── 否 → 新的 reply，生成 reply_id，yield REPLY_START
  │
  ├── Step 2: 进入 ReAct 循环（max_iters 硬限制）
  │   │
  │   ├── _check_next_action()
  │   │   ├── 有待执行的 tool_call（state=PENDING/ALLOWED）→ "acting"
  │   │   ├── 有等待中的 tool_call（state=ASKING/SUBMITTED）→ "exit"（暂停，等外部）
  │   │   └── 都没有 → "reasoning"（调用 LLM）
  │   │
  │   ├── "reasoning" 路径:
  │   │   compress_context()  ← 压缩旧上下文
  │   │   _reasoning()
  │   │     ├── _prepare_model_input()   ← 构建 messages + tools
  │   │     ├── _call_model()            ← LLM API 调用（洋葱中间件包裹）
  │   │     └── _convert_chat_response_to_event()  ← LLM 响应 → AgentEvent
  │   │   → yield MODEL_CALL_START, TEXT_BLOCK_*, TOOL_CALL_*, MODEL_CALL_END
  │   │   → 如果 LLM 只返回 text（无 tool_call），yield AssistantMsg，结束
  │   │
  │   └── "acting" 路径:
  │       _batch_tool_calls()   ← 收集所有待执行的 tool_call
  │       for batch:
  │         _execute_concurrent_tool_calls():
  │           for each tool_call:
  │             _execute_tool_call():
  │               ├── Step 1: 验证 tool_call 输入
  │               ├── Step 2: PermissionEngine.check_permission()
  │               │     ├── DENY → yield TOOL_RESULT_*(error)
  │               │     ├── ASK  → yield REQUIRE_USER_CONFIRM → 暂停
  │               │     └── ALLOW → 继续
  │               ├── Step 3: _acting(tool_call)  ← 工具中间件包裹
  │               │     └── toolkit.call_tool()   ← 实际执行
  │               └── Step 4: _save_to_context()  ← 结果写入 AgentState
  │       → yield TOOL_RESULT_*
  │       → 如果 yield 了 REQUIRE_USER_CONFIRM → 暂停，等外部事件
  │
  └── Step 3: 循环结束
        └── yield REPLY_END
```

### 3.2 关键控制点：`_check_next_action()`

这是 AgentScope 的"调度器"，极其简洁：

```python
def _check_next_action(self):
    last_msg = self._get_last_msg()
    
    # 找到未完成的 tool_call
    unfinished = [tc for tc in last_msg.get_content_blocks("tool_call")
                  if tc.id not in finished_result_ids]
    
    executable = [tc for tc in unfinished 
                  if tc.state in (PENDING, ALLOWED)]
    awaiting   = [tc for tc in unfinished 
                  if tc.state in (ASKING, SUBMITTED)]
    
    if executable:
        return "acting", None       # 执行工具
    if awaiting:
        return "exit", AssistantMsg(...)  # 暂停，等外部
    return "reasoning", None        # 调用 LLM 继续思考
```

**核心洞察**：状态机的决策只依赖 `ToolCallBlock.state`，而这个 state 是由事件流更新的。不需要额外的调度表。

---

## 四、多 Agent 通信：TeamCreate/AgentCreate/TeamSay

### 4.1 这不是"多 Agent 框架"，这是"工具驱动的动态编组"

AgentScope 的多 Agent 不是预定义的 CEO/Manager/Worker 层级，而是：

1. 一个 Leader Agent 调用 `TeamCreate` 工具 → 创建 Team
2. Leader 调用 `AgentCreate(name, description, prompt)` 工具 → 动态创建子 Agent
3. 子 Agent 在自己的 Session 中独立运行
4. 子 Agent 通过 `TeamSay(to=leader_name, message=...)` 工具 → 发送消息给 Leader
5. 消息通过 MessageBus 的 inbox 机制投递到 Leader 的会话
6. Leader 的下一个 `_reasoning()` 调用会收到 HintBlock，注入到上下文中

### 4.2 通信机制：HintBlock + Inbox

```
Leader Session                    Worker Session
    │                                  │
    ├─ AgentCreate("researcher") ──►   │ (新 Session 创建)
    │                                  ├─ Agent.reply_stream(prompt)
    │                                  ├─ 执行任务...
    │                                  ├─ TeamSay(to="leader", msg="研究发现...")
    │                                  │   └─ MessageBus.queue_push(inbox_key, msg)
    │                                  │
    │  (Leader 继续自己的 ReAct)        │
    ├─ _reasoning()                    │
    │   └─ InboxMiddleware.drain()  ◄──┤  从 inbox 拉取消息
    │       └─ 转为 HintBlock 注入 LLM   │
    ├─ LLM: "收到研究员的报告..."        │
    ├─ AgentCreate("coder") ──────►    │ (又一个新 Session)
    │   ...                             │
```

**关键**：Agent 之间不直接调用，全部通过 MessageBus。子 Agent 只是一个 `AgentCreate` 工具调用 + 一个独立的 Session。

---

## 五、MorPex 当前消息流 vs AgentScope 对照

### 5.1 MorPex 当前路径（过度包装）

```
用户输入
  │
  ▼
POST /api/chat/message
  │
  ▼
CrossDomainRouter.dispatch(userInput)
  │  └── LLM 调用 → 返回 RoutingAnalysis
  │
  ▼
DomainClusterManager.execute(domainId, message)
  │
  ▼
AgentOrchestrator
  │  ├── createCEO → createManager → createWorkers
  │  └── assignTask → 手动调用 LLMProvider.get()
  │
  ▼
FSMEngine.feed("tool_execution_start", { ... })
  │  └── 手动转换状态
  │
  ▼
EventBus.emit({ id: identity.createEventId(),  ← MorPex 包装层
                 type: "runtime.tool.called",   ← 字符串类型
                 payload: event })              ← 嵌套原始事件
  │
  ▼
SSE → 前端
```

**问题**：
1. pi 的 `AgentEvent` 被包在 `MorPexEvent.payload` 中 → 前端需要解包
2. `type: "runtime.tool.called"` 丢失了 pi 原生的 `tool_execution_start` 语义
3. 手动 `FSMEngine.feed()` + 手动 `EventBus.emit()` → 双重状态管理
4. ToolCall 无状态机 → 不知道工具是在等待、执行中还是已完成

### 5.2 建议的目标路径（pi 原生直通）

```
用户输入
  │
  ▼
POST /api/chat/message
  │
  ▼
CrossDomainRouter.dispatch(userInput)
  │  └── 返回 RoutingAnalysis (isMultiDomain, involvedDomains, dag)
  │
  ▼  (单领域)
DomainClusterManager.execute(domainId, message)
  │
  ▼
AgentHarness.prompt(message)  ← pi 原生
  │
  ├── subscribe(listener) → 直接拿到 AgentEvent:
  │     agent_start → turn_start → message_start
  │       → text_start/delta/end, toolcall_start/delta/end
  │     → message_end → turn_end → agent_end
  │
  ├── beforeToolCall → PermissionEngine.check()  ← MorPex 权限层
  │     └── { block: true, reason: "需用户确认" } 时
  │           → ToolCallTracker → state=ASKING
  │           → EventBus.broadcastCrossDomain()  ← 通知前端
  │
  ▼  (pi 原生事件直通 SSE，不做二次包装)
SSE → 前端消费 { type: "text_delta", delta: "...", reply_id: "..." }
```

---

## 六、核心设计原则总结

| 原则 | AgentScope 做法 | MorPex 应采纳 |
|------|----------------|--------------|
| **事件即状态** | `Msg.append_event()` 消费事件更新消息 | pi `AgentEvent` 直接透传，不做包装 |
| **类型安全** | `AgentEvent` 是 discriminated union，每种子类型有独立字段 | 用 pi 的 `AgentEvent` 类型替代 `MorPexEvent` |
| **reply_id 绑定** | 一轮 ReAct 的所有事件共享一个 `reply_id` | 复用 pi 的 `reply_id` / `message_id` |
| **Block 粒度** | 消息内容按 Block 拆分，前端逐块渲染 | 直接用 pi 的 `TextContent/ThinkingContent/ToolCall` |
| **工具内嵌消息** | ToolCall/ToolResult 是 Msg.content 的 Block | 不要再单独搞一个 `ToolResult` 类型 |
| **中间件不侵入** | `on_reply/on_reasoning/on_acting/on_model_call` 洋葱模式 | 用 pi 的 `beforeToolCall/afterToolCall` + `on()` hooks |
| **Agent 通信靠总线和收件箱** | `MessageBus.queue_push(inbox_key)` + `InboxMiddleware.drain()` | MorPex 的 `EventBus` 已经支持 `emitToDomain` |
| **状态机在 Block 里** | `ToolCallBlock.state` 驱动整个调度 | 新建 `ToolCallTracker` 薄层追踪 |
| **无额外调度表** | `_check_next_action()` 只读 `ToolCallBlock.state` | FSMEngine 应简化为读 Block state |
