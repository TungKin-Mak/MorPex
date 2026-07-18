# 02 — 核心业务流程（Business Flow）

> **用途**: 用 Mermaid 画出用户的操作路径，包含状态流转、轮询、SSE 推送、确认弹窗
> **版本**: 3.1.0 | **最后更新**: 2026-07-12
> **提示**: Obsidian 原生支持 Mermaid，可边画边改

---

## 目录

- [一、任务状态机（FSM）](#一任务状态机fsm)
- [二、主对话流程](#二主对话流程)
- [三、跨领域 DAG 流程](#三跨领域-dag-流程)
- [四、澄清对话流程](#四澄清对话流程)
- [五、人机协作 / 质询仲裁流程](#五人机协作--质询仲裁流程)
- [六、SSE 连接生命周期](#六sse-连接生命周期)
- [七、会话管理流程](#七会话管理流程)
- [八、关键交互机制说明](#八关键交互机制说明)

---

## 一、任务状态机（FSM）

> 所有任务执行都遵循此状态流转。前端通过 **SSE `runtime.fsm.transition`** 事件实时更新状态指示器。

```mermaid
stateDiagram-v2
    [*] --> IDLE : 初始化

    IDLE --> PLANNING : 接收用户请求
    PLANNING --> RUNNING : 规划完成
    PLANNING --> WAITING_USER : 置信度不足\n需澄清

    RUNNING --> WAITING_TOOL : 调用外部工具
    WAITING_TOOL --> RUNNING : 工具返回结果
    WAITING_TOOL --> WAITING_USER : 工具需要人工确认

    RUNNING --> WAITING_USER : 遇到歧义\n需用户选择
    WAITING_USER --> RUNNING : 用户提供指令

    RUNNING --> VERIFYING : 执行完成\n进入验证
    VERIFYING --> COMPLETED : 验证通过 ✅
    VERIFYING --> FAILED : 验证不通过 ❌

    FAILED --> PLANNING : 用户点击"重试"
    FAILED --> IDLE : 用户放弃

    RUNNING --> SUSPENDED : 用户挂起
    SUSPENDED --> RUNNING : 用户恢复

    RUNNING --> CANCELLED : 用户取消 / 紧急中止
    PLANNING --> CANCELLED : 用户取消
    WAITING_USER --> CANCELLED : 用户取消

    COMPLETED --> [*] : 结束
    FAILED --> [*] : 结束
    CANCELLED --> [*] : 结束
```

### 状态对照表（前端用）

| FSM 状态 | 中文含义 | 前端显示（颜色） | 用户可操作 |
|----------|----------|------------------|-----------|
| `IDLE` | 空闲 | 灰色 ● | — |
| `PLANNING` | 规划中 | 蓝色脉冲 ● | 取消 |
| `RUNNING` | 执行中 | 绿色旋转 ● | 取消、挂起 |
| `WAITING_TOOL` | 等待工具 | 黄色闪烁 ● | — |
| `WAITING_USER` | 等待用户 | 橙色 ● **弹窗提示** | **确认/取消/提供信息** |
| `VERIFYING` | 验证中 | 紫色 ● | — |
| `COMPLETED` | 已完成 | 绿色常亮 ✅ | 查看产物 |
| `FAILED` | 失败 | 红色 ● ❌ | **重试**、放弃 |
| `SUSPENDED` | 已挂起 | 灰色 ● | **恢复**、取消 |
| `CANCELLED` | 已取消 | 灰色删除线 ~~●~~ | — |

---

## 二、主对话流程

> 用户发送消息 → 后端意图解析 → 执行 → SSE 实时推送 → 返回结果

```mermaid
graph TD
    %% ===== 定义样式 =====
    classDef user fill:#1a1a2e,stroke:#e94560,color:#fff;
    classDef backend fill:#16213e,stroke:#0f3460,color:#fff;
    classDef decision fill:#533483,stroke:#e94560,color:#fff;
    classDef sse fill:#0f3460,stroke:#e94560,color:#fff,dashed;
    classDef popup fill:#e94560,stroke:#fff,color:#fff;

    A["👤 用户输入"]:::user --> B["POST /api/chat/send<br/>或 POST /api/chat/message"]:::backend

    B --> C{"IntentResolver<br/>意图置信度"}:::decision

    %% 低置信度
    C -->|< 0.6| D["❌ 拒绝<br/>返回 rejected 类型"]:::backend
    D --> D1["前端展示拒绝文案"]:::user

    %% 中置信度
    C -->|0.6 ~ 0.85| E["💬 需要澄清<br/>返回 clarification 类型"]:::backend
    E --> E1["前端弹出<br/>🔴 澄清问题表单"]:::popup
    E1 --> E2["用户回答问题<br/>再次发送请求"]:::user
    E2 --> B

    %% 直接聊天
    C -->|chat/query| F["💬 直接LLM对话<br/>返回 direct_chat 类型"]:::backend

    %% 高置信度 - 执行
    C -->|≥ 0.85| G["📋 WorkflowPlanner<br/>生成 Plan + 产物蓝图"]:::backend

    G --> H["DAG 执行循环<br/>Top-3 高优先任务"]:::backend

    H --> I["AgentHarness<br/>执行每个任务"]:::backend

    I -->|SSE 流式推送| J["📡 runtime.agent.message_update"]:::sse
    I -->|SSE 推送| K["📡 runtime.fsm.transition"]:::sse
    I -->|SSE 推送| L["📡 runtime.agent.tool_execution_start/end"]:::sse

    I --> M["产出入库<br/>ArtifactRegistry"]:::backend
    I --> N["记忆存储<br/>MemoryBus"]:::backend

    M --> O["📡 artifact.created<br/>SSE 推送"]:::sse

    O --> P["✅ 返回 HTTP 200<br/>{ type: execution_complete,<br/>  artifacts, output }"]:::backend

    P --> Q["👤 前端展示产物<br/>文件树 + 摘要"]:::user

    %% SSE 处理中心
    J --> R["🧩 前端 SSE Handler<br/>(api.ts connectSSE)"]:::user
    K --> R
    L --> R
    O --> R

    R --> S["流式追加对话气泡"]:::user
    R --> T["更新 FSM 状态点阵"]:::user
    R --> U["更新 DAG 卡片状态"]:::user
    R --> V["更新产物文件树"]:::user
```

### 序列图版本

```mermaid
sequenceDiagram
    actor 用户
    participant FE as 前端
    participant API as StudioServer
    participant Engine as MorPexCore 引擎
    participant SSE as SSE 通道

    用户->>FE: 输入消息
    FE->>API: POST /api/chat/send { message }

    API->>Engine: IntentResolver.resolve()
    Engine-->>API: IntentResult { confidence, type }

    alt 置信度 < 0.6
        API-->>FE: { type: "rejected", output: "..." }
        FE-->>用户: 展示拒绝文案
    else 0.6 ≤ 置信度 < 0.85
        API-->>FE: { type: "clarification", questions: [...] }
        FE-->>用户: 弹出澄清表单
        用户-->>FE: 回答问题
        FE->>API: 再次 POST (含 clarification_answers)
        API->>Engine: 重新执行
    else 置信度 ≥ 0.85
        API->>Engine: WorkflowPlanner.plan()
        Engine-->>API: Plan { tasks, blueprints }

        loop 每个任务
            API->>Engine: AgentHarness.prompt(task)
            Engine-->>SSE: runtime.agent.turn_start
            SSE-->>FE: 回合开始
            Engine-->>SSE: runtime.agent.message_update (流式 delta)
            SSE-->>FE: 实时追加文字
            Engine-->>SSE: runtime.fsm.transition
            SSE-->>FE: 更新状态
            Engine-->>SSE: runtime.agent.turn_end
            SSE-->>FE: 回合结束
        end

        Engine-->>SSE: artifact.created
        SSE-->>FE: 新增产物

        API-->>FE: { type: "execution_complete", artifacts, output }
        FE-->>用户: 展示完整结果
    end
```

---

## 三、跨领域 DAG 流程

> 用户提出跨领域复杂需求 → LLM 拆解为多领域 DAG → 并行/串行分发执行

```mermaid
graph TD
    classDef user fill:#1a1a2e,stroke:#e94560,color:#fff;
    classDef backend fill:#16213e,stroke:#0f3460,color:#fff;
    classDef decision fill:#533483,stroke:#e94560,color:#fff;
    classDef sse fill:#0f3460,stroke:#e94560,color:#fff,dashed;
    classDef domain fill:#0a1628,stroke:#e94560,color:#fff;

    A["👤 用户<br/>'设计硬件并写商业计划'"]:::user
    A --> B["POST /api/chat/message<br/>{ content }"]:::backend

    B --> C["CrossDomainRouter<br/>.dispatch()"]:::backend

    C --> D["LLM 单次调用<br/>RoutingAnalysis"]:::backend

    D --> E{"isMultiDomain?"}:::decision

    E -->|否| F["单领域执行"]:::backend
    E -->|是| G["多领域 DAG 拆解"]:::backend

    G --> H["toposort 拓扑排序"]:::backend

    H --> I["DomainDispatcher<br/>按拓扑执行 DAG"]:::backend

    I --> J["📡 cross_domain.dag_created<br/>SSE 推送 DAG 结构"]:::sse

    J --> K["领域 1: hardware_engineering"]:::domain
    J --> L["领域 2: business_finance<br/>(依赖领域1)"]:::domain

    K --> M["DomainCluster.wake()<br/>唤醒领域集群"]:::backend
    M --> N["AgentHarness.prompt()<br/>执行设计任务"]:::backend
    N --> O["产物共享 (ArtifactRef URI)"]:::backend

    O --> L
    L --> P["AgentHarness.prompt()<br/>撰写商业计划"]:::backend

    P --> Q["汇总结果"]:::backend
    Q --> R["📡 domain.task_completed<br/>SSE 推送"]:::sse

    R --> S["✅ HTTP 200<br/>{ dag, result }"]:::backend
    S --> T["👤 前端展示所有产物"]:::user

    %% 并行执行细节
    subgraph 并行执行
        I2["批 1: 无依赖任务并行"]:::backend
        I3["批 2: 依赖满足后并行"]:::backend
    end
```

### 领域并行调度

```mermaid
graph LR
    classDef domain1 fill:#1a1a2e,stroke:#0f3460,color:#fff;
    classDef domain2 fill:#16213e,stroke:#e94560,color:#fff;
    classDef domain3 fill:#0a1628,stroke:#533483,color:#fff;

    subgraph 批1 [第一批 - 无依赖]
        T1["task_0<br/>硬件设计"]:::domain1
        T2["task_1<br/>市场调研"]:::domain2
    end

    subgraph 批2 [第二批 - 依赖 batch1]
        T3["task_2<br/>商业计划<br/>dep: task_0, task_1"]:::domain3
    end

    T1 --> T3
    T2 --> T3
```

---

## 四、澄清对话流程

> 当 IntentResolver 置信度在 0.6~0.85 之间时触发

```mermaid
sequenceDiagram
    actor 用户
    participant FE as 前端
    participant API as StudioServer
    participant Engine as MorPexCore

    用户->>FE: 输入 "帮我做一个工具"
    FE->>API: POST /api/chat/send { message }
    API->>Engine: IntentResolver.resolve()
    Engine-->>API: confidence = 0.72 (ambiguous)

    API-->>FE: {
        type: "clarification",
        questions: [
            { id: "q1", question: "用什么语言？", type: "choice", options: ["Node.js", "Python"] },
            { id: "q2", question: "主要功能？", type: "open" }
        ]
    }

    FE-->>用户: 🔴 弹出澄清卡槽 (ClarifySlots)

    Note over 用户,FE: 用户回答

    用户-->>FE: 选择 "Node.js"，输入 "文件管理"
    FE->>API: POST /api/chat/send {
        message: "Node.js，文件管理",
        clarification_answers: { q1: "Node.js", q2: "文件管理" }
    }
    API->>Engine: 重新执行（置信度上升至 ≥ 0.85）
    Engine-->>API: 执行完成
    API-->>FE: { type: "execution_complete", ... }
    FE-->>用户: 展示结果
```

### 前端澄清弹窗逻辑

| 场景 | 弹窗类型 | 用户操作 |
|------|----------|----------|
| 置信度 0.6~0.85 | 🔴 `ClarifySlots` 卡槽 | 选择/输入答案，按 YES_BUF / NO_BUF |
| 等待用户输入 | 🟠 FSM `WAITING_USER` | 在 OmniTerminal 中输入指令 |
| 工具调用需确认 | 🟡 确认/取消弹窗 | 确认执行或取消 |
| 跨领域冲突 | ⚫ `InterrogationMatrix` 全屏 | 按 F1 批准 / F2 驳回 |

---

## 五、人机协作 / 质询仲裁流程

> 当 NegotiationEngine 检测到跨领域冲突或需要人工裁决时触发

```mermaid
graph TD
    classDef user fill:#1a1a2e,stroke:#e94560,color:#fff;
    classDef backend fill:#16213e,stroke:#0f3460,color:#fff;
    classDef popup fill:#e94560,stroke:#fff,color:#fff;
    classDef sse fill:#0f3460,stroke:#e94560,color:#fff,dashed;

    A["🔍 系统检测到<br/>领域冲突或需裁决"]:::backend
    A --> B["NegotiationEngine<br/>创建质询工单"]:::backend

    B --> C["📡 negotiation.ticket_created<br/>SSE 推送"]:::sse

    C --> D["⚫ 前端 InterrogationMatrix<br/>全屏红黑格点对质矩阵"]:::popup

    D --> E["👤 用户决策"]:::user

    E --> F{"选择"}:::popup
    F -->|"F1 批准 ✅"| G["继续执行"]:::backend
    F -->|"F2 驳回 ❌"| H["停止并反馈"]:::backend
    F -->|"ESC 暂缓"| I["挂起，稍后处理"]:::popup

    G --> J["📡 negotiation.ticket_resolved"]:::sse
    J --> K["✅ 3D 大脑复位<br/>恢复绿色"]:::user

    H --> J
    H --> L["📡 negotiation.escalated<br/>升级仲裁"]:::sse

    I --> M["FSM → SUSPENDED"]:::backend
    M --> N["用户可以通过<br/>OmniTerminal 恢复"]:::user
```

### 质询仲裁序列

```mermaid
sequenceDiagram
    actor 用户
    participant FE as 前端
    participant Engine as MorPexCore
    participant SSE as SSE 通道

    Engine->>Engine: NegotiationEngine 检测冲突
    Engine-->>SSE: negotiation.ticket_created
    SSE-->>FE: 接收质询工单

    FE->>用户: ⚫ 全屏 InterrogationMatrix 弹出

    alt 用户按 F1（批准）
        用户-->>FE: F1 确认
        FE->>Engine: 隐式批准（SSE 回传）
        Engine-->>SSE: negotiation.ticket_resolved
        SSE-->>FE: 关闭质询、大脑复位
        Engine->>Engine: 继续执行 DAG
    else 用户按 F2（驳回）
        用户-->>FE: F2 驳回
        FE->>Engine: 驳回指令
        Engine-->>SSE: negotiation.escalated
        SSE-->>FE: 显示升级状态
    else 用户按 ESC（暂缓）
        用户-->>FE: ESC
        FE->>FE: 关闭质询面板
        FE->>Engine: FSM → SUSPENDED
    end
```

---

## 六、SSE 连接生命周期

> 这是前端感知后端状态变化的**唯一实时通道**。没有轮询。

```mermaid
graph TD
    classDef fe fill:#1a1a2e,stroke:#e94560,color:#fff;
    classDef sse fill:#0f3460,stroke:#e94560,color:#fff,dashed;
    classDef decision fill:#533483,stroke:#e94560,color:#fff;

    A["🚀 前端启动<br/>App.tsx useEffect"]:::fe
    A --> B["api.ts connectSSE()"]:::fe

    B --> C["EventSource<br/>GET /api/stream/global"]:::fe

    C --> D{"连接成功?"}:::decision
    D -->|是| E["✅ 已连接<br/>开始接收事件"]:::sse
    D -->|否| F["🔴 连接失败<br/>1s 后自动重连"]:::fe

    E --> G["📨 收到事件"]:::sse
    G --> H{"事件类型判断"}:::fe

    H -->|runtime.agent.message_update| I["OmniTerminal<br/>流式追加文字"]:::fe
    H -->|runtime.fsm.transition| J["更新 FSM<br/>状态点阵"]:::fe
    H -->|dag.*| K["更新 DAG<br/>卡片状态"]:::fe
    H -->|artifact.*| L["更新产物<br/>文件树"]:::fe
    H -->|negotiation.*| M["InterrogationMatrix<br/>全屏质询"]:::fe
    H -->|domain.*| N["更新领域<br/>状态指示灯"]:::fe
    H -->|15s 心跳| O["忽略（保持连接）"]:::fe

    G --> P{"连接断开?"}:::decision
    P -->|是| Q["🔴 断开<br/>立即重连"]:::fe
    P -->|否| G

    Q --> R{"重连成功?"}:::decision
    R -->|是| E
    R -->|否| S["指数退避重连<br/>(1s, 2s, 4s, 8s...)"]:::fe
    S --> R

    %% 关键信息
    T["⏱ 30s 无 SSE delta →<br/>清除流式状态"]:::fe
    G --> T
```

### SSE 事件 → 前端组件映射

| SSE 事件 | → 更新哪个组件 | 更新方式 |
|----------|---------------|----------|
| `runtime.agent.message_update` | OmniTerminal (Xterm.js) | 直写 Canvas，零 React 重渲染 |
| `runtime.fsm.transition` | RightPane - FSM 状态点阵 | Zustand subscribe → ref 更新 |
| `dag.created` / `dag.node.completed` | RightPane - DAG 卡片 | 更新 unifiedStore.flows |
| `artifact.created` / `artifact.updated` | BottomPane - 产物文件树 | 更新 unifiedStore.artifacts |
| `cross_domain.dag_created` | CenterPane - DAG 覆盖层 | 更新 DAG 可视化 |
| `negotiation.ticket_created` | InterrogationMatrix | 全屏覆盖 |
| `domain.waking` / `domain.active` / `domain.sleeping` | LeftPane - 领域列表 | 更新状态指示器 |
| `runtime.execution.*` | TopBar - 执行计数 | 瞬态更新 |

---

## 七、会话管理流程

```mermaid
sequenceDiagram
    actor 用户
    participant FE as 前端
    participant API as StudioServer

    Note over 用户,API: 创建会话
    用户->>FE: 打开页面
    FE->>API: GET /api/sessions
    API-->>FE: { sessions: [...] }
    FE->>用户: 展示会话列表

    用户->>FE: 点击"新建会话"
    FE->>API: POST /api/sessions
    API-->>FE: { session: { id: "sess_new", ... } }
    FE->>用户: 进入新会话

    Note over 用户,API: 发送消息
    用户->>FE: 输入消息
    FE->>API: POST /api/chat/send { message, session_id }
    API-->>FE: 执行结果
    FE->>用户: 展示消息和产物

    Note over 用户,API: 查看历史
    用户->>FE: 切换会话
    FE->>API: GET /api/sessions/:id/messages
    API-->>FE: { messages: [...] }
    FE->>用户: 展示历史对话

    Note over 用户,API: 删除会话
    用户->>FE: 删除会话
    FE->>API: DELETE /api/sessions/:id
    API-->>FE: { ok: true }
    FE->>FE: 从列表中移除
```

---

## 八、关键交互机制说明

### 1. 轮询 — ❌ 不需要

> MorPex **没有轮询**。所有状态变化通过 SSE 实时推送。前端不需要任何 `setInterval` 轮询。

| 如果前端想... | 不要这样做 | 应该这样做 |
|---------------|-----------|-----------|
| 获取 FSM 状态 | ❌ 每 1s GET /api/status | ✅ 监听 `runtime.fsm.transition` SSE 事件 |
| 获取执行进度 | ❌ 每 3s GET /api/history | ✅ 监听 `runtime.*` SSE 事件 |
| 获取产物更新 | ❌ 每 5s GET /api/artifacts | ✅ 监听 `artifact.created` SSE 事件 |
| 获取 DAG 更新 | ❌ 轮询 | ✅ 监听 `dag.*` SSE 事件 |

### 2. SSE 推送 — ✅ 唯一实时通道

| 推送类型 | 时机 | 频率 |
|----------|------|------|
| 流式文字 | Agent 生成过程中 | 实时，每次 token |
| 状态变更 | FSM / DAG / Domain 状态变化时 | 事件驱动 |
| 心跳 | 保持连接 | 每 **15s** |
| 质询通知 | 需要人工裁决时 | 事件驱动 |

### 3. 确认/取消弹窗 — 🔴 需要

| 触发条件 | 弹窗类型 | 快捷键 |
|----------|----------|--------|
| 意图置信度 0.6~0.85 | 🔴 澄清卡槽 `ClarifySlots` | YES_BUF / NO_BUF |
| FSM 进入 `WAITING_USER` | 🟠 等待输入指示 | 在终端输入 |
| 跨领域冲突 | ⚫ `InterrogationMatrix` 全屏 | **F1** 批准 / **F2** 驳回 / **ESC** 暂缓 |
| 质询升级 | 🔴 人工仲裁通知 | 同 InterrogationMatrix |

### 4. 前端 SSE 空闲检测

| 机制 | 阈值 | 行为 |
|------|------|------|
| SSE 空闲检测 | **30s** 无任何 SSE 事件 | 清除流式状态，显示"连接超时"提示 |
| SSE 连接断开 | 网络波动 | 自动重连（指数退避: 1s, 2s, 4s, 8s...） |
| 请求级安全网 | **600s** | 后端 Promise.race，返回 504 |
| 紧急中止 | 用户手动触发 | `POST /api/ai/abort` + `Shift+Space` 快捷键 |

### 5. 前端状态更新路径

```
SSE 事件到达
  │
  ▼
api.ts connectSSE() 分发
  │
  ├──→ Zustand unifiedStore (低频状态)
  │      └──→ React 组件重渲染 (flows, agents, domains)
  │
  ├──→ Zustand telemetryStore (高频遥测)
  │      └──→ .subscribe() + useRef DOM 直接更新 (背压、FSM点阵)
  │
  ├──→ Xterm.js OmniTerminal (流式文字)
  │      └──→ Canvas 直写，零 React 重渲染
  │
  └──→ InterrogationMatrix (弹窗)
         └──→ 全屏覆盖层显示/隐藏
```
