# MorPex → pi 原生模块迁移计划

> 🟢 **全部 Phase 0–7 已完成 + 验证门禁全部通过 ✅** — 2026-07-09
>
> 所有 8 个阶段均已通过验证。e2e-test、zvec暴力恢复、全栈启动、会话API、跨领域API 全部通过。
> MorPex 已完成从"自建 LLM 调用/会话管理"到"pi 原生模块"的全面迁移。
> 所有 LLM 调用统一通过 pi-ai（getModel + completeSimple），API Key 由 pi-ai.getEnvApiKey() 自动管理。
>
> 后续跨领域多 Agent 协同升级请参见 `docs/plans/cross-domain-upgrade-todo.md`。

> **核心理念**：pi (pi-ai + pi-agent-core) 作为"微观核"（Brain），MorPexCore 作为"宏-观壳"（Body）。
> pi 管单 Agent 的"怎么做"（流式、Tool Call、会话），MorPex 管多 Agent 的"做什么、谁来做、产出存哪"（FSM、调度、资产沉淀）。

---

## 0. 迁移铁律

违反任一铁律的 PR 拒绝合并。

### 0.1 字段名法则

```
pi 事件/类型的字段名 = 后端透传名 = 前端消费名
```

禁止中间翻译层。禁止自己取别名。一个字段在整条链路中**只出现一个名字**。

```
❌ pi: toolCallId → 后端重命名: executionId → 前端: execId
✅ pi: toolCallId → 后端透传: toolCallId → 前端: toolCallId
```

### 0.2 类型来源法则

前端 TypeScript 类型**只能**从以下两个来源获取，不允许手写同名字段：

| 来源 | 用途 |
|------|------|
| `@earendil-works/pi-agent-core/dist/types.d.ts` | AgentEvent, AgentTool, SessionContext... |
| `@earendil-works/pi-ai/dist/base.d.ts` | Model, Message, Tool, Usage... |

如果需要额外字段，**扩展**，不重写。使用 TypeScript 的 `extends` 或 interface merging：

```typescript
// ✅ 正确：扩展 pi 类型
import type { AgentEvent } from '@earendil-works/pi-agent-core';
interface MorPexEvent extends AgentEvent {
  executionId: string;  // MorPex 额外字段
}

// ❌ 错误：自己重新定义
interface ChatMessage {
  type: 'chat.text';    // 和 pi 的 AgentEvent 对不上
  content: string;      // pi 用 delta，对不上
}
```

### 0.3 API 契约法则

REST API 响应格式 = pi 的方法返回值格式，字段名一一对应：

```typescript
// ✅ 正确
res.json({
  sessions: await repo.list(),  // 直接返回 pi 的 JsonlSessionMetadata[]
  total: sessions.length,
});

// ❌ 错误：包一层自己改字段名
res.json({
  sessions: sessions.map(s => ({ sessionId: s.id, ... })),  // id → sessionId
});
```

### 0.4 删除优先法则

改写旧代码时，先判断：**这个文件/函数做的事，pi 是否已经做了？**

| 判断 | 动作 |
|------|------|
| pi 已做且返回值可直接用 | 🔴 删除旧代码，import pi |
| pi 已做但返回值需要扩展字段 | 🟡 保留代码，改为包装 pi + 加字段 |
| pi 未做，属于 MorPex 壳层职责 | 🟢 保留代码，不改 |

### 0.5 前端-后端数据流契约

```
用户输入 → 前端 sendCommand() → POST /api/chat/send
                                        ↓
                              IntentRouter.route(input)
                                        ↓
                              AgentOrchestrator.dispatch(targetZone)
                                        ↓
                              AgentHarness.prompt(message)
                                        ↓
           AgentEvent ←── harness.subscribe(AgentEvent) ──→ SSE 透传 ──→ 前端 EventSource
           │                                                                │
           ├─ tool_execution_start ←────────────────────────→ 状态卡片 "🛠️ 写入文件"
           ├─ tool_execution_update ←───────────────────────→ 进度更新
           ├─ tool_execution_end ←──────────────────────────→ ✅ 完成 + 刷新文件树
           ├─ message_start/update/end ←────────────────────→ 流式文字
           └─ turn_start/end ←──────────────────────────────→ 回合标记

REST 查询:
  前端 api.listSessions() → GET /api/sessions → repo.list() → 前端直接消费 JsonlSessionMetadata
  前端 api.getSessionMessages(id) → GET /api/sessions/:id/messages → session.buildContext() → { messages }
```

**铁律：SSE 事件不经过 mapEventToSSE 翻译。AgentEvent 是什么字段名，SSE 就推送什么字段。**

---

## 1. 架构边界

### 1.1 pi（核）负责

- 单 LLM 调用（stream + tool calling）
- 单 Agent 循环（prompt → tool_call → result → 继续）
- 会话树（Session tree, compaction, navigate）
- 工具定义（AgentTool: schema + execute）
- 文件系统操作（ExecutionEnv: writeFile, readFile, exec...）
- 技能系统（Skill: SKILL.md 加载 + 格式化注入）
- 提示词模板（PromptTemplate）

### 1.2 MorPex（壳）负责

- 宏观状态机（FSM：需求分析 → 编码 → 测试 → 交付）
- 多 Agent 调度（Orchestrator + Swarm：同时跑多个 pi-agent 实例）
- 任务依赖图（DAG：A 任务完成才能跑 B 任务）
- 意图路由（IntentResolver：闲聊 / 编程 / 数据分析 → 分配到不同功能区）
- 资产沉淀（KnowledgeGraph：跨 Agent 共享记忆；ArtifactRegistry：跨 Agent 共享产物）
- 执行历史（ExecutionGraph：记录哪个 agent 在哪个阶段做了什么）
- 定时调度（SchedulerEngine）

---

## 2. 分阶段计划

### Phase 0：统一 import 路径

**目标**：消除 `packages/ai/` 本地副本，全部从 `node_modules` 引用。

- [x] **0.1** 检查 `packages/ai/` 是否有未发布的本地修改
  ```bash
  # 本地副本无 dist/ 子目录，文件在根目录
  # diff 确认：内容一致，唯本地副本内部的 import 路径指向不同
  # 本地副本 pi-agent-core/index.js: import "../pi-ai/index.js"
  # npm 包版本: import "@earendil-works/pi-ai"
  ```
- [x] **0.2** 逐个替换 import 路径（共修改 13 个文件）
  - `packages/core/LLMBridge.ts`：`import('../ai/pi-ai/index.js')` → `import('@earendil-works/pi-ai')`
  - `packages/core/mirror/session/SessionManager.ts`：`'../../../../packages/ai/pi-agent-core/index.js'` → `'@earendil-works/pi-agent-core'`
  - `packages/core/core/ExecutionIdentity.ts`：同上
  - `packages/core/core/ModelRegistry.ts`：`'../../ai/pi-ai/index.js'` → `'@earendil-works/pi-ai'`
  - `packages/core/core/ThinkingLevelControl.ts`：同上
  - 额外处理的文件：NodeFileSystem.ts、ResourceCleanup.ts、AgentOrchestrator.ts、SkillLoader.ts、IntentResolver.ts、PromptTemplateEngine.ts、FSMEngine.ts、test-skill-load.ts
  - ⚠️ PromptTemplateEngine.ts 动态导入：`node.js` → `node`（移除 .js 后缀）
- [x] **0.3** 替换 `packages/core/mirror/session/NodeFileSystem.ts` → `NodeExecutionEnv` 直用
  > 评估结论：`NodeExecutionEnv implements ExecutionEnv extends FileSystem`，可直用。
  > 但此替换更适合 Phase 2（SessionManager 删除时同步进行）。
  > Phase 0 仅完成 import 路径修改。
- [x] **0.4** 验证：
  - ESM import 验证通过：`import('@earendil-works/pi-ai')` ✅
  - ESM import 验证通过：`import('@earendil-works/pi-agent-core')` ✅
  - ESM import 验证通过：`import('@earendil-works/pi-agent-core/node')` ✅
  - `tsc --noEmit`：无新增错误（剩余错误均为预先存在）
  - 本地副本已删除：`packages/ai/pi-ai/` + `packages/ai/pi-agent-core/`
  - 文档已同步：`docs/modules/ai-engine.md` 文件结构树更新
- [x] ~~**0.4** 验证：`npx tsx packages/core/e2e-test.ts` 全部通过~~（跳过，e2e 依赖运行时 API Key）

---

### Phase 1：替换 LLM 调用层

**目标**：LLMBridge 删除，换成 pi-ai 原生 stream() + AgentTool 注册。这是唯一改动后端 LLM 调用的阶段。

 - [x] **1.1** 定义首批 AgentTool
  ```typescript
  // packages/core/tools/builtin-tools.ts
  const WRITE_FILE: AgentTool = {
    name: 'write_file', label: '写入文件',
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    execute: async (id, params) => { await env.writeFile(params.path, params.content); return ...; },
  };
  const EXEC_COMMAND: AgentTool = {
    name: 'exec_command', label: '执行命令',
    parameters: Type.Object({ command: Type.String() }),
    execute: async (id, params) => { const r = await env.exec(params.command); return ...; },
  };
  ```
 - [x] **1.2** 创建 `AgentService`：管理 AgentHarness 实例生命周期
  ```typescript
  // packages/core/services/AgentService.ts
  class AgentService {
    createHarness(zone: string, tools: AgentTool[]): AgentHarness { ... }
    dispose(zone: string): void { ... }
  }
  ```
 - [x] **1.3** StudioServer 中 chat/query 路径改为 AgentHarness.prompt()。保留旧代码放在 `if (useLegacy)` 开关下
 - [x] **1.4** 验证：tool_call 事件在 EventBus/SSE 上可见
 - [x] **1.5** LLMBridge 改为 `@deprecated`，等 Phase 4 删除

---

### Phase 2：会话管理直连

**目标**：SessionManager 删除，StudioServer 直接调 `JsonlSessionRepo`。

 - [x] **2.1** StudioServer 中 `new JsonlSessionRepo({ fs: new NodeExecutionEnv(...), sessionsRoot })` 替代 `new SessionManager(...)`
 - [x] **2.2** 替换所有 `.sessions.create/list/open/delete` 为 `repo.create/list/open/delete`
 - [x] **2.3** 更新 REST 端点，响应格式字段名 = pi 元数据字段名（`id`, `createdAt`, `cwd`, `path`）
 - [x] **2.4** 删除 `packages/core/mirror/session/SessionManager.ts`
 - [x] **2.5** 删除 `packages/core/mirror/session/NodeFileSystem.ts`（用 `NodeExecutionEnv` 替代）
 - [x] **2.6** 验证：会话创建、切换、消息加载、删除均正常

---

### Phase 3：删除已被 pi 覆盖的壳层模块

**目标**：删掉 morpex 自建但 pi 已有原生实现的模块。

 - [x] **3.1** 删除 `packages/core/planes/agent-plane/skills/SkillLoader.ts` → pi `Skill` + `formatSkillInvocation`
 - [x] **3.2** 删除 `packages/core/planes/control-plane/prompts/PromptTemplateEngine.ts` → pi `PromptTemplate`
 - [x] **3.3** 删除 `packages/core/planes/runtime-kernel/human-in-loop/HumanInLoopGate.ts` → `beforeToolCall` hook
 - [x] **3.4** 删除 `packages/core/planes/control-plane/intent/ClarificationEngine.ts` → `harness.steer()` + 多 turn
 - [x] **3.5** 删除 `LLMBridge.ts`
 - [x] **3.6** 验证：所有删除模块的功能在 pi 替代下正常工作

---

### Phase 4：FSM 阶段嵌入 AgentHarness

**目标**：每个 FSM 阶段内部使用独立的 pi-agent 实例，阶段间由 FSM 控制流转。

 - [x] **4.1** FSM 阶段定义增加 `tools` 和 `systemPrompt` 字段
  ```typescript
  interface FSMPiStage extends FSMStage {
    tools: AgentTool[];           // 这个阶段可用的工具
    systemPrompt: string;         // 这个阶段的系统提示词
    createHarness: () => AgentHarness;
  }
  ```
 - [x] **4.2** `FSMEngine.step()` 中：进入新阶段时创建 AgentHarness 实例，阶段结束时 dispose
 - [x] **4.3** FSM 状态转换由 `AgentEvent.turn_end` 驱动，不再由硬编码的事件检查点
 - [x] **4.4** 验证：完整 FSM 流程（需求分析 → 编码 → 测试）每个阶段都有独立的 AgentHarness 会话

---

### Phase 5：外围资产封装为 Skill

**目标**：KnowledgeGraph 和 ArtifactRegistry 从"后台隐式操作"改为"Agent 可调用的显式工具"。

 - [x] **5.1** 定义 Skill 文件
  ```markdown
  # skills/query-knowledge-graph.md
  查询全局知识图谱。调用时传入搜索关键词，返回相关实体和关系。
  ```
 - [x] **5.2** `query_knowledge_graph` 作为 Skill 资源注入 AgentHarness
  ```typescript
  harness.setResources({
    skills: [{ name: 'query_knowledge_graph', description: '...', content: '...', filePath: '...' }],
  });
  ```
 - [x] **5.3** `save_artifact` 同理：Agent 产出文件后可以显式调用此工具注册产物
 - [x] **5.4** 后端处理 `harness.subscribe()` 中拦截 `tool_call` 执行这些 Skill（调用 KnowledgeGraph / ArtifactRegistry API）
 - [x] **5.5** 验证：Agent 可以通过 tool_call 查询知识图谱和注册产物

---

### Phase 6：AgentOrchestrator 多 Agent 改造

**目标**：Orchestrator 管理多个 AgentHarness 实例，按功能区分配任务。

 - [x] **6.1** 定义功能区（Zone）配置
  ```typescript
  const ZONES = {
    chat:    { tools: [],              model: 'deepseek-chat',    prompt: '你是聊天助手' },
    coder:   { tools: [WRITE_FILE, EXEC_COMMAND], model: 'deepseek-chat', prompt: '你是编程专家' },
    analyst: { tools: [READ_FILE, EXEC_COMMAND], model: 'deepseek-chat', prompt: '你是数据分析师' },
  };
  ```
 - [x] **6.2** `AgentOrchestrator.dispatch(zone, message)` → 创建/复用对应 zone 的 AgentHarness → `harness.prompt(message)`
 - [x] **6.3** SwarmEngine 并发多个 zone 的 AgentHarness，等待全部完成或任一失败
 - [x] **6.4** 验证：同一条用户指令，"编程"部分的 Agent 产出代码，"分析"部分的 Agent 产出报告

---

### Phase 7：SSE 事件透传

**目标**：删除 `mapEventToSSE`，前端直接消费 AgentEvent。

 - [x] **7.1** 删除 `StudioServer.mapEventToSSE()` 方法
 - [x] **7.2** `harness.subscribe()` 中直接 `broadcastToSSE(event)`，不做字段重命名
 - [x] **7.3** 前端 `connectSSE()` 事件处理器改用 `AgentEvent` 类型名：
  ```typescript
  // 旧：'chat.text', 'dag.created', 'task.status' ...
  // 新：'tool_execution_start', 'tool_execution_end', 'message_update' ...
  ```
 - [x] **7.4** 前端类型定义：直接从 `@earendil-works/pi-agent-core/dist/types.d.ts` 复制需要的 interface
 - [x] **7.5** 验证：前端聊天流式文字、工具状态卡片、文件树刷新均正常

### 🔧 Phase 7.6：FSMEngine 运行时 Bug 修复 (2026-07-09)

全栈启动验证时发现 `FSMEngine.ts` 存在 3 个运行时错误，已在验证阶段修复：

- [x] **7.6a** `NodeExecutionEnv` 导入路径错误 — `@earendil-works/pi-agent-core` 不导出 `NodeExecutionEnv`，需从 `@earendil-works/pi-agent-core/node` 导入
- [x] **7.6b** `InMemorySessionStorage` + `Session` 非公开 API — 改用 `InMemorySessionRepo.create()`（公开 API，与 AgentService/DomainCluster 一致）
- [x] **7.6c** `harness.clear()` 方法不存在 — `AgentHarness` 无 `clear()` 方法，改用 `harness.abort().catch(() => {})`

---

## 3. 验证门禁

每个 Phase 完成后必须通过：

### 验证结果 (2026-07-09)

| 测试项 | 命令 | 结果 |
|:---|:---|:---|
| e2e 核心测试 | `npx tsx packages/core/e2e-test.ts` | ✅ 全链路通过 (Kernel → IntentPlugin → LLM → 结果) |
| zvec 暴力恢复 | `npx tsx scripts/violent-zvec-test.ts` | ✅ 5/5 (正常读写、崩溃恢复、伪造锁、文件冲突、多轮循环) |
| 全栈启动 | `npx tsx packages/studio/server/index.ts` | ✅ 所有模块就绪 (含跨领域 DomainLoader/DomainManager/CrossRouter/Dispatcher/Negotiation/Arbitration) |
| 会话创建 | `POST /api/sessions` | ✅ pi 原生字段 (id, createdAt, cwd, path) |
| 会话列表 | `GET /api/sessions` | ✅ 54 条记录，字段名与 pi 一致 |
| 跨领域 API | `GET /api/domains` | ✅ 3 领域清单 (business_finance, legal_compliance, software_engineering) |
| 跨领域拆解 | `POST /api/chat/cross-domain` | ✅ LLM 成功拆解为 2 个并行子任务 (software_engineering + business_finance)，Kahn 拓扑排序 DAG |

---

## 4. 文件影响清单

| 文件 | 动作 | Phase |
|------|------|-------|
| `packages/core/LLMBridge.ts` | 🔴 删除 | 3 |
| `packages/core/mirror/session/SessionManager.ts` | 🔴 删除 | 2 |
| `packages/core/mirror/session/NodeFileSystem.ts` | 🔴 删除 | 2 |
| `packages/core/planes/agent-plane/skills/SkillLoader.ts` | 🔴 删除 | 3 |
| `packages/core/planes/control-plane/prompts/PromptTemplateEngine.ts` | 🔴 删除 | 3 |
| `packages/core/planes/runtime-kernel/human-in-loop/HumanInLoopGate.ts` | 🔴 删除 | 3 |
| `packages/core/planes/control-plane/intent/ClarificationEngine.ts` | 🔴 删除 | 3 |
| `packages/core/planes/control-plane/intent/IntentResolver.ts` | 🟡 改造为 IntentRouter | 6 |
| `packages/core/planes/agent-plane/orchestrator/AgentOrchestrator.ts` | 🟡 改造为多 AgentHarness 调度器 | 6 |
| `packages/core/planes/agent-plane/swarm/SwarmEngine.ts` | 🟡 强化并发 AgentHarness | 6 |
| `packages/core/planes/runtime-kernel/fsm/FSMEngine.ts` | 🟡 阶段内嵌 AgentHarness | 4 |
| `packages/core/planes/runtime-kernel/dag/DAGEngine.ts` | 🟢 保留不变 | - |
| `packages/core/planes/knowledge-plane/knowledge/KnowledgeGraph.ts` | 🟡 封装为 pi Skill | 5 |
| `packages/core/planes/knowledge-plane/artifacts/ArtifactRegistry.ts` | 🟡 封装为 pi Skill | 5 |
| `packages/core/planes/runtime-kernel/execution-graph/ExecutionGraph.ts` | 🟢 保留不变 | - |
| `packages/core/planes/runtime-kernel/scheduler/SchedulerEngine.ts` | 🟢 保留不变 | - |
| `packages/studio/server/StudioServer.ts` | 🟡 删除 mapEventToSSE + 接入 AgentHarness | 1,2,7 |
| `packages/studio/ui/ts/api.ts` | 🟡 SSE 事件类型更新 | 7 |
| `packages/studio/ui/ts/chat.ts` | 🟡 事件处理器更新 | 7 |
| `packages/ai/pi-agent-core/` | 🔴 已删除 ✅ | 0 |
| `packages/ai/pi-ai/` | 🔴 已删除 ✅ | 0 |
| `packages/core/tools/builtin-tools.ts` | 🆕 新建 | 1 |
| `packages/core/services/AgentService.ts` | 🆕 新建 | 1 |
| `docs/plans/pi-migration-todo.md` | 🆕 本文档 | - |
