# 模块名称：MorPexCore 引擎模块

> 路径: `packages/core/` | 入口: `packages/core/index.ts` | 版本: 3.0.0
> 
> 🟢 **OpenSpace Fusion v3.0 已集成** — ToolQualityManager / TemplateManager / ExecutionRecordingEngine

---

## 1. 模块职责 (Responsibility)

### 本模块负责

| 职责                        | 说明                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Kernel 生命周期管理**         | 引擎启动/停止/状态查询，组件初始化与销毁                                                                                                                 |
| **EventBus 事件总线**         | 唯一通信通道：emit / on / off / getHistory，通配符订阅                                                                                             |
| **PluginSystem 插件管理**     | 插件注册、依赖拓扑排序、启动/停止生命周期                                                                                                                 |
| **ExecutionGateway 执行网关** | 执行请求路由到对应 Adapter（当前仅 PiAdapter）                                                                                                      |
| **ExecutionMirror 事件镜像**  | 所有 EventBus 事件的持久化记录（observer 模式）                                                                                                     |
| **Control Plane**         | 意图识别 (IntentResolver)、工作流规划 (WorkflowPlanner) — `PromptTemplateEngine` 已删除改用 pi `PromptTemplate`                                      |
| **Runtime Kernel**        | 任务状态机 (FSMEngine)、DAG 引擎、调度器 (SchedulerEngine)、执行图 (ExecutionGraph) — `HumanInLoopGate` 已删除改用 pi `beforeToolCall` hook                |
| **Agent Plane**           | Agent 编排 (AgentOrchestrator → CEO/Manager/Worker)、多 Agent 拍卖 (SwarmEngine) — `SkillLoader` 已删除改用 pi `Skill` + `formatSkillInvocation` |
| **Knowledge Plane**       | 记忆总线 v2 (MemoryBus → 竞争池+归档池+按类型遗忘)、知识图谱 (KnowledgeGraph)、产物管理 (ArtifactRegistry)                                                     |
| **AgentService**          | AgentHarness 生命周期管理：createHarness / dispose / getEnv                                                                                  |
| **内置 AgentTool**          | 内置工具集：write_file, exec_command, read_file, list_dir                                                                                   |
| **行业适配**                  | IndustryRegistry 内置行业模板                                                                                                               |
| **跨领域协议**                 | DomainManifestLoader + DomainCluster + DomainClusterManager — JSON 驱动的领域清单加载、动态领域集群生命周期管理                                             |
| **跨领域路由**                 | CrossDomainRouter (LLM DAG 拆解 + Kahn 拓扑排序) + DomainDispatcher (并行调度) — 将复杂任务拆解为跨领域 DAG 并分发执行                                          |
| **智能体协商**                 | NegotiationEngine — 跨领域质询工单 (InterrogationTicket) + 三闸门防死循环 (深度限制/哈希查重/对级限流)                                                          |
| **Planning Intelligence** | MetaPlanner v3.0 (7-Stage Pipeline + TemplateManager) + 三大认知引擎 (StrategicDeconstructor/LookAheadSimulator/DynamicReflexEngine) + DeviationGuard 熔断 |
| **ToolQualityManager 🆕** | 逐工具质量追踪 (滑动窗口 20 次) + 退化检测 (recentRate < historicalRate × 0.7) + 自动修复建议 + AgentReasoningInterceptor Tier 2.5 拦截 |
| **TemplateManager 🆕** | 模板演化 (CAPTURED/DERIVED/FIXED) + 6 种启发式修复 + Lineage 追踪 + TEMPLATE.md 双向同步 + 版本 Diff（合并原 TemplateEvolutionEngine + TemplateFileSystem） |
| **ExecutionRecordingEngine 🆕** | Thought/Action/Observation/DAG 四维录制 + 回放 + 模板提取 + ExecutionGateway 集成 |

### 本模块【绝不】负责

| 不负责 | 正确归属 |
|--------|----------|
| ❌ AI 模型的具体调用实现 | `@earendil-works/pi-ai` + `@earendil-works/pi-agent-core` — npm 外部包 |
| ❌ HTTP 服务器 / REST API 端点 | `packages/studio/server/` — StudioServer |
| ❌ 前端 UI 渲染 | `packages/studio/ui/` — React 前端 |
| ❌ 用户会话的创建/追加/构建上下文 | `@earendil-works/pi-agent-core` — Session / JsonlSessionRepo |
| ❌ Embedding 模型推理 | `tools-python/embedding-server.py` — 独立 Python 服务 |
| ❌ 数据库运维（zvec 启动/停止） | `@zvec/zvec` 外部包 |

---

## 2. 文件结构树 (File Structure)

```text
packages/core/
├── index.ts                    # 入口：导出所有公共类、函数、类型
├── bootstrap.ts                # 端到端集成引导
├── services/                   # 高阶服务
│   ├── AgentService.ts          # AgentHarness 生命周期管理 (Phase 1)
│   ├── LLMProvider.ts           # 🆕 全局 LLM 调用注册中心 (Phase 2)
├── utils/                      # 🆕 公共工具函数 (Wave 2 逻辑归一)
│   ├── extractJson.ts           # LLM JSON 提取 (统一 4 处副本)
│   ├── toposort.ts              # Kahn 拓扑排序 (统一 5 处副本)
│   └── jsonl.ts                 # 流式 JSONL 解析 (统一 4 处副本)
├── tools/                      # AgentTool 定义
│   ├── builtin-tools.ts         # 4 个内置 AgentTool (write_file, exec_command, read_file, list_dir)
│   ├── knowledge-graph-skill.ts  # 知识图谱查询 Skill 工具 (Phase 5)
│   ├── artifact-registry-skill.ts # 产物注册 Skill 工具 (Phase 5) — save_artifact
│   ├── ask-user-tool.ts          # 🆕 向用户提问的工具，agent 需要输入时调用
│   │                             #   调用后执行暂停，等待前端通过 steer API 回复
├── e2e-test.ts                 # 端到端测试
│
├── core/                       # 核心基础设施
│   ├── Kernel.ts               # 生命周期管理 (start/stop/getStatus)
│   ├── EventBus.ts             # 事件总线 (唯一通信通道)
│   ├── ExecutionIdentity.ts    # 全链路 ID 生成
│   ├── PluginSystem.ts         # 插件注册/启动/停止 (依赖拓扑排序)
│   ├── ModelRegistry.ts        # 模型发现
│   ├── ThinkingLevelControl.ts # 推理深度控制
│   └── types.ts                # 所有核心接口/类型定义
│
├── gateway/                    # 执行网关
│   ├── ExecutionGateway.ts     # 统一执行网关 (路由 agentRole → adapter)
│   └── adapters/
│       ├── PiAdapter.ts        # pi-agent-core 适配器
│       └── types.ts            # 适配器类型
│
├── mirror/                     # 可观测性 (事件镜像)
│   ├── ExecutionMirror.ts      # 镜像 — 直接消费 EventBus 标准化事件
│   ├── ExecutionRecordingEngine.ts # 🆕 v3.0 四维录制回放 (Thought/Action/Observation/DAG)
│   └── storage/                # 存储引擎
│       ├── JSONLStorage.ts     # JSONL 追加读写
│       └── types.ts            # 存储类型
│
├── planes/                     # 功能平面
│   ├── control-plane/          # 控制平面
│   │   ├── intent/             #   意图识别
│   │   │   ├── IntentResolver.ts
│   │   │   ├── # ClarificationEngine.ts — 已删除 (Phase 3)，改用 pi harness.steer() + 多 turn
│   │   │   ├── plugin.ts
│   │   │   └── types.ts
│   │   ├── planner/            #   工作流规划
│   │   │   ├── WorkflowPlanner.ts
│   │   │   ├── ArtifactBlueprint.ts
│   │   │   ├── plugin.ts
│   │   │   └── types.ts
│   │   └── # prompts/ — 已删除 (Phase 3)，改用 pi PromptTemplate
│   │
│   ├── runtime-kernel/         # 运行时内核
│   │   ├── fsm/                #   任务状态机 (Phase 4: 嵌入 AgentHarness)
│   │   │   ├── FSMEngine.ts    #   registerStages() + step() — 每个阶段独立 AgentHarness
│   │   │   ├── plugin.ts
│   │   │   └── types.ts        #   FSMPiStage 接口
│   │   ├── dag/                #   DAG 引擎
│   │   │   ├── DAGEngine.ts
│   │   │   ├── plugin.ts
│   │   │   └── types.ts
│   │   ├── scheduler/          #   调度器
│   │   │   ├── SchedulerEngine.ts
│   │   │   ├── plugin.ts
│   │   │   └── types.ts
│   │   ├── # human-in-loop/ — 已删除 (Wave 1)，目录物理移除，逻辑已迁移至 pi beforeToolCall hook
│   │   └── execution-graph/    #   执行图
│   │       ├── ExecutionGraph.ts
│   │       ├── plugin.ts
│   │       └── types.ts
│   │
│   ├── agent-plane/            # Agent 平面
│   │   ├── orchestrator/       #   Agent 编排 (Phase 6: Zone 调度)
│   │   │   ├── AgentOrchestrator.ts  #   registerZones() + dispatch() — 按功能区调度 AgentHarness
│   │   │   ├── plugin.ts
│   │   │   └── types.ts        #   ZoneConfig 接口
│   │   ├── # skills/ — 已删除 (Phase 3)，改用 pi Skill + formatSkillInvocation
│   │   └── swarm/              #   多 Agent 拍卖
│   │       ├── SwarmEngine.ts
│   │       ├── plugin.ts
│   │       └── types.ts
│   │
│   └── knowledge-plane/        # 知识平面
│       ├── memory/             #   记忆插件 (v2: 使用 @morpex/memory MemoryBus)
│       │   ├── VectorStore.ts
│       │   ├── ZVecLockRecovery.ts
│       │   ├── plugin.ts       #     MemoryPlugin v2.0.0
│       │   └── types.ts        #     重新导出 from @morpex/memory
│       ├── knowledge/          #   知识图谱
│       │   ├── KnowledgeGraph.ts
│       │   ├── plugin.ts
│       │   └── types.ts
│       └── artifacts/          #   产物管理
│           ├── ArtifactRegistry.ts
│           └── types.ts
│
├── industry/                   # 行业适配
│   ├── IndustryRegistry.ts
│   ├── plugin.ts
│   └── types.ts
│
├── router/                     # 路由器 (跨领域路由)
│   ├── CrossDomainRouter.ts   #   LLM DAG 拆解 (拓扑排序 Kahn 算法)
│   ├── DomainDispatcher.ts    #   DAG 并行调度执行
│   ├── ArbitrationHandler.ts  #   仲裁处理器
│   └── types.ts
│
├── domains/                    # 🆕 跨领域协议 (Phase 8-9)
│   ├── index.ts                #     入口
│   ├── types.ts                #     DomainManifest + DAG + Negotiation 类型
│   ├── DomainManifestLoader.ts #     JSON 加载/校验(60行)/热重载
│   ├── DomainCluster.ts        #     领域 Agent 集群 (wake/sleep/execute/steer)
│   └── DomainClusterManager.ts #     多集群管理器 (注册/意图匹配/限流)
│
├── negotiation/                # 🆕 智能体协商 (Phase 11.5)
│   └── NegotiationEngine.ts    #     质询工单生命周期管理
│
├── events/                     # 🆕 事件定义 (Phase 11)
│   └── CrossDomainEvents.ts    #     10种跨领域事件类型
│
├── e2e-domains.ts              # 🆕 Domain Manifest 端到端测试
├── e2e-cross-domain.ts         # 🆕 跨领域端到端测试
│
└── __tests__/                  # 测试
    └── morpex-core.test.ts
```

---

## 3. 架构与数据流程 (Architecture & Flow)

### 3.1 Kernel 启动流程

```
Kernel.start(config)
  │
  ├── 1. 创建核心组件
  │     ├── EventBus (historySize=1000)
  │     ├── ExecutionIdentity
  │     ├── PluginSystem
  │     ├── ModelRegistry
  │     └── ThinkingLevelControl
  │
  ├── 2. 初始化存储层
  │     └── JSONLStorage (mirrorBasePath)
  │
  ├── 3. 注册 PiAdapter (包装 AgentRuntime)
  │     └── ExecutionGateway.registerAdapter('pi', piAdapter)
  │
  ├── 4. 启动 ExecutionMirror（直接消费 EventBus 标准化事件）
  │     └── 开始监听 EventBus runtime.* 通配符事件 → 写入 JSONL
  │
  ├── 5. 注册 + 启动所有插件 (拓扑排序)
  │     ├── FSM Plugin
  │     ├── DAG Plugin
  │     ├── Scheduler Plugin
  │     ├── # HumanInLoop Plugin — 已删除 (Wave 1)
  │     ├── Memory Plugin (v2)
  │     ├── Knowledge Plugin
  │     ├── Artifact Plugin
  │     ├── Orchestrator Plugin
  │     ├── Swarm Plugin
  │     ├── Intent Plugin
  │     ├── Planner Plugin
  │     └── Execution Graph Plugin
  │
  └── 6. 标记 phase = 'running'
        emit('kernel.started')
```

### 3.2 一次用户请求的完整数据流

```
用户输入 "分析市场趋势"
        │
        ▼
[Studio UI]  POST /api/prompt  { message: "分析市场趋势" }
        │
        ▼
[StudioServer]  收到 POST
        │  emit('llm.request', { requestId, prompt, executionId })
        ▼
[AgentService → AgentHarness] 处理 prompt 请求
        │  harness.prompt(message)
        │  ├── pi-ai.stream() → DeepSeek API
        │  └── AgentEvent 流 ← harness.subscribe()
        │
        ├── AgentEvent: message_start/update/end → 流式文字
        │     └── [StudioServer] SSE 直接透传 AgentEvent
        │           └── [Studio UI] 逐 token 追加到对话气泡
        │
        ├── AgentEvent: tool_execution_start/update/end → 工具执行
        │     └── [StudioServer] SSE 直接透传 AgentEvent
        │           └── [Studio UI] 工具状态卡片 🛠️
        │
        └── AgentEvent: turn_start/end → 回合标记
              └── [Studio UI] 回合边界
```

### 3.3 FSM 状态流转

```
                    ┌─────────┐
                    │  IDLE   │
                    └────┬────┘
                         │ 用户提交 Prompt
                         ▼
                    ┌──────────┐
                    │ PLANNING │
                    └────┬─────┘
                         │ 计划生成完成
                         ▼
              ┌──────────────────────┐
              │       RUNNING        │◄────────────────────┐
              └──┬──────┬──────┬─────┘                     │
                 │      │      │                           │
      工具调用    │   用户交互  │  验证                      │
                 ▼      ▼      ▼                           │
          ┌──────────┐ ┌──────────┐ ┌──────────┐          │
          │WAITING   │ │WAITING   │ │VERIFYING ├──────────┘
          │_TOOL     │ │_USER     │ └────┬─────┘  验证通过→继续
          └────┬─────┘ └────┬─────┘      │
               │            │            │ 验证失败
               └────────────┴────────────┘
               工具返回/用户响应           ▼
                                    ┌──────────┐
                                    │ PLANNING │ (重新规划)
                                    └──────────┘

终端状态:
  ┌───────────┐  ┌────────┐  ┌───────────┐
  │ COMPLETED │  │ FAILED │  │ CANCELLED │
  └───────────┘  └────────┘  └───────────┘
```

### 3.4 AgentOrchestrator 层级

```
CEO (战略决策)
  └── Manager (任务分解)
        ├── Worker(coder)      — 编码实现
        ├── Worker(reviewer)   — 代码审查
        ├── Worker(tester)     — 测试验证
        ├── Worker(researcher) — 研究分析
        └── Worker(devops)     — 运维部署
```

---

## 4. 接口与契约 (API & Contracts)

### 4.1 Kernel API

**输入契约**:

```typescript
// 创建 Kernel
import { createKernel } from './index.js';

const kernel = createKernel({
  mirrorBasePath: string;    // 必填，Mirror 事件存储路径
});
```

**输出契约**:

```typescript
// Kernel 实例方法
kernel.start(): Promise<void>;
kernel.stop(): Promise<void>;
kernel.getStatus(): KernelStatus;
kernel.registerPlugin(plugin: MorPexPlugin): void;
kernel.registerPiRuntime(runtime: AgentRuntime): void;

// KernelStatus 结构
interface KernelStatus {
  phase: 'initializing' | 'running' | 'stopping' | 'stopped';
  uptime: number;           // 毫秒
  pluginCount: number;
  activeExecutions: number;
}
```

**异常契约**:

| 场景 | 异常 |
|------|------|
| Kernel 未启动时调用 `registerPlugin` | `throw new Error('Kernel not started')` |
| 重复注册同名插件 | `throw new Error('Plugin already registered: ${name}')` |
| 插件依赖缺失 | `throw new Error('Missing dependency: ${dep} for plugin ${name}')` |

### 4.2 EventBus API

**输入契约**:

```typescript
// 发布事件 — 必须携带 executionId
eventBus.emit({
  id: string;            // createEventId() 生成
  type: string;          // "{domain}.{action}"
  timestamp: number;
  executionId: string;   // ★ 必填
  source: string;        // 来源模块标识
  payload: any;
}): void;

// 订阅 — 支持通配符
eventBus.on(type: string, handler: (event: MorPexEvent) => void): () => void;
eventBus.once(type: string, handler: (event: MorPexEvent) => void): () => void;
```

**输出契约**:

```typescript
// 查询
eventBus.getHistory(type?: string): MorPexEvent[];
eventBus.listenerCount(): number;

// 取消订阅
const unsub = eventBus.on('fsm.*', handler);
unsub(); // 调用返回的函数取消订阅
```

**异常契约**:

| 场景 | 行为 |
|------|------|
| emit 时缺少 `executionId` | `console.warn('Event missing executionId')` — 不阻断 |
| on 注册重复 handler | 允许（每次 emit 会调用多次） |
| 历史超出上限 (1000) | 自动丢弃最旧事件 |

### 4.3 AgentHarness 事件契约（替代旧 LLMBridge）

`LLMBridge.ts` 已删除（Phase 3），LLM 调用由 `AgentService.createHarness()` + `AgentHarness.prompt()` 替代。

AgentHarness 通过 `harness.subscribe()` 产生以下 AgentEvent 流：

**AgentEvent 事件类型**:

| 事件类型                    | payload                          | 说明           |
| ----------------------- | -------------------------------- | ------------ |
| `turn_start`            | `{ turn, sessionId, timestamp }` | 回合开始         |
| `message_start`         | `{ message, sessionId }`         | 消息开始（流式起始标记） |
| `message_update`        | `{ delta, sessionId }`           | 流式增量 token   |
| `message_end`           | `{ message, sessionId }`         | 消息结束         |
| `tool_execution_start`  | `{ toolCallId, toolName, args }` | 工具开始执行       |
| `tool_execution_update` | `{ toolCallId, progress }`       | 工具执行进度       |
| `tool_execution_end`    | `{ toolCallId, result, error? }` | 工具执行完成       |
| `turn_end`              | `{ turn, sessionId }`            | 回合结束         |

**AgentTool 注册**:

通过 `AgentService.createHarness(zone, tools)` 注入，工具由 `packages/core/tools/builtin-tools.ts` 提供：

| 工具名 | 功能 |
|--------|------|
| `write_file` | 写入/覆盖文件 |
| `exec_command` | 执行 shell 命令 |
| `read_file` | 读取文件内容 |
| `list_dir` | 列出目录内容 |

**异常契约**:

| 场景 | 行为 |
|------|------|
| AgentHarness 调 LLM 失败 | AgentEvent 中 `error` 字段携带错误信息 |
| 工具执行失败 | `tool_execution_end` 的 `error` 字段含失败原因 |
| 会话不可用 | AgentService 自动创建新的 InMemorySessionStorage |

---

## 5. 已知 Bug 墙与回归测试 (Bug Wall & Regression)

### Bug #001 — EventBus 监听器泄漏

**症状**: 插件 stop 后未调用 `unsub()`，EventBus 仍持有引用，导致内存泄漏。长时间运行后内存增长。

**根因**: `packages/core/core/EventBus.ts` — `on()` 返回 `unsub` 函数，但 `PluginSystem.stopAll()` 未强制要求插件清理监听器。

**复现条件**: 反复执行 `start() → stop() → start()` 循环，每次 listenerCount 递增。

**修复方案**: 在 `PluginSystem.stopAll()` 中增加监听器清理逻辑，或要求每个插件的 `stop()` 方法中显式调用所有 `unsub()`。

**回归测试**: 运行 `npm run core:test`，检查 10 次 start/stop 后 `eventBus.listenerCount()` 未增长。

---

### Bug #002 — [已解决] LLMBridge 降级链超时 — 模块已删除

**状态**: `LLMBridge.ts` 已删除（Phase 3），改用 `AgentService` + `AgentHarness`。

LLM 调用降级由 pi-ai 内部处理，不再由 MorPex 管理超时。所有 LLM 调用走 pi-ai.stream()，若不可用则抛出异常由 AgentService 捕获。

---

### Bug #003 — PluginSystem 循环依赖报错不明确

**症状**: 当插件 A 依赖 B、B 依赖 A 时，PluginSystem 抛出 `Error('Circular dependency detected')`，但**不列出**具体的循环路径，排查困难。

**根因**: `packages/core/core/PluginSystem.ts` — 拓扑排序使用 Kahn 算法检测入度 > 0 的节点，但未记录 DFS 路径。

**复现条件**: 注册两个互相依赖的插件。

**修复方案**: 在检测到循环依赖时，执行一次 DFS 记录完整循环路径，包含在错误消息中：
```
Error: Circular dependency detected: plugin-a → plugin-b → plugin-a
```

**回归测试**: 单元测试中注册互相依赖的插件，验证错误消息包含完整路径。

---

> **铁律**: 修改本模块任何源码前，必须阅读本文档。修改完成后，必须同步更新本文档。

---

## 6. pi 迁移完成后的新能力

### 6.1 AgentHarness 直接管理 (Phase 4)

- FSMEngine 每个阶段可绑定独立的 AgentHarness 实例
- `registerStages()` + `step()` API 替代旧的 `runAgent()`
- `turn_end` 事件驱动 FSM 状态自动转换
- 🔧 **Phase 7.6**: 验证阶段修复 3 个运行时 Bug:
  - `NodeExecutionEnv` 导入路径: `@earendil-works/pi-agent-core` → `@earendil-works/pi-agent-core/node`
  - `InMemorySessionStorage` + `Session` 非公开 API → `InMemorySessionRepo.create()`
  - `harness.clear()` 不存在 → `harness.abort().catch(() => {})`

### 6.2 Zone 多 Agent 调度 (Phase 6)

- AgentOrchestrator 按功能区 (chat/coder/analyst) 分配 AgentHarness
- `registerZones()` + `dispatch(zone, message)` API
- 可扩展到任意数量的领域

### 6.3 SSE 事件透传 (Phase 7)

- `mapEventToSSE` 已删除（Phase 5），SSE 直通原始 MorPexEvent
- `broadcastToSSE()` 与 EventBus SSE 流统一为原始事件格式
- 前端以 `event.payload ?? event` 统一取数据

### 6.4 Phase 5 清理

| 清理项 | 说明 |
|--------|------|
| **RouterPlugin 已删除** | 绞杀者模式完成，全流量走 MorPexCore。CrossDomainRouter 保留（跨领域 DAG 拆解）。 |
| **mapEventToSSE 已删除** | SSE 直通原始 MorPexEvent，不再翻译。 |
| **4 路历史记录已统一** | 新增 `GET /api/history/:executionId` 统一查询端点。 |

### 6.5 跨领域多 Agent 协同 🆕 (Phase 8-14)

跨领域升级已全部完成。核心能力：
- **Domain Manifest** — JSON 驱动的领域定义协议，零代码扩行业
- **DomainCluster** — 动态领域集群（wake/sleep/execute/steer）
  - 新增 `onUserInputNeeded` 回调：当 agent 在 `execute()` 中调用 `ask_user` 工具时，
    工具实现会挂起等待一个 Promise。StudioServer 通过此回调注入用户回复。
  - pi-native steering：agent 调用 `ask_user({ question, options? })` → 工具 execute 挂起 →
    `onUserInputNeeded` 发射 SSE `runtime.task.awaiting_input` → 前端传递用户回应 →
    `harness.steer(reply)` 注入回复 → agent 继续执行。
  - 不比要修改 pi-agent-core，AgentHarness 原生支持 subscribe + steer。
- **CrossDomainRouter** — LLM 驱动的跨领域 DAG 拆解（Kahn 拓扑排序）
- **DomainDispatcher** — DAG 并行调度执行
- **EventBus v2** — 领域作用域事件（emitToDomain/onDomain/broadcastCrossDomain）
- **NegotiationEngine** — 跨领域质询工单 + 三闸门防死循环
- **ArtifactRegistry v2** — 标准化 URI 引用（artifact://{domain}/{type}/{id}）
- **KnowledgeGraph v2** — 跨领域实体查询（searchCrossDomain/findCrossDomainLinks）

详见 `docs/plans/cross-domain-upgrade-todo.md`

---

## 7. 跨领域协同架构 (Cross-Domain)

### 7.1 四层解耦模型

```
┌─────────────────────────────────────────────────────┐
│ 🟢 第一层：用户感知与统一路由层                        │
│    CrossDomainRouter + IntentResolver + 强推理 LLM   │
│    职责：领域拆解与指派，生成高级任务 DAG               │
├─────────────────────────────────────────────────────┤
│ 🔵 第二层：中枢事件总线 (Core Event Bus)               │
│    跨领域异步通信 + 资产引用传递 (ArtifactRef)          │
│    领域间互不干扰，只认事件和产物                       │
├─────────────────────────────────────────────────────┤
│ 🟡 第三层：动态领域空间 (Dynamic Domain Clusters)      │
│    每领域独立 pi-agent 集群：Master + Skill Pool      │
│    按需动态拉起/休眠，按 DomainManifest 配置           │
├─────────────────────────────────────────────────────┤
│ 🔴 第四层：全局共享底座 (Shared Substrate)            │
│    跨领域知识图谱 + 全局资产登记处 (URI 格式标准化)     │
└─────────────────────────────────────────────────────┘
```

### 7.2 核心协议：领域清单 (Domain Manifest)

定义一个新领域只需编写一个 JSON 配置文件，零代码改动：

```json
{
  "domain_id": "legal_compliance",
  "domain_name": "法律合规领域",
  "version": "1.0.0",
  "master_agent_config": {
    "system_prompt": "你是一名资深的跨国企业合规官...",
    "model": "deepseek-r1",
    "temperature": 0.3
  },
  "subscribed_events": ["ContractReviewRequestedEvent"],
  "skills": ["legal_database_search", "contract_diff_generator"],
  "output_artifacts": [
    { "type": "legal_report", "format": "markdown" }
  ],
  "wake_conditions": {
    "intent_patterns": ["法律", "合规", "合同"],
    "events": ["ContractReviewRequestedEvent"],
    "artifact_triggers": ["contract_draft"]
  }
}
```

### 7.3 跨领域任务执行流程

```
用户输入 → CrossDomainRouter.decompose()  →  子任务 DAG
             (LLM 拆解 + Kahn 拓扑排序)           ↓
                                        DomainDispatcher.executeDAG()
                                             ↓           ↓
                                     DomainCluster A  DomainCluster B
                                     (软件工程)       (商业金融)
                                             ↓           ↓
                                     artifact://a/x/1 → artifact://b/y/2
                                             ↓           ↓
                                     EventBus 广播 → NegotiationEngine
                                      (domain.task_completed)  (质询)
```

### 7.4 智能体协商协议

- 跨领域质询通过 `InterrogationTicket` 结构化通信
- 三闸门防死循环：深度限制(3) + 哈希查重 + 每对领域限流(1)
- FSM `INTERROGATING` 状态支持执行中质询中断与恢复
- `ESCALATED` 状态触发人类仲裁
