# MorPex 深水区防御性架构补强

> 三条防患于未然的架构建议，确保框架在极端软硬件联合研发场景下无可挑剔。

---

## 一、Worker 僵尸进程防御 + 反向熔断

### 威胁场景

`ToolExecutionProxy` 将 Frida Hook、固件编译、KTransformers 等重操作隔离到 `worker_threads`。底层 C++ 钩子崩溃、死循环、内存泄漏会导致：
- 僵尸线程（进程已死但 Worker 句柄未释放）
- 内存 RSS 飙升（大模型加载泄漏）
- 主线程被异步句柄挂住无法退出

### 防御机制

```
Worker 生命周期 = 三条防线

防线 1: 硬超时 (AbortController)
  ── timeoutMs 到期 → worker.terminate() → 抛 TOOL_EXECUTION_TIMEOUT

防线 2: 内存熔断 (RSS Monitor)
  ── 每 5 秒采样 process.memoryUsage().heapUsed
  ── 超过 maxMemoryMB × 0.9 → worker.terminate() → 抛 TOOL_EXECUTION_TIMEOUT

防线 3: 降级重试 (Degraded Retry)
  ── Worker 异常退出后，允许一次降级重试（不带 progress 流，只取最终结果）
  ── 重试也失败 → FSMEngine.feed('error', { code: 'TOOL_EXECUTION_TIMEOUT' })
```

### 新增文件

| 文件 | 职责 |
|:--|:--|
| `packages/core/tool/ToolExecutionProxy.ts` | Worker 池管理、超时熔断、内存监控、降级重试 |
| `packages/core/tool/ToolExecutionTimeoutError.ts` | 标准异常类，携带 toolCallId/toolName/originalError |

### FSMEngine 集成

```typescript
// FSMEngine 收到 TOOL_EXECUTION_TIMEOUT 后：
this.feed('tool_execution_end', {
  toolCallId,
  result: { content: [{ type: 'text', text: `工具执行超时: ${error.message}` }] },
  isError: true,
});
// → ToolCallTracker: state → FINISHED (error)
// → AgentLoop 自动将 error ToolResult 注入 LLM 上下文
// → LLM 看到错误后自行决定重试或换方案
```

### 紧急熔断

```typescript
// 系统关闭或遇到级联故障时
await toolExecutionProxy.abortAll();
// → 所有活跃 Worker 被 terminate
// → 所有 pending tool_call 收到 TOOL_EXECUTION_TIMEOUT
// → FSMEngine 统一降级
```

---

## 二、NegotiationEngine 语义震荡熔断 + 中央仲裁

### 威胁场景

硬件 Agent 坚持用 $50 的 RISC-V 芯片，财务 Agent 坚守 $30 预算。3 轮博弈后仍未收敛（语义震荡）。此时不能摆烂抛异常，必须引入人类仲裁。

### 防御机制

```
MAX_ALIGN_ROUNDS = 3

Round 1: 硬件 → 财务: "RISC-V 芯片 $50，性能必需"
        财务 → 硬件: "超预算 $20，换 $28 的 ARM"

Round 2: 硬件 → 财务: "ARM 缺 DMA 控制器，不可行"
        财务 → 硬件: "那 $35 的国产 RISC-V？"

Round 3: 硬件 → 财务: "$35 芯片缺 FPU，不可行"
        财务 → 硬件: "这是最终预算，无法调整"

─── MAX_ALIGN_ROUNDS 耗尽 ───

震荡熔断触发:
  ├── 1. NegotiationEngine 生成中央仲裁提示词
  │      格式: {
  │        conflict: "硬件选型预算冲突",
  │        positionA: { domain: "hardware_engineering", demand: "$50 RISC-V", reason: "需要 FPU + DMA" },
  │        positionB: { domain: "business_finance",    limit: "$30", reason: "总BOM不能超$100" },
  │        gap: "$20",
  │        rounds: 3,
  │        suggestions: ["增加预算到 $120", "换用 $35 国产芯片并软件模拟 FPU", "砍掉非核心传感器"]
  │      }
  │
  ├── 2. 生成 REQUIRE_USER_CONFIRM 事件
  │      携带冲突数据 → SSE → AstroM 3D 大脑
  │
  ├── 3. AstroM 前端渲染:
  │      - 硬件脑区 和 财务脑区 之间画红色冲突引线
  │      - 展示三方卡片: 硬件诉求 | 财务约束 | 建议方案
  │
  └── 4. 人类在 UI 上裁决 → UserConfirmResultEvent
        → NegotiationEngine.resolveWithArbitration(ticketId, decision)
        → 产物解锁，单方或双方按裁决修改
```

### NegotiationEngine 新增方法

```typescript
class NegotiationEngine {
  static readonly MAX_ALIGN_ROUNDS = 3;

  /**
   * escalateToArbitration — 语义震荡熔断
   *
   * 当 depth_count > MAX_ALIGN_ROUNDS 时，
   * 不抛异常，而是生成结构化冲突摘要，
   * 通过 REQUIRE_USER_CONFIRM 提交人类仲裁。
   */
  async escalateToArbitration(ticket: InterrogationTicket): Promise<ArbitrationPrompt> {
    // 1. 提取双方立场
    const rounds = ticket.history.filter(r => r.action === 'argue');
    const positionA = this.extractPosition(ticket.source_domain, rounds);
    const positionB = this.extractPosition(ticket.target_domain, rounds);

    // 2. 调用 LLM 生成建议方案
    const suggestions = await this.llm.generateSuggestions(positionA, positionB);

    // 3. 生成仲裁提示词
    return {
      ticketId: ticket.ticket_id,
      conflict: ticket.reason,
      positionA,
      positionB,
      gap: this.computeGap(positionA, positionB),
      rounds: ticket.depth_count,
      suggestions,
    };
  }
}
```

---

## 三、会话树快照的事件溯源（Event Sourcing）

### 威胁场景

FSM 支持 SUSPENDED 挂起和恢复。如果系统重启或分布式部署：
- 内存中的 `activeWorkers` Map 丢失
- `ToolCallTracker` 的状态机全部丢失
- `FSMEngine.transitionHistory` 丢失
- 前端 AstroM 3D 大脑的运行时状态无法还原

### 防御机制：Append-only Log + 重放恢复

```
核心原则：不存"当前状态"，只存"状态变迁事件"。
当前状态 = 重放所有事件得到。

每一次状态拨动，在 JSONL 中追加一行不可变日志：

{
  "type": "tool_call_state_change",
  "toolCallId": "tc1",
  "from": "PENDING",
  "to": "ASKING",
  "timestamp": 1720610000000,
  "executionId": "exe_20250710_a81f92cd",
  "metadata": { "reason": "requires user confirmation" }
}

{
  "type": "fsm_transition",
  "taskId": "task_0",
  "from": "RUNNING",
  "to": "SUSPENDED",
  "timestamp": 1720610001000,
  "executionId": "exe_20250710_a81f92cd"
}
```

### 事件类型定义（新增）

```typescript
type SourcingEvent =
  | { type: 'tool_call_state_change'; toolCallId: string; from: ToolCallState; to: ToolCallState; timestamp: number; executionId: string; metadata?: Record<string, unknown> }
  | { type: 'fsm_transition'; taskId: string; from: FSMState; to: FSMState; timestamp: number; executionId: string }
  | { type: 'artifact_created'; artifactId: string; uri: string; timestamp: number; executionId: string }
  | { type: 'artifact_updated'; artifactId: string; version: number; timestamp: number; executionId: string }
  | { type: 'negotiation_ticket_created'; ticketId: string; source: string; target: string; timestamp: number; executionId: string }
  | { type: 'negotiation_ticket_resolved'; ticketId: string; status: TicketStatus; timestamp: number; executionId: string }
  | { type: 'worker_spawned'; toolCallId: string; workerId: string; timestamp: number; executionId: string }
  | { type: 'worker_terminated'; toolCallId: string; reason: string; timestamp: number; executionId: string }
  | { type: 'dag_node_status_change'; nodeId: string; domain: string; from: string; to: string; timestamp: number; executionId: string };
```

### EventStore 实现

```typescript
class EventStore {
  private logPath: string;

  constructor(basePath: string) {
    this.logPath = `${basePath}/event-store.jsonl`;
  }

  /** 追加事件（不可变） */
  async append(event: SourcingEvent): Promise<void> {
    const line = JSON.stringify(event) + '\n';
    await fs.appendFile(this.logPath, line, 'utf-8');
  }

  /** 按 executionId 重放事件，重建运行时状态 */
  async replay(executionId: string): Promise<ReplayResult> {
    const events = await readJSONLLines<SourcingEvent>(this.logPath, {
      filter: (e) => e.executionId === executionId,
    });

    const state: ReplayResult = {
      toolCallStates: new Map(),
      fsmState: 'IDLE',
      dagNodeStates: new Map(),
      activeWorkers: new Set(),
    };

    for (const event of events) {
      switch (event.type) {
        case 'tool_call_state_change':
          state.toolCallStates.set(event.toolCallId, event.to);
          break;
        case 'fsm_transition':
          state.fsmState = event.to;
          break;
        case 'dag_node_status_change':
          state.dagNodeStates.set(event.nodeId, event.to);
          break;
        case 'worker_spawned':
          state.activeWorkers.add(event.toolCallId);
          break;
        case 'worker_terminated':
          state.activeWorkers.delete(event.toolCallId);
          break;
      }
    }

    return state;
  }

  /** 获取最后一个事件的时间戳（用于增量恢复） */
  async getLastTimestamp(): Promise<number> {
    // 读取最后一行，提取 timestamp
  }
}
```

### 恢复流程

```
系统重启
  │
  ├── 1. EventStore.replay(executionId) → 重建运行时状态
  │       ├── ToolCallTracker 恢复所有 tool_call 的 state
  │       ├── FSMEngine 恢复到最后的 fsmState
  │       └── DAG 节点状态恢复
  │
  ├── 2. 对于 SUSPENDED 的任务:
  │       ├── 从 Session JSONL 恢复 AgentHarness 快照
  │       └── 重新订阅 SSE → 前端 3D 大脑恢复渲染
  │
  └── 3. AstroM 3D 大脑恢复:
          ├── 重放事件 → 重建脑区节点激活状态
          ├── 重建粒子流走向（跨领域 Trace ID 拓扑）
          └── 高亮 SUSPENDED 的红色冲突引线
```

### 存储路径

```
data/
├── event-store.jsonl          ← 所有状态变迁事件 (Append-only)
├── sessions/
│   ├── <sessionId>.jsonl      ← pi Session tree 序列化
│   └── ...
├── mirror/
│   ├── executions.jsonl       ← ExecutionMirror (已有)
│   └── events.jsonl           ← EventBus 事件 (已有)
└── artifacts/
    ├── artifacts.jsonl        ← ArtifactRegistry (已有)
    └── relations.jsonl
```

---

## 四、三条防线在完整流程中的位置

```
工具调用执行:
  AgentHarness._acting(toolCall)
    │
    ├── PermissionEngine.check()  ← 权限裁决
    │
    ├── ToolExecutionProxy.execute()  ← Worker 隔离
    │   ├── [防线 1] 超时熔断 (AbortController)
    │   ├── [防线 2] 内存熔断 (RSS Monitor)
    │   └── [防线 3] 降级重试 (1次)
    │
    ├── EventStore.append('tool_call_state_change')  ← [Event Sourcing]
    │
    └── 异常 → FSMEngine.feed('error') → TOOL_EXECUTION_TIMEOUT

跨领域协商:
  NegotiationEngine.createTicket()
    │
    ├── Round 1..N (MAX_ALIGN_ROUNDS = 3)
    │
    ├── 收敛 → ACCEPTED/REJECTED
    │
    └── 震荡熔断 → escalateToArbitration()
        ├── [防线 4] LLM 生成仲裁提示词
        ├── REQUIRE_USER_CONFIRM → SSE → AstroM 3D
        └── 人类裁决 → resolveWithArbitration()

系统恢复:
  EventStore.replay(executionId)
    ├── 重建 ToolCallTracker 状态
    ├── 重建 FSMEngine 状态
    ├── 重建 DAG 节点状态
    └── AstroM 3D 重放恢复视觉状态
```

---

## 五、新增文件清单

| 文件 | 对应防线 | 工作量 |
|:--|:--|:--|
| `packages/core/tool/ToolExecutionProxy.ts` | #1 Worker 僵尸防御 | ~150 行 |
| `packages/core/tool/ToolExecutionTimeoutError.ts` | #1 标准异常 | ~20 行 |
| `packages/core/negotiation/NegotiationEngine.ts` (修改) | #2 震荡熔断 | +~80 行 |
| `packages/core/event/EventStore.ts` | #3 Event Sourcing | ~120 行 |
| `packages/core/event/SourcingEvent.ts` | #3 事件类型定义 | ~50 行 |
