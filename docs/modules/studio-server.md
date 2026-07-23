# 模块名称：Studio 桥接服务模块

> 路径: `packages/studio/server/` | 入口: `packages/studio/server/index.ts` | 端口: 8080 | 版本: 2.4.0

---

## 1. 模块职责 (Responsibility)

### 本模块负责

| 职责 | 说明 |
|------|------|
| **Express HTTP 服务器** | 监听 :8080，提供 REST API + SSE + 静态文件服务 |
| **REST API 端点** | 35+ 端点：系统状态、执行、编排、记忆、知识图谱、会话、配置 |
| **SSE 事件流** | EventBus 事件 → SSE 实时推送到前端 |
| **引擎初始化** | 通过 5 个工厂函数分步初始化 (Phase 4 重构)：initBaseServices / initAIEngines / initMemoryStorage / initControlPlane / initCrossDomainModules + wireFSMtoOrchestrator 自动联动 |
| **前后端桥接** | 将前端 REST 请求翻译为 EventBus 事件，将 EventBus 事件翻译为 SSE |
| **生产静态服务** | 在 `NODE_ENV=production` 时 serve 前端构建产物 (`packages/studio/ui/dist/`) |

### 本模块【绝不】负责

| 不负责 | 正确归属 |
|--------|----------|
| ❌ 核心引擎逻辑 (FSM/DAG/Memory/KG) | `packages/core/planes/` — 各功能平面 |
| ❌ LLM 模型调用 | `@earendil-works/pi-ai` + `@earendil-works/pi-agent-core` — npm 外部包 |
| ❌ 前端 UI 渲染 / 状态管理 | `packages/studio/ui/` — React 前端 |
| ❌ EventBus 实现 | `packages/core/core/EventBus.ts` |
| ❌ 数据持久化 (JSONL/zvec) | `packages/core/mirror/storage/` + `packages/core/planes/knowledge-plane/memory/` |

---

## 2. 文件结构树 (File Structure)

```text
packages/studio/server/
├── index.ts              # HTTP 服务器入口 (app.listen)
├── StudioServer.ts       # 核心：Express 应用构建 + 引擎初始化 + 路由注册
├── SessionManager.ts     # ★ v9.2 pi Session 生命周期管理器
├── SessionStore.ts       # ★ v9.2 会话持久化（文件 I/O，原 SessionManager 重命名）
├── StudioOrchestrator.ts # Agent 路由分发
├── ArtifactWriter.ts     # 产物文件系统落盘
│
├── V10API.ts             # ★ v10 REST API（17 端点）
├── V10MissionAdapter.ts  # ★ v10 Mission 生命周期适配器
├── V10Integration.ts     # ★ v10 统一启动入口
│
├── simulation/           # ★ v10 Phase 2: Simulation Twin（9 源文件）
│   ├── simulation-engine.ts
│   ├── simulation-twin.ts
│   ├── plan-simulator.ts
│   ├── cost-estimator.ts
│   ├── risk-predictor.ts
│   ├── success-predictor.ts
│   ├── execution-predictor.ts
│   └── types.ts
│
├── verification/         # ★ v10 Phase 1: Behavior Verification（8 源文件）
│   ├── behavior-verification-engine.ts
│   ├── expected-trace-builder.ts
│   ├── trace-comparator.ts
│   ├── quality-score.ts
│   ├── violation-detector.ts
│   ├── regression-store.ts
│   └── types.ts
│
├── learning/             # ★ v10 Phase 3: Learning Plane（5 源文件）
│   ├── learning-plane.ts
│   ├── experience-learning.ts
│   ├── workflow-learning.ts
│   ├── preference-learning.ts
│   └── index.ts
│
├── event-mesh/           # ★ v10 Phase 4: Event Mesh（7 源文件）
│   ├── event-mesh.ts
│   ├── event-registry.ts
│   ├── schema-validator.ts
│   ├── replay-engine.ts
│   ├── migration-layer.ts
│   └── types.ts
│
├── federation/           # ★ v10 Phase 5: Runtime Federation（6 源文件）
│   ├── federation-manager.ts
│   ├── node-identity.ts
│   ├── remote-executor.ts
│   ├── capability-discovery.ts
│   ├── types.ts
│   └── index.ts
│
├── observability/        # v9.2 Observability Plane（11 文件）
└── data/                 # 运行时数据目录

packages/studio/ui/
└── vite.config.ts        # Vite 配置 (开发代理 /api → :8080)
```

> 注：所有 API 路由内联在 `StudioServer.ts` 中。SessionManager/SessionStore 为 v9.2 新增/重命名。
> v10 模块通过 `V10Integration.ts` 统一初始化，`V10API.ts` 注册路由。

---

## 3. 架构与数据流程 (Architecture & Flow)

### 3.1 初始化流程

```
StudioServer.start()
  │
  ├── 1. 创建 MorPexCore Kernel
  │     createKernel({ mirrorBasePath: process.env.MIRROR_PATH })
  │
  ├── 2. 创建 AgentService
  │     new AgentService()
  │     // 管理 AgentHarness 生命周期，替代旧的 LLMBridge
  │
  ├── 2.5. ★ v9.2: 初始化 SessionManager（pi Session 生命周期管理）
  │     new SessionManager({ crossDomainRouter, domainDispatcher, domainManager, memoryBus, sessionStore })
  │     // 接线 DomainDispatcher 回调：
  │     //   onGetHarness → SessionManager.ensureHarness()
  │     //   onReleaseHarness → SessionManager.releaseHarness()
  │     // 新增 API 路由：
  │     //   POST /api/session/create  — 创建 session
  │     //   GET  /api/sessions         — 列出活跃 session
  │     //   POST /api/session/:id/send — 按 mode 路由消息
  │
  ├── 3. 初始化所有引擎组件
  │     ├── AgentService         — AgentHarness 生命周期管理
  │     ├── JsonlSessionRepo     — 会话持久化（替代旧的 SessionManager，现为 SessionStore）
  │     ├── FSMEngine            — 任务状态机
  │     ├── DAGEngine            — DAG 执行
  │     ├── SchedulerEngine      — 任务调度
  │     ├── MemoryBus (v2)      — 三维一体记忆总线
  │     ├── KnowledgeGraph       — 知识图谱
  │     ├── ArtifactRegistry     — 产物管理
  │     ├── AgentOrchestrator    — Agent 编排
  │     ├── SwarmEngine          — 多 Agent 拍卖
  │     ├── ExecutionGraph       — 执行图
  │     ├── IntentResolver       — 意图识别（通过 pi-ai 直接调用）
  │     ├── WorkflowPlanner      — 工作流规划
  │     ├── IntentPlugin         — 注册到 Kernel（监听 intent.input 事件）
  │     └── PlannerPlugin        — 注册到 Kernel（监听 intent.resolved 事件）
  │
  ├── 3.5. 初始化跨领域模块 🆕 (Phase 8-14)
  │     ├── pi-ai controlModel    — getModel('deepseek', 'deepseek-v4-flash')
  │     ├── DomainManifestLoader  — 加载 data/domains/*.json
  │     ├── DomainClusterManager  — 注册领域集群（注入 pi-ai LLM 调用器）
  │     ├── CrossDomainRouter     — LLM 跨领域 DAG 拆解
  │     ├── DomainDispatcher      — DAG 并行调度执行
  │     ├── NegotiationEngine     — 质询工单管理
  │     └── ArbitrationHandler    — 人类/自动仲裁
  │
  │ 注：所有 LLM 调用统一通过 pi-ai 的 getModel() + completeSimple()，
  │     API Key 由 pi-ai 的 getEnvApiKey() 自动从环境变量读取。
  │
  │ 注：旧 SessionManager（文件 I/O）于 v9.2 重命名为 SessionStore。
  │     新 SessionManager（pi Session 生命周期管理）于 v9.2 新增。
  │     SkillLoader / PromptTemplateEngine / HumanInLoopGate /
  │     ClarificationEngine 已删除（Phase 2-3），改用 pi 原生替代。
  │
  ├── 4. 设置 Express 中间件
  │     ├── cors()
  │     ├── express.json()
  │     └── 请求计时中间件
  │
  ├── 5. 注册 API 路由 (35+ 端点，见 §4)
  │
  ├── 6. 设置 SSE 端点
  │     ├── /api/stream/global          — 全局事件流
  │     └── /api/stream/execution/:id   — 单执行事件流
  │     └── EventBus → SSE 直通（原始 MorPexEvent）
  │
  ├── 7. 设置静态文件服务 (仅 production)
  │     └── express.static('packages/studio/ui/dist')
  │     └── SPA fallback: /* → index.html
  │
  ├── 8. 启动 Kernel
  │     await kernel.start()
  │
  └── 9. 启动 HTTP 服务器
        app.listen(process.env.PORT || 8080)
```

### 3.2 请求-响应数据流

#### 🆕 统一入口: POST /api/chat/message（v2.3 架构重构 — 推荐）

所有前端聊天输入无脑推送此端点。后端 `CrossDomainRouter.dispatch()` 单次 LLM 调用完成领域识别、澄清判定、依赖拓扑分析，统一路由单领域/多领域。

```
前端 Omni-Input                         后端 (Express :8080)
─────────                                ──────────
POST /api/chat/message                   StudioServer
{ content: "设计MIPI屏幕驱动并核对预算" }   │
────────────────────────────►             │ CrossDomainRouter.dispatch(content)
                                          │   → LLM 单次调用
                                          │   → RoutingAnalysis {
                                          │       isMultiDomain, involvedDomains,
                                          │       needsClarification, clarificationQuestions
                                          │     }
                                          │
                                          ├── needsClarification?
                                          │   → { type: "clarification", questions: [...] }
                                          │   → 用户继续对话回答
                                          │
                                          ├── 🎯 单领域
                                          │   → DomainCluster.decomposeSingleIntent()
                                          │
                                          └── 🕸️ 多领域
                                              → toposort → fan-out → DAG → 执行
                                          │
◄─────────────────────────────────────────│
{ ok, analysis, type?, questions?, dag?, result? }
```

**请求体**:
```json
{ "content": "用户输入文本" }
```

**澄清响应** (needsClarification=true):
```json
{
  "ok": true,
  "type": "clarification",
  "analysis": { "globalIntent": "...", "needsClarification": true },
  "questions": ["你想爬取什么类型的网站？", "需要什么数据格式？"]
}
```

**执行响应** (单领域或多领域):
```json
{
  "ok": true,
  "analysis": { "isMultiDomain": false, "involvedDomains": ["software_engineering"], ... },
  "dag": [{ "taskId": "task_0", "domain": "...", "goal": "...", "deps": [] }],
  "result": { ... }
}
```

#### 新路径: POST /api/chat/agent-send（AgentHarness 驱动）

```
前端 (React)                               后端 (Express :8080)
─────────                                  ──────────
POST /api/chat/agent-send                  StudioServer
{ message: "写一个排序算法", zone: "coder" }  │
────────────────────────────►               │ 1. AgentService.createHarness(zone, tools)
                                            │ 2. harness.prompt(message)
                                            │    ├── pi-ai.stream() → DeepSeek
                                            │    └── AgentEvent 流 ← subscribe()
                                            │
SSE: /api/stream/global                    │ 3. AgentEvent 直接透传
◄────────────────────────────               │    ├─ turn_start: 回合开始
{ type:"turn_start", ... }                 │    ├─ message_start/update/end: 流式文字
◄──────────────                              │    ├─ tool_execution_start/end: 工具执行
{ type:"message_update", delta:"冒" }     │    └─ turn_end: 回合完成
◄──────────────                              │
{ type:"tool_execution_start", ... }       │ 4. 返回 HTTP 响应
◄──────────────                              │
{ type:"tool_execution_end", ... }         │
◄──────────────                              │
                                            │
◄────────────────────────────               │
{ ok:true, type:"agent_response",          │
  text:"..." }                              │
```

#### ★ v9.2 新路径: POST /api/session/:id/send（SessionManager 驱动 — 推荐）

```
前端 ZoneD (React)                        后端 SessionManager (Express :8080)
─────────                                  ──────────
按 activeMode 选择 sessionId
POST /api/session/{sessionId}/send          SessionManager.send(sessionId, content)
{ content: "硬件选型" }                       │\
                                            │
                                            ├── mode=chat:
                                            │   LLMProvider.get()(content, systemPrompt)
                                            │   → { type: 'direct_chat', output: '...' }
                                            │
                                            ├── mode=luban:
                                            │   CrossDomainRouter.dispatch(content)
                                            │     → DAG nodes
                                            │     → 为每个节点 create('task', opts)
                                            │     → setImmediate → executeDag()
                                            │     → 每个节点 ensureHarness → harness.prompt
                                            │     → 完成释放 harness
                                            │   → { type: 'dag_plan', dag, executionId }
                                            │
                                            ├── mode=simq:
                                            │   MemoryBus.recall({ text: content, topK: 5 })
                                            │   → { type: 'direct_chat', output: '📖 找到 N 条...' }
                                            │
                                            └── mode=task:
                                                ensureHarness(sessionId)
                                                  → AgentHarness({ model, tools, systemPrompt })
                                                harness.prompt(content)
                                                → { type: 'direct_chat', output: '...' }
```

**Harness 依赖分层（核心原则）**:

| Session Mode | 需要 Harness | 原因 |
|:------------:|:------------:|------|
| chat | ❌ | 单次 LLM 对话，直接调用 LLMProvider |
| luban | ❌ | 编排层，仅在 DAG 节点执行时才创建 task harness |
| simq | ❌ | 记忆检索，直接调用 MemoryBus |
| task | ✅ | 多轮 Agent 对话 + 工具调用 |

---

#### 旧路径: POST /api/chat/send（控制平面驱动，旧路径仍可用）

```
前端 (React)                               后端 (Express :8080)
─────────                                  ──────────
POST /api/chat/send                        StudioServer
{ message: "帮我做一个CLI工具" }             │
────────────────────────────►               │ 1. 加载会话历史（JsonlSessionRepo）
                                            │ 2. IntentResolver.resolve(message)
                                            │    ├─ 置信度 < 0.6  → 返回 rejected
                                            │    ├─ 0.6~0.85 → 返回 clarification + 问题
                                            │    └─ ≥ 0.85  → 继续
                                            │
                                            │ 3. WorkflowPlanner.plan(intent)
                                            │    └─ 生成 Plan { tasks[], blueprints[] }
                                            │
                                            │ 4. 执行 Top-3 高优先任务 (通过 AgentService)
                                            │    └─ AgentHarness.prompt() each task
                                            │
                                            │ 5. 写入 ArtifactRegistry + 磁盘
                                            │    └─ emit('artifact.created', ...)
                                            │
SSE: /api/stream/global                    │ 6. 广播事件
◄────────────────────────────               │    ├─ intent.resolved
{ type:"intent.resolved", ... }            │    ├─ plan.generated
◄──────────────                              │    └─ artifact.created
{ type:"plan.generated", ... }             │
◄──────────────                              │ 7. 返回 HTTP 响应
{ type:"artifact.created", ... }           │
                                            │
◄────────────────────────────               │
{ ok:true, type:"execution_complete",      │
  output:"...", artifacts:[...] }          │
```

#### 旧路径: POST /api/prompt（遗留兼容，已标记 deprecated）

```
前端 (React)                               后端 (Express :8080)
─────────                                  ──────────
POST /api/prompt                           StudioServer
{ message: "你好" }                         │
────────────────────────────►               │ 1. 生成 executionId
                                            │ 2. emit('llm.request', ...)
                                            │    → AgentService → DeepSeek
                                            │ 3. emit('llm.response', ...)
◄────────────────────────────               │    → 返回文本
{ ok:true, output:"..." }
```

#### 澄清对话流程（中置信度场景）

```
前端                                        后端
  │                                          │
  │ POST /api/chat/send                      │
  │ { message: "帮我做一个CLI工具" }          │
  │─────────────────────────────────────────►│
  │                                          │ IntentResolver: 置信度 0.72
  │  ◄────────────────────────────────────────│
  │ { ok:true, type:"clarification",         │
  │   questions:[                            │
  │     { q:"用什么语言?", options:["Node.js","Python"] },
  │     { q:"主要功能?" }                     │
  │   ]}                                      │
  │                                          │
  │ 用户回答问题后再次调用                    │
  │ POST /api/chat/send                      │
  │ { message: "Node.js，文件复制",           │
  │   session_id: "xxx",                     │
  │   clarification_answers: {...} }          │
  │─────────────────────────────────────────►│
  │                                          │ 意图清晰 → 执行
  │  ◄────────────────────────────────────────│
  │ { ok:true, type:"execution_complete",    │
  │   artifacts:[...] }                       │
```

### 3.3 事件推送机制（SSE）

**Phase 5 已完成**: `mapEventToSSE()` 已删除。SSE 统一直通原始 MorPexEvent。

所有 SSE 事件统一为原始 MorPexEvent 格式：

```json
{
  "id": "evt_xxx",
  "type": "runtime.agent.message_update",
  "timestamp": 1700000000000,
  "executionId": "exe_xxx",
  "source": "studio",
  "payload": {
    "delta": "你好",
    "sessionId": "ses_xxx"
  }
}
```

| 事件类型 | 来源 | 前端处理 |
|---------|------|---------|
| `runtime.agent.message_update` | AgentHarness → PiAdapter | 流式追加对话气泡 |
| `runtime.agent.message_end` | AgentHarness → PiAdapter | 消息完成 |
| `runtime.agent.tool_execution_start` | AgentHarness → PiAdapter | 工具状态卡片 🛠️ |
| `runtime.agent.tool_execution_end` | AgentHarness → PiAdapter | 工具完成 ✅ |
| `runtime.agent.turn_start` | AgentHarness → PiAdapter | 回合开始 |
| `runtime.fsm.transition` | FSMEngine → EventBus | FSM 状态更新 |
| `dag.*` | DAGEngine → EventBus | DAG 拓扑可视化 |
| `runtime.execution.*` | StudioServer → EventBus | 执行计数 |

> **统一规则**: 所有 SSE 事件以后端 MorPexEvent 原始类型为准。前端通过 `event.payload ?? event` 取数据，兼容 broadcastToSSE 直通和 EventBus 全局流两种路径。
| `graph.*` | 透传 `graph.*` | 执行图更新 |
| `scheduler.*` | 透传 `scheduler.*` | 调度事件 |
| `human.*` | `human.pause` | 人工审批弹窗 |
| `memory.*` | `memory.event` | 记忆系统 v2 事件（stored/recalled/feedback/stage_complete/plan_stages/audit/intercept_input） |
| `knowledge.*` | 透传 | 知识图谱更新 |
| `artifact.*` | 透传 | 产物变更通知 |
| `orchestrator.*` | 透传 | Agent 编排事件 |
| `swarm.*` | 透传 | 拍卖事件 |
| `intent.*` | 透传 | 意图识别结果 |
| `plan.*` | 透传 | 规划事件 |
| `runtime.execution.*` | `execution.status` | 执行状态计数 |
| `runtime.agent.*` | `agent.event` | Agent 事件日志 |
| `kernel.*` / `gateway.*` | 透传 | 系统事件 |

---

## 4. 接口与契约 (API & Contracts)

### 4.1 系统状态

**GET `/api/status`**

输出:
```json
{
  "ok": true,
  "uptime": 12345,
  "kernel": {
    "phase": "running",
    "pluginCount": 14,
    "activeExecutions": 2
  },
  "plugins": 14
}
```

错误: 无（始终返回 200）

---

**GET `/api/health`**

输出:
```json
{ "ok": true, "uptime": 12345 }
```

---

**GET `/api/engine/check`**

输出:
```json
{
  "kernel": "running",
  "mirror": { "eventCount": 15000, "storagePath": "./data/mirror" },
  "gateway": { "adapters": ["pi"] },
  "eventTypes": ["fsm.transition", "dag.built", "llm.response", ...]
}
```

---

### 4.2 执行

**POST `/api/chat/message`** — 统一聊天入口（v2.3 架构重构，推荐）

输入:
```json
{ "content": "string (必填) — 用户输入文本" }
```

输出:

**1. 需要澄清追问** (needsClarification=true):
```json
{ "ok": true, "type": "clarification", "analysis": { "globalIntent": "...", "needsClarification": true }, "questions": ["追问1", "追问2"] }
```

**2. 单领域执行**:
```json
{ "ok": true, "analysis": { "isMultiDomain": false, "involvedDomains": ["software_engineering"], "globalIntent": "编写爬虫程序", "needsClarification": false }, "result": {} }
```

**3. 多领域 DAG**:
```json
{ "ok": true, "analysis": { "isMultiDomain": true, "involvedDomains": ["hardware_engineering", "business_finance"], "globalIntent": "设计硬件并核对预算" }, "dag": [{ "taskId": "task_0", "domain": "hardware_engineering", "goal": "设计MIPI屏幕驱动", "deps": [] }] }
```

错误: `400` — `content` 缺失

---

**POST `/api/chat/agent-send`** — AgentHarness 驱动的聊天端点（新，推荐）

输入:
```json
{
  "message": "string (必填)",
  "zone": "string (可选, 默认 'chat')",
  "sessionId": "string (可选)",
  "tools": "AgentTool[] (可选, 默认内置工具集)"
}
```

输出 (SSE 直接透传 AgentEvent，HTTP 返回):
```json
{
  "ok": true,
  "type": "agent_response",
  "text": "Agent 完整响应",
  "zone": "coder",
  "events": []
}
```

错误:
| 状态码 | 条件 |
|--------|------|
| 400 | `message` 缺失 |
| 503 | AgentService 不可用 |

---

**GET `/api/chat/agent-status`** — AgentService 状态查询

输出:
```json
{
  "ok": true,
  "activeZones": ["chat", "coder"],
  "env": { "cwd": "/project" },
  "model": "deepseek-v4-flash"
}
```

---

### 4.3 ★ v9.2 多 Session 端点

**POST `/api/session/create`** — 创建新 session

输入:
```json
{ "mode": "chat" }
```
`mode` 取值: `chat` | `luban` | `simq` | `task`

输出:
```json
{ "ok": true, "sessionId": "sess_chat_1700000000000_abc123", "mode": "chat" }
```

错误:
| 状态码 | 条件 |
|--------|------|
| 400 | `mode` 无效 |

---

**GET `/api/sessions`** — 列出所有活跃 session

输出:
```json
{
  "ok": true,
  "sessions": [
    { "id": "sess_chat_...", "mode": "chat", "status": "idle", "refCount": 0 },
    { "id": "sess_task_0_...", "mode": "task", "status": "running", "taskId": "task_0", "executionId": "ex1" }
  ]
}
```

---

**POST `/api/session/:id/send`** — 按 mode 路由消息（★ 推荐）

这是 v9.2 的核心路由端点。根据 session 的 mode 自动选择路由逻辑：

| mode | 后端调用 | 需 harness |
|:----:|----------|:----------:|
| chat | `LLMProvider.get()(content)` | ❌ |
| luban | `CrossDomainRouter.dispatch()` → DAG → 异步执行 | ❌ |
| simq | `MemoryBus.recall()` | ❌ |
| task | `ensureHarness()` → `harness.prompt()` | ✅ |

输入:
```json
{ "content": "用户输入文本" }
```

输出 (chat/simq):
```json
{ "ok": true, "type": "direct_chat", "output": "LLM 或记忆检索结果" }
```

输出 (luban — DAG 规划):
```json
{
  "ok": true,
  "type": "dag_plan",
  "dag": { "nodes": [...], "globalIntent": "...", "isMultiDomain": false },
  "executionId": "dag_1700000000000"
}
```

---

**POST `/api/chat/send`** — 控制平面驱动的聊天端点（旧，向后兼容）

输入:
```json
{
  "message": "string (必填)",
  "session_id": "string (可选)",
  "clarification_answers": "object (可选)"
}
```

输出 (根据 IntentResolver 置信度不同):

**1. 低置信度 (< 0.6) — 拒绝**:
```json
{
  "ok": true,
  "type": "rejected",
  "output": "抱歉，我无法完全理解您的需求...",
  "intent": { "type": "ambiguous", "domain": "general", "confidence": 0.45 }
}
```

**2. 中置信度 (0.6~0.85) — 澄清**:
```json
{
  "ok": true,
  "type": "clarification",
  "sessionId": "sess_xxx",
  "questions": [
    { "id": "q1", "question": "您想用什么编程语言？", "type": "choice", "options": ["Node.js", "Python"] },
    { "id": "q2", "question": "主要实现什么功能？", "type": "open" }
  ],
  "intent": { "type": "ambiguous", "domain": "software", "confidence": 0.72 }
}
```

**3. chat/query 类型 — 直接对话回复**:
当 IntentResolver 检测到 `chat` 或 `query` 类型时，跳过规划/执行流水线，直接调用 LLM 返回文本响应：
```json
{
  "ok": true,
  "type": "direct_chat",
  "output": "你好！有什么我可以帮你的吗？",
  "executionId": "exe_xxx",
  "intent": { "type": "chat", "domain": "general", "confidence": 0.95 }
}
```

**4. 高置信度 directive (≥ 0.85) — 执行完成**:
```json
{
  "ok": true,
  "type": "execution_complete",
  "output": "## 完成后总结...",
  "executionId": "exe_xxx",
  "plan": {
    "goal": "创建一个Node.js CLI工具",
    "riskLevel": "medium",
    "tasks": [
      { "name": "设计文档", "description": "...", "assignedRole": "架构师" }
    ]
  },
  "artifacts": [
    { "name": "需求规格文档", "type": "document", "path": "data/mirror/workspace/projects/exe_xxx/..." }
  ],
  "intent": { "type": "directive", "domain": "software", "confidence": 0.95, "goal": "创建PM2管理CLI工具" }
}
```

**5. 降级 (控制平面错误时 fallback):**
```json
{
  "ok": true,
  "output": "直接LLM响应文本",
  "fallback": true
}
```

错误:
| 状态码 | 条件 |
|--------|------|
| 400 | `message` 和 `clarification_answers` 都缺失 |
| 504 | 请求处理超时 (600s)，仅当整个请求超过 600 秒 |

**超时策略**:
- per-call LLM 超时: **无**（所有 LLM 调用无限等待 `llm.response`）
- 请求级超时: 600s 安全网（`Promise.race` 包裹整个处理流程）
- 可选 LLM 调用 (classifyArtifact, generateClarificationQuestions): 无超时，仅 LLM 报错时降级到规则兜底
- 前端 SSE 空闲检测: 30s 无 SSE 推送 → 清除流式状态

---

#### 4.2.1 下游交接 (Handoff) 模式 — DAG 任务上下文传递

当执行规划中的多个任务时，每个任务的 Prompt 末尾包含一个 `## 下游交接` 指令，要求 LLM 输出结构化 JSON 供下游任务消费。

**Prompt 末尾的指令**:
```
## ⚠️ 下游交接（必须附在输出末尾）
在完成上述任务后，请在输出末尾追加一个 JSON 段落，供下一个执行者参考。格式：

```handoff
{
  "decisions": ["关键决策"],
  "interfaces": { "api": "接口定义" },
  "constraints": ["约束条件"],
  "next_hint": "给下游任务的具体建议"
}
```
```

**提取逻辑**（优先级递减）:
1. 匹配 ` ```handoff ... ``` ` 代码块 — 精确提取
2. 匹配任何末尾 ` ```json { ... } ``` ` 块 — 兜底
3. 取输出末尾 800 字符 — 最终降级

**实际产出示例** — Task1 (产品经理) → Task2 (架构师):
```json
// Task1 handoff 输出
{
  "decisions": ["采用 pm2e 作为工具名", "JSON+表格双输出模式"],
  "interfaces": { "api": { "command_pattern": "pm2e <action> <target>" } },
  "next_hint": "建议架构师设计模块化架构，重点关注PM2 daemon IPC通信机制"
}

// Task2 收到上述 handoff 后的自己的 handoff 输出
{
  "decisions": ["采用 TypeScript + Commander.js", "使用 pm2 官方库"],
  "interfaces": { "api": { "IPM2Client": "{ connect, start, stop, ... }" } },
  "next_hint": "请按顺序实现：pm2-client.ts → formatter.ts → list命令 → start/stop/restart"
}
```

#### 4.2.2 Artifact 分类 — LLM 驱动

任务产出写入磁盘前，`classifyArtifact()` 调用 LLM 分析内容，确定文件类型、扩展名和文件名。

**LLM 分类 Prompt**:
```
分析以下内容，判断它属于什么类型。

内容片段（前500字符）：
{content}

请严格按以下 JSON 返回：
{
  "type": "code|document|config|schema|report|plan|structured_data",
  "extension": "建议的文件扩展名",
  "nameHint": "建议的文件名（不含扩展名，英文）"
}
```

**降级路径**（仅在 LLM 调用报错时）:
- 角色映射: `产品经理→document`, `开发者→code`, `测试→report`, `运维→config`
- 扩展名映射: `code→.js`, `document→.md`, `config→.json`, `report→.md`
- 文件名: 任务名 slug

---

**POST `/api/prompt`** (旧版，保持兼容)

输入:
```json
{
  "message": "string (必填)",
  "sessionId": "string (可选)",
  "model": "string (可选)"
}
```

输出 (同步等待 LLM 返回):
```json
{
  "ok": true,
  "requestId": "req_abc123",
  "text": "LLM 完整响应文本",
  "usage": { "input": 50, "output": 200, "totalTokens": 250 }
}
```

错误:
| 状态码 | 条件 |
|--------|------|
| 400 | `message` 缺失或为空 |
| 503 | 所有 LLM 提供商不可用 |

---

**GET `/api/artifacts`** — 产物查询

查询参数:
| 参数 | 类型 | 说明 |
|------|------|------|
| `executionId` | string (可选) | 按执行ID筛选 |

输出:
```json
{
  "ok": true,
  "projects": [
    {
      "id": "exe_xxx",
      "files": [
        { "name": "设计文档.md", "path": "projects/exe_xxx/..." }
      ]
    }
  ]
}
```

---

**POST `/api/execute`**

输入:
```json
{
  "agentRole": "assistant",
  "input": "string (必填)",
  "context": { "sessionId": "string (可选)" }
}
```

输出:
```json
{
  "status": "completed",
  "output": "Agent 执行结果",
  "artifacts": [],
  "duration": 3500
}
```

---

**POST `/api/cycle/run`** — 启动创业循环

输入:
```json
{
  "domain": "software (可选)",
  "trend": "string (可选)"
}
```

输出: HTTP 202
```json
{ "ok": true, "cycleId": "cycle_abc123", "message": "Cycle started" }
```

---

**GET `/api/history`** — 统一历史查询

输出: 聚合 HistoryStore + Mirror + MemoryBus + KnowledgeGraph 统计
```json
{
  "ok": true,
  "stats": {
    "totalCycles": 12,
    "totalTasks": 48,
    "mirror_events": 245,
    "mirror_executions": 12,
    "memory_index": 89,
    "kg_entities": 156
  },
  "cycles": [...],
  "tasks": [...],
  "executions": [...]
}
```

**GET `/api/history/:executionId`** — 🆕 按 executionId 聚合 4 路存储

输出:
```json
{
  "ok": true,
  "executionId": "exe_xxx",
  "history": { /* HistoryStore cycle */ },
  "mirror": [ /* ExecutionMirror events + snapshots */ ],
  "memory": [ /* MemoryBus recall results */ ],
  "artifacts": [ /* ArtifactRegistry matching */ ]
}
```

---

### 4.3 记忆 / 知识

**GET `/api/memory/stats`** — 记忆统计
**POST `/api/memory/feedback`** — 闭环反馈
**POST `/api/memory/stage-complete`** — 阶段完成
**POST `/api/memory/plan-stages`** — 阶段规划+门控
**POST `/api/memory/audit`** — 门控审计
**POST `/api/memory/intercept`** — Layer 2 输入拦截
**POST `/api/memory/compact`** — 手动压缩
**GET `/api/memory/summary-chain`** — 摘要链
**GET `/api/memory/temp-pool`** — 临时池查询

输出:
```json
{
  "totalEntries": 500,
  "byLayer": { "L1": 100, "L2": 200, "L3": 100, "L4": 80, "L5": 20 },
  "totalChunks": 1500,
  "vectorStoreSize": "45MB"
}
```

---

**GET `/api/memory/search?q=EventBus&limit=10`**

输出:
```json
{
  "results": [
    {
      "id": "mem_001",
      "content": "EventBus 是 MorPexCore 的唯一通信通道...",
      "score": 0.95,
      "layer": "L3",
      "timestamp": 1700000000000
    }
  ]
}
```

---

**GET `/api/knowledge-graph/data`**

输出:
```json
{
  "nodes": [
    { "id": "ent_001", "label": "EventBus", "type": "technology" }
  ],
  "edges": [
    { "source": "ent_001", "target": "ent_002", "type": "used_by" }
  ]
}
```

---

### 4.4 会话

**GET `/api/sessions`**

输出:
```json
{
  "sessions": [
    { "id": "sess_abc", "cwd": "/projects/myapp", "messageCount": 50, "createdAt": 1700000000000 }
  ]
}
```

**POST `/api/sessions`**

输入:
```json
{ "cwd": "/projects/myapp" }
```

输出:
```json
{ "ok": true, "sessionId": "sess_new123" }
```

**DELETE `/api/sessions/:id`**

输出:
```json
{ "ok": true }
```

错误: 404 — 会话不存在

---

### 4.5 SSE 事件流

**GET `/api/stream/global`**

响应: `Content-Type: text/event-stream`

所有 SSE 事件直通原始 MorPexEvent 类型：

```
event: message_update
data: {"type":"message_update","executionId":"exe_xxx","payload":{"delta":"你好"}}

event: runtime.task.awaiting_input
data: {"type":"runtime.task.awaiting_input","executionId":"exe_xxx","payload":{"taskId":"task_1","question":"...","options":[...]}}

event: runtime.task.completed
data: {"type":"runtime.task.completed","executionId":"exe_xxx","payload":{"taskId":"task_1","status":"completed","output":"..."}}
```

**流式输出** (v9.2): `rawCallLLM` 使用 `streamSimple` 逐 token 发射 `message_update`，前端合并连续消息。
超时 30s 自动降级 `completeSimple`。

**SSE 断开清理** (v9.2): 所有客户端断开 3 秒后自动 `abortAllHarnesses()`，重连时取消。

**异常契约**: SSE 连接断开时前端自动重连（由 `api.ts:connectSSE()` 处理）。

### 4.6 跨领域 (Phase 8-14) 🆕

| 端点 | 方法 | 描述 |
|------|:----:|------|
| `/api/domains` | GET | 列出所有已注册领域及状态（domain_id, domain_name, version, skills, status） |
| `/api/domains/reload` | POST | 手动热加载领域清单（重新扫描 `data/domains/*.json`） |
| `/api/domains/:domainId/status` | GET | 查询指定领域的详细状态（含清单校验结果） |
| `/api/domains/events` | GET | 获取跨领域事件类型列表 |
| `/api/chat/cross-domain` | POST | 跨领域任务拆解与执行（输入消息 → LLM 拆解 DAG → 并行分发执行） |

**`POST /api/chat/cross-domain` 请求体**:
```json
{ "message": "帮我设计一款智能农业监控硬件，并写一份商业推广计划书" }
```

**`POST /api/chat/cross-domain` 响应**:
```json
{
  "ok": true,
  "decomposition": {
    "tasks": [
      { "id": "task_0", "domain": "software_engineering", "goal": "设计智能农业监控硬件", "deps": [] },
      { "id": "task_1", "domain": "business_finance", "goal": "撰写商业推广计划书", "deps": ["task_0"] }
    ],
    "reasoning": "该需求先需要技术设计，再进行市场分析"
  },
  "dag": [ ... ],
  "result": { ... }
}
```

**SSE 事件类型更新**:
| 事件 | 含义 |
|------|------|
| `domain.waking` | 领域正在唤醒 |
| `domain.active` | 领域已激活 |
| `domain.sleeping` | 领域已休眠 |
| `domain.task_completed` | 领域任务完成 |
| `domain.error` | 领域错误 |
| `cross_domain.dag_created` | 跨领域 DAG 已创建（含 DAG 节点列表） |
| `cross_domain.artifact_shared` | 跨领域产物流转 |
| `artifact.created` | 产物创建（实时推送到左侧面板） |
| `artifact.updated` | 产物更新 |
| `runtime.task.started` | DAG 节点开始执行 |
| `runtime.task.completed` | DAG 节点执行完成（含 output/error） |
| `runtime.task.awaiting_input` | 节点需要用户输入（agent 调用 ask_user 工具） |
| `negotiation.ticket_created` | 质询工单创建 |
| `negotiation.ticket_resolved` | 质询工单解决 |
| `negotiation.escalated` | 质询升级到人类 |

---

## 4.7 会话历史与持久化 🆕

| 端点 | 方法 | 描述 |
|------|:----:|------|
| `/api/session/:sessionId/history` | GET | 获取完整聊天历史（JSONL） |
| `/api/session/:sessionId/message` | POST | 追加一条聊天消息 |
| `/api/task/:execId/:taskId/history` | GET | 获取节点执行消息 |
| `/api/task/:execId/:taskId/message` | POST | 追加节点执行消息 |
| `/api/harness/:harnessId/steer` | POST | 向 agent 注入用户回复（pi 核 steering） |
| `/api/task/resume` | POST | 🆕 恢复中断的任务（重建 harness + 注入上下文） |
| `/api/agents/suggestions` | GET | 获取 @ 提及面板的 Agent 列表 |

**POST `/api/session/:sessionId/message`**

请求体（透传所有字段到 JSONL）：
```json
{
  "role": "user|system",
  "content": "消息内容",
  "region": "输入|系统",
  "status": "pending|completed|failed",
  "executionId": "exe_xxx",
  "dag": { "nodes": [...], "globalIntent": "..." }
}
```

存储路径: `./data/sessions/chat-history/{sessionId}.jsonl`

**POST `/api/task/:execId/:taskId/message`**

请求体: `{"role":"system|assistant|user", "content":"..."}`

存储路径: `./data/sessions/task-history/{execId}/{taskId}.jsonl`

**POST `/api/harness/:harnessId/steer`**

实现 pi 核原生 steering。当 agent 调用 `ask_user` 工具时，后端挂起执行并等待此端点被调用。

请求体:
```json
{ "reply": "用户回复内容" }
```

响应:
```json
{ "ok": true, "steered": true }
```

**POST `/api/task/resume`** 🆕

刷新后 harness 丢失时，重建执行上下文继续任务。从 JSONL 加载历史消息，注入为 agent 的 goal。

请求体:
```json
{ "executionId": "exe_xxx", "taskId": "task_1", "input": "继续", "domain": "software_engineering" }
```

响应:
```json
{ "ok": true, "resumed": true, "taskId": "task_1", "executionId": "exe_xxx" }
```

流程: 加载 JSONL 历史 → 中止残留 harness → 重建 cluster → executeNode → SSE 事件正常流

**GET `/api/agents/suggestions`**

响应:
```json
{
  "ok": true,
  "agents": [
    { "key": "鲁班", "name": "@鲁班", "desc": "任务规划、创作执行、复杂工作流" },
    { "key": "司马迁", "name": "@司马迁", "desc": "检索历史记忆和知识库" }
  ]
}
```

---

## 4.8 POST /api/chat/message 更新 (v3.x)

支持附灵模式（前端通过 `agent` 参数指定专职 Agent）：

请求体:
```json
{
  "content": "帮我做一个网页",
  "agent": "鲁班"
}
```

当 `agent` 参数存在时，直接路由到对应的 AgentDispatchMap handler（跳过 MetaPlanner 和意图分类）。

当前已注册 Agent:
| key | handler |
|-----|---------|
| 鲁班 | `router.dispatch()` → 返回 dag_plan 卡片 → 异步 executeDAG |
| 司马迁 | `memoryBus.recall()` → 返回记忆检索结果 |

**DAG 执行模式（@鲁班）**:
```
Phase 1: CrossDomainRouter.dispatch(content) → 生成可执行 DAG
  ├─ 广播 cross_domain.dag_created (SSE → 前端创建 flow + 节点)
  └─ 立即返回 { type: "dag_plan", dag: {...} }

Phase 2: setImmediate → executeDAG(dag.nodes)
  ├─ onNodeStart → runtime.task.started SSE
  ├─ onNodeComplete → runtime.task.completed SSE
  ├─ onNodeFail → runtime.task.completed (failed) SSE
  └─ 全部完成后更新持久化 DAG 消息（含 final node statuses + result）
```

### Bug #001 — SSE 重连时事件丢失

**症状**: SSE 连接因网络波动断开，重连期间 EventBus 产生的事件丢失，前端未收到。例如 FSM 状态转换事件丢失，前端显示的状态与实际不一致。

**根因**: `StudioServer.ts` — SSE 直接订阅 EventBus 实时事件，无历史回放机制。重连后只能从当前时刻开始。

**复现条件**: 在任务执行中断开 SSE 连接 5 秒，重连后检查前端状态。

**修复方案**: SSE 重连时（客户端发送 `Last-Event-ID` header），从 `EventBus.getHistory()` 回放断开期间的事件。

**回归测试**: `scripts/e2e-memory-test.ts` 中模拟 SSE 断开重连，验证前端状态最终一致。

---

### Bug #002 — [已解决] 超时策略改为前端 SSE 空闲检测

**背景**: 此问题由 2026-07-09 的超时策略重构彻底解决。不再使用 per-call LLM 硬超时。

**旧问题**: `POST /api/prompt` 使用 `await` 等待 LLM，无超时控制，HTTP 连接无响应。

**新策略**:
| 层 | 机制 | 触发条件 |
|----|------|---------|
| 后端 per-call LLM | **无超时** | 所有 LLM 调用无限等待 `llm.response` |
| 请求级安全网 | 600s Promise.race | 600s 后 res.json 被拦截，返回 504 |
| Express 默认 | `req.setTimeout(0)` | 已禁用 |
| 前端 SSE 空闲 | 30s 无 SSE delta | 清除流式状态 (chat.ts resetStreamTimeout) |
| 前端 SSE 完成 | chat.text done:true | 清除计时器 (chat.ts clearStreamTimeout) |

**核心原则**: LLM 处理时间不可预测（2s–200s），硬超时要么误杀合法请求，要么形同虚设。正确的超时在前端 — 只有前端能判断

---

### Bug #003 — 静态文件 SPA fallback 覆盖 API 404

**症状**: 生产模式下访问不存在的 API 端点（如 `/api/typo`），本应返回 404 JSON，却返回了 `index.html` 内容。前端 JSON 解析失败导致静默错误。

**根因**: `StudioServer.ts` — SPA fallback `/* → index.html` 优先级高于 API 路由的 404 处理。

**复现条件**: 生产模式下 `curl http://localhost:8080/api/nonexistent`。

**修复方案**: SPA fallback 仅对非 `/api/*` 路径生效：
```typescript
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});
```

**回归测试**: 生产模式下访问 `/api/nonexistent` 验证返回 JSON 404 而非 HTML。

---

> **铁律**: 修改 `StudioServer.ts` 或 `index.ts` 前，必须阅读本文档。修改完成后，必须同步更新本文档的 API 契约。

---

## v10 集成层

### V10Integration

`packages/studio/server/V10Integration.ts` — v10 模块统一启用入口。

**初始化顺序**（有依赖关系的模块按序初始化）：
```
1. EventMesh（底层事件基础设施）
2. SimulationEngine + ExecutionPredictor
3. BehaviorVerificationEngine + RegressionStore
4. LearningPlane（门面）
5. FederationManager
```

**生命周期方法**：
- `V10Integration.start(deps)` — 初始化所有模块，创建适配器，注册路由
- `V10Integration.stop()` — 停止所有模块

### V10MissionAdapter

`packages/studio/server/V10MissionAdapter.ts` — 通过 EventBus 事件驱动，将 v10 功能注入 MissionRuntime 生命周期。

**监听事件**：
| 事件 | 触发行为 |
|------|----------|
| `PLAN_CREATED` | → SimulationEngine.simulate() |
| `EXECUTION_COMPLETED` | → BehaviorVerificationEngine.verify() |
| `MISSION_COMPLETED` | → LearningPlane.record() |
| `MISSION_FAILED` | → LearningPlane.record()（记录失败经验） |

### V10API

`packages/studio/server/V10API.ts` — 24 个 REST 端点，覆盖所有 v10 模块。

**依赖注入模式**：
```typescript
interface V10Dependencies {
  simulationEngine?: SimulationEngine
  behaviorVerificationEngine?: BehaviorVerificationEngine
  eventMesh?: EventMesh
  learningPlane?: LearningPlane
  federationManager?: FederationManager
}

function registerV10Routes(app: ExpressRouter, deps: V10Dependencies): void
```

所有模块为可选注入，缺失时端点返回 501 Not Implemented。

### v10 事件发射

| 事件 | 来源 |
|------|------|
| `simulation.started` / `simulation.completed` / `simulation.failed` | SimulationEngine |
| `verification.behavior.started` / `verification.behavior.completed` / `verification.behavior.failed` | BehaviorVerificationEngine |
| `quality.generated` | BehaviorVerificationEngine（评分后） |
| `federation.identity.registered` | NodeIdentity |
| `federation.execution.sent` / `federation.execution.completed` / `federation.execution.failed` | RemoteExecutor |
| `federation.discovery.started` / `federation.discovery.completed` | CapabilityDiscovery |
| `federation.manager.started` / `federation.manager.stopped` | FederationManager |
| `learning.updated` | LearningPlane |
| `v10.integration.started` | V10Integration |
