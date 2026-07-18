# 04 — 数据字典（Data Dictionary）

> **用途**: 把后端返回的英文字段翻译成中文业务含义，附前端显示建议
> **版本**: 3.1.0 | **最后更新**: 2026-07-12
> **目标读者**: AI 生成前端页面时参考，避免"黑话"误解

---

## 目录

- [一、SSE 事件字段](#一sse-事件字段)
- [二、系统状态字段](#二系统状态字段)
- [三、FSM 状态枚举](#三fsm-状态枚举)
- [四、会话管理字段](#四会话管理字段)
- [五、历史/执行记录字段](#五历史执行记录字段)
- [六、DAG 节点字段](#六dag-节点字段)
- [七、MemoryBus 字段](#七memorybus-字段)
- [八、意图结果字段](#八意图结果字段)
- [九、产物字段](#九产物字段)
- [十、领域信息字段](#十领域信息字段)
- [十一、Agent 字段](#十一agent-字段)
- [十二、API 响应通用字段](#十二api-响应通用字段)
- [十三、业务术语速查](#十三业务术语速查)

---

## 一、SSE 事件字段

> 所有 SSE 事件遵循统一 `MorPexEvent` 格式

### `MorPexEvent` 结构

```typescript
interface MorPexEvent {
  id: string;
  type: string;
  timestamp: number;
  executionId: string;
  source: string;
  payload: any;
}
```

### 字段释义

| 后端字段 | 中文含义 | 前端显示建议 |
|----------|----------|-------------|
| `id` | 事件唯一 ID（格式: `evt_{时间戳}_{随机4位hex}`） | ⚙️ 不显示，仅调试用 |
| `type` | 事件类型（格式: `{域}.{动作}`，如 `runtime.fsm.transition`） | 🧩 用于前端路由到对应处理器，**不直接显示** |
| `timestamp` | 事件发生时间戳（Unix 毫秒） | 🕐 格式化显示为 `HH:mm:ss`，日志列表排序用 |
| `executionId` | 执行流水号（格式: `exe_{时间戳}`） | 🔗 **全链路追踪 ID**，列表页第一列，加粗显示 |
| `source` | 事件来源模块（如 `studio`、`gateway`、`fsm`） | ⚙️ 调试信息，仅开发者可见 |
| `payload` | 事件载荷（核心数据，结构因 `type` 不同而异） | 📦 **核心数据**，前端取数规则: `event.payload ?? event` |

### 常见 `type` 值及 `payload` 内容

| `type` 值 | `payload` 包含 | 前端用途 |
|-----------|----------------|----------|
| `runtime.agent.message_update` | `{ delta: "你好", sessionId: "sess_xxx" }` | 流式追加对话气泡（delta 模式） |
| `runtime.agent.message_end` | `{ sessionId: "sess_xxx" }` | 消息完成标记 |
| `runtime.agent.tool_execution_start` | `{ toolName: "read_file", args: {...} }` | 显示"正在使用工具..." |
| `runtime.agent.tool_execution_end` | `{ toolName: "read_file", result: "..." }` | 工具完成 ✅ |
| `runtime.fsm.transition` | `{ from: "IDLE", to: "PLANNING", taskId: "..." }` | **更新 FSM 状态点阵** |
| `dag.created` | `{ nodes: [...], edges: [...] }` | 渲染 DAG 拓扑 |
| `dag.node.completed` | `{ taskId: "task_0", status: "success" }` | 更新 DAG 卡片状态 |
| `artifact.created` | `{ name: "设计文档.md", type: "document" }` | 新增产物到文件树 |
| `artifact.updated` | `{ name: "设计文档.md", version: 2 }` | 更新产物版本 |
| `cross_domain.dag_created` | `{ dag: { nodes: [...], edges: [...] }, analysis: {...} }` | 渲染跨领域 DAG |
| `negotiation.ticket_created` | `{ ticketId: "...", issue: "...", options: [...] }` | **触发 InterrogationMatrix 弹窗** |
| `negotiation.ticket_resolved` | `{ ticketId: "...", resolution: "accepted" }` | 关闭弹窗 |
| `domain.waking` | `{ domainId: "software_engineering" }` | 领域唤醒动画 |
| `domain.active` | `{ domainId: "software_engineering" }` | 领域状态变绿 |
| `domain.sleeping` | `{ domainId: "software_engineering" }` | 领域状态变灰 |
| `scheduler.backpressure` | `{ level: 0.75 }` | 更新 VU 表 |

---

## 二、系统状态字段

### `GET /api/status` 响应

| 后端字段 | 中文含义 | 前端显示建议 |
|----------|----------|-------------|
| `ok` | 请求是否成功（`true`/`false`） | ⚙️ 逻辑判断用，不显示 |
| `version` | 系统版本号（如 `2.0.0`） | ℹ️ 底部角落版本号 |
| `phase` | 内核当前阶段（`starting` / `running` / `stopping`） | 🔵 **TopBar PHASE 指示器**，running=白色，stopping=红色 |
| `uptime` | 运行时长（秒） | ⏱ 格式化为 `2h 15m 30s`，显示在 TopBar |
| `pluginCount` | 已加载插件数量（数字） | 📊 统计卡片，如 `插件: 14` |
| `activeExecutions` | 当前活跃执行任务数（数字） | 📊 统计卡片，如 `▶ 2` |
| `ai_engine` | AI 引擎是否就绪（`true`/`false`） | 🟢 绿色指示灯 / 🔴 红色指示灯 |
| `ai_engine_backend` | AI 引擎后端名称（`morpex-core`） | ⚙️ 不显示 |
| `memory_available` | 记忆系统是否可用（`true`/`false`） | 🟢 绿色指示灯 / 🔴 红色指示灯 |
| `timestamp` | 响应时间戳 | ⚙️ 调试用 |

### `GET /api/ai/status` 响应

| 后端字段 | 中文含义 | 前端显示建议 |
|----------|----------|-------------|
| `engine_info.model_id` | 模型 ID（如 `deepseek-v4-flash`） | ℹ️ TopBar 模型名 |
| `engine_info.model_name` | 模型名称（如 `DeepSeek V4 Flash`） | ℹ️ TopBar 显示 |
| `engine_info.provider` | 模型提供商（如 `deepseek`） | ℹ️ 提供商标签 |
| `engine_info.thinking_level` | 推理深度（`low` / `medium` / `high`） | ℹ️ 显示推理级别 |
| `engine_info.message_count` | 消息计数 | 📊 统计 |

---

## 三、FSM 状态枚举

### 任务状态机 10 种状态

| 后端枚举值 | 中文含义 | 前端显示建议 | 颜色 |
|-----------|----------|-------------|------|
| `IDLE` | **空闲** — 任务未开始，等待用户输入 | 灰色圆点 ● | `#666666` |
| `PLANNING` | **规划中** — 正在调用 LLM 生成计划 | 蓝色脉冲圆点 ◉ | `#4488FF` |
| `RUNNING` | **执行中** — Agent 正在执行任务 | 绿色旋转动画 ⟳ | `#00CC88` |
| `WAITING_TOOL` | **等待工具** — 正在调用外部工具（文件读写/代码执行等） | 黄色闪烁圆点 ◉ | `#FFCC00` |
| `WAITING_USER` | **等待用户** — 需要用户输入/确认 | 🟠 **橙色弹窗提示** | `#FF8800` |
| `VERIFYING` | **验证中** — 验证执行结果是否通过 | 紫色圆点 ● | `#8844FF` |
| `COMPLETED` | **已完成** — 任务成功结束 | 绿色常亮圆点 ✅ | `#00CC88` |
| `FAILED` | **失败** — 任务执行出错 | 🔴 **红色圆点 + 显示重试按钮** | `#FF3333` |
| `SUSPENDED` | **已挂起** — 被用户或系统暂停 | 灰色圆点 ⏸️ | `#666666` |
| `CANCELLED` | **已取消** — 被用户中止 | 灰色删除线圆点 ❌ | `#666666` |

### 状态流转触发条件

| 当前状态 | → 下一状态 | 触发条件 |
|----------|-----------|----------|
| IDLE | PLANNING | 用户发送消息 |
| PLANNING | RUNNING | 规划生成完毕 |
| PLANNING | WAITING_USER | 置信度不足，需澄清 |
| RUNNING | WAITING_TOOL | 调用外部工具 |
| WAITING_TOOL | RUNNING | 工具返回结果 |
| WAITING_TOOL | WAITING_USER | 工具需人工确认 |
| RUNNING | WAITING_USER | 遇到歧义，需用户选择 |
| WAITING_USER | RUNNING | 用户提供指令 |
| RUNNING | VERIFYING | 执行完成，进入验证 |
| VERIFYING | COMPLETED | 验证通过 |
| VERIFYING | FAILED | 验证不通过 |
| FAILED | IDLE | 用户放弃 |
| FAILED | PLANNING | **用户点击"重试"** |
| RUNNING | SUSPENDED | 用户挂起 |
| SUSPENDED | RUNNING | 用户恢复 |
| *任何非终态* | CANCELLED | 用户取消 / 紧急中止 |

---

## 四、会话管理字段

### `GET /api/sessions` 响应

| 后端字段 | 中文含义 | 前端显示建议 |
|----------|----------|-------------|
| `id` | 会话 ID（格式: `sess_{随机}`） | **列表第一列，加粗显示**，可点击进入详情 |
| `name` | 会话摘要名（自动生成） | **列表第二列**，默认显示"未命名会话" |
| `createdAt` | 创建时间戳（Unix 毫秒） | 格式化为 `2026-07-12 14:30` |
| `cwd` | 工作目录（如 `./data/workspace/projects`） | ⚙️ 缩略显示，调试用 |
| `path` | 存储文件路径（如 `./data/sessions/sess_abc.jsonl`） | ⚙️ 不显示 |
| `parentSessionPath` | 父会话路径（会话派生时使用） | ⚙️ 不显示 |
| `messageCount` | 消息数量（数字） | 消息数徽标，如 `50` |
| `total` | 总会话数（响应顶层） | 列表顶部统计 |

### `GET /api/sessions/:id/messages` 响应 — 消息字段

| 后端字段 | 中文含义 | 前端显示建议 |
|----------|----------|-------------|
| `session_id` | 会话 ID | 页面标题 |
| `messages[].role` | 消息角色（`user` / `assistant`） | 👤 用户用 `[USR]` 标记 / 🤖 助手用 `[SYS]` 标记 |
| `messages[].content` | 消息内容（文本） | 对话气泡内容 |
| `messages[].timestamp` | 消息时间戳 | 时间戳后缀，如 `14:30:25` |

---

## 五、历史/执行记录字段

### `GET /api/history/:executionId` 响应

| 后端字段 | 中文含义 | 前端显示建议 |
|----------|----------|-------------|
| `executionId` | 执行流水号 | 🔗 **详情页标题**，列表页第一列加粗显示 |
| `history` | HistoryStore 执行记录 | 📋 **基本信息区块** — 显示 goal、status、任务列表 |
| `history.goal` | 执行目标 | 详情页的"目标"标题 |
| `history.status` | 执行状态 | 状态标签（已完成/失败/进行中） |
| `history.tasks` | 任务列表 | 任务步骤列表 |
| `mirror` | **事件镜像列表**（仅详情页有） | 📜 **实时日志区块** — 按时间排列的事件日志 |
| `mirror[].type` | 事件类型 | 日志条目类型标签 |
| `mirror[].payload` | 事件载荷 | 日志详情 |
| `memory` | **关联记忆列表**（仅详情页有） | 🧠 **记忆召回区块** — 相关的历史记忆 |
| `memory[].content` | 记忆内容 | 记忆卡片 |
| `memory[].score` | 相关性评分（0-1） | 进度条显示相关性 |
| `artifacts` | **产物列表**（仅详情页有） | 📁 **产物文件树** — 本次执行产生的所有文件 |
| `artifacts[].name` | 产物名称 | 文件名 |
| `artifacts[].type` | 产物类型 | 文件图标 |
| `artifacts[].version` | 版本号 | `v{n}` 标签 |

### `GET /api/history` 响应 — 列表页字段差异

| 字段 | 列表页 | 详情页 |
|------|--------|--------|
| `stats` | ✅ 有（统计概览） | ❌ 无 |
| `cycles[]` | ✅ 有（简要列表） | ❌ 无（聚合在 history 中） |
| `tasks[]` | ✅ 有（简要列表） | ❌ 无（聚合在 history 中） |
| `executions[]` | ✅ 有（简要列表） | ❌ 无 |
| `mirror[]` | ❌ **无**（列表页不返回日志） | ✅ **有（实时日志区块）** |
| `memory[]` | ❌ **无** | ✅ **有（记忆召回区块）** |
| `artifacts[]` | ❌ **无** | ✅ **有（产物文件树）** |

> ⚠️ **前后端一致**: 列表页只展示摘要，详情页展示完整数据（含 log、memory、artifacts）

---

## 六、DAG 节点字段

### DAGNode 结构

```typescript
interface DAGNode {
  taskId: string;
  domain: string;
  goal: string;
  deps: string[];
  status: 'pending' | 'running' | 'success' | 'failed' | 'rerouting' | 'skipped';
  priority?: number;
  retryCount?: number;
  maxRetries?: number;
  result?: any;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}
```

| 后端字段 | 中文含义 | 前端显示建议 |
|----------|----------|-------------|
| `taskId` | 任务 ID（如 `task_0`） | **DAG 卡片标题**，列表页第一列 |
| `domain` | 所属领域（如 `software_engineering`） | **领域标签**，彩色徽标 |
| `goal` | 任务目标描述（如 "设计MIPI屏幕驱动"） | **卡片副标题**，首行显示 |
| `deps` | 依赖任务列表（如 `["task_0"]`） | **箭头连线**，拓扑图中展示 |
| `status` | 任务状态（见下表） | **4 态边框颜色** + 状态标签 |
| `priority` | 优先级（数字，越大越优先） | ⚙️ 不显示 |
| `retryCount` | 已重试次数 | 仅失败时显示 `重试 2/3` |
| `maxRetries` | 最大重试次数 | 仅失败时显示 |
| `result` | 执行结果（任意类型） | 展开卡片后显示 |
| `error` | 错误信息（字符串） | 🔴 **红色错误文本**，仅 `failed` 时显示 |
| `startedAt` | 开始时间戳 | 时间线显示 |
| `completedAt` | 完成时间戳 | 时间线显示 |

### `status` 枚举值与前端显示

| 枚举值 | 中文含义 | 边框颜色 | 可操作 |
|--------|----------|----------|--------|
| `pending` | 等待中（未开始） | 灰色虚线 `#666666` | — |
| `running` | 执行中 | 白色脉冲（动画） | 可取消 |
| `success` | 已完成 ✅ | 白色实线 `#FFFFFF` | 可点击查看结果 |
| `failed` | 失败 ❌ | **红色实线 `#FF3333`** | **可点击"重试"** |
| `rerouting` | 重新路由中 | 黄色闪烁 `#FFCC00` | — |
| `skipped` | 已跳过 | 灰色删除线 `#666666` | — |

---

## 七、MemoryBus 字段

### `GET /api/memory/stats` 响应

| 后端字段 | 中文含义 | 前端显示建议 |
|----------|----------|-------------|
| `stats.provenance.totalIndexed` | **已索引记忆总数** | 📊 统计卡片，如 `记忆: 500` |
| `stats.provenance.mainPoolCount` | **主池记忆数**（竞争池，最新/高频） | 数字显示，如 `Main: 300` |
| `stats.provenance.archiveCount` | **归档记忆数**（沉淀后的稳定记忆） | 数字显示，如 `Archive: 150` |
| `stats.provenance.correctionCount` | **纠错记忆数**（修正过的记录） | 数字显示，如 `纠错: 50` |
| `stats.gate.total` | **总写入尝试次数**（包含被拒绝的） | 统计用 |
| `stats.gate.rejected` | **被拒绝写入次数**（低质量过滤） | 🔴 红色数字 |
| `stats.gate.rejectRate` | **拒绝率**（百分比字符串，如 `12.0%`） | 百分比显示 |
| `stats.v2.tempPoolSize` | **临时池大小**（会话级临时上下文） | 数字显示，如 `Temp: 40` |
| `stats.v2.stageDefs` | 阶段定义数 | ⚙️ 不显示 |
| `stats.v2.currentStage` | 当前阶段 ID | 阶段指示器，如 `阶段 1/3` |

### `GET /api/memory/search` 响应

| 后端字段 | 中文含义 | 前端显示建议 |
|----------|----------|-------------|
| `results[].id` | 记忆 ID | ⚙️ 不显示 |
| `results[].content` | 记忆内容（文本） | 记忆卡片正文 |
| `results[].score` | 相关性评分（0-1） | **进度条**，颜色随分数变化: ≥0.8 白色, ≥0.5 灰色, <0.5 暗灰 |
| `results[].layer` | 记忆层级（`L1`~`L5`） | 层级标签 |
| `results[].timestamp` | 记忆时间戳 | 格式化时间 |

### MemoryBus v2 三池说明

| 池名称 | 后端字段 | 中文含义 | 特性 |
|--------|----------|----------|------|
| **Main Pool** | `mainPoolCount` | **主池（竞争池）** | 最新/高频记忆，按热度竞争保留 |
| **Archive** | `archiveCount` | **归档池** | 经过沉淀的稳定记忆，长期保存 |
| **Temp Pool** | `tempPoolSize` | **临时池** | 会话级临时上下文，Ctrl+K 可清除 |

---

## 八、意图结果字段

### IntentResult 结构

```typescript
interface IntentResult {
  rawInput: string;
  type: 'directive' | 'query' | 'ambiguous' | 'chat';
  confidence: number;
  domain: string;
  goal: string;
  entities?: Record<string, any>;
}
```

| 后端字段 | 中文含义 | 前端显示建议 |
|----------|----------|-------------|
| `rawInput` | 用户原始输入 | ⚙️ 不显示（就是用户刚说的） |
| `type` | 意图类型 | **意图标签** |
| `confidence` | 置信度（0-1 浮点数） | **进度条**，颜色规则见下表 |
| `domain` | 所属领域（如 `software`、`general`） | 领域标签 |
| `goal` | 提炼后的目标（字符串） | **任务标题**，如 "创建一个Node.js CLI工具" |

### `type` 枚举与前端处理

| type 值 | 中文含义 | 触发操作 | 前端处理 |
|---------|----------|----------|----------|
| `directive` | **指令** — 用户明确要求做某事 | 执行完整的规划→执行流水线 | 显示产物和结果 |
| `query` | **查询** — 用户问问题 | LLM 回答，不执行任务 | 直接展示回答文本 |
| `ambiguous` | **模糊** — 意图不够清晰 | 拒绝或触发澄清流程 | 展示澄清表单 |
| `chat` | **聊天** — 日常对话 | LLM 闲聊回复 | 直接展示回答文本 |

### `confidence` 区间与前端颜色

| 置信度区间 | 含义 | 颜色 | 前端行为 |
|-----------|------|------|----------|
| `< 0.6` | 低置信度（无法理解） | 🔴 **红色** | 显示拒绝文案 |
| `0.6 ~ 0.85` | 中置信度（需澄清） | 🟡 **黄色** | 弹出 ClarifySlots 表单 |
| `≥ 0.85` | 高置信度（直接执行） | 🟢 **白色** | 进入执行流水线 |

---

## 九、产物字段

### ArtifactInstance 结构

```typescript
interface ArtifactInstance {
  id: string;
  name: string;
  type: 'code' | 'document' | 'config' | 'schema' | 'report' | 'plan' | 'structured_data';
  content: any;
  version: number;
  status: 'draft' | 'active' | 'archived';
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  metadata?: Record<string, any>;
}
```

| 后端字段 | 中文含义 | 前端显示建议 |
|----------|----------|-------------|
| `id` | 产物唯一 ID（格式: `art_{时间戳}`） | ⚙️ 不显示 |
| `name` | 产物名称（如 `设计文档.md`） | **文件树节点名** |
| `type` | 产物类型（见下表） | **文件图标** |
| `content` | 产物内容（可以是文本、JSON 等） | **代码审计器 / SlideoverDrawer 预览** |
| `version` | 版本号（数字，从 1 递增） | `v1` `v2` 标签 |
| `status` | 产物状态 | 状态标签 |
| `createdAt` | 创建时间戳 | 时间显示 |
| `updatedAt` | 最后更新时间戳 | 时间显示 |
| `createdBy` | 创建者（如 `task_0`） | 来源标注 |

### `type` 枚举与前端图标

| type 值 | 中文含义 | 建议图标 |
|---------|----------|----------|
| `code` | 代码文件（.js/.ts/.py 等） | 📄 `<Code />` |
| `document` | 文档文件（.md/.txt/.doc） | 📝 `<FileText />` |
| `config` | 配置文件（.json/.yaml/.env） | ⚙️ `<Settings />` |
| `schema` | 数据模式/接口定义 | 📋 `<Clipboard />` |
| `report` | 报告文件 | 📊 `<BarChart />` |
| `plan` | 计划/规划文件 | 📋 `<CheckSquare />` |
| `structured_data` | 结构化数据（JSON/CSV） | 🗃️ `<Database />` |

### `GET /api/artifacts` 响应

| 后端字段 | 中文含义 | 前端显示建议 |
|----------|----------|-------------|
| `projects` | 产物项目列表（按 executionId 分组） | 文件树根节点 |
| `projects[].id` | executionId | 文件夹名，如 `exe_xxx` |
| `projects[].files` | 文件列表 | 文件树子节点 |
| `files[].name` | 文件名 | 文件名，带图标 |
| `files[].path` | 文件路径 | 点击打开用 |

---

## 十、领域信息字段

### `GET /api/domains` 响应

| 后端字段 | 中文含义 | 前端显示建议 |
|----------|----------|-------------|
| `domain_id` | 领域唯一标识（如 `software_engineering`） | 列表 ID，鼠标悬停显示全称 |
| `domain_name` | 领域中文名称（如 `软件工程`） | **列表显示名** |
| `version` | 领域版本号（如 `1.0.0`） | 标签显示 |
| `skills` | 技能列表（如 `["coding", "architecture"]`） | **标签组**，逗号分隔显示 |
| `status` | 领域状态（`active`=活跃 / `sleeping`=休眠 / `error`=错误） | 🟢 绿色=活跃 / ⚪ 灰色=休眠 / 🔴 红色=错误 |

---

## 十一、Agent 字段

### `GET /api/orchestrator/agents` 响应

| 后端字段 | 中文含义 | 前端显示建议 |
|----------|----------|-------------|
| `agents[].id` | Agent ID | 列表 ID |
| `agents[].role` | Agent 角色（`CEO-AI` / `PM-AI` / `researcher` / `planner` / `coder` / `reviewer`） | **角色标签**，不同角色不同颜色 |
| `agents[].status` | Agent 状态（`idle`=空闲 / `running`=执行中 / `error`=错误） | 🟢 状态指示灯 |

### `GET /api/observability/workers` 响应

| 后端字段 | 中文含义 | 前端显示建议 |
|----------|----------|-------------|
| `id` | Worker ID | 列表 ID |
| `role` | Worker 角色 | 角色名 |
| `state` | Worker 状态 | 状态标签 |
| `specialty` | Worker 专长 | 标签显示 |

---

## 十二、API 响应通用字段

| 后端字段 | 中文含义 | 前端显示建议 |
|----------|----------|-------------|
| `ok` | 请求是否成功（`true`=成功 / `false`=失败） | ⚙️ 逻辑判断用，`false` 时读取 `error` 字段显示错误信息 |
| `error` | 错误描述（仅 `ok: false` 时存在） | 🔴 **红色错误提示**，如 "缺少 content" |
| `type` | 响应类型（`clarification` / `rejected` / `direct_chat` / `execution_complete`） | 用于前端路由到不同处理逻辑 |

---

## 十三、业务术语速查

> 以下术语是 MorPex 系统的核心概念，理解它们有助于正确理解后端返回的数据。

| 术语 | 英文 | 中文解释 | 前端注意事项 |
|------|------|----------|-------------|
| **执行流水号** | `executionId` | 一次用户请求的唯一标识，格式 `exe_{时间戳}`。贯穿整个请求生命周期，从意图解析到产物生成。 | **所有 SSE 事件和 API 响应都带此字段**，用于关联不同端点的数据。列表页应作为第一列加粗显示。 |
| **服务端推送事件** | **SSE** | Server-Sent Events，后端主动推数据到前端。前端通过 `EventSource` 连接 `/api/stream/global`。 | **不要轮询！** 所有实时更新通过 SSE 获取。重连时前端自动恢复（无历史回放）。 |
| **事件总线** | `EventBus` | 系统内部唯一通信通道。所有模块间通信通过它广播事件。SSE 就是 EventBus 事件的外溢。 | 无需在前端理解其内部实现。只需知道 SSE 事件的 `type` 前缀对应不同的模块来源。 |
| **有限状态机** | **FSM** | 任务状态流转引擎。定义了 10 种状态（IDLE→PLANNING→RUNNING→...→COMPLETED/FAILED）。 | 前端通过 `runtime.fsm.transition` 事件实时跟踪状态变化。每个状态对应不同的 UI 状态和可操作按钮。 |
| **有向无环图** | **DAG** | 任务依赖关系图。节点=任务，边=依赖关系。跨领域请求会被拆解为 DAG。 | 前端渲染 DAG 时，`deps` 数组决定节点间的箭头连线方向。先执行无依赖节点，再执行有依赖节点。 |
| **三维一体记忆总线** | **MemoryBus** | 记忆系统的核心。包含语义索引（Provenance）、向量存储（Semantic）、知识图谱（Topology）三层。 | 前端只需关心统计数字（总数/三池数量）和搜索功能。记忆内容来自 `GET /api/memory/search`。 |
| **知识图谱** | **KnowledgeGraph** | 实体-关系图。存储领域知识、技术概念、项目实体及其关系。 | 前端 3D 可视化使用 `GET /api/knowledge-graph/data` 返回的 `nodes[]` 和 `edges[]`。 |
| **产物注册表** | `ArtifactRegistry` | 所有执行产物的唯一入口。每个文件（代码、文档、报告）注册为一个 ArtifactInstance，带版本号。 | 前端文件树通过 `GET /api/artifacts` 获取。SSE `artifact.created` 事件实时增量更新。不要直接读文件系统。 |
| **意图解析** | `IntentResolver` | 理解用户输入意图的模块。输出置信度和意图类型。 | 前端需要处理 4 种返回类型（rejected / clarification / direct_chat / execution_complete）。 |
| **规划器** | `WorkflowPlanner` | 将用户意图转为可执行的任务列表和产物蓝图。 | 前端无需直接调用，它由 `/api/chat/send` 端点内部调用。 |
| **跨领域路由** | `CrossDomainRouter` | 处理跨领域复杂请求。LLM 单次调用完成领域识别→DAG 拆解→执行路由。 | `/api/chat/message` 端点使用它。返回 `dag.nodes[]` 供前端渲染。 |
| **领域集群** | `DomainCluster` | 每个领域是一个独立集群，可以唤醒/休眠。含独立 Token 配额和工具白名单。 | 前端在 LeftPane 展示领域列表，通过 SSE `domain.*` 事件更新状态。 |
| **质询工单** | `InterrogationTicket` | 跨领域冲突时的协商机制。状态机: PENDING→ARGUING→ACCEPTED/REJECTED。 | 前端通过 SSE `negotiation.*` 事件触发 InterrogationMatrix 弹窗，用户按 F1/F2 决策。 |
| **产物血缘** | `Lineage` | 产物的上下游依赖关系。DAG 级别的溯源。 | 目前前端不直接展示，未来可用于"查看这个文件是从哪个任务产生的"。 |
| **背压** | `Backpressure` | 调度器的负载压力指标（0-100%）。超过 80% 表示接近瓶颈。 | 前端 RightPane VU 表展示此指标。通过 SSE `scheduler.backpressure` 事件更新。 |
| **写闸门** | `WriteGate` | 记忆系统的质量过滤机制。低分数记忆会被自动拒绝。 | 前端底部面板显示拒绝率百分比。如果拒绝率异常高，说明系统在严格过滤低质量输入。 |
| **四层架构** | — | Control Plane（做什么）→ Multi-Domain（哪些领域）→ Runtime Kernel（怎么执行）→ Knowledge Plane（知道什么） | 前端不直接感知此分层。SSE 事件的 `type` 前缀会暗示来自哪一层（`intent.*`=控制面, `runtime.*`=运行时内核, `memory.*`=知识面）。 |
