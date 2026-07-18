# MorPexCore v2.3 核心业务流程、架构拓扑与全功能测试技术白皮书

> **版本**: 2.3.0 | **日期**: 2026-07-10 | **状态**: 四阶段重构完成 + 质量审计通过
>
> 本文档是 MorPexCore 内核的**权威技术真相源**，涵盖完整业务链路、重构后架构拓扑以及全功能自动化测试矩阵。
> 任何模块的实现、测试、重构必须以此文档的数据结构和控制流为基准。

---

## 目录

1. [端到端核心业务流程图解与深度剖析](#一端到端核心业务流程图解与深度剖析)
2. [重构后架构拓扑与数据流](#二重构后架构拓扑与数据流)
3. [全功能自动化测试矩阵与压力测试用例](#三全功能自动化测试矩阵与压力测试用例)

---

## 一、端到端核心业务流程图解与深度剖析

### 1.0 全链路总览

```
用户输入: "帮我设计一个智能农业监控硬件，并写一份商业推广计划书"
  │
  ├─► [Phase 1] 控制面 ── 意图解析 + 领域路由
  │      IntentResolver.resolve() → CrossDomainRouter.decompose()
  │
  ├─► [Phase 2] 规划面 ── 任务编排 + 拓扑依赖
  │      WorkflowPlanner.plan() → DAGEngine.buildFromTasks()
  │
  ├─► [Phase 3] 知识面 ── 状态流转 + 产物单点持久化
  │      FSMEngine.feed() → ArtifactRegistry.register/update()
  │
  └─► [Phase 4] 事件流水线 ── Trace ID 传播 + EventBus 广播
         ExecutionGateway.execute() → EventBus.emit() → Mirror/SSE
```

### 1.1 【控制面 → 领域路由】意图拆解与领域上下文构建

**起点**: 用户输入一个自然语言字符串，可能涉及多个专业领域的复合意图。

**步骤 1.1.1 — IntentResolver.resolve()**

```
文件: packages/core/planes/control-plane/intent/IntentResolver.ts
核心方法: async resolve(input: string): Promise<IntentResult>
```

**数据结构变化**:

```
输入: string
  "帮我设计一个智能农业监控硬件，并写一份商业推广计划书"
      │
      ▼ LLMProvider.get()(prompt)
      │  系统提示词: DEFAULT_SYSTEM_PROMPT (分类规则 + JSON 输出格式)
      │  调用 pi-ai 的 completeSimple() → DeepSeek API
      │
      ▼ 原始响应: raw: string
      │  "{\"type\":\"directive\",\"confidence\":0.92,\"domain\":\"general\",...}"
      │
      ▼ extractJson(raw) → 括号匹配算法提取 JSON 字符串
      │  → parseJsonWithRepair(jsonStr) (pi-ai 自动修复 JSON 语法错误)
      │
输出: IntentResult
  {
    rawInput: "帮我设计一个智能农业监控硬件...",
    type: "directive",           // IntentType: directive|query|ambiguous|chat
    confidence: 0.92,            // 0-1，<0.6 拒绝
    domain: "general",           // 单领域标签（粗略分类）
    goal: "设计智能农业监控硬件并撰写商业推广计划书",
    entities: {},                // 预留实体提取
    metadata: { reasoning: "..." }
  }
```

**决策逻辑**:
- `confidence ≥ 0.85` → 直接执行
- `0.6 ≤ confidence < 0.85` → 需澄清
- `confidence < 0.6` → 拒绝，返回 `intent.rejected` 事件

**步骤 1.1.2 — CrossDomainRouter.decompose()**

```
文件: packages/core/router/CrossDomainRouter.ts
核心方法: async decompose(input: string): Promise<TaskDecomposition>
```

**数据结构变化**:

```
输入: string (用户原始输入，不经 IntentResult 中转)
      │
      ▼ 构建领域上下文
      │  this.clusterManager.getDomainContextText()
      │  → "- domain_id: \"hardware_engineering\", name: \"硬件工程\", 唤醒词: ..."
      │  → "- domain_id: \"business_finance\", name: \"商业金融\", 唤醒词: ..."
      │
      ▼ 构建 prompt = systemPrompt.replace('{availableDomains}', domainContext) + input
      │
      ▼ LLMProvider.get()(prompt) → DeepSeek API
      │
      ▼ extractJson(raw) → JSON.parse
      │
输出: TaskDecomposition
  {
    tasks: [
      {
        id: "task_0",
        domain: "hardware_engineering",
        goal: "设计智能农业监控硬件系统",
        deps: [],
        expected_artifacts: ["system_design_doc", "hardware_spec"]
      },
      {
        id: "task_1",
        domain: "business_finance",
        goal: "撰写商业推广计划书",
        deps: ["task_0"],              // 依赖硬件设计先完成
        expected_artifacts: ["marketing_plan_doc"]
      }
    ],
    reasoning: "该需求先需要硬件设计，再进行市场分析"
  }
```

**关键容错机制**:
1. LLM 调用失败 → 返回单任务 Fallback（domain='unknown', goal=input）
2. JSON 解析失败 → `crossDomainRouter.parseDecomposition()` 捕获异常，同样走单任务 Fallback
3. 已修复 Bug：`domains` 变量从 `this.clusterManager.getAllClusters().map(c => c.manifest)` 获取，不再引用未定义变量

**步骤 1.1.3 — CrossDomainRouter.buildDAG()**

```
输入: TaskDecomposition (上一步输出)
      │
      ▼ topologicalSort(nodes, n => n.deps, n => n.taskId)
      │  统一工具函数 packages/core/utils/toposort.ts (Kahn 算法)
      │  - 对重复依赖自动去重（使用 Set）
      │  - 检测到环时返回原序并 warn
      │
输出: DAGNode[]
  [
    { taskId: "task_0", domain: "hardware_engineering", goal: "...", deps: [], status: "pending" },
    { taskId: "task_1", domain: "business_finance", goal: "...", deps: ["task_0"], status: "pending" }
  ]
  // 拓扑顺序: task_0 → task_1
```

---

### 1.2 【任务编排与拓扑依赖】WorkflowPlanner + DAGEngine

**步骤 1.2.1 — WorkflowPlanner.plan()**

```
文件: packages/core/planes/control-plane/planner/WorkflowPlanner.ts
核心方法: async plan(intent: IntentResult): Promise<Plan>
```

**数据结构变化**:

```
输入: IntentResult (来自 IntentResolver)
      │
      ▼ this.buildPrompt(intent)
      │  → PLAN_PROMPT + intent 字段拼装
      │
      ▼ LLMProvider.get()(prompt) → DeepSeek API
      │
      ▼ extractJson(raw) → JSON.parse
      │
      ▼ 两阶段 ID 映射:
      │   1. createBlueprint() → bpNameToId Map (用真实 ID 替换 name 引用)
      │   2. taskNameToId Map (用真实 ID 替换依赖 name 引用)
      │
      ▼ sortBlueprintsByDeps(blueprints)
      │   → topologicalSort(blueprints, b => b.dependencies, b => b.id)
      │
      ▼ sortTasksTopologically(tasks) (DFS 拓扑排序)
      │
输出: Plan
  {
    id: "plan_1783615200000_a1b2c3",
    goal: "设计智能农业监控硬件并撰写商业推广计划书",
    blueprints: [
      {
        id: "bp_20260710_a81f92cd",
        name: "硬件系统设计文档",
        type: "document",
        owner: "hardware_engineer",
        dependencies: [],
        acceptanceCriteria: ["包含架构图", "指定元器件清单"]
      },
      {
        id: "bp_20260710_b72e83df",
        name: "商业计划书",
        type: "document",
        owner: "business_analyst",
        dependencies: ["bp_20260710_a81f92cd"],  // 已用真实 ID 替换
        acceptanceCriteria: ["市场分析", "财务预测", "推广策略"]
      }
    ],
    tasks: [
      {
        id: "task_plan_..._0",
        name: "硬件需求分析",
        assignedRole: "hardware_engineer",
        dependencies: [],
        outputArtifacts: ["bp_20260710_a81f92cd"],  // 已用真实 ID 替换
        status: "pending",
        estimatedDuration: 120000,
        priority: 8
      },
      {
        id: "task_plan_..._1",
        name: "商业计划撰写",
        assignedRole: "business_analyst",
        dependencies: ["task_plan_..._0"],          // 已用真实 ID 替换
        outputArtifacts: ["bp_20260710_b72e83df"],
        status: "pending",
        estimatedDuration: 90000,
        priority: 7
      }
    ],
    status: "draft",
    riskLevel: "medium",
    estimatedDuration: 210000,
    createdAt: 1783615200000,
    metadata: { domain: "general", intentType: "directive", rawLLM: "..." }
  }
```

**步骤 1.2.2 — DAGEngine.buildFromTasks()**

```
文件: packages/core/planes/runtime-kernel/dag/DAGEngine.ts
核心方法: buildFromTasks(tasks): void
```

**数据结构变化**:

```
输入: tasks[] (来自 Plan.tasks)
      │
      ▼ 逐条 addNode({ id, name, agentType, description, deps, status, priority, ... })
      │
      │  内部数据结构:
      │    nodes: Map<string, DAGNode>    // { id → { ...DAGNode } }
      │    edges: Set<string>             // { "task_0->task_1" }
      │
      ▼ DAGEngine 运行时状态追踪:
      │   - startNode(nodeId)     → status='running', startedAt=now
      │   - completeNode(nodeId)  → status='success', completedAt=now
      │   - failNode(nodeId, err) → retryCount++, status='pending'|'rerouting'|'failed'
      │   - rerouteNode(nodeId)   → status='rerouting', 尝试 alternateNodes
      │
      ▼ 每次状态变更触发:
      │   onNodeStatusChange(nodeId, newStatus, prevStatus) 回调
      │   snapshotNode(nodeId) → nodeHistory 记录不可变快照
      │   recordMutation(type, nodeId, reason) → mutationsLog
```

**DAGEngine 关键修复 (BUG-10)**:
- `failNode()` 中 reroute 逻辑重构：先设置 `status='rerouting'`，保留 error 信息，再执行 reroute
- 避免旧代码中 `status='rerouting'` 但 error 被覆盖导致的状态不一致

---

### 1.3 【知识面与状态流转】FSMEngine + ArtifactRegistry 单点持久化

**步骤 1.3.1 — FSMEngine 状态机驱动 Zone 调度**

```
文件: packages/core/planes/runtime-kernel/fsm/FSMEngine.ts
核心数据结构: TRANSITIONS: Record<FSMState, Partial<Record<ExternalEvent, FSMState>>>
```

**状态转换图**:

```
                    ┌─────────┐
          cancel    │  IDLE   │ agent_start
    ┌──────────────►│         │───────────────┐
    │               └─────────┘               │
    ▼                                         ▼
┌──────────┐                          ┌──────────┐
│CANCELLED │                          │ PLANNING │
└──────────┘                          └────┬─────┘
          ▲                         turn_start│agent_end
          │ cancel          ┌─────────────────┼──────────┐
          │                 ▼                 │          ▼
          │           ┌──────────┐            │   ┌───────────┐
          │           │ RUNNING  │◄───────────┘   │ COMPLETED │
          │           └────┬─────┘                └───────────┘
          │    tool_ │     │  │ turn_end    ▲
          │ execution│     │  │             │ agent_end
          │   _start │     │  │             │
          │          ▼     │  ▼             │
          │    ┌─────────┐│┌──────────┐     │
          │    │WAITING  │││ VERIFYING├─────┘
          │    │_TOOL    ││└──────────┘
          │    └────┬────┘│     ▲
          │     tool│     │     │
          │ execution│    │ interrogation_accept
          │     _end│     │     │
          │          ▼     │ ┌──────────────┐
          │    ┌──────────┐│ │INTERROGATING │
          │    │ RUNNING  ││ └──────────────┘
          │    └──────────┘│
          │          ▲     │
          │   user_input   │
          │          │     │
          │    ┌──────────┐│
          │    │ WAITING  ││
          │    │ _USER    ││
          │    └──────────┘│
          │                │
          └──── cancel ────┘  (任意非终端状态均可取消)
```

**FSMEngine 关键修复 (BUG-15)**:
- `reset()` 先独立清理内部状态（state='IDLE', context=null, transitionHistory=[]），再尝试 `abort()`
- abort 失败不阻止重置，避免旧代码中 abort() 异常导致状态残留

**步骤 1.3.2 — ArtifactRegistry 不可变更新 + 单一事实来源持久化**

```
文件: packages/core/planes/knowledge-plane/artifacts/ArtifactRegistry.ts
核心原则: ArtifactRegistry 是产物数据的唯一持久化入口 (Single Source of Truth)
```

**写路径（无锁设计，依赖 Node.js 单线程事件循环保证原子性）**:

```
register(artifact, domainId?)
  ├── 1. this.artifacts.set(artifact.id, artifact)         // 内存 Map
  ├── 2. createVersionSnapshot(artifact, '初始版本')        // 创建不可变版本快照
  │       → this.versions.set(artifact.id, [version])
  ├── 3. domainIndex 更新 (按领域索引)
  ├── 4. onArtifactCreated?.(artifact) 回调                 // 通知外部
  └── 5. _scheduleAutoSave()                               // 2s 延迟防抖刷盘

update(artifact, changeLog?)
  ├── 1. 检查 existing 是否存在 (不存在则抛错)
  ├── 2. 记录 prevVersion, prevStatus (用于版本追踪)
  ├── 3. this.artifacts.set(artifact.id, artifact)         // 原子替换
  ├── 4. createVersionSnapshot(artifact, changeLog)        // 追加版本快照
  │       → versions.push(version)
  │       → while (versions.length > maxVersions) versions.shift() // FIFO 淘汰
  ├── 5. onArtifactUpdated?.(artifact, prevVersion)
  ├── 6. onArtifactStatusChanged?.(artifactId, status, prevStatus)   // 状态变更通知
  └── 7. _scheduleAutoSave()

scheduleAutoSave()
  ├── _dirty = true
  ├── clearTimeout(_autoSaveTimer)
  └── _autoSaveTimer = setTimeout(() => saveToDisk(), 2000)
       ├── 写入 artifacts.jsonl (逐行 JSON.stringify)
       └── 写入 relations.jsonl (逐行 JSON.stringify)
```

**读路径**:

```
get(id)        → Map.get(id)                    // O(1)
search(query)  → 筛选 type/status/name/createdBy → offset/limit
getAll()       → [...Map.values()]
resolve(uri)   → parseURI(uri) → Map.get(artifactId)  // 标准化 URI 解析
listByDomain(d)→ domainIndex.get(domainId)
```

**为何移除 ArtifactStorage 不会引入死锁**:
- Node.js 单线程事件循环：所有 `register/update/saveToDisk` 调用都在同一线程同步执行
- `_scheduleAutoSave` 使用防抖定时器（2s），确保连续多次更新只触发一次磁盘写入
- 旧 ArtifactStorage 曾维护独立的写入队列，与 ArtifactRegistry 形成双写竞争
- 移除后，ArtifactRegistry 是唯一写入者，无竞态条件

---

### 1.4 【事件流水线】Trace ID 传播与 EventBus 广播

**步骤 1.4.1 — ExecutionIdentity 统一 ID 生成**

```
文件: packages/core/core/ExecutionIdentity.ts
ID 格式: {prefix}_{YYYYMMDD}_{8hex_uuidv7}

示例追踪链:
  executionId: "exe_20260710_a81f92cd"    ← 根执行 ID
    ├── traceId: "trc_20260710_b72e83df"  ← 全链路 Trace ID
    ├── sessionId: "ses_20260710_c63f94e1"← 会话 ID
    ├── eventId:  "evt_20260710_d54fa5b2" ← 单个事件 ID
    └── artifactId:"art_20260710_e43fb6c3"← 产物 ID
```

**关键设计**:
- 使用 `uuidv7()`（时间有序 UUID）替代 `crypto.randomBytes`
- `getChain(childId)` 回溯全路径：`[root, ..., parent, child]`
- 所有插件/组件必须通过 `this.identity.createEventId()` 生成 ID，**禁止手写字符串**

**步骤 1.4.2 — ExecutionGateway 事件广播**

```
文件: packages/core/gateway/ExecutionGateway.ts
```

```
execute(agentRole, request)
  ├── 1. 查找 Adapter (agentRole 精确匹配 → 默认 Adapter)
  ├── 2. 确保 executionId (缺失时自动生成)
  ├── 3. emitRuntimeEvent('runtime.execution.started', payload)
  │       → EventBus.emit({ id: createEventId(), type, executionId, source:'gateway', ... })
  ├── 4. adapter.execute(request)
  ├── 5. emitRuntimeEvent('runtime.execution.completed', payload)
  └── 6. on error → emitRuntimeEvent('runtime.execution.failed', payload)

abort(executionId)
  ├── 向所有 Adapter 并行发送 abort
  │   - PiAdapter.abort() 只中止匹配的 executionId ('*' 或 currentExecutionId)
  └── emitRuntimeEvent('runtime.execution.aborted', { executionId })
```

**PiAdapter 关键修复 (BUG-4)**:
- `abort('*')` 不再误杀所有执行
- 只在 `executionId === '*' || executionId === this.currentExecutionId` 时才触发 runtime.abort()

**步骤 1.4.3 — EventBus 事件传播机制**

```
文件: packages/core/core/EventBus.ts

emit(event)
  ├── 验证 executionId (缺失时 warn)
  ├── 验证事件类型命名空间 (缺失 '.' 时 warn，建议 "domain.action" 格式)
  ├── 写入 history (保留最近 1000 条)
  ├── 1. 精确匹配: listeners.get(event.type) → 逐个 handler(event)
  ├── 2. 全局通配符: listeners.get('*') → 逐个 handler(event)
  ├── 3. 命名空间通配符: listeners.get('runtime.*') 匹配 'runtime.tool.called'
  └── 4. 一次性监听: onceListeners.get(event.type) → 逐个 → delete

emitToDomain(domainId, event)    // 领域作用域广播
  └── 只触发通过 onDomain(domainId, type, handler) 注册的监听器

broadcastCrossDomain(event)      // 跨领域广播
  ├── 触发全局监听器 (emit)
  └── 触发所有领域的 onDomain 监听器
```

**步骤 1.4.4 — ExecutionMirror 观察者**

```
文件: packages/core/mirror/ExecutionMirror.ts

mirror.start(subscribeFn)
  └── subscribeFn((type, handler) => eventBus.on(type, handler))
      ├── 订阅 'runtime.tool.*', 'runtime.agent.*', 'runtime.task.*',
      │         'runtime.plan.*', 'runtime.dag.*', 'runtime.execution.*'
      └── 所有匹配事件 → JSONLStorage.append(event) → 磁盘 JSONL 文件

mirror.stop() → 取消所有订阅
```

**设计约束**: Mirror 仅观察记录，不参与控制流闭环。即便 mirror 写入失败，主路径不受影响。

---

## 二、重构后架构拓扑与数据流

### 2.1 静态拓扑：四层平面架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Layer 3: Studio 桥接层                           │
│  StudioServer (Express :8080)                                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │REST API  │ │SSE Mgr   │ │Engine    │ │Static    │ │Session   │     │
│  │35+端点   │ │心跳+广播 │ │Bootstrap │ │Files     │ │Names     │     │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘     │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ EventBus + 方法调用
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Layer 2: MorPexCore 引擎                            │
│                                                                         │
│  ┌────────────────────────── EventBus ────────────────────────────┐    │
│  │  emit / on / once / emitToDomain / broadcastCrossDomain        │    │
│  └───────┬──────────┬──────────┬──────────┬──────────┬───────────┘    │
│          │          │          │          │          │                 │
│  ┌───────▼──┐ ┌─────▼───┐ ┌──▼──────┐ ┌─▼────────┐┌▼──────────┐     │
│  │ Control  │ │ Runtime │ │ Agent   │ │Knowledge │ │Industry   │     │
│  │ Plane    │ │ Kernel  │ │ Plane   │ │Plane     │ │(横切)     │     │
│  ├──────────┤ ├─────────┤ ├─────────┤ ├──────────┤ ├───────────┤     │
│  │Intent    │ │FSM      │ │Orch.    │ │MemoryBus │ │Registry   │     │
│  │Resolver  │ │Engine   │ │(Agent   │ │v2 (三维) │ │           │     │
│  │          │ │         │ │Service) │ │          │ │           │     │
│  │Workflow  │ │DAG      │ │Swarm    │ │Knowledge │ │           │     │
│  │Planner   │ │Engine   │ │Engine   │ │Graph     │ │           │     │
│  │          │ │         │ │         │ │          │ │           │     │
│  │Artifact  │ │Scheduler│ │         │ │Artifact  │ │           │     │
│  │Blueprint │ │Engine   │ │         │ │Registry  │ │           │     │
│  │          │ │         │ │         │ │(唯一入口)│ │           │     │
│  │          │ │Exec     │ │         │ │          │ │           │     │
│  │          │ │Graph    │ │         │ │Vector    │ │           │     │
│  │          │ │         │ │         │ │Store     │ │           │     │
│  └──────────┘ └─────────┘ └─────────┘ └──────────┘ └───────────┘     │
│                                                                         │
│  ┌──────────┐ ┌──────────────────┐ ┌──────────────────────┐           │
│  │Kernel    │ │ExecutionMirror   │ │ExecutionGateway      │           │
│  │(DI容器)  │ │(Observer Only)   │ │(薄桥 → PiAdapter)    │           │
│  └──────────┘ └──────────────────┘ └──────────────────────┘           │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────┐         │
│  │             CrossDomain 横切模块 (Phase 8-14)             │         │
│  │  CrossDomainRouter → DomainClusterManager → Negotiation  │         │
│  └──────────────────────────────────────────────────────────┘         │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │ PiAdapter → pi-agent-core
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Layer 1: AI 推理引擎 (pi)                           │
│  @earendil-works/pi-ai          @earendil-works/pi-agent-core          │
│  ├─ getModel()                  ├─ Agent / PiAgent                    │
│  ├─ stream() / complete()       ├─ runAgentLoop()                     │
│  ├─ completeSimple()            ├─ JsonlSessionRepo / InMemorySession │
│  └─ parseJsonWithRepair()       └─ AgentTool / AgentEvent             │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │ HTTP
                                   ▼
                          DeepSeek / OpenAI API
```

**关键依赖线变化（重构后）**:

```
移除前 (v2.0):                   移除后 (v2.3):
  ArtifactPlugin                   ArtifactPlugin
     ├──► ArtifactRegistry             └──► ArtifactRegistry (唯一入口)
     └──► ArtifactStorage (双写!)           ├── register / update (内存 Map)
          ├── writeFileSync()               ├── saveToDisk() (JSONL)
          └── 与 Registry 竞态               └── loadFromDisk() (JSONL)
```

### 2.2 动态数据流：流式响应 + 内存吞吐

```
用户 POST /api/chat/send { message, sessionId }
  │
  ├── 1. StudioServer 接收请求
  │      executionId = this.kernel.executionIdentity.createExecutionId()
  │
  ├── 2. 控制面流水线
  │      IntentResolver.resolve(message)
  │        └──► LLMProvider.get()(prompt) → DeepSeek
  │             └──► extractJson(raw) → parseJsonWithRepair(jsonStr)
  │                  └──► IntentResult { type, confidence, domain, goal }
  │
  ├── 3. 领域路由 (复合意图时)
  │      CrossDomainRouter.decompose(message)
  │        └──► DomainClusterManager.getDomainContextText()
  │             └──► LLMProvider.get()(prompt) → TaskDecomposition
  │                  └──► buildDAG() → DAGNode[] (topologicalSort)
  │
  ├── 4. 规划面
  │      WorkflowPlanner.plan(intentResult)
  │        └──► LLMProvider.get()(prompt) → Plan
  │             ├── createBlueprint() → ArtifactBlueprint[]
  │             └── tasks[] → sortTasksTopologically()
  │
  ├── 5. 运行时执行
  │      DAGEngine.buildFromTasks(plan.tasks)
  │        └──► getNextBatch() → 按优先级并行调度
  │             └──► SchedulerEngine.enqueue(task)
  │                  └──► onTaskReady → 真实 LLM 调用
  │                       └──► ArtifactRegistry.register(artifact)
  │                            └──► _scheduleAutoSave() (2s 防抖)
  │
  ├── 6. EventBus 广播 (每步都发射事件)
  │      runtime.execution.started
  │      runtime.task.started / runtime.task.completed
  │      artifact.created
  │      runtime.execution.completed
  │
  ├── 7. 双路消费
  │      ExecutionMirror → JSONLStorage.append() → data/mirror/*.jsonl
  │      StudioServer SSE → broadcastToSSE() → 前端 EventSource
  │
  └── 8. MemoryBus 记忆固化 (异步，不阻塞响应)
         memoryBus.remember({ content, source, tags, importance })
           └──► WriteGate.decide() → 过滤低质量记忆
                └──► ECLCognifyEngine → 实体/关系抽取
                     └──► KnowledgeGraph → 图数据库写入
```

---

## 三、全功能自动化测试矩阵与压力测试用例

### 3.1 单元测试：工具函数验证

#### 3.1.1 topologicalSort — 循环依赖与拒绝策略

```typescript
// 文件: packages/core/__tests__/toposort.test.ts
import { topologicalSort } from '../utils/toposort.js';

describe('topologicalSort', () => {
  // ── 正常场景 ──
  it('应正确排序简单依赖链 A→B→C', () => {
    const nodes = [
      { id: 'c', name: 'C', deps: ['b'] },
      { id: 'a', name: 'A', deps: [] },
      { id: 'b', name: 'B', deps: ['a'] },
    ];
    const result = topologicalSort(nodes, n => n.deps, n => n.id);
    expect(result.map(n => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('应正确处理多依赖节点 (菱形依赖)', () => {
    const nodes = [
      { id: 'd', deps: ['b', 'c'] },
      { id: 'c', deps: ['a'] },
      { id: 'b', deps: ['a'] },
      { id: 'a', deps: [] },
    ];
    const result = topologicalSort(nodes, n => n.deps, n => n.id);
    // d 必须在 b 和 c 之后
    const dIdx = result.findIndex(n => n.id === 'd');
    const bIdx = result.findIndex(n => n.id === 'b');
    const cIdx = result.findIndex(n => n.id === 'c');
    expect(dIdx).toBeGreaterThan(bIdx);
    expect(dIdx).toBeGreaterThan(cIdx);
  });

  it('应正确处理无依赖节点 (并行执行)', () => {
    const nodes = [
      { id: 'a', deps: [] },
      { id: 'b', deps: [] },
      { id: 'c', deps: [] },
    ];
    const result = topologicalSort(nodes, n => n.deps, n => n.id);
    expect(result).toHaveLength(3);
  });

  // ── 循环依赖场景 ──
  it('应在检测到简单环时返回原序并警告', () => {
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    const nodes = [
      { id: 'a', deps: ['b'] },
      { id: 'b', deps: ['a'] },
    ];
    const result = topologicalSort(nodes, n => n.deps, n => n.id);
    // 应返回原序（不崩溃）
    expect(result).toHaveLength(2);
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining('图中存在环')
    );
    consoleWarn.mockRestore();
  });

  it('应在检测到间接环 (A→B→C→A) 时返回原序', () => {
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    const nodes = [
      { id: 'a', deps: ['c'] },
      { id: 'b', deps: ['a'] },
      { id: 'c', deps: ['b'] },
    ];
    const result = topologicalSort(nodes, n => n.deps, n => n.id);
    expect(result).toHaveLength(3);
    consoleWarn.mockRestore();
  });

  // ── 边界场景 ──
  it('应正确处理空数组输入', () => {
    const result = topologicalSort([], n => [], n => '');
    expect(result).toEqual([]);
  });

  it('应正确处理依赖不存在的节点', () => {
    const nodes = [
      { id: 'a', deps: ['nonexistent'] },
      { id: 'b', deps: [] },
    ];
    const result = topologicalSort(nodes, n => n.deps, n => n.id);
    // 不存在的依赖被忽略，不影响排序结果
    expect(result.map(n => n.id)).toContain('a');
    expect(result.map(n => n.id)).toContain('b');
  });

  it('应对重复依赖去重 (BUG-11 回归测试)', () => {
    // 旧代码：deps=['a','a','a'] 导致 inDegree 偏高 3，永远无法调度
    const nodes = [
      { id: 'a', deps: [] },
      { id: 'b', deps: ['a', 'a', 'a'] }, // 重复依赖
    ];
    const result = topologicalSort(nodes, n => n.deps, n => n.id);
    expect(result.map(n => n.id)).toEqual(['a', 'b']);
    // b 的入度应为 1（去重后），而非 3
  });

  it('应处理大型 DAG (100+ 节点) 的性能', () => {
    const nodes = Array.from({ length: 200 }, (_, i) => ({
      id: `n${i}`,
      deps: i > 0 ? [`n${i - 1}`] : [],
    }));
    const start = performance.now();
    const result = topologicalSort(nodes, n => n.deps, n => n.id);
    const elapsed = performance.now() - start;
    expect(result).toHaveLength(200);
    expect(elapsed).toBeLessThan(50); // 200 节点应在 50ms 内完成
  });
});
```

#### 3.1.2 extractJson — LLM 畸形输出容错

```typescript
// 文件: packages/core/__tests__/extractJson.test.ts
import { extractJson } from '../utils/extractJson.js';

describe('extractJson', () => {
  // ── 正常格式 ──
  it('应提取纯 JSON', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it('应提取 Markdown 代码块中的 JSON', () => {
    const input = '```json\n{"a":1}\n```';
    expect(extractJson(input)).toBe('{"a":1}');
  });

  it('应从带前后文本中提取 JSON', () => {
    const input = '这是分析结果：\n{"type":"directive","confidence":0.9}\n希望对您有帮助。';
    expect(extractJson(input)).toBe('{"type":"directive","confidence":0.9}');
  });

  // ── 深度嵌套 ──
  it('应正确处理深度嵌套 JSON (3层+)', () => {
    const input = '{"a":{"b":{"c":[1,2,{"d":3}]}}}';
    expect(extractJson(input)).toBe('{"a":{"b":{"c":[1,2,{"d":3}]}}}');
  });

  it('应正确处理嵌套大括号 (BUG-3 回归测试)', () => {
    // 旧代码：贪婪正则 {[\s\S]*} 匹配到最后的 }，提取出多余字符
    const input = '{"outer":{"inner":"value"}}';
    expect(extractJson(input)).toBe('{"outer":{"inner":"value"}}');
  });

  // ── 转义字符 ──
  it('应正确处理字符串中的转义引号', () => {
    const input = '{"msg":"hello \\"world\\""}';
    expect(extractJson(input)).toBe('{"msg":"hello \\"world\\""}');
  });

  it('应正确处理字符串中的反斜杠转义', () => {
    const input = '{"path":"C:\\\\Users\\\\test"}';
    const result = extractJson(input);
    expect(result).toBe('{"path":"C:\\\\Users\\\\test"}');
  });

  // ── 容错场景 ──
  it('应对无 JSON 的输入返回 null', () => {
    expect(extractJson('')).toBeNull();
    expect(extractJson('no json here')).toBeNull();
    expect(extractJson('just some text')).toBeNull();
  });

  it('应对未闭合括号返回 null', () => {
    expect(extractJson('{"broken"')).toBeNull();
    expect(extractJson('{"a":1')).toBeNull();
  });

  it('应对多 JSON 对象时提取第一个', () => {
    const input = '{"first":1} extra {"second":2}';
    expect(extractJson(input)).toBe('{"first":1}');
  });

  // ── LLM 常见畸形输出 ──
  it('应处理 LLM 在 JSON 外添加解释文本', () => {
    const input = '根据分析，结果如下：\n```json\n{"tasks":[{"id":"t1","goal":"test"}]}\n```\n以上是完整计划。';
    expect(extractJson(input)).toBe('{"tasks":[{"id":"t1","goal":"test"}]}');
  });

  it('应处理 LLM 在 JSON 内包含 markdown 格式字符', () => {
    const input = '{"goal":"写一个 **Python** 脚本，使用 `pandas` 库"}';
    expect(extractJson(input)).toBe('{"goal":"写一个 **Python** 脚本，使用 `pandas` 库"}');
  });

  it('应处理空代码块', () => {
    const input = '```json\n\n```';
    expect(extractJson(input)).toBeNull(); // 空代码块内无 JSON
  });
});
```

### 3.2 集成测试：数据单点写入与一致性

#### 3.2.1 ArtifactRegistry 并发写入一致性

```typescript
// 文件: packages/core/__tests__/artifact-registry-concurrency.test.ts
import { ArtifactRegistry } from '../planes/knowledge-plane/artifacts/ArtifactRegistry.js';

describe('ArtifactRegistry 并发写入一致性', () => {
  let registry: ArtifactRegistry;

  beforeEach(() => {
    registry = new ArtifactRegistry({ dataDir: './data/test-artifacts-concurrent' });
  });

  afterEach(() => {
    registry.clear();
  });

  // ── 单点写入原子性 ──
  it('应保证同一 artifact 的连续更新不丢失版本', async () => {
    const artifact = ArtifactRegistry.createArtifact({
      name: 'test',
      type: 'document',
      content: { v: 1 },
    });
    registry.register(artifact);

    // 模拟 100 次快速连续更新
    const updatedVersions: number[] = [];
    for (let i = 0; i < 100; i++) {
      const current = registry.get(artifact.id)!;
      const updated = ArtifactRegistry.updateContent(current, { v: i + 2 });
      registry.update(updated);
      updatedVersions.push(updated.version);
    }

    const final = registry.get(artifact.id)!;
    expect(final.version).toBe(101); // 初始 v1 + 100 次更新
    expect(final.content).toEqual({ v: 101 });
  });

  // ── 版本历史完整性 ──
  it('应保留可配置数量的版本历史并 FIFO 淘汰', () => {
    const registry10 = new ArtifactRegistry({
      dataDir: './data/test-artifacts-version',
      maxVersions: 10,
    });

    const artifact = ArtifactRegistry.createArtifact({
      name: 'test', type: 'document', content: { v: 1 },
    });
    registry10.register(artifact);

    // 进行 20 次更新（超过 maxVersions=10）
    for (let i = 0; i < 20; i++) {
      const current = registry10.get(artifact.id)!;
      registry10.update(ArtifactRegistry.updateContent(current, { v: i + 2 }));
    }

    const versions = registry10.getVersions(artifact.id);
    expect(versions.length).toBe(10); // 只保留最近 10 个版本
    expect(versions[9].version).toBe(21); // 最新版本
    registry10.clear();
  });

  // ── 防抖刷盘 ──
  it('应在最后一次变更后延迟刷盘（不每写必刷）', async () => {
    const saveSpy = jest.spyOn(registry as any, 'saveToDisk');

    const artifact = ArtifactRegistry.createArtifact({
      name: 'test', type: 'document', content: {},
    });
    registry.register(artifact);

    // 快速连续 10 次 update
    for (let i = 0; i < 10; i++) {
      const current = registry.get(artifact.id)!;
      registry.update(ArtifactRegistry.updateContent(current, { v: i }));
    }

    // 同步检查：此时 saveToDisk 还没有被调用（在防抖定时器中）
    // 注意：register 触发了 _scheduleAutoSave，所以 saveSpy 可能已被调用 1 次
    const immediateCalls = saveSpy.mock.calls.length;

    // 等待防抖定时器触发
    await new Promise(r => setTimeout(r, 2500));

    // 总共调用的次数应小于变更次数（证明防抖生效）
    const totalCalls = saveSpy.mock.calls.length;
    expect(totalCalls).toBeLessThanOrEqual(immediateCalls + 3); // 不应 10 次都触发

    saveSpy.mockRestore();
  }, 5000);

  // ── 双写移除后无死锁验证 ──
  it('应支持在回调中再次调用 register 而不死锁', () => {
    let secondRegistered = false;

    registry.onArtifactCreated = () => {
      if (!secondRegistered) {
        secondRegistered = true;
        const child = ArtifactRegistry.createArtifact({
          name: 'child', type: 'document', content: {},
        });
        // 回调中再次 register（旧双写架构下可能死锁）
        expect(() => registry.register(child)).not.toThrow();
      }
    };

    const parent = ArtifactRegistry.createArtifact({
      name: 'parent', type: 'document', content: {},
    });
    registry.register(parent);

    expect(secondRegistered).toBe(true);
    expect(registry.count).toBe(2);
  });
});
```

#### 3.2.2 CrossDomainRouter + DomainClusterManager 集成

```typescript
// 文件: packages/core/__tests__/cross-domain-integration.test.ts
import { DomainClusterManager } from '../domains/DomainClusterManager.js';
import { CrossDomainRouter } from '../router/CrossDomainRouter.js';
import { DomainManifestLoader } from '../domains/DomainManifestLoader.js';

describe('CrossDomainRouter + DomainClusterManager 集成', () => {
  let manager: DomainClusterManager;
  let router: CrossDomainRouter;

  beforeAll(async () => {
    const loader = new DomainManifestLoader();
    const manifests = await loader.loadAll();
    manager = new DomainClusterManager();
    manifests.forEach(m => manager.register(m));
    router = new CrossDomainRouter(manager);
  });

  it('应正确拆解跨领域复合意图', async () => {
    // 注意：此测试依赖 LLM，可能因 API key 未配置而走 fallback
    const decomp = await router.decompose('设计硬件并写推广方案');
    expect(decomp.tasks.length).toBeGreaterThanOrEqual(1);
    expect(decomp.tasks[0]).toHaveProperty('id');
    expect(decomp.tasks[0]).toHaveProperty('domain');
    expect(decomp.tasks[0]).toHaveProperty('goal');
  });

  it('buildDAG 应生成拓扑排序的 DAG 节点', () => {
    const decomp = {
      tasks: [
        { id: 't1', domain: 'hw', goal: '硬件设计', deps: [] },
        { id: 't2', domain: 'biz', goal: '商业计划', deps: ['t1'] },
        { id: 't3', domain: 'hw', goal: '测试', deps: ['t1'] },
      ],
      reasoning: 'test',
    };
    const dag = router.buildDAG(decomp);
    const t1Idx = dag.findIndex(n => n.taskId === 't1');
    const t2Idx = dag.findIndex(n => n.taskId === 't2');
    expect(t1Idx).toBeLessThan(t2Idx); // t1 在 t2 之前
    expect(dag).toHaveLength(3);
  });

  it('validateAndRepair 应修复无效领域引用', () => {
    const decomp = {
      tasks: [
        { id: 't1', domain: 'nonexistent_domain', goal: 'test', deps: [] },
      ],
      reasoning: '',
    };
    const manifests = manager.getAllClusters().map(c => c.manifest);
    const repaired = router.validateAndRepair(decomp, manifests);
    // 应被重定向到有效领域
    expect(repaired.tasks[0].domain).not.toBe('nonexistent_domain');
  });
});
```

### 3.3 边界与压力测试：E2E 稳定性

#### 3.3.1 FSMEngine 并发冲突与降级

```typescript
// 文件: packages/core/__tests__/fsm-stress.test.ts
import { FSMEngine } from '../planes/runtime-kernel/fsm/FSMEngine.js';

describe('FSMEngine 并发压力测试', () => {
  let fsm: FSMEngine;

  beforeEach(() => {
    fsm = new FSMEngine({ taskTimeout: 5000 });
  });

  afterEach(() => {
    fsm.reset();
  });

  // ── 合法状态转换 ──
  it('应按 TRANSITIONS 表正确完成完整生命周期', () => {
    fsm.start('task-1', '测试任务');

    expect(fsm.state).toBe('PLANNING');
    expect(fsm.feed('turn_start', {})).toBe(true);
    expect(fsm.state).toBe('RUNNING');

    expect(fsm.feed('tool_execution_start', { toolName: 'read_file' })).toBe(true);
    expect(fsm.state).toBe('WAITING_TOOL');

    expect(fsm.feed('tool_execution_end', { result: 'ok' })).toBe(true);
    expect(fsm.state).toBe('RUNNING');

    expect(fsm.feed('turn_end', {})).toBe(true);
    expect(fsm.state).toBe('VERIFYING');

    expect(fsm.feed('agent_end', { result: '完成' })).toBe(true);
    expect(fsm.state).toBe('COMPLETED');
    expect(fsm.isTerminal).toBe(true);
  });

  // ── 非法状态转换 ──
  it('应拒绝非法状态转换并返回 false', () => {
    fsm.start('task-1', '测试');
    // 从 PLANNING 直接 tool_execution_start 是非法转换
    const result = fsm.feed('tool_execution_start', {});
    expect(result).toBe(false);
    expect(fsm.state).toBe('PLANNING'); // 状态不变
  });

  it('应在终端状态拒绝所有事件', () => {
    fsm.start('task-1', '测试');
    fsm.feed('agent_end', {}); // → COMPLETED
    expect(fsm.state).toBe('COMPLETED');
    expect(fsm.feed('turn_start', {})).toBe(false);
    expect(fsm.feed('tool_execution_start', {})).toBe(false);
  });

  // ── 并发事件注入 (100+ 冲突事件) ──
  it('应在 100 个快速连续事件注入下保持状态一致性', () => {
    fsm.start('task-stress', '压力测试');

    // 注入 100 个合法 + 非法混合事件
    const events: Array<{ event: any; data: any }> = [];
    for (let i = 0; i < 100; i++) {
      const legalEvents = ['turn_start', 'tool_execution_start', 'tool_execution_end', 'turn_end', 'agent_end'];
      const illegalEvents = ['user_input', 'cancel', 'interrogation_start'];
      const pool = i % 3 === 0 ? illegalEvents : legalEvents;
      events.push({
        event: pool[i % pool.length],
        data: { index: i },
      });
    }

    for (const { event, data } of events) {
      fsm.feed(event as any, data);
    }

    // 状态机不应崩溃，终态应合法
    expect(['IDLE', 'PLANNING', 'RUNNING', 'WAITING_TOOL', 'WAITING_USER',
            'VERIFYING', 'INTERROGATING', 'COMPLETED', 'FAILED', 'CANCELLED'])
      .toContain(fsm.state);

    // 转换历史不应为空
    expect(fsm.getHistory().length).toBeGreaterThan(0);
  });

  // ── 超时降级 ──
  it('应在超时后自动转为 FAILED 状态', async () => {
    const fsmShort = new FSMEngine({ taskTimeout: 100 }); // 100ms 超时
    fsmShort.start('task-timeout', '超时测试');

    // 等待超时
    await new Promise(r => setTimeout(r, 200));

    expect(fsmShort.state).toBe('FAILED');
    expect(fsmShort.isTerminal).toBe(true);
    expect(fsmShort.getContext()?.error).toBe('任务超时');
    fsmShort.reset();
  });

  // ── reset() 安全性 (BUG-15 回归测试) ──
  it('应在 abort 抛异常时仍成功重置', () => {
    fsm.start('task-reset', '重置测试');
    fsm.feed('turn_start', {});

    // 模拟 harness.abort() 失败
    const harness = fsm.getCurrentHarness();
    if (harness) {
      jest.spyOn(harness, 'abort').mockRejectedValue(new Error('abort failed'));
    }

    // reset 不应抛出异常
    expect(() => fsm.reset()).not.toThrow();
    expect(fsm.state).toBe('IDLE');
    expect(fsm.getContext()).toBeNull();
  });
});
```

#### 3.3.2 JSONLStorage 断点恢复与异常隔离

```typescript
// 文件: packages/core/__tests__/jsonl-recovery.test.ts
import { JSONLStorage } from '../mirror/storage/JSONLStorage.js';
import { readJSONLLines } from '../utils/jsonl.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('JSONLStorage 异常恢复', () => {
  const testDir = path.join(os.tmpdir(), `morpex-jsonl-test-${Date.now()}`);
  let storage: JSONLStorage;

  beforeEach(() => {
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
    storage = new JSONLStorage(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  // ── 正常写入和读取 ──
  it('应正确追加和读取 JSONL 数据', async () => {
    await storage.initialize();

    const events = [
      { id: 'e1', type: 'test.event', data: 'hello' },
      { id: 'e2', type: 'test.event', data: 'world' },
    ];

    for (const event of events) {
      await storage.append(event);
    }

    const records = await storage.query();
    expect(records).toHaveLength(2);
    expect(records[0].id).toBe('e1');
    expect(records[1].id).toBe('e2');
  });

  // ── 损坏行容错 ──
  it('readJSONLLines 应跳过损坏行，不中断整体解析', () => {
    const content = [
      '{"id":"e1","type":"ok"}',
      'this is a corrupted line',
      '{broken json',
      '',
      '{"id":"e2","type":"also ok"}',
    ].join('\n');

    const result = readJSONLLines(content);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('e1');
    expect(result[1].id).toBe('e2');
  });

  // ── 空文件处理 ──
  it('应对空文件返回空数组', () => {
    const result = readJSONLLines('');
    expect(result).toEqual([]);
  });

  it('应对仅含空白行的文件返回空数组', () => {
    const result = readJSONLLines('\n\n\n');
    expect(result).toEqual([]);
  });

  // ── 超长行处理 ──
  it('应正确处理包含大量数据的单行', () => {
    const bigData = { id: 'big', data: 'x'.repeat(10000) };
    const content = JSON.stringify(bigData);
    const result = readJSONLLines(content);
    expect(result).toHaveLength(1);
    expect(result[0].data).toHaveLength(10000);
  });

  // ── Compaction ──
  it('compaction 应去重保留最新事件', async () => {
    await storage.initialize();

    // 写入 10 个事件
    for (let i = 0; i < 10; i++) {
      await storage.append({ id: `e${i}`, type: 'test', seq: i });
    }

    await storage.compact();

    const records = await storage.query();
    expect(records).toHaveLength(10);
    // compaction 后数据应仍可读
    expect(records[0].seq).toBe(0);
    expect(records[9].seq).toBe(9);
  });
});
```

#### 3.3.3 EventBus 高吞吐与通配符匹配

```typescript
// 文件: packages/core/__tests__/eventbus-stress.test.ts
import { EventBus } from '../core/EventBus.js';

describe('EventBus 高吞吐与通配符', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus(500); // 小历史容量以便测试
  });

  afterEach(() => {
    bus.clear();
  });

  // ── 通配符匹配 ──
  it('"runtime.*" 应匹配 "runtime.tool.called"', () => {
    const handler = jest.fn();
    bus.on('runtime.*', handler);
    bus.emit({
      id: 'evt_1', type: 'runtime.tool.called',
      timestamp: Date.now(), executionId: 'exe_1', source: 'test', payload: {},
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('"*" 应匹配所有事件', () => {
    const handler = jest.fn();
    bus.on('*', handler);
    bus.emit({ id: 'e1', type: 'a.b', timestamp: 0, executionId: 'x', source: 't', payload: {} });
    bus.emit({ id: 'e2', type: 'c.d', timestamp: 0, executionId: 'x', source: 't', payload: {} });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  // ── once 一次性监听 ──
  it('once 应在触发一次后自动取消', () => {
    const handler = jest.fn();
    bus.once('test.event', handler);
    bus.emit({ id: 'e1', type: 'test.event', timestamp: 0, executionId: 'x', source: 't', payload: {} });
    bus.emit({ id: 'e2', type: 'test.event', timestamp: 0, executionId: 'x', source: 't', payload: {} });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  // ── 高吞吐 ──
  it('应在 1000 个事件/s 下不丢失事件', () => {
    const received: string[] = [];
    const unsub = bus.on('perf.event', (e) => received.push(e.id));

    for (let i = 0; i < 1000; i++) {
      bus.emit({
        id: `evt_${i}`, type: 'perf.event',
        timestamp: Date.now(), executionId: 'perf', source: 'test', payload: { i },
      });
    }

    expect(received).toHaveLength(1000);
    unsub();
  });

  // ── 领域作用域 ──
  it('emitToDomain 应只触发对应领域的监听器', () => {
    const hwHandler = jest.fn();
    const bizHandler = jest.fn();
    bus.onDomain('hardware_engineering', 'task.completed', hwHandler);
    bus.onDomain('business_finance', 'task.completed', bizHandler);

    bus.emitToDomain('hardware_engineering', {
      id: 'e1', type: 'task.completed',
      timestamp: Date.now(), executionId: 'x', source: 't', payload: {},
    });

    expect(hwHandler).toHaveBeenCalledTimes(1);
    expect(bizHandler).toHaveBeenCalledTimes(0);
  });

  // ── 历史容量 ──
  it('应在超过 maxHistory 时 FIFO 淘汰', () => {
    for (let i = 0; i < 600; i++) {
      bus.emit({
        id: `evt_${i}`, type: 'test',
        timestamp: i, executionId: 'hist', source: 't', payload: { i },
      });
    }
    const history = bus.getHistory();
    expect(history.length).toBeLessThanOrEqual(500);
    // 最早的事件已被淘汰
    expect(history[0].payload.i).toBeGreaterThan(0);
  });
});
```

### 3.4 测试覆盖率目标

| 模块 | 目标覆盖率 | 关键场景 |
|------|-----------|---------|
| `utils/extractJson.ts` | 100% | 嵌套 JSON、转义引号、代码块、畸形输出 |
| `utils/toposort.ts` | 100% | 循环依赖、重复依赖、空数组、大型 DAG |
| `utils/jsonl.ts` | 100% | 损坏行、空文件、超长行 |
| `core/EventBus.ts` | ≥95% | 通配符、领域作用域、高吞吐、once |
| `planes/.../ArtifactRegistry.ts` | ≥90% | 并发写入、版本 FIFO、防抖刷盘、回调递归 |
| `planes/.../FSMEngine.ts` | ≥90% | 状态转换表、非法转换拒绝、超时降级、reset 安全 |
| `planes/.../DAGEngine.ts` | ≥90% | 拓扑排序、failNode reroute、环检测 |
| `router/CrossDomainRouter.ts` | ≥85% | 意图拆解、DAG 构建、validateAndRepair |
| `planes/.../WorkflowPlanner.ts` | ≥85% | LLM 调用、JSON 解析、Fallback 规划 |

---

> **铁律提醒**: 本文档是 MorPexCore v2.3 的权威技术真相源。
> 任何代码变更必须同步更新本文档的对应章节。
> 测试用例应优先参照本文档中的 Jest 骨架编写，确保覆盖所有标注的边界场景。
