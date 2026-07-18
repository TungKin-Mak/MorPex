# MorPex v2.4 升级规划 — 实现参考手册

> 每个条目 = 要做什么 + pi 精确类型 + AgentScope 参考源文件 + 代码骨架。
> 下一个会话即可直接按此文档逐项实现。

---

## 快速索引

| Phase | 项目数 | 新建文件 | 修改文件 |
|:--|:--|:--|:--|
| 0 已完成 | 5 | 0 | 5 |
| 1 安全防御 | 4 | 5 | 1 |
| 2 执行流 | 4 | 2 | 1 |
| 3 多领域 | 6 | 3 | 2 |
| 4 记忆 | 3 | 0 | 0 |
| 5 设计调整 | 6 | 2 | 1 |

---

## Phase 0：已完成（5 项，无需操作）

略。

---

## Phase 1：安全与防御

### 1.1 ToolExecutionProxy — Worker 僵尸防御 + Runtime Agent Proxy

**做什么**：所有工具调用在独立 worker_threads 中执行。超时/内存超限自动 terminate。内核保持轻量。

**pi 类型锚点**：

```typescript
// pi-agent-core types.d.ts — AgentTool.execute 签名
interface AgentTool<TParams, TDetails> {
  execute: (
    toolCallId: string,
    params: Static<TParams>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>
  ) => Promise<AgentToolResult<TDetails>>;
}

// pi-agent-core harness/types.d.ts — afterToolCall 可覆写结果
interface AfterToolCallResult {
  content?: (TextContent | ImageContent)[];
  details?: unknown;
  isError?: boolean;
  terminate?: boolean;
}
```

**AgentScope 参考**：

```
agentscope/agent/_agent.py:
  _execute_tool_call()       — 工具调用生命周期 (L1563-1720)
  _acting()                  — 工具中间件包裹 (L1723-1760)
  _handle_error_tool_call()  — 错误工具结果生成 (L1770-1840)

agentscope/tool/_base.py:
  ToolBase.call()            — 工具执行入口
  ToolBase.__call__()        — 洋葱中间件链
```

**代码骨架**：

```typescript
// packages/core/tool/ToolExecutionProxy.ts
import { Worker } from 'worker_threads';
import type { AgentToolResult, AgentToolUpdateCallback } from '@earendil-works/pi-agent-core';

interface ProxyConfig {
  timeoutMs: number;       // 硬超时，默认 120_000
  maxMemoryMB: number;     // 内存上限，默认 512
  allowDegradedRetry: boolean; // 降级重试一次
}

export class ToolExecutionProxy {
  private active = new Map<string, Worker>();

  async execute<T>(
    toolCallId: string,
    toolName: string,
    args: unknown,
    workingDir: string,
    onUpdate?: AgentToolUpdateCallback<T>,
  ): Promise<AgentToolResult<T>> {
    // 1. new Worker(bootstrapPath, { resourceLimits })
    // 2. setTimeout → terminate('TIMEOUT')
    // 3. setInterval(memMonitor) → terminate('OOM')
    // 4. worker.on('message') → progress/completed/error
    // 5. catch → allowDegradedRetry ? retryOnce() : throw ToolExecutionTimeoutError
  }

  abortAll(): void { /* 紧急熔断 */ }
}
```

---

### 1.2 PermissionEngine — 5 种权限模式

**做什么**：AgentLoopConfig.beforeToolCall 的回调实现，按 deny→ask→allow→mode 优先级裁决。

**pi 类型锚点**：

```typescript
// pi-agent-core types.d.ts L229
beforeToolCall?: (
  context: BeforeToolCallContext,
  signal?: AbortSignal
) => Promise<BeforeToolCallResult | undefined>;

interface BeforeToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: AgentToolCall;        // { type:'toolCall', id, name, arguments }
  args: unknown;
  context: AgentContext;          // { systemPrompt, messages, tools? }
}

interface BeforeToolCallResult {
  block?: boolean;    // true → AgentLoop 自动生成 error ToolResult
  reason?: string;    // 阻止原因，会出现在 ToolResult 的 text 中
}
```

**AgentScope 参考**：

```
agentscope/permission/_engine.py:
  PermissionEngine.__init__()          — 绑定 PermissionContext
  check_permission(tool, input)        — 分发到 _check_<mode>
  _check_default()                     — deny→ask→tool自检→allow→默认ASK
  _check_explore()                     — 只读模式
  _check_bypass()                      — 全自动
  _check_dont_ask()                    — 无人值守
  _check_deny_rules / _check_ask_rules / _check_allow_rules

agentscope/permission/_types.py:
  PermissionMode: DEFAULT, EXPLORE, ACCEPT_EDITS, BYPASS, DONT_ASK
```

**代码骨架**：

```typescript
// packages/core/permission/PermissionEngine.ts
import type { BeforeToolCallContext, BeforeToolCallResult } from '@earendil-works/pi-agent-core';

type PermissionMode = 'default' | 'explore' | 'accept_edits' | 'bypass' | 'dont_ask';

interface PermissionRule {
  toolName: string;
  pattern?: string;    // glob for Read/Write/Edit, prefix for Bash
  behavior: 'allow' | 'deny' | 'ask';
}

export class PermissionEngine {
  constructor(
    private mode: PermissionMode,
    private rules: PermissionRule[],
    private workingDirs: string[],
  ) {}

  // 直接赋值给 AgentLoopConfig.beforeToolCall
  check = async (ctx: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> => {
    // 1. deny rules → return { block: true, reason: 'Denied: ...' }
    // 2. ask rules  → return { block: true, reason: 'ASYNC_SUSPEND_FOR_USER' }
    // 3. allow rules → return undefined (放行)
    // 4. mode fallback:
    //    explore      → isReadOnly ? undefined : { block: true }
    //    accept_edits → inWorkingDir ? undefined : { block: true }
    //    bypass       → undefined
    //    dont_ask     → { block: true }
    //    default      → { block: true, reason: 'requires confirmation' }
  };
}
```

---

### 1.3 EventStore — Event Sourcing 持久化

**做什么**：每次状态变迁追加一行 JSONL。重启时重放重建运行时状态。

**pi 类型锚点**：

```typescript
// pi-agent-core harness/types.d.ts — SessionStorage 接口
interface SessionStorage {
  appendEntry(entry: SessionTreeEntry): Promise<void>;
  getEntry(id: string): Promise<SessionTreeEntry | undefined>;
  getPathToRoot(leafId: string): Promise<SessionTreeEntry[]>;
}

// MorPex 已有的 JSONL 工具
// packages/core/utils/jsonl.ts
function readJSONLLines<T>(path: string): AsyncGenerator<T>;
```

**AgentScope 参考**：

```
agentscope/app/storage/_base.py:
  StorageBase 接口 — 持久化抽象

agentscope/state/_state.py:
  AgentState  — Pydantic BaseModel，可直接序列化
```

**代码骨架**：

```typescript
// packages/core/event/EventStore.ts
import { readJSONLLines } from '../../utils/jsonl.js';

type SourcingEvent =
  | { type: 'tool_call_state_change'; toolCallId: string; from: string; to: string; ts: number; execId: string }
  | { type: 'fsm_transition'; taskId: string; from: string; to: string; ts: number; execId: string }
  | { type: 'artifact_created'; artifactId: string; ts: number; execId: string }
  | { type: 'artifact_updated'; artifactId: string; version: number; ts: number; execId: string }
  | { type: 'negotiation_ticket_created'; ticketId: string; ts: number; execId: string }
  | { type: 'negotiation_ticket_resolved'; ticketId: string; status: string; ts: number; execId: string }
  | { type: 'worker_spawned'; toolCallId: string; ts: number; execId: string }
  | { type: 'worker_terminated'; toolCallId: string; reason: string; ts: number; execId: string }
  | { type: 'dag_node_status_change'; nodeId: string; from: string; to: string; ts: number; execId: string };

export class EventStore {
  constructor(private logPath: string) {}

  async append(event: SourcingEvent): Promise<void> {
    // fs.appendFile(logPath, JSON.stringify(event) + '\n')
  }

  async replay(executionId: string): Promise<ReplayState> {
    // readJSONLLines → filter by executionId → fold into ReplayState
  }
}
```

---

### 1.4 LLM Resilience — extractJson 三级修复

**做什么**：Level 1 括号匹配（已有）→ Level 2 截断补齐 → Level 3 带错误反馈的 1 次 LLM 重试。

**pi 类型锚点**：

```typescript
// pi-ai types.d.ts — completeSimple 用于 LLM 调用
function completeSimple(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions
): Promise<AssistantMessage>;

// LLMProvider 已注册的调用函数
type LLMCaller = (prompt: string, systemPrompt?: string) => Promise<string>;
```

**AgentScope 参考**：

```
agentscope/agent/_agent.py:
  _call_model() L1006 — 模型调用 + 重试逻辑 + fallback model
```

**修改文件**：`packages/core/utils/extractJson.ts`

```typescript
export function extractJson(
  raw: string,
  options?: {
    repair?: boolean;        // 默认 true
    retryWithLLM?: boolean;  // 默认 false (需要 LLMCaller)
    llmCaller?: (prompt: string) => Promise<string>;
  }
): string | null {
  // Level 1: 已有 — 逐字符括号匹配
  let result = extractBraceJson(raw);
  if (result) return result;

  // Level 2: 就地修复 — 找最后一个合法 key，补齐 }
  if (options?.repair !== false) {
    result = repairTruncatedJson(raw);
    if (result) return result;
  }

  // Level 3: LLM 重试 — 仅当提供了 llmCaller
  if (options?.retryWithLLM && options?.llmCaller) {
    const retryPrompt = `你之前输出的 JSON 格式有误，解析失败。请修复后只输出完整的 JSON，不要包含其他文字。\n\n原始输出:\n${raw}`;
    const retryRaw = await options.llmCaller(retryPrompt);
    return extractBraceJson(retryRaw); // 再走一次 Level 1
  }

  return null;
}
```

---

## Phase 2：Agent 执行流升级

### 2.1 ToolCallTracker — 状态机

**做什么**：追踪每个 tool_call 的 PENDING→ASKING→ALLOWED→EXECUTING→FINISHED。

**pi 类型锚点**：

```typescript
// pi-agent-core types.d.ts — AgentEvent (discriminated union)
type AgentEvent =
  | { type: 'tool_execution_start'; toolCallId: string; toolName: string; args: any }
  | { type: 'tool_execution_end'; toolCallId: string; toolName: string; result: any; isError: boolean };

// pi-agent-core harness/types.d.ts — ToolCallEvent (harness hook)
interface ToolCallEvent {
  type: 'tool_call';
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}
```

**AgentScope 参考**：

```
agentscope/message/_block.py:
  ToolCallState: PENDING, ASKING, ALLOWED, SUBMITTED, FINISHED (L90-103)
  ToolCallBlock.state 字段 (L110-130)

agentscope/agent/_agent.py:
  _update_tool_call_state() — 状态更新 (L1297)
  _check_next_action()      — 基于 state 的调度 (L748)
```

**代码骨架**：

```typescript
// packages/core/tool/ToolCallTracker.ts
import type { AgentEvent } from '@earendil-works/pi-agent-core';

export type ToolCallState = 'PENDING' | 'ASKING' | 'ALLOWED' | 'EXECUTING' | 'FINISHED';

export class ToolCallTracker {
  private states = new Map<string, ToolCallState>();
  private eventStore?: EventStore;

  constructor(eventStore?: EventStore) { this.eventStore = eventStore; }

  transition(toolCallId: string, to: ToolCallState): void {
    const from = this.states.get(toolCallId) ?? 'PENDING';
    this.states.set(toolCallId, to);
    this.eventStore?.append({ type: 'tool_call_state_change', toolCallId, from, to, ts: Date.now(), execId: '' });
  }

  // 供 harness.subscribe() 调用
  onAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'tool_execution_start':
        this.transition(event.toolCallId, 'EXECUTING'); break;
      case 'tool_execution_end':
        this.transition(event.toolCallId, 'FINISHED'); break;
    }
  }

  getState(toolCallId: string): ToolCallState { return this.states.get(toolCallId) ?? 'PENDING'; }
  getAll(): Map<string, ToolCallState> { return new Map(this.states); }
}
```

---

### 2.2 CompactionPolicy — 自动压缩

**做什么**：每次 LLM 调用前估算 token 数，超阈值自动触发 harness.compact()。

**pi 类型锚点**：

```typescript
// pi-agent-core harness/agent-harness.d.ts L60
compact(customInstructions?: string): Promise<{
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: unknown;
}>;

// pi-agent-core harness/compaction/compaction.d.ts L50
function estimateContextTokens(messages: AgentMessage[]): ContextUsageEstimate;

// pi-agent-core harness/types.d.ts — session_before_compact hook
harness.on('session_before_compact', handler) → SessionBeforeCompactResult | undefined
```

**AgentScope 参考**：

```
agentscope/agent/_agent.py:
  compress_context()            — 压缩入口 (在 _reply_impl 的 reasoning 前调用)
  _split_context_for_compression() — Token 计数 + 拆分 (L890-960)
  _split_tool_result_for_compression() — 大结果截断 (L1055-1130)
```

**代码骨架**：

```typescript
// packages/core/compaction/CompactionPolicy.ts
import type { AgentHarness } from '@earendil-works/pi-agent-core';
import { estimateContextTokens } from '@earendil-works/pi-agent-core/harness/compaction/compaction';

export class CompactionPolicy {
  constructor(
    private harness: AgentHarness,
    private threshold: number = 80000,
    private keepRecent: number = 16000,
  ) {}

  async maybeCompact(messages: AgentMessage[]): Promise<void> {
    const est = estimateContextTokens(messages);
    if (est.total > this.threshold) {
      await this.harness.compact('保留最近的决策和当前任务上下文。');
    }
  }

  // 注册到 harness.on('context')
  hook = async (event: { messages: AgentMessage[] }) => {
    await this.maybeCompact(event.messages);
    return { messages: event.messages };
  };
}
```

---

### 2.3 ToolResultOffloader — 大结果截断

**做什么**：超大 tool_result (>10000 字符) 存文件，上下文只留引用。

**pi 类型锚点**：

```typescript
// pi-agent-core types.d.ts L242
afterToolCall?: (
  context: AfterToolCallContext,
  signal?: AbortSignal
) => Promise<AfterToolCallResult | undefined>;

interface AfterToolCallResult {
  content?: (TextContent | ImageContent)[];  // 替换原结果
  details?: unknown;
  isError?: boolean;
  terminate?: boolean;
}
```

**AgentScope 参考**：

```
agentscope/agent/_agent.py:
  _split_tool_result_for_compression() L1055 — 分块 + 截断 + offload_reminder
```

**代码骨架**：

```typescript
// 直接在 AgentLoopConfig 中声明
const loopConfig: AgentLoopConfig = {
  afterToolCall: async (ctx) => {
    const text = ctx.result.content
      .filter(c => c.type === 'text')
      .map(c => (c as TextContent).text)
      .join('');
    if (text.length > 10000) {
      const path = await writeWorkspaceFile(ctx.toolCallId, text);
      return {
        content: [{ type: 'text', text: `[结果已保存到 ${path}，共 ${text.length} 字符。调用 Read 工具查看。]` }],
      };
    }
  },
};
```

---

### 2.4 FSMEngine SUSPENDED — 非阻塞挂起

**做什么**：PermissionEngine 返回 ASK 时，不阻塞线程，序列化状态后释放。用户确认后通过 pi 原生 reply_stream 恢复。

**pi 类型锚点**：

```typescript
// pi-agent-core harness/agent-harness.d.ts — reply_stream 接受外部事件
// Agent.reply_stream() 可接收 UserConfirmResultEvent / ExternalExecutionResultEvent / UserInterruptEvent
// pi 的 _reply_impl 内部检测 is_awaiting → _handle_incoming_event → 恢复执行

// 关键：harness.subscribe() 不是 reply_stream。恢复时需重新调用 harness 的内部方法。
// 更精确的做法：保留 SuspendedSession { session, pendingToolCalls }，
// 恢复时用 session 重新创建 AgentHarness，调用 harness.reply_stream(UserConfirmResultEvent)
```

**AgentScope 参考**：

```
agentscope/agent/_agent.py:
  _reply_impl()          — is_awaiting 检测 (L710)
  _handle_incoming_event() — 处理 UserConfirmResultEvent (L730)
  reply_stream(inputs)   — 统一入口，接受 Msg | UserConfirmResultEvent | ...
```

**修改文件**：`packages/core/planes/runtime-kernel/fsm/FSMEngine.ts`

```typescript
// FSMEngine 新增
type FSMState = 'IDLE' | 'PLANNING' | 'RUNNING' | 'SUSPENDED' | 'WAITING_TOOL' | 'WAITING_USER' | 'VERIFYING' | 'INTERROGATING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

interface SuspendedTask {
  taskId: string;
  sessionId: string;       // pi Session ID，用于恢复
  replyId: string;         // pi reply_id
  pendingToolCalls: { id: string; name: string }[];
  suspendedAt: number;
}

class FSMEngine {
  private suspendedTasks = new Map<string, SuspendedTask>();

  suspend(taskId: string, sessionId: string, replyId: string, toolCalls: AgentToolCall[]): void {
    this.feed('user_input', { taskId }); // 或新增专用事件
    this.state = 'SUSPENDED';
    this.suspendedTasks.set(taskId, { taskId, sessionId, replyId, pendingToolCalls: toolCalls.map(tc => ({ id: tc.id, name: tc.name })), suspendedAt: Date.now() });
  }

  async resume(taskId: string, confirmResults: { toolCallId: string; confirmed: boolean }[]): Promise<void> {
    const suspended = this.suspendedTasks.get(taskId);
    if (!suspended) throw new Error(`No suspended task: ${taskId}`);

    // 从 Session 恢复 AgentHarness
    const harness = await this.restoreHarness(suspended.sessionId);

    // pi 原生恢复：传入 UserConfirmResultEvent
    // （需要构造符合 pi 类型的事件对象）
    await harness.reply_stream({
      type: 'user_confirm_result',
      reply_id: suspended.replyId,
      confirm_results: confirmResults.map(r => ({
        confirmed: r.confirmed,
        tool_call: { id: r.toolCallId },
      })),
    } as any);

    this.suspendedTasks.delete(taskId);
    this.state = 'RUNNING';
  }
}
```

---

## Phase 3：多领域协同升级

### 3.1 DomainCluster Cgroup

**做什么**：AgentCreate 工具内部调用 DomainCluster.spawnSubAgent()，做配额检查 + 工具继承 + 目录锁。

**pi 类型锚点**：

```typescript
// pi-agent-core harness/agent-harness.d.ts
class AgentHarness {
  constructor(options: AgentHarnessOptions);
}

interface AgentHarnessOptions {
  env: ExecutionEnv;
  session: Session;
  tools?: AgentTool[];
  systemPrompt?: string | (() => string);
  model: Model<any>;
  activeToolNames?: string[];
}
```

**AgentScope 参考**：

```
agentscope/app/_tool/_agent_create.py:
  AgentCreate — 工具类，内部调用 _merge_leader_permissions()
  SubAgentTemplate — 子Agent模板
```

**修改文件**：`packages/core/domains/DomainCluster.ts`

```typescript
export class DomainCluster {
  private tokenQuota: number = 2_000_000;
  private usedTokens: number = 0;

  spawnSubAgent(params: {
    name: string;
    description: string;
    prompt: string;
    harness: AgentHarness;
  }): AgentHarness {
    if (this.usedTokens >= this.tokenQuota) {
      throw new Error(`[Cgroup] Domain ${this.manifest.domain_id} token quota exceeded`);
    }
    // 工具链 = Manifest.baseTools ∩ Manifest.allowedTools（不可由 LLM 指定）
    const tools = this.manifest.baseTools.filter(t => !this.manifest.disallowedTools?.includes(t.name));
    const session = createSession({ cwd: this.workingDir });
    return new AgentHarness({
      env: params.harness.env,
      session,
      tools,
      systemPrompt: this.buildSubAgentPrompt(params),
      model: params.harness.getModel(),
    });
  }
}
```

---

### 3.2 TeamSay + NegotiationEngine 分层

**做什么**：TeamSay 走 `harness.steer()`（UDP 语义），NegotiationEngine 走 `ArtifactRegistry.acquireLock()`（TCP 语义）。

**pi 类型锚点**：

```typescript
// pi-agent-core harness/agent-harness.d.ts L40-48
steer(text: string): Promise<void>;       // 注入 steering 消息
followUp(text: string): Promise<void>;    // 注入 followUp 消息
nextTurn(text: string): Promise<void>;    // 注入 nextTurn 消息
```

**AgentScope 参考**：

```
agentscope/app/_tool/_team_say.py:
  TeamSay — 工具类，调用 MessageBus.queue_push(inbox_key)

agentscope/app/middleware/_inbox_middleware.py:
  InboxMiddleware — 从 inbox drain 消息 → HintBlock 注入
```

```typescript
// TeamSay 工具执行体
class TeamSayTool implements AgentTool {
  name = 'TeamSay';
  description = '向指定 Agent 发送消息';

  async execute(toolCallId: string, params: { to: string; message: string }): Promise<AgentToolResult> {
    const targetHarness = this.registry.get(params.to);
    // pi 原生 steer() — 异步非阻塞，目标 Agent 当前 turn 完成后自动消费
    await targetHarness.steer(`[来自 ${this.senderName}]: ${params.message}`);
    return { content: [{ type: 'text', text: `消息已发送至 ${params.to}` }], details: {} };
  }
}
```

---

### 3.3 NegotiationEngine 震荡熔断

**做什么**：MAX_ALIGN_ROUNDS=3 耗尽后 → LLM 生成仲裁提示词 → REQUIRE_USER_CONFIRM。

**AgentScope 参考**：

```
agentscope/negotiation/ — (AgentScope 无 NegotiationEngine，这是 MorPex 独有的)
但可参考 AgentScope 的 PermissionEngine 中 ASK → DENY 的转换模式:
  _convert_ask_to_deny() — DONT_ASK 模式下 ASK 自动转 DENY
```

**修改文件**：`packages/core/negotiation/NegotiationEngine.ts`

```typescript
async escalateToArbitration(ticket: InterrogationTicket): Promise<ArbitrationPrompt> {
  const rounds = ticket.history.filter(r => r.action === 'argue');
  // 1. 提取双方立场
  // 2. 调用 LLM 生成建议方案
  // 3. 生成 REQUIRE_USER_CONFIRM 事件 → SSE → AstroM 3D
  return {
    ticketId: ticket.ticket_id,
    conflict: ticket.reason,
    positionA: extractDomainPosition(ticket.source_domain, rounds),
    positionB: extractDomainPosition(ticket.target_domain, rounds),
    rounds: ticket.depth_count,
    suggestions: await this.llm.generateSuggestions(positionA, positionB),
  };
}
```

---

### 3.4 ReadArtifactTool — Lazy VFS

**做什么**：下游 Agent 的 systemPrompt 注入产物摘要 + ReadArtifact 工具。LLM 需要细节时按 section 惰性加载。

**pi 类型锚点**：

```typescript
// pi-agent-core types.d.ts L305
interface AgentTool<TParams, TDetails> {
  name: string;
  description: string;
  parameters: TSchema;
  label: string;
  execute: (toolCallId: string, params: Static<TParams>, signal?, onUpdate?) => Promise<AgentToolResult<TDetails>>;
}
```

**代码骨架**：

```typescript
// packages/core/tool/ReadArtifactTool.ts
export class ReadArtifactTool implements AgentTool {
  name = 'ReadArtifact';
  description = '按需读取上游产物的指定章节';
  parameters = Type.Object({
    uri: Type.String({ description: 'artifact://{domain}/{type}/{id}' }),
    section: Type.Optional(Type.String({ description: '章节名，如 BOM/PCB/Firmware' })),
  });

  async execute(_toolCallId: string, params: { uri: string; section?: string }): Promise<AgentToolResult> {
    const artifact = ArtifactRegistry.resolve(params.uri);
    if (!artifact) return { content: [{ type: 'text', text: `产物 ${params.uri} 不存在` }], details: {} };

    const content = params.section
      ? extractSection(artifact.content, params.section)
      : artifact.summary;

    return {
      content: [{ type: 'text', text: formatArtifactContent(artifact, content) }],
      details: {
        artifactId: artifact.id,
        version: artifact.version,
        fullSize: artifact.content.length,
        availableSections: artifact.sections,
      },
    };
  }
}
```

---

### 3.5 CollaborationHub — 预对齐沙盒

**做什么**：CrossDomainRouter 检测模糊双向依赖时，不立即生成 DAG，创建临时沙盒做 2-3 轮对齐。

**AgentScope 参考**：

```
AgentScope 没有完全对应的概念。最接近的是:
  agentscope/app/_tool/_team_create.py  — 创建 Team 容器
  Team 中的多个 Agent 通过 TeamSay 自由通信
```

**新增文件**：`packages/core/collaboration/CollaborationHub.ts`

```typescript
export class CollaborationHub {
  constructor(
    private participants: string[],  // domain IDs
    private maxRounds: number = 3,
    private goal: string,
  ) {}

  async align(): Promise<AlignmentResult> {
    for (let round = 0; round < this.maxRounds; round++) {
      // 1. 每个 participant 的 Agent 收到 steering: "你需要与 {other} 对齐 {goal}"
      // 2. 通过 harness.steer() 互相发送立场
      // 3. 检测是否收敛（双方不再提出新异议）
      if (this.hasConverged()) break;
    }
    // 返回对齐结果 → CrossDomainRouter 据此生成 DAG
    return { aligned: this.hasConverged(), consensus: this.extractConsensus() };
  }
}
```

---

### 3.6 SessionProjection — 跨域投影

**做什么**：子领域等待用户确认时，状态投影到父领域 SSE。

**AgentScope 参考**：

```
agentscope/app/_service/_session_projection.py:
  SessionProjection.upsert()  — 持久化投影卡片
  SessionProjection.publish() — 向目标 session 发送 CustomEvent

agentscope/app/_service/_projectors/_subagent_hitl.py:
  SubagentHitlProjector — 子 Agent HITL 投影到 Leader
```

**代码骨架**：

```typescript
// packages/core/projection/SessionProjection.ts
export class SessionProjection {
  constructor(private eventBus: EventBus) {}

  async project(params: {
    sourceSessionId: string;
    targetSessionId: string;
    kind: string;          // 'subagent_hitl' | 'negotiation' | ...
    payload: Record<string, unknown>;
  }): Promise<void> {
    // 1. 持久化 (EventBus 已有 broadcastCrossDomain)
    // 2. 发布 CustomEvent 到目标 session 的 SSE
    this.eventBus.broadcastCrossDomain({
      id: createEventId(),
      type: 'custom',
      timestamp: Date.now(),
      executionId: params.sourceSessionId,
      source: 'projection',
      payload: {
        name: params.kind,
        value: params.payload,
      },
    });
  }
}
```

---

## Phase 4：记忆体系升级

### 4.1 自动写回（harness.subscribe → agent_end）

```typescript
// pi-agent-core types.d.ts — AgentEvent
// { type: 'agent_end'; messages: AgentMessage[] }

harness.subscribe(async (event) => {
  if (event.type === 'agent_end') {
    // event.messages 是 AgentMessage[] = (UserMessage|AssistantMessage|ToolResultMessage|CustomAgentMessages)[]
    const userMsg = event.messages.find(m => m.role === 'user');
    const assistantMsgs = event.messages.filter(m => m.role === 'assistant');
    if (userMsg && assistantMsgs.length > 0) {
      await memoryBus.remember({
        content: assistantMsgs.map(m => extractText(m)).join('\n'),
        source: 'execution',
        sourceId: executionId,
        tags: ['conversation', domainId],
        importance: 3,
      });
    }
  }
});
```

### 4.2 on_reasoning 注入（harness.on('context')）

```typescript
harness.on('context', async (event) => {
  // event.messages: AgentMessage[]
  const query = event.messages
    .filter(m => m.role === 'user')
    .map(m => extractText(m))
    .join(' ');
  const memories = await memoryBus.recall({ text: query, topK: 5 });
  if (memories.length > 0) {
    const hintMsg = buildHintMessage(memories);
    return { messages: [...event.messages, hintMsg] };
  }
});
```

### 4.3 Agentic 模式 — 声明合并扩展

```typescript
// packages/core/messages.ts
declare module '@earendil-works/pi-agent-core' {
  interface CustomAgentMessages {
    memoryHint: {
      role: 'memoryHint';
      memories: string[];
      timestamp: number;
    };
    dagNodeStatus: {
      role: 'dagNodeStatus';
      nodeId: string;
      domain: string;
      status: 'pending' | 'running' | 'success' | 'failed';
      timestamp: number;
    };
  }
}

// 在 AgentLoopConfig.convertToLlm 中将 memoryHint 转为 user message
convertToLlm: (messages) => messages.map(m => {
  if (m.role === 'memoryHint') {
    return { role: 'user', content: `[记忆]\n${m.memories.join('\n')}`, timestamp: m.timestamp };
  }
  return m;
});
```

---

## Phase 5：设计方向调整

### 5.1 Structured Trace Protocol — EventBus 注入 zone

**做什么**：`emitToDomain` / `broadcastCrossDomain` 自动注入 sourceZone/targetZone。

**pi 类型锚点**：无直接锚点。这是 MorPex EventBus 层的增强。

**AgentScope 参考**：

```
agentscope/event/_event.py:
  EventBase.id, created_at, metadata  — 标准化事件元数据
  ReplyStartEvent.session_id, reply_id — 事件携带会话上下文
```

**修改文件**：`packages/core/core/EventBus.ts`

```typescript
// emitToDomain 自动注入
emitToDomain(domainId: string, event: MorPexEvent): void {
  // 自动注入 zone 元数据
  event.sourceZone = this.currentDomain;    // 从 AsyncLocalStorage 或调用上下文获取
  event.targetZone = domainId;
  // ... 其余逻辑不变
}

broadcastCrossDomain(event: MorPexEvent): void {
  event.sourceZone = this.currentDomain;
  event.targetZone = '*';  // 广播
  // ... 其余逻辑不变
}
```

### 5.2 FSMEngine 调度简化

```
从: TRANSITIONS 表 + feed() 手动驱动
到: _check_next_action() 只读 ToolCallTracker 的 state Map

参考 Agentscope 的:
  agentscope/agent/_agent.py L748 _check_next_action()
  → 有 executable tool_call → 'acting'
  → 有 awaiting tool_call   → 'exit'
  → 都没有                   → 'reasoning'
```

### 5.3 – 5.6 均为纯设计方向调整，无独立代码文件。

---

## 附录 A：pi 类型快速参考

| 类型 | 源文件 | 用途 |
|:--|:--|:--|
| `AgentEvent` | `pi-agent-core/dist/types.d.ts` | 流式事件，SSE 直通 |
| `AgentMessage` | `pi-agent-core/dist/types.d.ts` | 消息联合类型 |
| `AgentTool` | `pi-agent-core/dist/types.d.ts` | 工具定义 |
| `AgentLoopConfig` | `pi-agent-core/dist/types.d.ts` | beforeToolCall/afterToolCall/convertToLlm |
| `AgentHarness` | `pi-agent-core/dist/harness/agent-harness.d.ts` | prompt/steer/compact/subscribe/on |
| `AgentHarnessOwnEvent` | `pi-agent-core/dist/harness/types.d.ts` | harness.on() 的 13 个 hook 事件 |
| `SessionStorage` | `pi-agent-core/dist/harness/types.d.ts` | Session tree 持久化接口 |
| `AssistantMessage` | `pi-ai/dist/types.d.ts` | LLM 响应消息 |
| `ToolCall` | `pi-ai/dist/types.d.ts` | 工具调用块 |
| `TextContent` / `ThinkingContent` | `pi-ai/dist/types.d.ts` | 内容块 |
| `CustomAgentMessages` | `pi-agent-core/dist/types.d.ts` | 声明合并扩展点 |
| `completeSimple` | `pi-ai/dist/stream.d.ts` | LLM 调用 |

## 附录 B：AgentScope 参考文件索引

| 文件                                                                      | 参考内容                                                                                     |
| :---------------------------------------------------------------------- | :--------------------------------------------------------------------------------------- |
| `agentscope/agent/_agent.py`                                            | ReAct 循环、_reply_impl、_reasoning、_acting、_check_next_action、compress_context              |
| `agentscope/message/_base.py`                                           | Msg、UserMsg、AssistantMsg、SystemMsg、append_event()                                        |
| `agentscope/message/_block.py`                                          | TextBlock、ThinkingBlock、ToolCallBlock(state machine)、ToolResultBlock、HintBlock、DataBlock |
| `agentscope/event/_event.py`                                            | AgentEvent 联合类型、START/DELTA/END 协议                                                       |
| `agentscope/middleware/_base.py`                                        | MiddlewareBase、on_reply/on_reasoning/on_acting/on_model_call/on_system_prompt            |
| `agentscope/permission/_engine.py`                                      | PermissionEngine、5 种模式、deny→ask→allow 优先级                                                |
| `agentscope/middleware/_longterm_memory/_mem0/_middleware.py`           | Mem0Middleware、on_reply 自动写回、on_reasoning 注入、两级回退                                        |
| `agentscope/middleware/_longterm_memory/_reme/_middleware.py`           | ReMeMiddleware、增量写回、异步检索+注入分离                                                            |
| `agentscope/middleware/_longterm_memory/_agentic_memory/_middleware.py` | AgenticMemory、LLM 自己管理文件系统记忆                                                             |
| `agentscope/middleware/_rag.py`                                         | RAGMiddleware、static/agentic 双模式                                                         |
| `agentscope/app/_service/_session_projection.py`                        | SessionProjection、跨会话 UI 投影                                                              |
| `agentscope/app/_tool/_agent_create.py`                                 | AgentCreate 工具、子 Agent 创建 + 权限继承                                                         |
| `agentscope/tool/_base.py`                                              | ToolBase、call/check_permissions/match_rule/generate_suggestions                          |
| `agentscope/tool/_response.py`                                          | ToolChunk、ToolResponse、append_chunk                                                      |
