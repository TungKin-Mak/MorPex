# MorPex Space 组织模型设计（P1 + P2）

> 状态：设计契约（实施依据）。目标：把 UI 的 session 抽象为「组织 Space」——总部 + 部门，
> 部门由已安装工作流包驱动生成；任务走「编排层(用户↔经理) → 工位层(经理↔step-agent) → 执行肢(工具)」三层；
> 部门间/工位间可真正"对话"（AgentMailbox）。
> 关联：docs/guides/workflow-xjmcu.md、packages/workflows/WORKFLOW_PLUGIN_STANDARD.md、
> ui_session_log.md（17i 系列）、SESSION_LOG.md。

---

## 0. 已实证的引擎能力（设计依赖）

| 能力 | 位置 | 结论 |
|---|---|---|
| Department 实体（leadAgentId/groupChatId 预留） | packages/core/src/governance/control-plane/department-types.ts | Space 映射基础，groupChatId 待启用 |
| OrchestratorAgent.run(goal,{departmentId,contextHint}) | packages/core/src/execution/orchestration/OrchestratorAgent.ts | 已支持部门参数，persona 注入点 |
| 每步骤独立 agent 会话 | AgentSessionStore + StepAgentExecutor（stepSessions/upstreamSessions） | 工位会话已具备，异步产物传递 |
| 执行肢（原语工具）纯执行不聊天 | primitiveAgentTools + DomainPrimitiveRegistry | 完全符合"执行肢不交流" |
| 工作流插件包（manifest+provider+actions+artifacts） | packages/workflows/{xjmcu,hardware,software,ecommerce} | 部门生成来源；matchGoal 是路由钩子 |
| WorkflowRegistry/WorkflowExecutor | packages/core/src/evolution/workflow/ | 工作流注册与执行（steps→PlanStep，agentType/domain=工位） |
| agent.message / agent.message.sent / agent.message.received | packages/core/src/infrastructure/protocol/events/EventType.ts | 事件类型已预留，无发射者 → P2 落点 |
| 跨部门静态机制（非对话） | CrossDepartmentArbitrationEngine / KnowledgeSynthesizer | 规划期仲裁/知识融合，不是实时对话 |
| 意图分流 | IntentClassifier / GoalIntelligenceFacade（executeGoal 内） | 闲聊 vs 任务分流已具备 |
| 会话/历史 | SessionStore（chat-history/*.jsonl）+ StudioServer chat/send | 需扩展为 Space 归属 |

## 1. Space 模型

```
┌─────────────────────────────────────────────┐
│ 🏢 总部 Space（spaceId='hq'）                │
│   ├─ 🤖 秘书线程：日常闲聊 + 任务路由入口      │
│   └─ （按已装工作流包生成部门 Space）          │
│   ├─ 💻 软件部 Space  (workflow=software)    │
│   ├─ 📣 电商部 Space  (workflow=ecommerce)   │
│   ├─ 🔌 嵌入式部 Space(workflow=xjmcu)       │
│   └─ 🛠 硬件部 Space  (workflow=hardware)    │
└─────────────────────────────────────────────┘
```

每个部门 Space 内部（对用户是一个"部门群聊"，物理上三层上下文隔离）：

```
部门 Space（如嵌入式部）
├─ 编排层线程：用户 ↔ 部门经理 persona（接单/澄清/方案确认/汇报）  ← 每任务一条
├─ 工位层会话：经理 ↔ 各 step-agent 工位（电路设计/程序开发/结构） ← 引擎已有
│     ╰ 工位间可私聊（AgentMailbox，P2）：电路设计↔程序开发谈外设
├─ 执行肢：原语工具干活不聊天（引擎已有）
└─ 跨部门对话（AgentMailbox，P2）：嵌入式经理↔采购经理谈预算
```

### 1.1 实体定义

```ts
// core/src/governance/control-plane/space-types.ts（新增）
export interface Space {
  id: string;                 // 'hq' | `dept_${departmentId}` | `task_${missionId}`
  type: 'hq' | 'department' | 'task';
  name: string;
  icon?: string;
  parentId: string | null;    // hq 无父；department 父=hq；task 父=department
  departmentId?: string;      // department/task 时有
  workflowId?: string;        // 部门由工作流包驱动时
  managerPersona?: string;    // 经理角色设定（LLM persona）
  stationNames?: string[];    // 工位清单（来自 workflow steps agentType/domain）
  createdAt: number;
}

export interface SpaceTree {
  hq: Space;
  departments: Space[];
  // task spaces 按需查询（不常驻内存）
}
```

### 1.2 部门 Space 由工作流包驱动生成

- 启动时（bootstrap）扫描已注册的 `WorkflowProvider`（现有 registry）+ `packages/workflows/*/manifest.json`。
- 每个 provider 生成一个部门 Space：
  - `name/icon` ← manifest.name/description + **中文映射表（支持自定义别名）**：
    - 默认映射 `software→软件部 / ecommerce→电商部 / xjmcu→嵌入式部 / hardware→硬件部`
    - 自定义别名优先级：`data/space-aliases.json`（用户可改）> 默认映射表 > manifest.name
  - `managerPersona` ← provider 描述 + 部门职责 prompt（模板）
  - `capabilities` ← provider 的 actions / WorkflowExecutor steps 的 agentType（**仅作能力提示，不是硬性工位列表**）
  - `matchGoal` ← provider.matchGoal（路由兜底）
- 新增端点 `POST /api/space/:id/install-workflow`（可选，P3 完整化）——先以"启动自动发现"为主。

### 1.3 引擎会话 ↔ UI 映射（用户确认）

```
引擎内部（多独立会话，结构不动）              UI 显示（聚合）
├─ chat-history/<sessionId>.jsonl  ──┐   ┌─ 部门 Space（容器）
│   （用户↔经理对话：接单/澄清/方案/汇报）│   │   ├─ 任务线程#1（聚合 chat-history 的 threadId 消息
│                                     ├───┤      + agent-sessions 该任务全部会话的只读投影）
├─ agent-sessions/--orchestrator--/  │   │   ├─ 任务线程#2 …
│   （每任务一个编排器会话）            │   │   └─ 秘书闲聊线程
└─ agent-sessions/<工位>/            │   └─ 总部 Space（秘书闲聊 + 路由入口）
    （每步骤一个工位会话）              └────（UI 按 spaceId/threadId 分组，引擎存储不动）
```

- `chat-history` 是消息真相源：P1 给消息加 `kind/spaceId/threadId` 归属字段，UI 按字段分组展示成「Space → 任务线程」，引擎会话存储/结构不变（向后兼容旧数据）。

## 2. 路由（Q4：LLM 判断）

`chat/send` 分流升级：

```
用户消息
  ├─ IntentClassifier（已有）：chat → 秘书闲聊线程（不回部门）
  └─ task → 路由决策：
        ├─ 主：秘书 LLM 判断（"这个任务该交给哪个部门" → spaceId/departmentId）
        │    提示词注入各部门 name/desc/matchGoal 关键词，输出部门 id；LLM 失败回退 matchGoal
        └─ 兜底：遍历 provider.matchGoal(goal)，取最高分部门；无命中 → 软件部（默认）
```

- 路由结果写入 chat/send 的 `departmentId`（executeGoal 已支持）。
- 前端：任务气泡/卡片标注入驻的部门 Space（"已转交 💻 软件部"）。

## 3. 编排器 persona 化

- `OrchestratorAgent.run(goal, { departmentId, managerPersona, capabilities })`：
  - 分析 prompt 前置注入经理 persona：「你是{部门}的经理。本部门可用能力：{capabilities}。请以经理口吻拆解任务。」
  - **工位由 LLM 按任务复杂度动态编排**（用户确认 Q3）：capabilities 仅作能力提示，编排器视任务需要自由组织工位/步骤，不硬性绑定 workflow 步骤列表。
- `CompanyFacade.executeGoal` 透传 departmentId + persona（已支持 departmentId，补 persona 透传）。
- 后端 `chat/send`：任务消息落库带 `spaceId`（部门 Space）+ `threadId`（任务线程=missionId）。

## 4. AgentMailbox（P2，真交流）

### 4.1 服务

```ts
// core/src/execution/AgentMailbox.ts（新增）
interface MailMessage {
  id: string;
  from: string;              // agentId 或 'dept:xxx' 或 'station:xxx'
  to: string;
  spaceId: string;           // 归属 Space（部门/任务）
  text: string;
  createdAt: number;
  resolved?: boolean;
  reply?: string;            // 对方回复
}
```

- `sendAndWait(from, to, text, opts): Promise<string>` —— 阻塞等待对方回复（同 ask_user 模式，带超时）。
- 落盘：`data/mailbox/<spaceId>.jsonl`。
- 事件：`agent.message`（发出）、`agent.message.sent` / `agent.message.received`（投射 SSE）。
- 路由表：`to` 支持部门粒度（`dept:${departmentId}` → 该部门经理 persona 决定回复，可再下派工位）与工位粒度（`station:${stationId}`）。
- 接入点：
  - 工位间：StepAgentExecutor 增加 `mail` 原语（step-agent 可"问隔壁工位"，阻塞等回复，工具返回文本继续执行）。
  - 部门间：编排器/步骤分析阶段允许"咨询其它部门"（如嵌入式问采购预算）。

### 4.2 触发与呈现（Q2=A：自动 + 只读旁观）

- 默认自动执行，用户**只读旁观**：前端部门 Space 内投影工位/部门间对话流水（可折叠，样式类似群聊小气泡）。
- 仅高风险/大额（沿用 ApprovalGate 策略）才升级为人工门（HumanDecision，后续统一）。

## 5. 会话/持久化

- 现状：SessionStore `chat-history/<sessionId>.jsonl` 平铺所有消息。
- P1 改造：`appendChatMessage` 消息增加字段 `{ kind: 'chat'|'task', spaceId?, threadId?, departmentId? }`（向后兼容：旧消息无字段按 chat）。
- 前端 loadHistory 按 `spaceId` 过滤展示（进入哪个 Space 看哪个 Space 的消息）。
- Space 树本身持久化：`data/spaces.json`（防抖落盘，类似 artifacts.snapshot）。

## 6. 事件契约（新增）

```
space.created            → { space: { id, type, name, parentId, departmentId, workflowId } }
space.message.user       → { spaceId, threadId?, text }            （用户在某 Space 发言）
task.routed              → { goal, spaceId, departmentId, workflowId, confidence }
agent.message            → { id, from, to, spaceId, text }          （AgentMailbox 发出）
agent.message.sent       → 同上（投射 SSE）
agent.message.received   → { id, from, to, spaceId, reply }        （投射 SSE）
```

复用：`mission.created/updated`、`execution.step.*`、`chat.stream.delta`（流式）等既有事件不动。

## 7. REST 契约（新增/扩展）

```
GET  /api/spaces                        → { ok, tree: { hq, departments[] } }
GET  /api/spaces/:id/messages           → { ok, messages[] }（按 spaceId 过滤历史）
POST /api/chat/send                     → body 增加 { spaceId?, departmentId? }；响应增加 { routedTo?, spaceId? }
GET  /api/mailbox/:spaceId              → { ok, messages[] }（只读旁观 P2）
POST /api/mailbox/send                  → { ok, messageId }（预留，供调试/人工代发）
```

## 8. 前端（web）改动

### 8.1 侧栏：会话列表 → 空间树
- 总部（秘书闲聊 + 路由入口）+ 各部门（软件/电商/嵌入式/硬件），点击进入对应 Space。
- 保留"历史会话"折叠区（兼容旧会话）。

### 8.2 部门 Space 对话视图
- 顶部：部门名 + 经理 persona + 工位清单（chips）。
- 中部：任务线程列表（该部门已下达任务：每任务一个线程卡片）+ 当前选中线程的对话（用户↔经理：接单/澄清/方案/汇报）。
- 底部：输入条（发送任务到该部门 / 在该线程回复）。
- 工位执行动态：只读投影（DAG/步骤/流式，复用 LiveCardController）。

### 8.3 秘书 Space
- 日常闲聊（复用现闲聊流式）+ 任务路由提示（"这个任务我转交 💻 软件部了"）。

### 8.4 只读旁观投影（P2）
- 部门 Space 内可折叠"工位间/部门间对话"流水（AgentMailbox 消息，只读）。

## 9. 分阶段任务拆解

### P1（部门 Space 化）
- [ ] 后端：`space-types.ts` + `SpaceService`（build tree / 持久化 / 事件）
- [ ] 后端：bootstrap 扫描 WorkflowProvider → 生成部门 Space
- [ ] 后端：路由（秘书 LLM + matchGoal 兜底）接入 chat/send
- [ ] 后端：OrchestratorAgent persona 注入 + executeGoal 透传
- [ ] 后端：SessionStore 消息加 kind/spaceId/threadId + GET /api/spaces + chat/send 扩展
- [ ] 前端：侧栏空间树
- [ ] 前端：部门 Space 视图（线程列表 + 经理对话 + 工位动态投影）
- [ ] 前端：秘书 Space（闲聊 + 路由提示）
- [ ] 门禁：root tsc / web typecheck+build / api-contract

### P2（AgentMailbox 真交流）
- [ ] 后端：`AgentMailbox` 服务（sendAndWait/落盘/事件/路由表）
- [ ] 后端：StepAgentExecutor 接入 mail 原语（工位间）+ 编排器跨部门咨询
- [ ] 后端：GET /api/mailbox/:spaceId + 事件投射
- [ ] 前端：部门 Space 只读旁观投影（可折叠）
- [ ] 门禁：root tsc / web typecheck+build

### P3（后续，不在本次）
- 工作流包安装 UI（POST /api/space/install-workflow）、WorkflowIntelligence 学习→导出包闭环、HumanDecision 统一人工门。

## 10. 风险与兼容

1. **旧会话兼容**：旧 chat-history 无 kind/spaceId → 默认归入"历史会话"区，不强制迁移。
2. **路由误判**：LLM 路由错误 → 任务进错部门。缓解：路由结果在任务卡片上可见 + 提供"转交"（后续）；matchGoal 兜底保底。
3. **编排器 persona 影响既有任务**：默认 persona 只影响分析口吻与工位选择，不改执行语义；不注入时行为与现状一致。
4. **AgentMailbox 阻塞超时**：必须有超时兜底（默认 5 分钟），超时按"未回复继续"处理，不卡死任务。
5. **多任务并发**：Space/线程隔离天然解决"回复错任务"（每线程自己的上下文 + 决议按 id）。
6. **SSE 过滤**：前端按 spaceId/threadId 过滤事件，避免跨 Space 串扰（复用 isRunRelevant 机制）。
