# 单一 Transcript 会话架构 — 重构设计文档

> 状态：设计稿 v1（待评审） · 参考：OpenClaw（/tmp/openclaw-ref，同源 pi-agent-core 生态）
> 范围：统一"UI 聊天历史 ↔ agent 会话"存储，结构性解决多轮断裂、流式丢失、孤儿数据三大痛点
> 原则：遵守 AGENTS.md 铁律（EventBus Only / PiBridge 隔离 / 领域隔离 / 真相源优先）；按一人维护规模裁剪，拒绝过度设计

---

## 0. TL;DR

**逻辑上单一真相源 = pi 的 session transcript；UI 历史 = 它的投影。**
物理实现选 **"JSONL 真相源 + SQLite 读模型"**（方案 A2）：pi `JsonlSessionRepo` 继续作为 LLM 上下文的唯一写入方（零风险复用其重放/压缩语义），新增轻量索引器把条目镜像进 SQLite（追加式 `transcript_events`），UI 历史 API 全部改查 SQLite 投影。审批用 `custom_message` 条目落库。

不选 OpenClaw 式"SQLite 为唯一真相源"（A1）的原因：需自实现 pi 的 SessionStorage 接口并正确复刻 compaction/replay 语义，升级 pi 版本时风险自担——一人规模下性价比不足。A2 达成全部用户可见目标，且保留 A1 作为演进路径。

---

## 1. 设计目标与非目标

### 目标
| # | 目标 | 对应现状痛点 |
|---|---|---|
| G1 | 多轮对话对 LLM 连续：同一会话的每次 executeGoal 能看到全部历史 | executeGoal 每次新建 orchestrator 会话（`OrchestratorAgent.ts:309`，`orch_${Date.now()}`），历史从不回读 |
| G2 | UI 显示 = LLM 上下文：一套 transcript，展示层只是投影 | chat-history jsonl 与 agent-sessions jsonl 两套存储、无关联字段 |
| G3 | 流式内容低丢失：回合级原子落库 + 崩溃后可恢复到最近完整回合 | SSE delta 不落库 |
| G4 | UI 消息可追溯 agent 轨迹：chat 消息 ↔ transcript 条目双向可查 | threadId 回填窗口 + 孤儿 |
| G5 | 审批/人工把关有审计记录（custom_message 扩展） | 现无持久化审批事件 |
| G6 | 会话 reset/compact 不产生孤儿（窗口链 + 归档） | 删除即孤儿 |

### 非目标（明确不做）
- ❌ 替换 pi-agent-core 的 AgentHarness / 自研上下文管理——继续用它
- ❌ OpenClaw 规模的清理服务（磁盘预算/high-water 强制回收/zstd 冷备）——一人公司不需要，用简单保留策略
- ❌ 渠道路由（WhatsApp/Telegram 等 channel 概念）——MorPex 只有 Studio UI 一个入口
- ❌ 多进程并发写同一 transcript——Studio server 是单进程
- ❌ 本期改前端组件结构——只换数据来源 API

---

## 2. 总体架构

```
┌─────────────────────────── 写入侧（唯一写者 = PiBridge/AgentHarness）───────────────────────────┐
│                                                                                                  │
│  POST /api/chat/send                                                                             │
│    └─ ChatTranscriptService.resolve(chatSessionId)                                               │
│         ├─ 已有 window → JsonlSessionRepo 打开既有 .jsonl（resume，G1 核心）                      │
│         └─ 无 → create（sessionKey 锚定，见 §3）                                                  │
│    └─ companyFacade.executeGoal(msg, { session })   ← session 句柄透传（PiBridge config.session）│
│         └─ OrchestratorAgent：不再自建 orch_${ts}，复用传入 session（step/executor 子会话挂树）   │
│              harness 运行中自动 appendMessage（user/assistant/thinking/toolCall/toolResult）      │
│         └─ 回合收尾：ChatTranscriptService.appendTurn(...)  ← assistant 总结+元数据，原子追加     │
│                                                                                                  │
└──────────────┬───────────────────────────────────────────────────────────────────────────────────┘
               ↓ 镜像（Indexer：tail -f 式增量，水位线 entrySeq）
┌──────────────▼──────────── 读模型（better-sqlite3，data/sessions/transcript.db）─────────────────┐
│  transcript_windows(session_id PK, session_key UNIQUE, previous_session_id, reason, status…)     │
│  transcript_events(session_id, seq, byte_offset, kind, role, preview)                        │
│  chat_index(chat_session_id, message_seq, role, kind, preview, mission_id, created_at)           │
└──────────────┬──────────────────────────────────────────────────────────────────────────────────┘
               ↓ 投影（sanitize + 过滤）
┌──────────────▼──────────── 读取侧 ───────────────────────────────────────────────────────────────┐
│  GET /api/session/:id/history?v2=1   → 投影后的消息数组（剥签名/截断 thinking/display 过滤）      │
│  GET /api/session/:id/events?after=seq→ 增量同步                                                 │
│  SSE /api/stream/global             → 实时流（live buffer 上限 + 回合结束触发前端按 seq 对账）    │
│  审批：POST /api/approval/:requestId  → 写 approval_decision(custom_message) + 放行运行时门控     │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

职责边界（铁律对齐）：
- **只有 PiBridge 允许 import `@earendil-works/pi-*`**（现有红线不变）。新代码落位：
  - `packages/core/src/infrastructure/adapters/pi-bridge/` 内扩展 session resume 工厂（PiBridge 静态方法）
  - `packages/studio/server/transcript/`：ChatTranscriptService / Indexer / projection / history 路由（纯 TS，不触 pi，经 EventBus 收执行事件）

---

## 3. 存储层设计

### 3.1 物理布局

```
data/sessions/
├── transcript.db                  # 新：SQLite 读模型（WAL 模式）
├── transcripts/<sessionId>.jsonl  # 新：UI 会话真相源（JsonlSessionRepo 格式）
├── agent-sessions/...             # 保留：编排子会话树（orchestrator/step/executor），父链挂 UI 会话
├── chat-history/                  # 冻结：迁移后只读，最终移入 _legacy/
└── _legacy/                       # 迁移归档（不删，可回滚）
```

### 3.2 SQLite DDL 草案（better-sqlite3，STRICT 表）

```sql
PRAGMA journal_mode=WAL;

-- 会话窗口（借鉴 openclaw-agent-schema.sql:112，大幅裁剪）
CREATE TABLE IF NOT EXISTS transcript_windows (
  session_id         TEXT PRIMARY KEY,            -- pi session id（uuidv7）
  session_key        TEXT NOT NULL UNIQUE,        -- 路由锚点，见 §3.3
  previous_session_id TEXT,                       -- reset/fork 链
  reason             TEXT CHECK (reason IS NULL OR reason IN
                       ('initial','reset','fork','rewind','compaction')),
  status             TEXT CHECK (status IN ('active','archived')),
  display_name       TEXT,
  component          TEXT,                        -- 'main' | 'orchestrator' | 'step-agent' | 'executor'
  parent_session_id  TEXT,                        -- 子会话挂 UI 会话（G4 关联）
  model_provider     TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
) STRICT;

-- 追加式事件索引（★ 不存正文，只存坐标：正文唯一存在 jsonl 里）
CREATE TABLE IF NOT EXISTS transcript_events (
  session_id   TEXT NOT NULL REFERENCES transcript_windows(session_id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,                  -- pi entry seq，单调递增
  byte_offset  INTEGER NOT NULL,                  -- ★ 该条目在 jsonl 文件中的字节偏移
  byte_length  INTEGER NOT NULL,                  -- ★ 该行字节数（seek 后一次读完）
  kind         TEXT NOT NULL DEFAULT 'internal',  -- 'chat' | 'task' | 'approval' | 'meeting' | 'internal'
  role         TEXT,                              -- 'user'|'assistant'|'toolResult'（列表页免开文件）
  preview      TEXT,                              -- 前 120 字符纯文本（会话内滚动列表免开文件）
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (session_id, seq)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_events_kind ON transcript_events(session_id, kind, seq);

-- 跨 agent 留言（公司层，不属于任何一本账；双方账本只写存根 custom_message）
CREATE TABLE IF NOT EXISTS agent_messages (
  id           TEXT PRIMARY KEY,
  from_session TEXT NOT NULL REFERENCES transcript_windows(session_id),
  to_session   TEXT NOT NULL REFERENCES transcript_windows(session_id),
  body         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  read_at      INTEGER                            -- 未读红点白送
) STRICT;

-- UI 会话列表读模型（替代 session-names.json + 目录扫描）
CREATE TABLE IF NOT EXISTS chat_index (
  chat_session_id TEXT NOT NULL,
  last_seq        INTEGER NOT NULL,
  last_role       TEXT,
  preview         TEXT,                          -- 末条消息前 120 字符
  message_count   INTEGER NOT NULL DEFAULT 0,
  mission_ids     TEXT,                          -- JSON 数组，涉及的任务线程
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (chat_session_id)
) STRICT;
```

> **实现偏离记录（T1 落地时补充，均已验证）**：① `transcript_windows` 增加 `file_path` 列——定位账本文件必需（OpenClaw 键即路径；MorPex 的 pi repo 需显式 path）；② 新增 `index_watermark` 表——增量扫描需按字节记水位，chat_index 按 chat 维度组织不合用；③ seq 采用物理行号而非 pi 内部序号（追加式文件下行序 = 条目序，且与 byte_offset 水位互为校验）。

### 3.3 sessionKey 格式（适配 MorPex 概念，非照抄 channel）

```
chat:<sessionId>                    ← UI 会话（真相源 transcript，多轮 resume 锚点）
mission:<missionId>                 ← 任务线程视图（= 挂到某 chat 会话的标签查询，不单独建 transcript）
agent:orchestrator:<goalRunId>      ← 编排子会话（parent_session_id → 所属 chat 会话）
agent:step-agent:<runId> / agent:executor:<runId>
```

子会话树：step/executor 会话经 `parent_session_id` 挂到所属 chat 会话窗口（唯一权威标识，pi 元数据里的 `parentSessionPath` 仅作参考，见 §4.3）。

要点：`mission` 是**查询维度不是存储维度**——任务的全部轨迹在其所属 chat 会话 transcript + 子会话树里，`chat_index.mission_ids` + `transcript_events.kind='task'` 即可检索。避免 OpenClaw conversations/deliveries 一整层的复杂度。

### 3.4 账本条目（jsonl 行）schema

直接采用 pi 0.81 `SessionTreeEntry`（已验证：`node_modules/@earendil-works/pi-agent-core/dist/harness/types.d.ts:237-296`）：

```ts
type Entry =
  | { type:"message"; message: UserMessage|AssistantMessage|ToolResultMessage; id; parentId; timestamp }
  | { type:"compaction"; summary; firstKeptEntryId; tokensBefore }        // 上下文压缩
  | { type:"reset"; reason:"new"|"idle"|...; firstKeptEntryId }           // 会话重置
  | { type:"model_change"; provider; modelId }
  | { type:"thinking_level_change"; thinkingLevel }
  | { type:"custom"; customType; data }                                    // 内部事件（永不显示）
  | { type:"custom_message"; customType; content; display:boolean }        // ★ 审批等可显示自定义事件
  | { type:"label"|"session_info"|"branch_summary"|... }
```

消息内内容块（pi-ai types，已验证 `types.d.ts` ThinkingContent）：
`TextContent{text}` / `ThinkingContent{thinking, thinkingSignature?, redacted?}` / `ToolCall` —— **思考链、实际输出、提问、工具调用原生全覆盖，零扩展**。

---

## 4. 写入侧改造

### 4.1 会话 resolve + resume（G1 核心）

```ts
// packages/studio/server/transcript/ChatTranscriptService.ts（新）
async resolve(chatSessionId: string): Promise<AgentSessionHandle> {
  const win = this.db.lookupWindowByKey(`chat:${chatSessionId}`);
  if (win?.status === 'active') return this.bridge.openSession(win.session_id);   // ★ resume
  return this.bridge.createSession({ key: `chat:${chatSessionId}`, component: 'main' });
}
```

- `PiBridge.openSession/createSession`：新静态工厂，内部走 `JsonlSessionRepo`（铁律：pi import 只在此文件）。`openSession` = 按 path 打开既有 jsonl → harness 自动重放 entries 为 LLM 上下文。（API 已核实：`repo.open(metadata)` 存在，metadata 含 `path`；`AgentHarnessOptions.session` 为必填注入点。）
- **并发护栏**：ChatTranscriptService 维护 per-sessionId in-flight 锁（Map<sessionId, Promise>）；同一会话上一条消息未完成时，新请求返回 409 或排队（默认排队，followUp 语义），禁止两个 harness 同时写同一 jsonl。
- **OrchestratorAgent 改造点（最小侵入）**：`opts.incomingSession?: AgentSessionHandle` 存在时跳过自建（`OrchestratorAgent.ts:305-317` 处加一个分支）；step-agent/executor 仍由 AgentSessionStore 创建，但 `parent_session_id` 指向 incoming 所在窗口。

### 4.2 回合级原子落库 + 崩溃恢复（G3）

- harness 运行中的 appendMessage 由 pi 自动逐条落 jsonl（追加写，天然 crash-safe 到"最后一条完整行"）。
- **assistant 最终回复 + 元数据**在回合收尾由 ChatTranscriptService 一次性 `appendMessage`（含 mode/missionId/kind），消灭现在"先落 user 再 patch"的双写窗口。
- 崩溃恢复语义：jsonl 尾部若有残缺行 → JsonlSessionRepo 读取时忽略；重启后 Indexer 以 `min(磁盘行数, 已提交水位)` 对账。SSE 丢失窗口从"无限"缩到"当前回合"。
- 删除 `patchLastUserMessage` 依赖（user 消息归属改为回合收尾与 assistant 一起写，或以 kind 标记后不可变）。

### 存储总原则：单一全文源

**同一份正文在磁盘上只有一份（jsonl）；SQLite 只存坐标（byte_offset）+ 元数据（kind/role/preview）。**

- 读一条记录 = `readAt(offset, length)` 一次 seek，性能近似等价，但空间从「约 2×」降到「约 0.05×」（每条仅几十字节索引）。
- jsonl 追加写 ⇒ 偏移量永不变化，指针不会失效。唯一例外是 `compact()` 若重写文件 ⇒ Indexer 检测文件大小回缩即全量重建（幂等，秒级）。
- 体积大头从来不是聊天文本（KB~MB 级），而是工具输出/思考链长块——它们只存 jsonl 一份，增长由既有机制控制：`compact()` 摘要旧条目 + 归档 gzip + 清理任务删过期归档。
- 会议账本、子会话都是普通窗口，各只占一份 jsonl；agent_messages 本体只在表里一份，账本内仅几十字节存根。

### 4.3 跨会话讨论（agent 跨会话上下文传递）

现状机制（已核实 `StepAgentExecutor.ts:188-263`）：DAG 执行时 OrchestratorAgent 收集 `stepSessions: Map<stepName, sessionPath>`，下游 step 的 prompt 注入①上游最终输出文本 + ②上游会话 `.jsonl` **路径清单**（纯文本引用）。关键缺口：全仓无任何读取其他会话内容的工具——下游 agent 只能看到上游最后一段输出，"翻上游病历"实际做不到，属半成品。

新架构下的演进（三档）：

1. **标识统一（不做过渡双写）**：`transcript_windows.parent_session_id` 为唯一权威；创建 step 窗口时只写它，`upstreamSessions` 直接升级为 `Map<name, {sessionId}>`。
2. **内容补全（T3 一并做）**：新增受门控的原语工具 `session_read(sessionId)` —— 内部走 PiBridge 打开目标 jsonl、经投影层 sanitize 后返回摘要或指定 seq 范围条目。让下游真正能读上游过程，而非只看结论。
3. **权限边界**：`session_read` 默认仅允许读同一条 `chat:` 树内的祖先/兄弟会话（沿 `parent_session_id` 链判定），跨任务拒绝；fork 场景复用现成 `repo.fork`（继承条目进 LLM 上下文，强于路径注入）。

### 4.4 Indexer（读模型镜像）

- 触发：EventBus 订阅执行事件 + history 请求前懒对账（`SELECT max(seq)` vs jsonl 行数，落后则增量导入）。
- 幂等：`(session_id, seq)` 主键 upsert，只写坐标+预览不写正文；水位存 `chat_index.last_seq`。
- **半行防护**：harness 追加写进行中读取可能拿到末尾残缺 JSON 行——Indexer 只认「以换行结尾且 JSON.parse 通过」的完整行，与崩溃恢复规则共用同一解析器。
- 失败降级：SQLite 不可用时 history API 直接读 jsonl（同一投影函数）——指针式索引下天然成立：投影的输入永远是 jsonl 条目，SQLite 只负责“找得到”。

### 4.5 组织架构通信（三原语模型）

角色映射：工位 = step/executor 会话；部门经理 = orchestrator 会话；部门 = 同一 chat 树；公司 = `agent_messages` 表（不属于任何一本账）。

| 原语 | 解决什么 | 实现 |
|---|---|---|
| ① 查档案 | 经理看下属过程；同事互相请教 | `session_read(sessionId)` 门控工具（§4.3 第 2/3 档），权限矩阵见下 |
| ② 留言 | 工位↔工位、经理↔经理点对点 | 写 `agent_messages` 一行 + 双方账本各追加存根 custom_message（AI 下次开账即见） |
| ③ 开会 | 多工位协同讨论 | 新建会议窗口（普通 transcript，kind='meeting'），会后经理摘要回自己账本 |

权限矩阵（session_read / 留言范围共用）：

```
上司→下属    全文（沿 parent_session_id 向下）
同树兄弟     摘要（同一 chat 树内的 step/executor 互查）
经理↔经理   留言放行（component='orchestrator' 特例），对方账本不可直接翻
跨树其他     拒绝
```

所有通信均为账本条目或表记录 ⇒ 天然留痕可审计；未读查询示例：`SELECT * FROM agent_messages WHERE to_session=? AND read_at IS NULL`。

---

## 5. 投影层设计

### 5.1 sanitize 规则（借鉴 chat-display-projection.sanitize.ts）

| 输入 | 输出 | 理由 |
|---|---|---|
| `ThinkingContent.thinkingSignature` | **必删** | Anthropic 加密载荷，敏感且前端无用 |
| `ThinkingContent.thinking` | **默认不下发**（`?thinking=1` 显式开启时才给，且截断 2000 字符）【已拍板】 | UI 思考链默认隐藏 |
| `redacted` 块 / 错误路径的 reasoning 块 | 整块剥除 | 安全过滤载荷不下发 |
| `custom`（非 custom_message）/ label / session_info / model_change / thinking_level_change | 过滤 | 内部信封 |
| `custom_message.display=false` | 过滤 | 如审计型审批记录 |
| `message.role=toolResult` | 默认过滤（`?tools=1` 调试模式可见） | UI 噪音 |

### 5.2 API 形态

```
GET /api/session/:id/history?v2=1
  → { sessionId, messages: [{seq, role, content, kind, timestamp, thinking?, toolCalls?}], cursor }
GET /api/session/:id/events?after=<seq>          # 增量对账（前端 SSE 断线重连后调用）
GET /api/sessions                                # 列表 = chat_index（O(1)，替代目录扫描）
```

旧 `/api/session/:id/history` 直接删除，前端同步切换（无过渡期）。

### 5.3 SSE 实时流

- 保持现有 eventBus → SSE 通道不动（铁律：EventBus Only）。
- 新增 live buffer 规则：delta 累积上限 500k chars（借鉴 live-chat-projector.ts:24），超限丢弃最早 delta 并标记 `truncated`。
- **回合结束事件携带 `{sessionId, lastSeq}`**，前端收到后拉一次 `events?after=cursor` 对账——保证"看过的"最终等于"落库的"。
- **游标语义**：`lastSeq`/`after` 统一使用 pi entry 序号（与 `session.getEntries({afterEntrySeq})` 同一游标体系），投影层、Indexer、前端三方零换算。

---

## 6. custom_message 审批扩展

### 6.1 事件定义

```ts
// 请求（display=true，上屏等待用户操作）
{ type:"custom_message", customType:"morpex.approval_request",
  display:true,
  content:{ requestId, tool, argsSummary, riskLevel, createdAt, timeoutAt } }

// 决策（display=true，作为对话内的可见卡片留存）
{ type:"custom_message", customType:"morpex.approval_decision",
  display:true,
  content:{ requestId, decision:"approve"|"deny"|"timeout", decidedBy:"user", decidedAt, comment? } }

// 纯审计（如系统自动放行的低危项，display=false 不上屏但可查）
```

### 6.2 运行时门控 + 落库的关系

- 门控机制已确认：pi-agent-core 0.81 的 `AgentTool.beforeToolCall` 是**异步钩子**（`(context, signal?) => Promise<BeforeToolCallResult|undefined>`，返回 `{block:true, reason}` 则拦截并生成错误 toolResult）——审批可在 harness 层原生实现：钩内等待 confirmation queue 的用户决策（带超时 signal）。
- **落库时机**：request 在发起时写入、decision 在回流时写入——两者都是普通 transcript 条目追加，不阻塞门控。
- 投影层：`kind='approval'` 的两条组成一对，前端渲染为"审批卡片"；超时未决自动补写 `decision:timeout` 条目，杜绝悬挂请求。

### 6.3 审计查询

```sql
-- 两步查：先从索引定位 approval 条目，再按 byte_offset 读原文解析
SELECT session_id, seq, byte_offset FROM transcript_events WHERE kind='approval' ORDER BY seq;
```

---

## 7. 数据迁移与兼容

| 对象 | 策略 |
|---|---|
| `chat-history/sess_*.jsonl` | 一次性脚本 `scripts/migrate-chat-to-transcript.mjs`：每 sess 文件 → 建 `chat:<id>` 窗口，user/system 消息转为 MessageEntry/custom_message（保留原 timestamp），写完打 `reason:'initial'`。原文件移动到 `_legacy/`（不删，可整体回滚） |
| `agent-sessions/**` | **不动**。它们是编排内部日志，价值在子会话树；仅对新任务开始写 `parent_session_id` 关联。提供可选脚本为历史任务回填 parent（按时间窗匹配，标注 `matchedBy:'heuristic'`） |
| `session-names.json` | 导入 transcript_windows.display_name 后废弃 |
| 切换策略 | 无灰度开关，一次性切换：迁移脚本跑完 → 新路径生效 → 同一提交内删除旧 chat-history 读写代码 |

验收：迁移脚本幂等（重跑跳过已迁移 sessionId）；迁移后新旧 history API 对同一会话的消息条数一致（对账测试）。

---

## 8. 管理面（按一人规模裁剪）

```
POST /api/session/:id/reset      → 新窗口（previous_session_id 链接，reason:'reset'）；旧 jsonl 转 archived，不删除
POST /api/session/:id/compact    → 直接调 pi-agent-core 的 shouldCompact/compact API（OpenClaw 同款用法，不自研摘要）
GET  /api/sessions?archived=1    → chat_index 查询
清理任务（scripts/maintenance.mjs，手动或每周计划任务）：
  - archived 且超 **30 天**【已拍板】→ gzip 归档到 data/sessions/_archive/ 并从 db 标记
  - 孤儿检测：windows 无 events、events 无 windows → 报告（不自动修，一人规模人工确认即可）
```

不做：磁盘预算强制回收、zstd 冷备表、参与者/建议/进度卡等 OpenClaw 扩展表。

---

## 9. 分阶段实施计划

| 阶段 | 内容 | 改动范围 | 可独立上线 | 验收标准 | 风险 |
|---|---|---|---|---|---|
| **T0（先行快赢，0.5 天）** | 多轮连续性热修：executeGoal 接受外部 session，chat/send 复用既有 orchestrator jsonl | PiBridge(+openSession)、CompanyFacade 透传、OrchestratorAgent 分支、StudioServer 传参 | ✅ | 同一会话连发两句"我叫X""我是谁"，第二轮回答正确 | 低：不改存储格式 |
| **T1（核心，2-3 天）** | TranscriptStore(SQLite DDL) + ChatTranscriptService(resolve/appendTurn) + Indexer(指针式) + 回合级落库替换 patch 双写 + parent 链接入（§4.3 兼容层） | packages/studio/server/transcript/*（新）、StudioServer chat/send 改造、AgentSessionStore 加 parent 链接 | ✅ | 崩杀后端进程重启，历史完整恢复且 LLM 上下文连续 | 中：写入路径变更，需 e2e 用例覆盖崩溃恢复 |
| **T2（投影上线，1-2 天）** | projection/sanitize + history v2 + sessions 列表 API + 前端切换 + SSE 对账事件 | studio/server/transcript/projection.ts（新）、web 拉取层小改 | ✅ | 刷新页面/断线重连后 UI 与落库一致；thinking 展示且无 signature 泄漏（单测断言） | 中：前端回归 |
| **T3（审批+组织通信，2 天）** | approval_request/decision custom_message + confirmation queue 接线 + 超时兜底 + 审计查询 + `session_read` 门控工具（含权限矩阵）+ `agent_messages` 表及留言路由 | confirmation/queue.ts 桥接、新 approval 路由、primitiveAgentTools 加 session_read/send_message | ✅ | 高危工具有审批卡片，拒绝后工具不执行且有审计记录；下游 step 可读同树上游摘要；跨部门经理可留言 | 中：需核实 pi 0.81 工具拦截钩子形态（开放问题 Q2） |
| **T4（迁移+管理面+回填，1-1.5 天）** | 迁移脚本 + reset/compact/清理 + 删除旧 chat-history 读写路径 + 历史 parent 启发式回填（Q4） | scripts/migrate-chat-to-transcript.mjs、backfill-parents.mjs、maintenance.mjs、路由清理 | ✅ | 迁移对账测试过；旧路径删除后全门禁绿；回填结果可抽查纠错 | 低 |

依赖顺序 T0 → T1 → (T2,T3 可并行) → T4。总计约 6-9 个工作日（含测试）。

---

## 10. 开放问题（需用户决策）

- **Q1 已拍板**：思考链默认不显示，`?thinking=1` 显式开启且截断 2000 字符。
- **Q2 已关闭（评审确认）**：pi 0.81 存在 `AgentTool.beforeToolCall` 异步钩子（`dist/types.d.ts:233`），T3 直接用 harness 级门控 + confirmation queue 承接用户决策，无需应用层降级方案。
- **Q3 已拍板**：归档阈值 30 天；归档明文 gzip（本地单人环境，不加密）。
- **Q4 已拍板：做**。T4 增加回填脚本：按时间窗启发式匹配历史 agent-sessions 的 parent 关系并写入 transcript_windows，匹配项标 `matchedBy:'heuristic'` 可人工纠错。
- **Q5 A1 演进触发条件**：何时值得迁向"SQLite 唯一真相源"？建议触发条件：出现多进程写同一会话的需求，或 pi 升级导致 JsonlSessionRepo 格式破坏性变更时。

---

## 附：关键证据锚点

- MorPex 现状双写：`packages/studio/server/StudioServer.ts:841`（chat/send）、`:886`（appendChatMessage user）、`:920`（patchLastUserMessage + system 总结）
- 每次执行新建会话（多轮断裂根因）：`packages/core/src/execution/orchestration/OrchestratorAgent.ts:309`
- pi 类型全集：`node_modules/@earendil-works/pi-agent-core/dist/harness/types.d.ts:237-296`（SessionTreeEntry 联合，含 custom_message:277）
- PiBridge 隔离层：`packages/core/src/infrastructure/adapters/pi-bridge/PiBridge.ts`（config.session 注入点 :142/:658）
- 子会话仓库：`packages/core/src/execution/orchestration/AgentSessionStore.ts`（appendCustomEntry/getEntries 已具备）
- OpenClaw DDL：`/tmp/openclaw-ref/src/state/openclaw-agent-schema.sql:112`（session_windows）、`:372`（transcript_events）、`:383`（archives）
- OpenClaw resume：`src/agents/embedded-agent-runner/run/attempt-session-prepare.ts:435-439`
- OpenClaw 投影脱敏：`src/gateway/chat-display-projection.sanitize.ts:195-203`（截断 thinking、删 signature）
- OpenClaw 审批不落库（本设计的反例依据）：`src/agents/agent-tools.before-tool-call.approval.ts`
- MorPex 侧 pi API 核实（评审补充）：`node_modules/@earendil-works/pi-agent-core/dist/harness/session/jsonl-repo.d.ts`（`open(metadata)`/`JsonlSessionMetadata.path`）、`dist/harness/types.d.ts:631+`（`AgentHarnessOptions.session` 必填）、`dist/types.d.ts:35-40/:233`（`BeforeToolCallResult`/`beforeToolCall` 异步钩子）、`dist/harness/agent-harness.d.ts:62`（`compact()` 内置）
