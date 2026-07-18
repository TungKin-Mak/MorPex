# @VALIDATE-TODO 标注清单

> 测试前需验证的硬编码/占位代码。测试通过后按需修复为配置化/完整实现。

---

## 统计

**总标注**: 21 处，分布在 14 个文件中

### 按类型分组

| 类型 | 数量 | 说明 |
|:--|:--:|:--|
| A: 硬编码路径 | 2 | `./data/offloaded`, `./data/events/event-store.jsonl` |
| B: 硬编码阈值/配额 | 6 | 80000, 10000, 120_000, 512, 2_000_000, 1000 |
| C: Mock/占位实现 | 1 | 内联 spawn MCP 实现 |
| D: 简化完成条件检查 | 1 | `checkCompletion()` 占位逻辑 |
| E: 硬编码模型名 | 2 | `deepseek-v4-flash` |
| F: 简化错误处理 | 2 | 空 catch 块隐藏持久化错误 |
| G: 硬编码超时 | 2 | 600s, 300s |
| H: 同步文件操作 | 1 | `appendFileSync` |
| I: 简化 Token 估算 | 1 | `Math.ceil(text.length / 4)` |
| J: 简化内存监控 | 1 | setInterval 轮询而非事件驱动 |
| K: 硬编码重要性 | 1 | `importance: 3` |
| L: 硬编码历史上限 | 1 | `DEFAULT_MAX_HISTORY = 1000` |

---

## 按文件分组

### `packages/core/workflow/WorkflowEngine.ts`
- L319: `@VALIDATE-TODO: 完成条件检查过于简化，需解析 Agent 输出的结构化结果并匹配 completionCriteria`

### `packages/core/workflow/WorkflowRegistry.ts`
- L17: `@VALIDATE-TODO: 硬编码超时回收阈值，应从配置注入`

### `packages/core/services/AgentFactory.ts`
- L102: `@VALIDATE-TODO: 硬编码配额消耗值 1000，应从 DomainManifest 读取初始消耗`
- L84-85: `@VALIDATE-TODO: 硬编码模型名，应从配置注入`

### `packages/core/tool/ToolExecutionProxy.ts`
- L26: `@VALIDATE-TODO: 硬编码超时/内存上限，应从配置注入`
- L27: `@VALIDATE-TODO: 硬编码内存上限，应从配置注入`
- L73: `@VALIDATE-TODO: 内存监控过于简化，应使用 worker.resourceLimits 事件而非轮询`

### `packages/core/tool/ToolResultOffloader.ts`
- L27: `@VALIDATE-TODO: 硬编码截断阈值，应从配置注入`
- L28: `@VALIDATE-TODO: 硬编码路径，应从配置注入`

### `packages/core/compaction/CompactionPolicy.ts`
- L14: `@VALIDATE-TODO: 硬编码压缩阈值，应从配置注入`
- L15: `@VALIDATE-TODO: 硬编码保留量，应从配置注入`
- L18: `@VALIDATE-TODO: Token 估算过于简化（4字符=1token），应接入真实 tokenizer 或 pi 的 estimateContextTokens`

### `packages/core/event/EventStore.ts`
- L66: `@VALIDATE-TODO: 硬编码日志路径，应从配置注入`
- L89: `@VALIDATE-TODO: 同步文件操作可能阻塞事件循环，应改为异步写入`

### `packages/core/event/EventStoreSubscriber.ts`
- L53: `@VALIDATE-TODO: 失败静默隐藏了持久化错误，应加入错误计数和告警`
- L69: `@VALIDATE-TODO: 失败静默隐藏了持久化错误`

### `packages/core/memory/MemoryHooks.ts`
- L51: `@VALIDATE-TODO: 硬编码重要性分数，应根据对话长度和复杂度动态计算`

### `packages/core/planes/runtime-kernel/fsm/FSMEngine.ts`
- L73: `@VALIDATE-TODO: 硬编码任务超时，应从配置注入`
- L82: `@VALIDATE-TODO: 硬编码模型名，应从配置注入`

### `packages/core/domains/DomainCluster.ts`
- L57: `@VALIDATE-TODO: 硬编码配额值，应从 DomainManifest 读取`

### `packages/core/core/EventBus.ts`
- L14: `@VALIDATE-TODO: 硬编码历史上限，应从配置注入`

### `packages/workflows/programming/mcp/filesystem-server.ts`
- L33: `@VALIDATE-TODO: MCP 实现使用内联字符串 spawn，应替换为独立的 MCP 协议包`

### `packages/workflows/programming/mcp/git-server.ts`
- L27: `@VALIDATE-TODO: MCP 实现使用内联字符串 spawn，应替换为独立的 MCP 协议包`

---

## 修复优先级建议

### P0（测试前确认）
这些硬编码值会影响测试结果，需确认是否在可接受范围：
- `ToolExecutionProxy.ts` — timeout 120s / OOM 512MB（可接受，但不达标的测试可能误判）
- `CompactionPolicy.ts` — 80K token 阈值（可能过早或过晚触发压缩）
- `EventStoreSubscriber.ts` — 两个空 catch 块（持久化失败被静默，测试中不易察觉）

### P1（测试通过后修复）
这些是生产前必须配置化的值：
- 所有路径（`./data/*`）
- 模型名（`deepseek-v4-flash`）
- 配额（`2_000_000`, `1000`）

### P2（迭代优化）
这些是架构优化：
- MCP 内联字符串 → 独立协议包
- Token 估算 → 真实 tokenizer
- 内存监控 → 事件驱动
