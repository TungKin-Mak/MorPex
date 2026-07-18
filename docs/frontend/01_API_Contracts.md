# 01 — 接口契约（API Contracts）

> **用途**: AI 生成前端页面的"数据地基"  
> **版本**: 3.1.0 | **最后更新**: 2026-07-12  
> **后端文档源**: `docs/modules/studio-server.md`、`docs/features-and-architecture.md`

---

## 目录

- [一、通用规范](#一通用规范)
  - [Base URL](#base-url)
  - [统一事件格式（SSE）](#统一事件格式sse)
  - [请求头](#请求头)
  - [错误码速查](#错误码速查)
  - [超时策略](#超时策略)
- [二、接口列表](#二接口列表)
  - [2.1 系统状态](#21-系统状态)
  - [2.2 Chat 对话](#22-chat-对话)
  - [2.3 Session 会话管理](#23-session-会话管理)
  - [2.4 历史记录](#24-历史记录)
  - [2.5 记忆系统](#25-记忆系统)
  - [2.6 知识图谱](#26-知识图谱)
  - [2.7 产物查询](#27-产物查询)
  - [2.8 领域管理](#28-领域管理)
  - [2.9 可观测性](#29-可观测性)
  - [2.10 Agent 编排](#210-agent-编排)
  - [2.11 配置管理](#211-配置管理)
  - [2.12 辅助 / 兼容](#212-辅助--兼容)
- [三、SSE 事件参考](#三sse-事件参考)
- [四、错误码详细说明](#四错误码详细说明)

---

## 一、通用规范

### Base URL

| 环境 | URL |
|------|-----|
| 开发 | `http://localhost:8080` |
| 生产 | `https://<host>:8080` |

### 统一事件格式（SSE）

所有 SSE 事件向后端原始 `MorPexEvent` 格式：

```json
{
  "id": "evt_20260710_a81f92cd",
  "type": "runtime.agent.message_update",
  "timestamp": 1700000000000,
  "executionId": "exe_xxx",
  "source": "studio",
  "payload": { ... }
}
```

> ⚠️ **前端取数规则**: 统一使用 `event.payload ?? event` 取值。兼容 broadcastToSSE 直通和 EventBus 全局流两种路径。

### 请求头

| Header | 值 | 说明 |
|--------|-----|------|
| `Content-Type` | `application/json` | POST/PUT 请求必填 |
| `Accept` | `application/json` | 推荐 |

> 注：当前版本**无身份认证**（401/403 为预留）。

### 错误码速查

| HTTP 状态码 | 含义 | 触发条件 |
|-------------|------|----------|
| **200** | 成功 | 正常返回，始终返回 `{ ok: true }` |
| **400** | 请求参数错误 | `content`/`message`/`input` 缺失或为空 |
| **404** | 资源不存在 | 会话 ID 不存在（DELETE/GET） |
| **429** | 请求频率限制 | ❌ 未实现（预留） |
| **500** | 服务器内部错误 | 引擎未就绪或异常 |
| **503** | 服务不可用 | AgentService / LLM 提供商不可用 |
| **504** | 请求超时 | 请求处理超过 600s 安全网 |

### 超时策略

| 层 | 机制 | 触发条件 |
|----|------|----------|
| 后端 per-call LLM | **无超时** | LLM 调用无限等待（0.5s–200s 皆正常） |
| 请求级安全网 | 600s `Promise.race` | 超时返回 `504` |
| **前端 SSE 空闲检测** | **30s** 无 SSE delta | 清除流式状态（前端自行实现） |
| Express 默认 | `req.setTimeout(0)` | 已禁用 |

> **核心原则**: LLM 处理时间不可预测，硬超时要么误杀合法请求，要么形同虚设。**正确的超时在前端**。

---

## 二、接口列表

### 2.1 系统状态

#### `GET /api/status`

> 内核状态概览（TopBar 主数据源）

**请求参数**: 无

**响应**:
```json
{
  "ok": true,
  "version": "2.0.0",
  "phase": "running",
  "uptime": 12345,
  "pluginCount": 14,
  "activeExecutions": 2,
  "ai_engine": true,
  "ai_engine_backend": "morpex-core",
  "memory_available": true,
  "timestamp": 1700000000000
}
```

| 字段 | 类型 | 说明 | 前端用途 |
|------|------|------|----------|
| `phase` | string | 内核阶段: `starting` / `running` / `stopping` | TopBar PHASE 指示器 |
| `uptime` | number | 运行时长（秒） | 格式化 "2h 15m" |
| `pluginCount` | number | 已加载插件数 | 统计卡片 |
| `activeExecutions` | number | 当前活跃执行数 | 统计卡片 |
| `ai_engine` | boolean | AI 引擎就绪状态 | 绿色/红色指示灯 |

**错误**: 始终返回 200

---

#### `GET /api/health`

> 健康检查（心跳探测）

**请求参数**: 无

**响应**:
```json
{
  "ok": true,
  "uptime": 12345
}
```

---

#### `GET /api/engine/check`

> 引擎诊断（调试用）

**请求参数**: 无

**响应**:
```json
{
  "kernel": "running",
  "mirror": {
    "eventCount": 15000,
    "storagePath": "./data/mirror"
  },
  "gateway": {
    "adapters": ["pi"]
  },
  "eventTypes": ["fsm.transition", "dag.built", "llm.response", "..."]
}
```

---

#### `GET /api/ai/status`

> AI 引擎状态

**请求参数**: 无

**响应**:
```json
{
  "ok": true,
  "running": true,
  "backend": "morpex-core",
  "initialized": true,
  "engine_info": {
    "model_id": "deepseek-v4-flash",
    "model_name": "DeepSeek V4 Flash",
    "provider": "deepseek",
    "running": true,
    "thinking_level": "medium",
    "message_count": 0
  }
}
```

---

### 2.2 Chat 对话

#### `POST /api/chat/message` ⭐ **推荐（统一入口）**

> **最常用的前端入口**。所有聊天输入无脑推送此端点，后端自动完成领域识别、澄清判定、执行路由。

**请求体**:
```json
{
  "content": "帮我设计一款智能农业监控硬件并写商业计划书",
  "session_id": "sess_xxx"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `content` | string | ✅ | 用户输入文本 |
| `session_id` | string | ❌ | 会话 ID（留空自动生成） |

**响应 — 单领域执行**:
```json
{
  "ok": true,
  "executionId": "exe_xxx",
  "dag": {
    "nodes": [
      {
        "taskId": "task_0",
        "domain": "software_engineering",
        "goal": "设计监控硬件",
        "deps": []
      }
    ],
    "isMultiDomain": false,
    "involvedDomains": ["software_engineering"],
    "globalIntent": "设计智能农业监控硬件",
    "reasoning": "单一领域任务，直接执行"
  },
  "result": { "output": "...执行结果..." }
}
```

**响应 — 多领域 DAG**:
```json
{
  "ok": true,
  "executionId": "exe_xxx",
  "dag": {
    "nodes": [
      { "taskId": "task_0", "domain": "hardware_engineering", "goal": "设计MIPI屏幕驱动", "deps": [] },
      { "taskId": "task_1", "domain": "business_finance", "goal": "撰写商业推广计划书", "deps": ["task_0"] }
    ],
    "isMultiDomain": true,
    "involvedDomains": ["hardware_engineering", "business_finance"],
    "globalIntent": "设计硬件并核对预算"
  },
  "result": { ... }
}
```

**错误**:
| 状态码 | 条件 |
|--------|------|
| 400 | `content` 缺失 |
| 500 | 引擎内部错误 |

> ⚠️ 此端点通过 SSE 实时推送事件（`cross_domain.dag_created`、`runtime.*`），前端需同时监听 SSE。

---

#### `POST /api/chat/send` ⭐（旧路径，向后兼容）

> 控制平面驱动。根据意图置信度返回不同结果类型。

**请求体**:
```json
{
  "message": "帮我做一个CLI工具",
  "session_id": "sess_xxx",
  "clarification_answers": { "q1": "Node.js" }
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | string | ✅ | 用户消息 |
| `session_id` | string | ❌ | 会话 ID |
| `clarification_answers` | object | ❌ | 澄清对话的答案 |

**响应类型一 — 低置信度拒绝 (confidence < 0.6)**:
```json
{
  "ok": true,
  "type": "rejected",
  "output": "抱歉，我无法完全理解您的需求...",
  "intent": {
    "type": "ambiguous",
    "domain": "general",
    "confidence": 0.45
  }
}
```

**响应类型二 — 中置信度澄清 (0.6 ≤ confidence < 0.85)**:
```json
{
  "ok": true,
  "type": "clarification",
  "sessionId": "sess_xxx",
  "questions": [
    { "id": "q1", "question": "您想用什么编程语言？", "type": "choice", "options": ["Node.js", "Python"] },
    { "id": "q2", "question": "主要实现什么功能？", "type": "open" }
  ],
  "intent": {
    "type": "ambiguous",
    "domain": "software",
    "confidence": 0.72
  }
}
```

**响应类型三 — 直接对话 (chat/query 类型)**:
```json
{
  "ok": true,
  "type": "direct_chat",
  "output": "你好！有什么我可以帮你的吗？",
  "executionId": "exe_xxx",
  "intent": {
    "type": "chat",
    "domain": "general",
    "confidence": 0.95
  }
}
```

**响应类型四 — 高置信度执行 (confidence ≥ 0.85, 最核心)**:
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
    { "name": "需求规格文档", "type": "document", "path": "projects/exe_xxx/..." }
  ],
  "intent": {
    "type": "directive",
    "domain": "software",
    "confidence": 0.95,
    "goal": "创建CLI工具"
  }
}
```

**响应类型五 — 降级模式**:
```json
{
  "ok": true,
  "output": "直接LLM响应文本",
  "fallback": true
}
```

---

#### `POST /api/chat/agent-send` ⭐（AgentHarness 驱动，推荐）

> Agent 原生对话通道，SSE 流式输出。

**请求体**:
```json
{
  "message": "写一个排序算法",
  "zone": "coder",
  "sessionId": "sess_xxx",
  "tools": []
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | string | ✅ | 消息内容 |
| `zone` | string | ❌ | Agent 隔离区: `chat` / `coder` / `research`（默认 `chat`） |
| `sessionId` | string | ❌ | 会话 ID |
| `tools` | AgentTool[] | ❌ | 自定义工具集（默认使用内置 4 工具） |

**HTTP 响应**（同步返回最终文本）:
```json
{
  "ok": true,
  "type": "agent_response",
  "text": "Agent 完整响应",
  "zone": "coder",
  "events": []
}
```

| 状态码 | 条件 |
|--------|------|
| 400 | `message` 缺失 |
| 503 | AgentService 不可用 |

> ⚠️ **此端点的真正响应在 SSE 中**：`runtime.agent.message_update`（流式 delta）、`runtime.agent.tool_execution_*`（工具调用）、`runtime.agent.turn_start/end`（回合标记）。前端应同时监听 SSE 获取实时流式输出。

---

#### `GET /api/chat/agent-status`

> AgentService 状态查询

**请求参数**: 无

**响应**:
```json
{
  "ok": true,
  "activeZones": ["chat", "coder"],
  "env": { "cwd": "/project" },
  "model": "deepseek-v4-flash"
}
```

---

### 2.3 Session 会话管理

#### `GET /api/sessions`

> 列出全部会话（列表页）

**请求参数**: 无

**响应**（列表页）:
```json
{
  "sessions": [
    {
      "id": "sess_abc",
      "createdAt": 1700000000000,
      "cwd": "./data/workspace/projects",
      "path": "./data/sessions/sess_abc.jsonl",
      "parentSessionPath": null,
      "name": "设计爬虫项目",
      "messageCount": 50
    }
  ],
  "total": 1
}
```

| 字段 | 类型 | 说明 | 前端显示 |
|------|------|------|----------|
| `id` | string | 会话 ID | 列表第一列（加粗） |
| `name` | string | 会话摘要名 | 列表第二列 |
| `createdAt` | number | 创建时间戳 | 格式化日期 |
| `messageCount` | number | 消息数 | 徽标数字 |
| `cwd` | string | 工作目录 | 缩略显示 |

---

#### `POST /api/sessions`

> 创建新会话

**请求体**:
```json
{
  "cwd": "./data/workspace/projects"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `cwd` | string | ❌ | 工作目录（默认 `./data/workspace/projects`） |

**响应**:
```json
{
  "session": {
    "id": "sess_new123",
    "createdAt": 1700000000000,
    "cwd": "./data/workspace/projects",
    "path": "./data/sessions/sess_new123.jsonl"
  }
}
```

---

#### `GET /api/sessions/:id/messages`

> 获取指定会话的消息历史（详情页）

**请求参数**: URL 参数 `:id` — 会话 ID

**响应**（详情页）:
```json
{
  "session_id": "sess_abc",
  "messages": [
    {
      "role": "user",
      "content": "帮我写一个爬虫",
      "timestamp": 1700000000000
    },
    {
      "role": "assistant",
      "content": "## 爬虫设计方案...",
      "timestamp": 1700000000001
    }
  ]
}
```

> ⚠️ **列表 vs 详情页差异**:
> - `GET /api/sessions`（列表页）: 只返回 `id`、`name`、`createdAt`、`messageCount` 等摘要字段
> - `GET /api/sessions/:id/messages`（详情页）: 返回完整 `messages[]` 消息历史

---

#### `DELETE /api/sessions/:id`

> 删除会话

**请求参数**: URL 参数 `:id` — 会话 ID

**响应**:
```json
{
  "ok": true
}
```

| 状态码 | 条件 |
|--------|------|
| 404 | 会话不存在 |
| 500 | 删除失败 |

---

### 2.4 历史记录

#### `GET /api/history`

> **统一历史查询**（聚合 4 路存储的统计概览 — 列表页）

**请求参数**: 无

**响应**（列表页）:
```json
{
  "ok": true,
  "stats": {
    "totalCycles": 12,
    "totalTasks": 48,
    "mirror_events": 245,
    "mirror_executions": 12,
    "memory_index": 89,
    "memory_archive": 34,
    "kg_entities": 156,
    "kg_relations": 312
  },
  "cycles": [
    { "id": "cycle_001", "goal": "...", "status": "completed", "createdAt": 1700000000000 }
  ],
  "tasks": [],
  "executions": []
}
```

**列表字段差异**: 只返回统计 `stats` + 简要 `cycles[]` / `tasks[]` / `executions[]`，**不含完整日志**。

---

#### `GET /api/history/:executionId`

> **按 executionId 聚合查询 4 路存储**（详情页）

**请求参数**: URL 参数 `:executionId` — 执行流水号

**响应**（详情页 — 完整数据）:
```json
{
  "ok": true,
  "executionId": "exe_xxx",
  "history": {
    "id": "cycle_001",
    "goal": "创建CLI工具",
    "status": "completed",
    "tasks": [...]
  },
  "mirror": [
    { "id": "evt_001", "type": "fsm.transition", "timestamp": 1700000000000, "payload": { "from": "IDLE", "to": "PLANNING" } },
    { "id": "evt_002", "type": "runtime.task.started", "payload": { "taskId": "task_0" } }
  ],
  "memory": [
    { "id": "mem_001", "content": "EventBus 是唯一通信通道...", "score": 0.95 }
  ],
  "artifacts": [
    { "id": "art_001", "name": "设计文档.md", "type": "document", "version": 1 }
  ]
}
```

> ⚠️ **列表 vs 详情页差异**:
> - `GET /api/history`（列表页）: 统计 + 简要列表，**无 `mirror[]`、无 `memory[]`**
> - `GET /api/history/:executionId`（详情页）: **有 `mirror[]`（实时日志）、`memory[]`（关联记忆）、`artifacts[]`（产物）**

---

### 2.5 记忆系统

#### `GET /api/memory/stats`

> 记忆系统统计

**请求参数**: 无

**响应**:
```json
{
  "ok": true,
  "stats": {
    "provenance": {
      "totalIndexed": 500,
      "mainPoolCount": 300,
      "archiveCount": 150,
      "correctionCount": 50
    },
    "gate": {
      "total": 1000,
      "rejected": 120,
      "rejectRate": "12.0%"
    },
    "v2": {
      "tempPoolSize": 40,
      "stageDefs": 3,
      "currentStage": "stage_1"
    }
  }
}
```

---

#### `GET /api/memory/search?q=<关键词>&limit=<数量>`

> 记忆搜索（向量+关键词）

**请求参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `q` | string | ✅ | 搜索关键词 |
| `limit` | number | ❌ | 返回条数（默认 10） |

**响应**:
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

#### `GET /api/memory-bus/stats`

> MemoryBus v2 统计（三维一体）

**请求参数**: 无

**响应**:
```json
{
  "ok": true,
  "stats": {
    "index": 500,
    "archive": 150,
    "correction": 50,
    "gate": {
      "total": 1000,
      "rejected": 120,
      "rejectRate": "12.0%"
    }
  }
}
```

---

#### `GET /api/memory-bus/recall`

> 记忆召回（hybrid-rag）

**请求参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `text` | string | ✅ | 召回文本 |
| `topK` | number | ❌ | 返回条数 |
| `strategy` | string | ❌ | `hybrid-rag`(默认) / `vector` / `keyword` |
| `includeArchive` | boolean | ❌ | 是否包含归档 |

**响应**:
```json
{
  "items": [
    { "id": "mem_001", "content": "...", "score": 0.92 }
  ]
}
```

---

### 2.6 知识图谱

#### `GET /api/knowledge-graph/data`

> 全量图谱数据（3D 可视化用）

**请求参数**: 无

**响应**:
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

#### `GET /api/knowledge/search?q=<关键词>&type=<类型>`

> 知识搜索

**请求参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `q` | string | ✅ | 搜索关键词 |
| `type` | string | ❌ | 类型过滤 |

---

### 2.7 产物查询

#### `GET /api/artifacts?executionId=<ID>`

> 产物查询

**请求参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `executionId` | string | ❌ | 按 executionId 筛选（不传则返回全部） |

**响应**:
```json
{
  "ok": true,
  "projects": [
    {
      "id": "exe_xxx",
      "files": [
        { "name": "设计文档.md", "path": "projects/exe_xxx/设计文档.md" },
        { "name": "main.js", "path": "projects/exe_xxx/main.js" }
      ]
    }
  ]
}
```

---

### 2.8 领域管理

#### `GET /api/domains`

> 列出全部已注册领域

**请求参数**: 无

**响应**:
```json
{
  "ok": true,
  "domains": [
    {
      "domain_id": "software_engineering",
      "domain_name": "软件工程",
      "version": "1.0.0",
      "skills": ["coding", "architecture"],
      "status": "active"
    },
    {
      "domain_id": "business_finance",
      "domain_name": "商业金融",
      "version": "1.0.0",
      "skills": ["analysis"],
      "status": "sleeping"
    }
  ]
}
```

| 字段 | 说明 | 前端显示 |
|------|------|----------|
| `domain_id` | 领域标识 | 列表 ID |
| `domain_name` | 领域名称 | 列表显示名 |
| `status` | 活跃/休眠 | 状态指示灯 |

---

#### `GET /api/domains/:domainId/status`

> 查询指定领域的详细状态

**请求参数**: URL 参数 `:domainId`

**响应**:
```json
{
  "ok": true,
  "domain_id": "software_engineering",
  "manifest": { ... },
  "status": "active",
  "runtime": {
    "executions": 10,
    "activeTasks": 2
  }
}
```

---

### 2.9 可观测性

#### `GET /api/observability/workers`

> Worker 状态

**请求参数**: 无

**响应**:
```json
[
  { "id": "worker_001", "role": "researcher", "state": "idle", "specialty": "research" }
]
```

---

#### `GET /api/observability/traces`

> Mirror 追踪数据

**请求参数**: 无

**响应**:
```json
{
  "traces": [
    { "executionId": "exe_001", "events": 42, "startedAt": 1700000000000 }
  ]
}
```

---

#### `GET /api/observability/metrics`

> 可观测性指标

**请求参数**: 无

---

### 2.10 Agent 编排

#### `GET /api/orchestrator/status`

> Orchestrator 状态

---

#### `GET /api/orchestrator/agents`

> 全部 Agent 列表

**响应**:
```json
{
  "ok": true,
  "agents": [
    { "id": "agent_001", "role": "CEO-AI", "status": "idle" },
    { "id": "agent_002", "role": "PM-AI", "status": "idle" }
  ]
}
```

---

#### `GET /api/agents`

> 全部 Agent 详情

---

### 2.11 配置管理

#### `GET /api/config`

> 读取配置

**响应**:
```json
{
  "ok": true,
  "version": "2.0.0",
  "engine_type": "morpex-core",
  "thinking_level": "medium",
  "model": "deepseek-v4-flash"
}
```

---

#### `PUT /api/config`

> 更新配置

**请求体**:
```json
{
  "thinking_level": "high",
  "model": "deepseek-v4-flash"
}
```

---

### 2.12 辅助 / 兼容

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/ai/abort` | 中止全部执行 |
| POST | `/api/prompt` | 快速 LLM 对话（旧版，已废弃） |
| POST | `/api/execute` | 直接调用 Execution Gateway 执行 |
| POST | `/api/cycle/run` | 周期执行（CEO→PM→Worker 团队） |
| GET | `/api/departments` | 部门 + Agent 结构 |
| GET | `/api/business-units` | 业务单元结构 |
| GET | `/api/v6/startup-state` | 兼容旧版 StartupState |

---

## 三、SSE 事件参考

### SSE 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/stream/global` | **全局 SSE 流** — EventBus 所有事件实时推送，15s 心跳 |
| GET | `/api/stream/execution/:executionId` | 按 executionId 过滤的 SSE 流 |

> SSE 断开时前端自动重连（`api.ts:connectSSE()` 处理）。重连时不回放历史事件。

### 全部 SSE 事件类型及前端处理

| 事件类型 | 来源 | 前端处理 |
|----------|------|----------|
| `runtime.agent.message_update` | AgentHarness → PiAdapter | **流式追加**对话气泡（delta 模式） |
| `runtime.agent.message_end` | AgentHarness → PiAdapter | 消息完成 ✅ |
| `runtime.agent.tool_execution_start` | AgentHarness → PiAdapter | 工具状态卡片 🛠️ |
| `runtime.agent.tool_execution_end` | AgentHarness → PiAdapter | 工具完成 ✅ |
| `runtime.agent.turn_start` | AgentHarness → PiAdapter | 回合开始标记 |
| `runtime.agent.turn_end` | AgentHarness → PiAdapter | 回合结束 |
| `runtime.fsm.transition` | FSMEngine → EventBus | **FSM 状态更新**（点阵指示器更新） |
| `dag.built` | DAGEngine → EventBus | DAG 拓扑创建 |
| `dag.node.completed` | DAGEngine → EventBus | DAG 节点完成 |
| `dag.deadlock_detected` | DAGEngine → EventBus | 死锁告警 |
| `runtime.execution.started` | StudioServer → EventBus | 执行计数 +1 |
| `runtime.execution.completed` | StudioServer → EventBus | 执行计数 -1 |
| `cross_domain.dag_created` | CrossDomainRouter | 跨领域 DAG 可视化 |
| `domain.waking` | DomainClusterManager | 领域唤醒动画 |
| `domain.active` | DomainClusterManager | 领域激活指示 |
| `domain.sleeping` | DomainClusterManager | 领域休眠指示 |
| `domain.task_completed` | DomainDispatcher | 领域任务完成 |
| `artifact.created` | ArtifactRegistry | 产物新增提示 |
| `artifact.updated` | ArtifactRegistry | 产物更新 |
| `negotiation.ticket_created` | NegotiationEngine | 质询工单 → 弹出**确认/取消**弹窗 |
| `negotiation.ticket_resolved` | NegotiationEngine | 质询解决关闭 |
| `negotiation.escalated` | NegotiationEngine | 质询升级 → 人类仲裁 |
| `intent.resolved` | IntentResolver | 意图识别结果 |
| `plan.generated` | WorkflowPlanner | 规划完成 |
| `llm.request` | LLM provider | LLM 调用开始 |
| `llm.response` | LLM provider | LLM 响应 |
| `memory.*` | MemoryBus v2 | 记忆系统事件 |
| `kernel.started` | Kernel | 内核启动 |

> ⚠️ **所有 SSE 事件统一规则**: 前端通过 `event.payload ?? event` 取数据。`payload` 存在则取 `payload`，不存在则直接用 `event` 对象本身。

---

## 四、错误码详细说明

### HTTP 状态码

| 状态码 | 含义 | 触发条件（详细） |
|--------|------|-----------------|
| **200** | 成功 | 正常返回。即使业务逻辑错误（如意图拒绝），只要请求处理完成即返回 200 + `{ ok: true }` |
| **400** | 请求参数错误 | `content` 缺失 → `POST /api/chat/message`；`message` 缺失 → `POST /api/prompt`；`input` 缺失 → `POST /api/execute` |
| **404** | 资源不存在 | 会话 ID 不存在 → `GET /api/sessions/:id/messages`、`DELETE /api/sessions/:id` |
| **429** | 频率限制 | ❌ 未实现（预留） |
| **500** | 内部错误 | 引擎未初始化 / 组件注册失败 / 未知异常 |
| **503** | 服务不可用 | AgentService 未初始化 → `POST /api/chat/agent-send`；所有 LLM 提供商不可用 → `POST /api/prompt` |
| **504** | 请求超时 | 整个请求处理超过 **600s** 安全网 |

### 业务错误码（内嵌在 response body 中）

> 业务错误不走 HTTP 状态码，统一返回 `200` + `{ ok: false, error: "..." }`

| error 消息 | 含义 | 前端处理 |
|------------|------|----------|
| `缺少 content` | 请求体未传 `content` | 显示"请输入内容" |
| `缺少 message` | `POST /api/prompt` 未传 `message` | 禁用发送按钮 |
| `缺少 input` | `POST /api/execute` 未传 `input` | 显示参数错误 |
| `Orchestrator 未初始化` | 编排器未就绪 | 显示"系统初始化中，请稍候" |
| `AgentService 不可用` | Agent Harness 未创建 | 显示"AI 引擎未就绪" |
| `会话不存在` | sessionId 无效 | 提示"会话已过期，请刷新" |

### 意图级别错误（内嵌在 `/api/chat/send` 响应中）

| type | 含义 | 前端处理 |
|------|------|----------|
| `rejected` | 置信度 < 0.6，无法理解 | 展示 `output` 字段的拒绝文案 |
| `clarification` | 置信度 0.6~0.85，需追问 | 渲染 `questions[]` 表单 |
| `fallback` | 控制平面降级 | 直接展示 `output`（纯 LLM 响应） |

### 最佳实践总结

```typescript
// 前端通用错误处理模式
try {
  const resp = await fetch('/api/chat/message', { ... });
  if (!resp.ok) {
    // HTTP 错误
    switch (resp.status) {
      case 400: showToast('参数错误'); break;
      case 503: showToast('服务暂不可用，请稍后重试'); break;
      case 504: showToast('请求超时，请重试'); break;
      default: showToast('系统错误');
    }
    return;
  }
  const data = await resp.json();
  if (!data.ok) {
    // 业务错误
    showToast(data.error || '操作失败');
    return;
  }
  // 成功处理
  handleSuccess(data);
} catch (err) {
  // 网络错误
  showToast('网络异常，请检查连接');
}
```
