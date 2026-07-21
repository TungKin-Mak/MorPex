# MorPex 多Session架构改造

> ✅ **全部完成 (2026-07-17)** — 12 个文件变更，0 个新依赖，后端测试 181/182 通过，前端编译零错误。详见下方 TODO 表（全部 ✅）。

## 架构总览

```
SessionManager (后端单例, 管理所有 pi Session)
  ├── sess_chat    mode=chat     harness=null    status=idle
  ├── sess_luban   mode=luban    harness=null    status=idle    ← 切换时懒创建
  ├── sess_simq    mode=simq     harness=null    status=idle
  ├── sess_task_0  mode=task     harness=Harness status=running ← 并行执行
  └── sess_task_1  mode=task     harness=Harness status=running ← 独立上下文

前端:
  ZoneD (右侧340px)                   ZoneB (左侧320px)
  ┌─────────────────────┐            ┌──────────────────────┐
  │ 💬聊天 🔧鲁班 📖司马迁│            │ [日志] [task_0] [task_1]│  ← 节点tab
  ├─────────────────────┤            ├──────────────────────┤
  │ 当前模式的对话       │            │ 日志 / 节点详情       │
  │ + DAG卡片           │            │ + 输入框             │
  ├─────────────────────┤            │                      │
  │ $> _______________  │            └──────────────────────┘
  └─────────────────────┘

核心原则:
  1. session 由后端 pi 核原生管理, 前端不生成 session_id
  2. 每个独立对话上下文 = 一个 pi Session, 有独立 system prompt + 消息历史
  3. 前端和 session 运行完全解耦: 前端只负责显示, 不影响 session 运行
  4. Agent session 的 harness 懒创建 (前端切换到该 mode 时才拉起)
  5. Task session 的 harness 由 DomainDispatcher 在执行时创建, 完成后回收
  6. 同 domain 多个 task → 多个独立 harness → 天然并行

Harness 依赖分层:
  只有 task session 需要 AgentHarness (多轮对话 + 工具调用).
  编排/规划/检索层 不需要 harness, 直接调用 LLMProvider 或存储层:

  ┌──────────────────────────────────────────────────────┐
  │ SessionManager.send(sessionId, content)              │
  │                                                      │
  │ mode=chat:                                           │
  │   LLMProvider.get()(prompt)                          │
  │   → 单次对话, ❌ 不需 harness                         │
  │                                                      │
  │ mode=luban:                                          │
  │   CrossDomainRouter.dispatch(content)                │
  │     → LLMProvider.get()(prompt) ❌ 不需 harness       │
  │   MetaPlanner.wrapOrchestrate() [可选]               │
  │     → PipelineExecutor → LLMProvider ❌ 不需 harness  │
  │   DomainDispatcher.executeDAG(nodes)                 │
  │     → 每个节点: SessionManager.ensureHarness(taskId) │
  │       ✅ 这里才创建 harness                            │
  │                                                      │
  │ mode=simq:                                           │
  │   MemoryBus.recall({ text, topK })                   │
  │     → ZVecStorage + KnowledgeGraph ❌ 不需 harness    │
  │                                                      │
  │ mode=task:                                           │
  │   harness.prompt(content)                            │
  │     → AgentHarness 多轮 + 工具调用 ✅ 需要 harness     │
  └──────────────────────────────────────────────────────┘

  总结: sess_chat/sess_luban/sess_simq 的 harness 永远为 null.
  编排和 meta 层在 SessionManager.send() 中直接调用, 不经过 harness.
  只有 sess_task 才需要 ensureHarness.
```

---

## 理想链路映射

```
用户: @鲁班 硬件选型
  │
  ├── ① 识别意图 ─────────────────→ CrossDomainRouter.dispatch()
  │     LLMProvider.get()(prompt)           Single-Shot LLM 调用
  │     → 意图: 硬件选型+对比              输出: { globalIntent, isMultiDomain }
  │
  ├── ② 识别领域 ─────────────────→ (同上, 一次调用完成)
  │     单域: hardware_engineering         involvedDomains: ["hardware_engineering"]
  │     多域: hardware + legal             domainDependencies: [...]
  │
  ├── ③ Meta层选择最优策略 ────────→ MetaPlanner.wrapOrchestrate()
  │     策略A: 先选型再对比                PipelineExecutor (7-Stage):
  │     策略B: 并行选型最后汇总              1.意图分析 2.经验匹配 3.候选生成
  │     策略C: 分层逐步推进                 4.模拟推演 5.评分 6.决策 7.激活
  │     选A, 历史成功率最高                 优化 DAG goal + 调整依赖
  │
  ├── ④ 智能编排Agent ────────────→ DomainDispatcher.executeDAG()
  │     编排出DAG:                         拓扑排序 → 依赖检查 → 冲突检测
  │     task_0: MCU选型                    并行调度 (maxParallel=3)
  │     task_1: 方案对比                   同领域加锁 / 跨领域协商
  │     task_0 → task_1 (依赖)             产物传递: collectUpstreamArtifacts
  │
  └── ⑤ DAG执行 ──────────────────→ Task Session + AgentHarness
       │
       ├── 执行肢 (tools)
       │   AgentHarness.tools = [
       │     ...skillPool,            ← 领域技能 (datasheet_search 等)
       │     ReadArtifactTool,        ← 读取上游产物
       │     AgentCreateTool,         ← 创建子 Agent
       │     TeamSayTool,             ← 跨 Agent 沟通
       │     ForkExecuteTool,         ← Fork 执行
       │     askUserTool,             ← 向用户提问
       │   ]
       │
       ├── 任务分析/推理
       │   harness.prompt(goal)
       │     systemPrompt = 领域知识 + 任务目标
       │     LLM 多轮: 分析参数 → 调用工具 → 推理 → 输出
       │
       ├── 跨Agent沟通
       │   TeamSayTool → NegotiationEngine → ArbitrationHandler
       │
       └── 返回交付物 ────────────→ ArtifactRegistry
           选型报告.md                  saveArtifactToDisk()
           对比表.json                  EventBus.emit('artifact.created')
```

### Session 视角完整链路

```
sess_luban (harness=null) ← 始终不创建 harness, 只做编排
  │
  │  POST /api/session/sess_luban/send { content: "硬件选型" }
  │
  ├── ①② 意图+领域 → CrossDomainRouter.dispatch(content)
  │     → DAG={ nodes:[task_0, task_1], executionId:'ex1' }
  │
  ├── ③ Meta → MetaPlanner.wrapOrchestrate(dag) [可选, enabled=false]
  │     → PipelineExecutor 7-Stage 评估优化
  │
  ├── ④ 创建 task session (仅 pi Session, 无 harness)
  │     SessionManager.create('task', { taskId:'task_0', executionId:'ex1', domainId:'hardware_engineering' })
  │     SessionManager.create('task', { taskId:'task_1', executionId:'ex1', domainId:'hardware_engineering' })
  │       → sess_task_0: status=pending, harness=null
  │       → sess_task_1: status=pending, harness=null
  │
  ├── ④ 返回 DAG 给前端
  │     return { type:'dag_plan', dag, executionId:'ex1' }
  │
  └── ⑤ setImmediate → DomainDispatcher.executeDAG([task_0, task_1])
       │
       │ --- task_0 ---
       │
       │ SessionManager.ensureHarness('sess_task_0')
       │   → domainClusterManager.getCluster('hardware_engineering')
       │   → cluster.buildTools() → skillPool + tools
       │   → manifest.master_agent_config.system_prompt
       │   → new AgentHarness({ model, tools, systemPrompt })
       │   → sess_task_0.status = 'running'
       │
       │ harness.prompt("MCU选型+竞品分析")
       │   ├── LLM: "分析市面上主流MCU方案..."
       │   ├── tool: datasheet_search("STM32")    ← 领域技能
       │   ├── tool: ReadArtifact("requirements.md")  ← 读取上游
       │   ├── tool: TeamSayTool("legal: 合规检查")   ← 跨领域沟通
       │   │     → NegotiationEngine.createTicket
       │   │     → ArbitrationHandler
       │   ├── tool: askUserTool("选STM32还是GD32?")
       │   │     → EventBus → SSE → ZoneB task tab 显示询问
       │   │     → 用户回复 → steerHarness → resolve
       │   └── 最终: "选型报告: STM32F407..."
       │
       │ SessionManager.close('sess_task_0')
       │   → harness.abort() → sess_task_0.harness=null
       │   → sess_task_0.status = 'completed'
       │
       │ --- task_1 --- (依赖 task_0, 拿到上游产物后开始)
       │
       │ SessionManager.ensureHarness('sess_task_1')
       │   → sessionCtx.artifacts = { task_0: [选型报告] }  ← 上游注入
       │
       │ harness.prompt("基于选型报告做方案对比")
       │   ├── tool: ReadArtifact("artifact://hardware_engineering/report/task_0")
       │   └── 最终: "对比报告: ..."
       │
       │ SessionManager.close('sess_task_1')
       │
       ├── DomainDispatcher.onComplete
       │     → finalizeExecution → 汇总结果
       │     → EventBus.emit → SSE → ZoneD luban mode 显示完成
       │
       └── ArtifactRegistry
             saveArtifactToDisk("选型报告.md")
             saveArtifactToDisk("对比表.json")
```

### Task Session 生命周期

| 状态 | harness | 含义 | 转换 |
|------|---------|------|------|
| `pending` | null | DAG 已创建, 等待调度 | DomainDispatcher 调度到该节点 |
| `running` | AgentHarness | 正在执行 | ensureHarness() 完成 |
| `completed` | null | 执行完成, harness 已回收 | harness.prompt() 返回 |
| `failed` | null | 执行失败, harness 已回收 | harness.prompt() 抛出异常 |

### 多个 @鲁班 任务的 Session 管理

```
t1: "@鲁班 硬件选型" → DAG_1: [task_0, task_1]
t2: "@鲁班 写推广计划" → DAG_2: [task_2, task_3]

sess_luban:  status=idle, harness=null   ← 始终一个, 复用
sess_task_0: status=running              ← DAG_1 节点
sess_task_1: status=running              ← DAG_1 节点
sess_task_2: status=pending              ← DAG_2 节点 (新增)
sess_task_3: status=pending              ← DAG_2 节点 (新增)

多个 DAG 共存, task session 各自独立生命周期.
sess_luban 一个就够了, 不创建 harness.
```

### 清理策略

```
惰性清理 + 引用计数:
  - task session 完成后不立即删除 (前端 ZoneB tab 可能还在查看)
  - ZoneB 打开 task tab → refCount++
  - ZoneB 关闭 task tab → refCount--
  - refCount=0 ∧ status∈{completed,failed} → 标记可清理
  - 定时 GC (每5分钟): 清理 completed > 10分钟 且 refCount=0 的 session
```

---

## 后端 TODO

### 1. 新建 `packages/studio/server/SessionManager.ts`

**职责**: 统一管理所有 pi Session 的生命周期, 替代前端自造 session_id 和 DomainCluster 自建 session 的混乱现状.

| # | 任务 | 详细 | 状态 |
|---|------|------|------|
| 1.1 | `SessionHandle` 类型 | `{ id, mode, piSession: Session, harness: AgentHarness\|null, systemPrompt, status:'idle'\|'pending'\|'running'\|'completed'\|'failed'\|'closed', taskId?, executionId?, domainId?, refCount:number, completedAt?, createdAt }` | ✅ |
| 1.2 | `create(mode, opts?)` | 通过 `InMemorySessionRepo.create()` 创建 pi `Session`, 构造 `SessionHandle`, 存入内部 `Map`, 返回 `sessionId`. opts: `{ executionId?, taskId? }` | ✅ |
| 1.3 | `ensureHarness(sessionId)` | 对 agent/task mode 的 session 懒创建 `AgentHarness`. 需要 `DomainCluster.buildTools()` 提供工具链, `manifest.master_agent_config.system_prompt` 作为 system prompt. 已存在则直接返回 | ✅ |
| 1.4 | `send(sessionId, content)` | 路由逻辑见下方详细伪代码 | ✅ |

**1.4 详细路由逻辑:**

```typescript
async send(sessionId: string, content: string) {
  const session = this.sessions.get(sessionId);

  switch (session.mode) {
    case 'chat':
      // 单次 LLM 对话, 不需要 harness
      const reply = await LLMProvider.get()(content, chatSystemPrompt);
      return { type: 'direct_chat', output: reply };

    case 'luban':
      // 编排层, 不需要 harness
      const dag = await this.crossDomainRouter.dispatch(content);
      // 可选: await this.metaPlanner?.wrapOrchestrate(dag)
      //        ↑ 也用 LLMProvider.get(), 不需要 harness
      // 为每个节点创建 task session (仅 pi Session, 无 harness)
      for (const node of dag.nodes) {
        await this.create('task', {
          taskId: node.taskId,
          executionId: dag.executionId
        });
      }
      // 异步执行 DAG, 执行到每个节点时才 ensureHarness
      setImmediate(() =>
        this.domainDispatcher.executeDAG(dag.nodes, sessionCtx));
      return { type: 'dag_plan', dag, executionId: dag.executionId };

    case 'simq':
      // 记忆检索, 不需要 harness
      const result = await this.memoryBus.recall({
        text: content, topK: 5
      });
      const output = result?.items?.length
        ? `📖 找到 ${result.items.length} 条相关记忆`
        : '📭 未找到相关记忆。';
      return { type: 'direct_chat', output };

    case 'task':
      // 执行层, ✅ 需要 harness
      await this.ensureHarness(sessionId);
      const result = await session.harness!.prompt(content);
      return { type: 'direct_chat', output: result };
  }
}
```
| 1.5 | `close(sessionId)` | 调用 harness.abort(), 标记 status='closed', 从 Map 中移除 | ✅ |
| 1.6 | `get(sessionId)` | 返回 `SessionHandle \| undefined` | ✅ |
| 1.7 | `getAll()` | 返回所有活跃 session 摘要: `[{ id, mode, status, taskId?, executionId? }]` | ✅ |

### 2. 改造 `packages/core/src/domains/DomainCluster.ts`

**职责**: 不再管理 harness 生命周期, 只负责提供领域知识 (systemPrompt + tools + skills).

| # | 任务 | 详细 | 状态 |
|---|------|------|------|
| 2.1 | 删除 `_master` 字段 | 移除 `private _master: AgentHarness` 及所有赋值 | ✅ |
| 2.2 | 删除 `wake()` 中 harness 创建逻辑 | 保留 `loadSkills()`, 删除 `new AgentHarness(...)` 和 `this._master = ...` | ✅ |
| 2.3 | 删除 `sleep()` 中 harness 清理 | 删除 `_master.abort()` 和 `_master = null` | ✅ |
| 2.4 | 新增 `buildTools()` | 返回完整工具链数组: `[...skillPool.values(), askUserTool, AgentCreateTool, TeamSayTool, ReadArtifactTool]`. 其中 `askUserTool` 的 handler 通过构造函数注入 | ✅ |
| 2.5 | `execute(goal, harness)` 改签名 | 接收外部 `AgentHarness` 作为参数, 调用 `harness.prompt(goal)`. 不再自建 harness | ✅ |
| 2.6 | 保留 `loadSkills()` | 不变, 技能文件加载逻辑不变 | ✅ |
| 2.7 | 保留 `spawnSubAgent()` | Cgroup 配额和子Agent 工具继承逻辑不变, 但子Agent 的 harness 也应由 SessionManager 管理 (后续优化) | ✅ |

### 3. 改造 `packages/core/src/domains/DomainClusterManager.ts`

**职责**: execute 透传外部 harness.

| # | 任务 | 详细 | 状态 |
|---|------|------|------|
| 3.1 | `execute(domainId, goal, harness, sessionCtx?)` 改签名 | 新增 `harness: AgentHarness` 参数 | ✅ |
| 3.2 | 透传 harness | `cluster.execute(goal, harness)` | ✅ |
| 3.3 | 保留 `wake()`/`sleep()` | 生命周期管理不变 (不含 harness) | ✅ |

### 4. 改造 `packages/core/src/router/DomainDispatcher.ts`

**职责**: DAG 节点执行时通过回调获取/释放 harness.

| # | 任务 | 详细 | 状态 |
|---|------|------|------|
| 4.1 | 新增 `onGetHarness` 回调 | `(domainId: string, taskId: string, goal: string) => Promise<AgentHarness>` | ✅ |
| 4.2 | 新增 `onReleaseHarness` 回调 | `(taskId: string) => Promise<void>` | ✅ |
| 4.3 | `executeNode` 中调用回调 | 替换 `this.clusterManager.execute(domainId, goal, sessionCtx)` 为: `const harness = await onGetHarness(...); const result = await harness.prompt(goal); await onReleaseHarness(taskId)` | ✅ |
| 4.4 | 保留 `collectUpstreamArtifacts` | 上游产物注入 sessionCtx 逻辑不变 | ✅ |
| 4.5 | 保留 `resolveBatchConflicts` | 冲突检测逻辑不变 | ✅ |

### 5. 改造 `packages/studio/server/StudioServer.ts`

**职责**: 集成 SessionManager, 新增 session API, 接线回调.

| # | 任务 | 详细 | 状态 |
|---|------|------|------|
| 5.1 | 初始化 `SessionManager` | 在 `initComponents()` 中 `this.sessionManager = new SessionManager(...)` | ✅ |
| 5.2 | 新增 `POST /api/session/create` | `{ mode }` → 调用 `sessionManager.create(mode)` → 返回 `{ sessionId, mode }` | ✅ |
| 5.3 | 新增 `GET /api/sessions` | 返回所有活跃 session 列表 | ✅ |
| 5.4 | 改造聊天路由 | `POST /api/chat/message` → `POST /api/session/:id/send`. 调用 `sessionManager.send(sessionId, content)` | ✅ |
| 5.5 | 接线 `DomainDispatcher` 回调 | `domainDispatcher.onGetHarness = (domainId, taskId, goal) => sessionManager.ensureHarness(taskSessionId); domainDispatcher.onReleaseHarness = (taskId) => sessionManager.close(taskSessionId)` | ✅ |
| 5.6 | DAG 创建后为节点创建 session | 在 `initCrossDomainModules()` 的 onUserInputNeeded 等回调中, 收到 DAG 后为每个节点调用 `sessionManager.create({ mode:'task', taskId, executionId })` | ✅ |
| 5.7 | 移除 `_steerResolvers` | harness steer 管理移到 SessionManager 内部, StudioServer 不再持有 `_steerResolvers` Map | ✅ |
| 5.8 | 保留 SSE 路由 | `setupSSE()` 保持, 但 `onProjected` 事件过滤不变 | ✅ |

### 6. 无需改动

| 文件 | 原因 |
|------|------|
| `CrossDomainRouter.ts` | `dispatch()` 返回 `ExecutionDAG`, 内部用 `LLMProvider.get()` 不需 harness |
| `MetaPlanner.ts` / `PipelineExecutor.ts` | 7-Stage Pipeline 全程 `LLMProvider.get()`, 不依赖 harness |
| `EventBus.ts` | `emit`/`onProjected` 不变 |
| `MemoryBus.ts` | 记忆系统独立于 session, 不需 harness |
| `NegotiationEngine.ts` | 协商逻辑不变, 内部用 `LLMProvider.get()` |
| `ArbitrationHandler.ts` | 仲裁逻辑不变 |
| `PlanExperienceStore.ts` | 读 JSONL, 不需 harness |

---

## 前端 TODO

### 1. 改造 `packages/studio/ui/ts/stores.ts`

| # | 任务 | 详细 | 状态 |
|---|------|------|------|
| 1.1 | 新增类型 `ChatMode` | `'chat' \| 'luban' \| 'simq'` | ✅ |
| 1.2 | 新增类型 `ModeState` | `{ sessionId?: string, liveStream: LiveStreamItem[], executionId?: string }` | ✅ |
| 1.3 | 新增类型 `ZoneBTab` | `{ type:'logs' } \| { type:'node', taskId:string, executionId:string, label:string }` | ✅ |
| 1.4 | 新增字段 `modeStates` | `Record<ChatMode, ModeState>`, 默认三个 mode 各 `{ liveStream:[] }` | ✅ |
| 1.5 | 新增字段 `activeMode` | `ChatMode`, 默认 `'chat'` | ✅ |
| 1.6 | 新增字段 `zoneBActiveTab` | `ZoneBTab`, 默认 `{ type:'logs' }` | ✅ |
| 1.7 | 新增字段 `zoneBTabs` | `ZoneBTab[]`, 默认 `[]` | ✅ |
| 1.8 | Action `switchChatMode` | `set({ activeMode: mode })`, 纯前端切换 | ✅ |
| 1.9 | Action `pushToChatMode` | 追加 item 到 `modeStates[mode].liveStream`; 连续同状态 running 合并; 上限 200 条; 同步到 localStorage `morpex_livestream_{mode}` | ✅ |
| 1.10 | Action `openNodeInZoneB` | 已存在该 taskId → `switchZoneBTab`; 不存在 → `zoneBTabs.push({type:'node',...})` + `switchZoneBTab` | ✅ |
| 1.11 | Action `closeNodeInZoneB` | 从 `zoneBTabs` 移除; 若关闭的是当前 active → `switchZoneBTab({type:'logs'})` | ✅ |
| 1.12 | Action `switchZoneBTab` | `set({ zoneBActiveTab: tab })` | ✅ |

### 2. 改造 `packages/studio/ui/ts/ZoneD_RightPane.tsx`

| # | 任务 | 详细 | 状态 |
|---|------|------|------|
| 2.1 | 新增模式切换行 | 三个按钮 `💬聊天` `🔧鲁班` `📖司马迁`, 当前 active 高亮 (color:#fff, border-bottom:2px solid #ff1a1a), 非active 灰色 (color:#666). 样式 inline, font-size:12px | ✅ |
| 2.2 | 聊天历史改为渲染 `modeStates[activeMode].liveStream` | 替代全局 `liveStream`, 渲染逻辑不变 (DAG卡片检测/用户消息/系统消息/恢复横幅) | ✅ |
| 2.3 | 发送消息改为按 mode 路由 | chat → `api.chat(content, modeStates.chat.sessionId)`; luban → `api.chat(content, modeStates.luban.sessionId, '鲁班')`; simq → `api.chat(content, modeStates.simq.sessionId, '司马迁')` | ✅ |
| 2.4 | 响应的 sessionId 写入对应 mode | `res.sessionId` → `modeStates[mode].sessionId = res.sessionId` | ✅ |
| 2.5 | 响应用于 `pushToChatMode` | 替代 `pushLiveStream`, 写入 `pushToChatMode(activeMode, {...})` | ✅ |
| 2.6 | localStorage 按 mode 存储 | 三个key: `morpex_session_chat/luban/simq`, 页面加载时分别恢复 | ✅ |
| 2.7 | 移除 `sessionRef` | 改用 store 的 `modeStates[mode].sessionId` | ✅ |
| 2.8 | 移除 `selectedAgent` | 改用 `activeMode` 决定 agent | ✅ |
| 2.9 | 移除 `MentionSuggest` | 删除 `@`提及面板相关代码和状态 (不再需要内联 @Agent 切换) | ✅ |
| 2.10 | DAG卡片节点点击 | `handleNodeClick` → `store.openNodeInZoneB(taskId, executionId, goal.slice(0,15))` | ✅ |

### 3. 改造 `packages/studio/ui/ts/ZoneB_LeftPane.tsx`

| # | 任务 | 详细 | 状态 |
|---|------|------|------|
| 3.1 | 读取 store | `zoneBActiveTab, zoneBTabs, switchZoneBTab, closeNodeInZoneB` | ✅ |
| 3.2 | 仅日志tab时不显示tab行 | `zoneBTabs.length === 1` (即只有 `{type:'logs'}`) → 不渲染tab行, 直接渲染日志+交付物 (保持现有外观) | ✅ |
| 3.3 | 有节点tab时渲染tab行 | `[日志] [task_0·选型] [task_1·排期]`, active有红色下划线. 节点tab后有 × 关闭按钮. 样式 inline: flex, font-size:11px, padding:4px 8px | ✅ |
| 3.4 | 内容区条件渲染 | `activeTab.type==='logs'` → 现有实时日志 (上半) + 交付物 (下半); `activeTab.type==='node'` → `NodeShell` 组件 | ✅ |
| 3.5 | `NodeShell` 组件 (内联) | 读取 `flows[].tasks[]` 中对应 taskId 的 `messages`, `status`, `harnessId`. 过滤系统状态消息, 合并连续同角色消息, 自动滚底 | ✅ |
| 3.6 | NodeShell awaiting_input | 显示选项按钮列表, 点击发送 `api.steerHarness(harnessId, option)` | ✅ |
| 3.7 | NodeShell interrupted/failed | 显示恢复输入框 + 发送按钮, 调用 `api.resumeTask(executionId, taskId, input)` | ✅ |
| 3.8 | NodeShell 加载历史 | `useEffect` 调用 `api.getTaskHistory(executionId, taskId)` 拉取 JSONL 历史 | ✅ |
| 3.9 | NodeShell 自动滚底 | `useEffect` 监听 `messages.length` 和最后一条内容长度 | ✅ |

### 4. 改造 `packages/studio/ui/ts/DagCard.tsx`

| # | 任务 | 详细 | 状态 |
|---|------|------|------|
| 4.1 | 节点点击 → `openNodeInZoneB` | 替换内联 `TaskShell` 展开逻辑 (`expandedTaskId` state + `handleNodeClick`). 调用 `store.openNodeInZoneB(taskId, executionId, goal.slice(0,15))` | ✅ |
| 4.2 | 移除内联 `TaskShell` | 删除 `TaskShell` 组件定义和 `expandedTaskId` 渲染逻辑 | ✅ |
| 4.3 | 保留 DAG 卡片展开/收起 | 点击头部切换节点列表可见性 (`expanded` state) | ✅ |
| 4.4 | 保留节点状态颜色 | `STATUS_COLORS`/`STATUS_LABELS` 不变, 实时状态从 `nodeStatuses` prop 流入 | ✅ |

### 5. 改造 `packages/studio/ui/ts/App.tsx`

| # | 任务 | 详细 | 状态 |
|---|------|------|------|
| 5.1 | SSE `runtime.task.*` 路由 | 根据 `executionId` 找所属 mode: `modeStates[mode].executionId === executionId` → `pushToChatMode(mode, item)`. 也更新全局 `flows` (DAG卡片依赖) | ✅ |
| 5.2 | SSE `cross_domain.dag_created` 路由 | 写入 `modeStates.luban.liveStream` + 设置 `modeStates.luban.executionId = flowId` | ✅ |
| 5.3 | SSE `message_update` 路由 | 推到当前 `activeMode`: `pushToChatMode(activeMode, item)` | ✅ |
| 5.4 | SSE `artifact.created` | 保持全局 `addArtifact` 不变 | ✅ |
| 5.5 | 初始化: 恢复三个 mode 的 session | 从 `localStorage` 读 `morpex_session_chat/luban/simq` → `GET /api/session/{id}/history` → 恢复到 `modeStates[mode].liveStream` | ✅ |
| 5.6 | 初始化: 恢复 flows 缓存 | 保持现有 `loadFlowsFromCache` 逻辑 | ✅ |

---

## 迭代规则

### 原则

1. **每轮只改一个文件, 改完验证编译, 再继续下一个**
2. **后端先于前端, 核心先于外围**
3. **每个文件改完, 必须跑相关测试: `npx tsx packages/core/__tests__/morpex-crossdomain.test.ts` 和 `npx tsx packages/core/__tests__/tc-3.4-eventbus.ts`**
4. **改完后端全部文件后, 跑一次 `npx tsc --noEmit --skipLibCheck` 确保类型无错 (忽略 `__tests__/` 已有报错)**
5. **前端改完每个文件后, 跑 `npx tsc --noEmit --skipLibCheck` 检查类型**
6. **禁止删除任何现有功能, 只重构内部实现**
7. **禁止修改现有 API 的返回结构 (除非明确标注)**
8. **禁止引入新的 npm 依赖**

### 轮次 (11 轮)

```
Round 1:  后端 — 新建 SessionManager.ts           → 验证: import 检查, 类型编译
Round 2:  后端 — 改造 DomainCluster.ts             → 验证: morpex-crossdomain.test.ts
Round 3:  后端 — 改造 DomainClusterManager.ts      → 验证: morpex-crossdomain.test.ts
Round 4:  后端 — 改造 DomainDispatcher.ts          → 验证: morpex-crossdomain.test.ts
Round 5:  后端 — 改造 StudioServer.ts              → 验证: tsc --noEmit
Round 6:  前端 — 改造 stores.ts                    → 验证: tsc --noEmit
Round 7:  前端 — 改造 ZoneD_RightPane.tsx           → 验证: tsc --noEmit
Round 8:  前端 — 改造 ZoneB_LeftPane.tsx            → 验证: tsc --noEmit
Round 9:  前端 — 改造 DagCard.tsx                   → 验证: tsc --noEmit
Round 10: 前端 — 改造 App.tsx                       → 验证: tsc --noEmit
Round 11: 联调 — 全栈测试                            → 验证: 启动服务, 端到端
```

### 验证命令

```bash
# 每轮后端改动后
npx tsx packages/core/__tests__/tc-3.4-eventbus.ts
npx tsx packages/core/__tests__/morpex-crossdomain.test.ts
npx tsx packages/core/__tests__/morpex-common.test.ts

# 每轮前端改动后
npx tsc --noEmit --skipLibCheck 2>&1 | grep -v "__tests__" | grep -v "node_modules"

# 联调
npm start
```

### 阻断条件

- ❌ 任何测试失败 → 修复后再进入下一轮
- ❌ `tsc --noEmit` 出现非 `__tests__/` 目录的错误 → 修复
- ❌ 编译错误涉及改动的文件 → 修复
- ✅ `__tests__/` 目录下已有错误可忽略 (是测试文件本身的导入路径问题)
