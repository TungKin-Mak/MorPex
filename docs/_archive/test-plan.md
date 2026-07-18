# MorPex v2.4 后端全功能测试计划

> 覆盖范围：从用户输入到交付物的完整链路  
> 包含：21 处 `@VALIDATE-TODO` 标注 + 工作流 + Agent + 记忆 + 权限 + 事件溯源 + 协商  
> 会话目标：跑通全部测试 → 逐项修复硬编码 → 回归验证

---

## 一、测试架构总览

```
┌──────────────────────────────────────────────────────────────────────┐
│                         测试金字塔 (7 层)                              │
│                                                                      │
│  L7  端到端工作流          programming 全流程 / 热插拔 / 跨领域        │
│  L6  编排集成              WorkflowEngine + AgentFactory + FSMEngine   │
│  L5  领域宿主              ProgrammingRuntimeHost / 工具集 / MCP       │
│  L4  安全防御              PermissionEngine / ToolExecutionProxy       │
│  L3  基础设施              EventStore / EventBus / MemoryBus           │
│  L2  核心引擎              WorkflowRegistry / AgentFactory            │
│  L1  原子单元              工具 / 类型 / 拓扑排序                       │
└──────────────────────────────────────────────────────────────────────┘
```

### 测试数据约定

| 变量 | 测试值 |
|:--|:--|
| `TEST_WORKSPACE` | `./data/test-workspace/` |
| `TEST_IDENTITY_TOKEN` | `test-token-morpex-2025` |
| `TEST_PROJECT_NAME` | `test-api-server` |
| `TEST_INPUT` | "用 TypeScript 创建一个 Express REST API，包含 GET /health 和 POST /users 两个端点" |

---

## 二、L1 — 原子单元测试

### TC-1.1 `topologicalSort` 拓扑排序

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/core/utils/toposort.ts` |
| **输入** | `[{id:'a',deps:[]},{id:'b',deps:['a']},{id:'c',deps:['a']}]` |
| **期望** | 排序后 `a` 在 `b` 和 `c` 之前 |
| **边界** | 空数组 → `[]`；单节点 → 单元素；环形依赖 → 抛异常 |

### TC-1.2 `extractJson` 三级修复

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/core/utils/extractJson.ts` |
| **TC-1.2a** | 纯 JSON → 直接返回 |
| **TC-1.2b** | Markdown 代码块 → 提取内部 JSON |
| **TC-1.2c** | 截断 JSON → Level 2 补齐 `}` |
| **TC-1.2d** | 无效 JSON + LLM → `extractJsonAsync` Level 3 重试 |
| **TC-1.2e** | 非 JSON 输入 → `null` |

### TC-1.3 `readJSONLLines` JSONL 解析

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/core/utils/jsonl.ts` |
| **TC-1.3a** | 正常 3 行 JSONL → 3 个对象 |
| **TC-1.3b** | 含损坏行 → 跳过损坏行，返回有效行 |
| **TC-1.3c** | 空字符串 → `[]` |

### TC-1.4 `SecurityBoundaryException`

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/core/services/AgentFactory.ts` |
| **TC-1.4a** | 缺失 `identityToken` → `throw SecurityBoundaryException` |
| **TC-1.4b** | 缺失 `cgroupQuota` → `throw SecurityBoundaryException` |
| **TC-1.4c** | 配额耗尽 (`usedTokens >= tokenLimit`) → `throw SecurityBoundaryException` |
| **TC-1.4d** | 合法参数 → 返回 `AgentHarness` 实例 |

---

## 三、L2 — 核心引擎测试

### TC-2.1 `WorkflowRegistry` — 注册+切换+生命周期

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/core/workflow/WorkflowRegistry.ts` |
| **@VALIDATE-TODO** | L17 — 硬编码超时回收阈值 |

**TC-2.1a 注册**
- `register(host)` → 成功注册
- 重复注册相同 domainId → `throw Error`

**TC-2.1b 首次切换**
- `transitionTo('programming', context)` → 返回 host → `onWake()` 被调用 → `refCount = 1`

**TC-2.1c 同领域再次切换**
- 再次 `transitionTo('programming', context)` → `onWake()` 不再被调用 → `refCount = 2`

**TC-2.1d 跨领域切换 + 引用计数**
- `transitionTo('ecommerce', context)` → `programming.refCount = 1` → `ecommerce.refCount = 1`

**TC-2.1e 超时回收**
- `refCount` 归零 → 启动 10 分钟定时器 → 定时器触发 → `onSleep()` 被调用
- 测试时缩短 `IDLE_TIMEOUT_MS` 到 1000ms

**TC-2.1f 超时前切回取消回收**
- `refCount` 归零后 5 秒内 `transitionTo` 同一领域 → 定时器被取消 → `onSleep()` 不被调用

### TC-2.2 `WorkflowEngine` — 双层编排

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/core/workflow/WorkflowEngine.ts` |
| **@VALIDATE-TODO** | L319 — 完成条件检查简化 |

**TC-2.2a 工作流未注册**
- `execute('nonexistent', 'input')` → `throw Error`

**TC-2.2b 领域无工作流定义**
- Host 的 `manifest.workflow` 为 `undefined` → 返回 `{ success: false, error: "未定义工作流" }`

**TC-2.2c 步骤拓扑排序**
- 输入 5 步 DAG → 输出 `scaffold` 在 `implement` 之前，`implement` 在 `lint`/`test` 之前，`lint`/`test` 在 `fix` 之前

**TC-2.2d Micro Agent 创建**
- 每个步骤调用 `AgentFactory.spawn()` → 校验 `identityToken` + `cgroupQuota` + `ring=1`
- 工具集仅包含 `suggestedTools` 范围内的工具（不包含其他步骤的工具）

**TC-2.2e 步骤失败 + 重试**
- 步骤执行抛异常 → 重试 `maxRetries` 次 → 全失败后标记 `success: false`

**TC-2.2f 步骤超时**
- 步骤设置 `timeoutMs=1000` → 1 秒后未完成 → 重试

**TC-2.2g `@VALIDATE-TODO` 完成条件检查**
- Agent 返回 `"所有测试通过"` → `checkCompletion` 返回 `true`
- Agent 返回 `"test failed: 2 errors"` → `checkCompletion` 返回 `false`

### TC-2.3 `AgentFactory` — 配额管理

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/core/services/AgentFactory.ts` |
| **@VALIDATE-TODO** | L84/L85 — 硬编码模型名；L102 — 配额消耗值 1000 |

**TC-2.3a 配额消耗**
- 每次 `spawn()` → `cgroupQuota.usedTokens += 1000`

**TC-2.3b 配额耗尽**
- `usedTokens = 1_999_000` → 第 2 次 spawn 成功 → 第 3 次（超出 2_000_000）→ `throw SecurityBoundaryException`

---

## 四、L3 — 基础设施测试

### TC-3.1 `EventStore` — 追加+重放

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/core/event/EventStore.ts` |
| **@VALIDATE-TODO** | L66 — 硬编码日志路径；L89 — 同步 `appendFileSync` |

**TC-3.1a 追加事件**
- `append({ type: 'fsm_transition', taskId: 't1', from: 'IDLE', to: 'RUNNING', ts, execId })` → JSONL 文件新增一行

**TC-3.1b 重放指定 executionId**
- `replay('exec-123')` → 返回该 executionId 的所有事件，按序排列

**TC-3.1c 重放全部**
- `replay()` → 返回所有事件

**TC-3.1d 重放文件不存在**
- `replay()` 对不存在的文件 → 返回空 `ReplayState`

**TC-3.2 `EventStoreSubscriber` — 事件订阅**

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/core/event/EventStoreSubscriber.ts` |
| **@VALIDATE-TODO** | L53/L69 — 两个空 catch 块隐藏持久化错误 |

**TC-3.2a FSM 事件持久化**
- `EventBus.emit({ type: 'fsm.transition', payload: {...} })` → `EventStore.append()` 被调用

**TC-3.2b 工具状态事件持久化**
- `EventBus.emit({ type: 'tool.state_change', payload: {...} })` → `EventStore.append()` 被调用

**TC-3.2c 持久化失败不崩溃**
- 模拟 EventStore 写入失败 → 事件订阅不抛异常（当前是空 catch）→ `@VALIDATE-TODO` 修复后应有错误计数

### TC-3.3 `MemoryBusListener` — 事件驱动记忆

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/core/memory/MemoryBusListener.ts` |
| **@VALIDATE-TODO** | `MemoryHooks.ts` L51 — 硬编码 `importance: 3` |

**TC-3.3a 反思事件归档**
- `EventBus.emit({ type: 'agent.reflection_created', payload: { content: '...' } })` → `VectorStore.upsert()` 被调用

**TC-3.3b 产物更新事件归档**
- `EventBus.emit({ type: 'artifact.updated', payload: { artifactId, content } })` → `VectorStore.upsert()` 被调用

**TC-3.3c Agent 结束事件归档**
- `EventBus.emit({ type: 'agent.end', payload: { messages } })` → 提取 assistant 文本 → 归档

**TC-3.3d `stop()` 取消监听**
- 调用 `stop()` → 后续事件不触发归档

### TC-3.4 `EventBus` — 事件总线

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/core/core/EventBus.ts` |
| **@VALIDATE-TODO** | L14 — 硬编码历史上限 1000 |

**TC-3.4a 发射+订阅**
- `emit(event)` → 同类型 handler 被调用

**TC-3.4b 通配符**
- `on('runtime.*', handler)` → `emit({ type: 'runtime.tool.start' })` → handler 被调用

**TC-3.4c 领域作用域**
- `emitToDomain('hardware', event)` → `onDomain('hardware', ...)` 被调用 → 全局 `on(...)` 不被调用

**TC-3.4d 跨领域广播 zone 注入**
- `broadcastCrossDomain(event)` → `event.sourceZone` 和 `event.targetZone` 被自动设置

**TC-3.4e 历史保留上限**
- 连续发射 1001 个事件 → `getHistory()` 返回最近 1000 条

**TC-3.4f `once()` 一次性订阅**
- `once(type, handler)` → 触发一次后自动取消

---

## 五、L4 — 安全防御测试

### TC-4.1 `PermissionEngine` — 5 种模式

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/core/permission/PermissionEngine.ts` |

**TC-4.1a deny 规则优先**
- 添加 `{ toolName: 'Write', behavior: 'deny' }` 规则 → 同时有 allow 规则 → `check()` 返回 `{ block: true }`

**TC-4.1b explore 模式**
- `mode='explore'` → `Read` 工具 → `undefined`(放行) → `Write` 工具 → `{ block: true }`

**TC-4.1c accept_edits 模式**
- `mode='accept_edits'` + `workingDirs=['/workspace']` → 操作 `/workspace/src` → 放行 → 操作 `/etc` → 阻止

**TC-4.1d bypass 模式**
- `mode='bypass'` → 所有工具 → 放行

**TC-4.1e dont_ask 模式**
- `mode='dont_ask'` → 所有工具 → `{ block: true }`

**TC-44.1f default 模式**
- `mode='default'` → 所有工具 → `{ block: true, reason: 'requires confirmation' }`

### TC-4.2 `ToolExecutionProxy` — Worker 隔离

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/core/tool/ToolExecutionProxy.ts` |
| **@VALIDATE-TODO** | L26 — 硬编码 120s/512MB；L27 — 硬编码内存上限；L73 — 简化内存监控 |

**TC-4.2a 正常执行**
- `execute(tcId, 'bash', { command: 'echo hello' }, cwd)` → 返回 `{ content: [{ type: 'text', text: 'hello' }] }`

**TC-4.2b 超时终止**
- `execute(tcId, 'bash', { command: 'sleep 10' }, cwd, { timeoutMs: 1000 })` → `throw ToolExecutionTimeoutError`

**TC-4.2c 降级重试**
- 第一次执行失败 → `allowDegradedRetry=true` → 自动重试一次 → 第二次失败 → `throw ToolExecutionTimeoutError`

**TC-4.2d 紧急熔断**
- `abortAll()` → 所有活跃 Worker 被 `terminate()`

### TC-4.3 `CompactionPolicy` — 上下文压缩

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/core/compaction/CompactionPolicy.ts` |
| **@VALIDATE-TODO** | 80K 阈值 / 16K 保留 / 简化 Token 估算 |

**TC-4.3a 低于阈值不触发**
- 消息 10K token → `maybeCompact()` → 不调用 `harness.compact()`

**TC-4.3b 高于阈值触发**
- 消息 100K token → `maybeCompact()` → 调用 `harness.compact()`

**TC-4.3c hook 注册**
- `harness.on('context', policy.hook)` → LLM 调用前自动触发检查

### TC-4.4 `ToolResultOffloader` — 大结果卸载

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/core/tool/ToolResultOffloader.ts` |
| **@VALIDATE-TODO** | 10K 阈值 / `./data/offloaded` 路径 |

**TC-4.4a 低于阈值不卸载**
- 结果 3000 字符 → 原始结果返回

**TC-4.4b 高于阈值卸载**
- 结果 15000 字符 → 内容写入文件 → 返回 `[结果已卸载]` 摘要

---

## 六、L5 — 领域宿主测试

### TC-5.1 `ProgrammingRuntimeHost` — 生命周期

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/workflows/programming/index.ts` |

**TC-5.1a `onWake()`**
- 调用 `onWake()` → MCP 进程启动（filesystem + git 各一个子进程）→ 工具集加载（Scaffold + Lint + TestRunner）

**TC-5.1b `onSleep()`**
- 调用 `onSleep()` → 所有 MCP 子进程被 `SIGTERM` → 工具集清空

**TC-5.1c `healthCheck()`**
- MCP 进程运行中 → `{ healthy: true }`
- MCP 进程已退出 → `{ healthy: false, mcpStatuses: [{ running: false, error: '...' }] }`

**TC-5.1d `getTools()`**
- 返回 `[ScaffoldTool, LintTool, TestRunnerTool, ...]`

### TC-5.2 `ScaffoldTool` — 项目脚手架

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/workflows/programming/tools/ScaffoldTool.ts` |

**TC-5.2a Node.js 项目**
- `execute(tcId, { projectPath, projectType: 'node', projectName })` → 创建 `package.json` + `tsconfig.json` + `src/index.ts`

**TC-5.2b Python 项目**
- `execute(tcId, { projectPath, projectType: 'python', projectName })` → 创建 `pyproject.toml` + `src/__init__.py`

**TC-5.2c Rust 项目**
- `execute(tcId, { projectPath, projectType: 'rust', projectName })` → 创建 `Cargo.toml` + `src/main.rs`

**TC-5.2d 通用项目**
- `execute(tcId, { projectPath, projectType: 'generic', projectName })` → 创建 `README.md` + `src/`

### TC-5.3 `LintTool` — 代码检查

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/workflows/programming/tools/LintTool.ts` |

**TC-5.3a ESLint**
- `execute(tcId, { projectPath, linter: 'eslint' })` → 运行 `npx eslint` → 返回结果

**TC-5.3b auto 检测**
- `execute(tcId, { projectPath, linter: 'auto' })` → 自动检测项目类型 → 运行对应 linter

### TC-5.4 `TestRunnerTool` — 测试执行

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/workflows/programming/tools/TestRunnerTool.ts` |

**TC-5.4a 默认测试命令**
- `execute(tcId, { projectPath })` → 自动检测（vitest/pytest/cargo test）→ 执行 → 返回通过/失败统计

**TC-5.4b 自定义命令**
- `execute(tcId, { projectPath, testCommand: 'npm run test:e2e' })` → 执行自定义命令

### TC-5.5 MCP 服务

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/workflows/programming/mcp/` |
| **@VALIDATE-TODO** | filesystem-server L33 / git-server L27 — MCP 占位实现 |

**TC-5.5a filesystem MCP**
- `startMCPServers(workspaceDir)` → 子进程启动 → 监听 stdio

**TC-5.5b git MCP**
- `startMCPServers(workspaceDir)` → 子进程启动 → 监听 stdio

**TC-5.5c 停止 MCP**
- `stopMCPServers(processes)` → 所有子进程收到 `SIGTERM` → 退出码 0

---

## 七、L6 — 编排集成测试

### TC-6.1 `FSMEngine` — 动态调度

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/core/planes/runtime-kernel/fsm/FSMEngine.ts` |
| **@VALIDATE-TODO** | L73 — 硬编码 300s 任务超时；L82 — 硬编码模型名 |

**TC-6.1a 完整状态流**
- `start(taskId, goal)` → `IDLE → PLANNING`
- `feed('turn_start')` → `RUNNING`
- `feed('tool_execution_start')` → `WAITING_TOOL`
- `feed('tool_execution_end')` → `RUNNING`
- `feed('turn_end')` → `VERIFYING`
- `feed('agent_end')` → `COMPLETED`

**TC-6.1b 挂起+恢复**
- `suspend(taskId, sessionId, replyId, toolCalls)` → `SUSPENDED`
- `resume(taskId, confirmResults)` → `RUNNING`

**TC-6.1c 任务超时**
- `start(taskId, goal)` → 超过 `taskTimeout` → `FAILED`

**TC-6.1d `_check_next_action(event)` 动态推导**
- `tool_execution_start` + 有 ALLOWED 工具 → 返回 `WAITING_TOOL`
- `turn_end` + 无 pending/executing → 返回 `VERIFYING`

**TC-6.1e EventBus 外排**
- `setState()` → `EventBus.emit({ type: 'fsm.transition', ... })`

### TC-6.2 `ToolCallTracker` — 工具调用状态机

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/core/tool/ToolCallTracker.ts` |

**TC-6.2a 状态转换**
- `register(tcId, 'bash')` → `PENDING`
- `transition(tcId, 'EXECUTING')` → `EXECUTING`
- `transition(tcId, 'FINISHED')` → `FINISHED`

**TC-6.2b 非法转换**
- `FINISHED` → `EXECUTING` → 警告但不崩溃

**TC-6.2c 查询**
- `getExecutable()` → 返回所有 `ALLOWED` 状态的工具
- `getAwaiting()` → 返回所有 `PENDING|ASKING` 状态的工具

### TC-6.3 `CrossDomainRouter` — Single-Shot 路由

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/core/router/CrossDomainRouter.ts` |

**TC-6.3a 单领域快速路径**
- 输入编程需求 → LLM 分析返回 `isMultiDomain: true, tasks: [...]` → 直接用 `tasks` 构建 DAG → 跳过 `decomposeSingleIntent`

**TC-6.3b 多领域拓扑编排**
- 输入跨领域需求 → LLM 分析返回多领域 + 依赖 → `topologicalSort` 排序

**TC-6.3c LLM 失败无降级**
- LLM 调用失败 → 直接 `throw`（不返回 fallback DAG）

### TC-6.4 `ExecutionOrchestrator` — 管道编排

| 项 | 内容 |
|:--|:--|
| **被测文件** | `packages/core/planes/control-plane/orchestrator/ExecutionOrchestrator.ts` |

**TC-6.4a 完整管道**
- `orchestrate(input)` → `router.dispatch(input)` → `dispatcher.executeDAG(dag.nodes)` → 返回结果

---

## 八、L7 — 端到端工作流测试

### TC-7.1 编程工作流全流程（核心）

| 项 | 内容 |
|:--|:--|
| **输入** | `"用 TypeScript 创建一个 Express REST API，包含 GET /health 和 POST /users 两个端点"` |
| **领域** | `programming` |
| **期望交付物** | 5 个步骤全部通过，项目可编译运行 |

**TC-7.1a Step 1: scaffold**
- 创建 `package.json` + `tsconfig.json` + `src/index.ts`
- 产物：`project_structure`
- 验证：所有模板文件存在

**TC-7.1b Step 2: implement**
- 编写 Express 服务器代码 + 两个端点
- 产物：`source_code`
- 验证：`tsc --noEmit` 无错误

**TC-7.1c Step 3: lint**
- 运行 ESLint 检查
- 产物：`lint_report`
- 验证：无 error（允许 warning）

**TC-7.1d Step 4: test**
- 运行测试
- 产物：`test_report`
- 验证：所有测试通过

**TC-7.1e Step 5: fix**
- 根据 lint/test 结果修复问题
- 产物：`source_code`（修复后）
- 验证：lint + test 均通过

**TC-7.1f 最终交付物**
- 工作流返回 `{ success: true, steps: [...] }`
- 项目文件夹包含完整的可运行代码

### TC-7.2 工作流热插拔

**TC-7.2a 运行时切换**
- 编程工作流运行到一半 → `WorkflowRegistry.transitionTo('ecommerce', context)` → 编程 `refCount` 递减 → 电商领域 `onWake()`
- 验证：编程 MCP 进程在 10 分钟后被回收

**TC-7.2b 上下文投递**
- 编程工作流产出的 `source_code` Artifact URI → 切换后作为 `SessionContext.artifacts` 传递给电商领域
- 验证：电商 Agent 可通过 `ReadArtifactTool` 读取编程产物

### TC-7.3 Agent 调用链路验证

**TC-7.3a AgentFactory 单入口**
- 整个流程中所有 Agent 创建都经过 `AgentFactory.spawn()`
- 验证：无直接 `new AgentHarness()` 调用

**TC-7.3b Ring 0/1/2 权限隔离**
- Leader (Ring 0) 只能调用 `AgentCreateTool`
- Expert (Ring 1) 不能调用 `AgentCreateTool`，只能调用 `ForkExecute`
- Fork (Ring 2) 无 LLM 上下文，仅执行代码
- 验证：跨 Ring 调用被 `PermissionEngine` 阻止

**TC-7.3c Fork 隔离执行**
- Expert 调用 `ForkExecute` → `ToolExecutionProxy` → Worker Thread
- 验证：执行在独立线程中，超时/OOM 被终止

### TC-7.4 记忆系统端到端

**TC-7.4a 自动写回**
- Agent 执行完毕 → `agent.end` 事件 → `MemoryBusListener` → `VectorStore.upsert()`
- 验证：对话内容被向量化归档

**TC-7.4b 记忆注入**
- 第二次运行相同类型任务 → `harness.on('context')` 触发检索 → 历史记忆注入上下文
- 验证：Agent 的回复引用了历史记忆

### TC-7.5 事件溯源端到端

**TC-7.5a FSM 状态持久化**
- 工作流执行过程中的所有 FSM 状态转换 → EventBus → EventStoreSubscriber → JSONL
- 验证：JSONL 文件包含完整的状态转换链

**TC-7.5b 重放恢复**
- `EventStore.replay(executionId)` → 重建 `ReplayState`
- 验证：状态与运行时一致

### TC-7.6 协商系统端到端

**TC-7.6a 工单创建**
- 一个领域对另一个领域的产物提出质询 → `NegotiationEngine.createTicket()`
- 验证：工单状态 `PENDING`

**TC-7.6b 协商流程**
- `respond('argue')` × 3 → `depth_count > MAX_DEPTH` → 自动升级
- `escalateToArbitration()` → 生成 `ArbitrationPrompt`
- 验证：包含双方立场和 LLM 建议方案

---

## 九、`@VALIDATE-TODO` 验证 checklist（21 项）

| # | 文件 | 内容 | 测试验证 |
|:--:|:--|:--|:--|
| 1 | `WorkflowEngine.ts` | 完成条件检查简化 | TC-2.2g |
| 2 | `WorkflowRegistry.ts` | 超时回收阈值 | TC-2.1e |
| 3 | `AgentFactory.ts` | 模型名硬编码 | TC-1.4d (确认使用配置的模型) |
| 4 | `AgentFactory.ts` | 配额消耗值 1000 | TC-2.3a |
| 5 | `ToolExecutionProxy.ts` | 超时 120s | TC-4.2b |
| 6 | `ToolExecutionProxy.ts` | 内存 512MB | TC-4.2b |
| 7 | `ToolExecutionProxy.ts` | 内存监控轮询 | TC-4.2c |
| 8 | `ToolResultOffloader.ts` | 截断阈值 10000 | TC-4.4b |
| 9 | `ToolResultOffloader.ts` | 路径 `./data/offloaded` | TC-4.4b |
| 10 | `CompactionPolicy.ts` | 压缩阈值 80000 | TC-4.3b |
| 11 | `CompactionPolicy.ts` | 保留量 16000 | TC-4.3b |
| 12 | `CompactionPolicy.ts` | Token 估算简化 | TC-4.3b |
| 13 | `EventStore.ts` | 日志路径硬编码 | TC-3.1a |
| 14 | `EventStore.ts` | 同步 `appendFileSync` | TC-3.1a |
| 15 | `EventStoreSubscriber.ts` | 空 catch 块 (×2) | TC-3.2c |
| 16 | `MemoryHooks.ts` | 重要性 `3` | TC-3.3a |
| 17 | `FSMEngine.ts` | 任务超时 300s | TC-6.1c |
| 18 | `FSMEngine.ts` | 模型名硬编码 | TC-6.1a |
| 19 | `DomainCluster.ts` | 配额 2_000_000 | TC-7.1 (确认配额未耗尽) |
| 20 | `EventBus.ts` | 历史上限 1000 | TC-3.4e |
| 21 | MCP `filesystem/git` | 占位实现 | TC-5.5a/b |

---

## 十、测试执行流程

### 阶段 0：环境准备
```
mkdir -p ./data/test-workspace
export TEST_IDENTITY_TOKEN="test-token-morpex-2025"
```

### 阶段 1：L1 原子单元（约 15 分钟）
```
npx vitest run --reporter=verbose -- tests/unit/
```

### 阶段 2：L2-L4 引擎+基础设施（约 30 分钟）
```
npx vitest run --reporter=verbose -- tests/integration/engine/
npx vitest run --reporter=verbose -- tests/integration/safety/
npx vitest run --reporter=verbose -- tests/integration/infra/
```

### 阶段 3：L5 领域宿主（约 20 分钟）
```
npx vitest run --reporter=verbose -- tests/integration/workflows/
```

### 阶段 4：L6-L7 端到端（约 40 分钟）
```
npx vitest run --reporter=verbose -- tests/e2e/
```

### 阶段 5：`@VALIDATE-TODO` 专项（约 20 分钟）
```
npx vitest run --reporter=verbose -- tests/validate-todo/
```

---

## 十一、预期结果与修复触发

| 测试结果 | 后续动作 |
|:--|:--|
| ✅ 全部通过 | 按优先级逐项修复 `@VALIDATE-TODO`：配置化 → 回归测试 |
| ⚠️ TC-2.2g 失败 | 修补 `checkCompletion` 逻辑 → 重新测试 |
| ⚠️ TC-5.5 失败 | 修补 MCP 占位实现 → 替换为真实协议包 → 重新测试 |
| ⚠️ TC-3.2c 暴露静默失败 | 添加错误计数和告警 → 重新测试 |
| ❌ 其他失败 | 修复对应模块 → 回归全部 L1-L7 |

---

*测试计划版本: 3.0.0 | 最后更新: 2025-07-11 | 覆盖 21 处 @VALIDATE-TODO + 7 层 56 个测试用例 + 引擎重构*

---

## 十二、v3.0 微内核重构验证 (2026-07-11)

### 架构变更

| 旧 (v2.4 OOP) | 新 (v3.0 微内核) |
|:--|:--|
| `WorkflowEngine` Class (394行) | `executeWorkflow()` 纯函数 (280行) |
| `WorkflowRegistry` refCount 管理 | `McpRuntimeManager` 边车生命周期 |
| `FSMEngine` Class (412行) | `NodeState` 内联状态机 (PENDING→READY→RUNNING→SUCCESS/FAILED/RETRYING/SKIPPED) |
| `DomainRuntimeHost` 直接 spawn | `McpClient` JSON-RPC 接口 (Host 不接触 stdio) |
| 硬编码领域特判 `if (domainId === 'programming')` | `domain.json` 声明式配置 |
| `any` 类型泛滥 | 零 `any`，全强类型 |
| 同步 I/O (`fs.writeFileSync`) | 异步非阻塞 (`fsp.writeFile`) |

### 新增模块

| 模块 | 行数 | 职责 |
|:--|:--:|:--|
| `engine/types.ts` | 318 | 强类型系统 (WorkflowState/NodeState/Planner/ArtifactRef) |
| `engine/workflow.ts` | 350 | 微内核调度 (executeWorkflow + FSM + Planner Loop) |
| `engine/handoff.ts` | 152 | HandoffContext 工厂 (EventBus + Agent 桥接) |
| `engine/agent-bridge.ts` | 280 | 三段 Agent (Ring 0/1/2) + Memory + Compaction + Offload |
| `engine/artifact-bridge.ts` | 130 | ArtifactRegistry 桥接 (引用传递 + 大产物卸载) |
| `engine/engine-subscriber.ts` | 118 | EventBus → EventStore + MemoryBus 桥接 |
| `mcp/McpRuntimeManager.ts` | 559 | MCP 边车管理 (spawn/重启/孤儿响应/审计日志) |
| `mcp/McpJsonRpcHandler.ts` | 188 | JSON-RPC 2.0 子进程基类 |

### 修复的关键 Bug

| Bug | 严重度 | 修复 |
|:--|:--:|:--|
| JSON-RPC 孤儿响应致 Agent 永久挂起 | 🔴 | orphan-response → 拒绝最旧 pending + 释放 Agent |
| MCP 进程崩溃无自愈 | 🔴 | `maxRestarts` + `restartEntry()` 自动重启 |
| 同步 `fs.writeFileSync` 阻塞事件循环 | 🟡 | 全部改 `fsp.writeFile` / `fsp.mkdir` (异步非阻塞) |
| SessionContext 在多领域管道丢失 | 🟡 | `orchestrate()` → `Dispatcher` → `ClusterManager` 全链路注入 |
| 假配额 `+=1000` | 🟡 | LLM `result.usage.totalTokens` 真实计数 |
| 大结果撑爆 Context Window | 🟡 | `>10KB` 自动卸载到 `data/offloaded/` |
| 向量库故障静默丢记忆 | 🟡 | 本地 `data/memory-fallback/` JSON 暂存 |
| optional 节点失败炸毁工作流 | 🟡 | `continue` 跳过 + `SKIPPED` 状态 |

### 新增能力 (Q1-Q4)

| 能力 | 说明 |
|:--|:--|
| **Q1: 按需注入** | `requiredArtifacts` 声明式过滤，不传全量产物 |
| **Q2: 节点状态机** | `NodeState`: PENDING→READY→RUNNING→WAITING→SUCCESS/FAILED/RETRYING/SKIPPED |
| **Q3: 增强类型** | `ArtifactRef` 9 字段 (schema/producer/version/lineage/size/createdAt...) |
| **Q4: Planner Loop** | 失败时 `planner()` 回调 → 追加替代节点 → 重新拓扑排序 → 继续执行 |

### 测试结果

```
基线回归 (morpex-core):  293/293 ✅
引擎单元 (engine):        35/35  ✅
端到端 (e2e):             26/26  ✅
MCP 边车 (mcp):           17/17  ✅
编排集成 (tc-6.x):         35/35  ✅
─────────────────────────────────
总计:                    406/406 (100%)
```
