# UI 会话日志（ui_session_log.md）

> 用途：记录 MorPex 前端 UI（web 渲染层 + desktop 桌面壳）的当前状态、本次会话改动、已知问题与续接点。
> **下个会话续接 UI 工作前，先读本文件**（配合根 `SESSION_LOG.md` 的 17a-17g 条目 + `AGENTS.md`）。
> 最后更新：2026-08-17（17h 重构 → 17i.40；含开发体验/懒加载/流式/拟人化对话全套）

---

## 0. ⚠️ BAT 注意事项（Windows，必读，踩过多次坑）

1. **改 `.bat` 文件必须 纯 ASCII（英文消息）+ CRLF 行尾**。
   - 原因：Windows cmd 用 GBK + CRLF 解析 .bat；UTF-8/LF 会让中文乱码字节被当命令执行 → 批量「不是内部或外部命令」。
   - 不要用 write 工具直接写 .bat（会存 UTF-8+LF）；用 bash heredoc 写 ASCII 内容后 `sed -i 's/$/\r/'` 转 CRLF，或用 `unix2dos`。
   - 校验：`file start-dev.bat` 应输出 `DOS batch file, ASCII text, with CRLF`；或 python 检查无 >127 字节。
2. **start-dev.bat 现状**（17i.37-39 定稿）：
   - 启动前**杀掉 5473 残留后端**（`netstat` + `taskkill`，消灭陈旧 keep-alive 连接）。
   - **单窗口** `MorPex-Desktop` 跑 `dev:all`（Vite + Tauri + 后端，concurrently -k 托管）→ **关窗 = 全部退出**。
   - 无独立 MorPex-Backend 窗口；后端日志在 dev:all 窗口输出。
3. **`dev:all` 路径**（desktop/package.json）：`npm --prefix ../web run dev`（web）+ `npm --prefix ../../../ run dev:backend`（**根目录三层 ../..**，不是两层）。
4. 单独 `npm run dev:backend`（自己的终端）不在 concurrently 托管内，关 UI 不会杀它——统一用 `start-dev.bat` / `dev:all`。

---

## 1. 当前架构（三段解耦）

```
desktop 壳（Tauri2, Rust）──加载──> web 渲染层（Vite+TS, 无框架）──HTTP/SSE──> StudioServer(:5473)
   仅开窗+管后端生命周期        4 视图 + 手写 API 客户端             独立进程，零静态托管
   零 IPC/零 @morpex 引用         src/api/client.ts 唯一拼 URL        后端零改动（仅端口 5473）
```

- **前后端严格分离**：前端只经 HTTP/SSE 消费后端 API；后端不托管静态资源。
- **唯一后端入口**：`VITE_API_BASE`（默认 `http://localhost:5473`，`src/env.ts`）。
- 浏览器模式与桌面共用同一套渲染层（`packages/studio/web`）。

## 2. 目录与关键文件

```
packages/studio/web/                          # 渲染层（浏览器 + 桌面共用）
├── src/main.ts              # 入口：装配 ApiClient + hash 路由 + tab 高亮 + 挂载 4 视图
├── src/env.ts               # VITE_API_BASE（唯一后端地址来源，默认 :5473）
├── src/api/client.ts        # 26 端点 → 类型化函数（全项目唯一拼 /api/... 的地方）
├── src/api/http.ts          # fetch 封装（JSON/错误归一化）
├── src/api/sse.ts           # EventSource 封装（/api/stream/global，自动重连）
├── src/api/types.ts         # 手写 REST 类型（镜像 api-contract.test.ts）
├── src/ui/dom.ts            # 轻量 DOM 工具 el()/mount()/clear()
├── src/ui/router.ts         # hash 路由（默认路由 console）
├── src/ui/widgets.ts        # 卡片/徽章/表格/按钮等部件
├── src/views/console.ts     # ⭐ 会话对话（CLI 风格，默认首页）——核心视图
├── src/views/dashboard.ts   # 仪表盘（5 卡片 + 5s 轮询）
├── src/views/events.ts      # 事件流（SSE 实时）
├── src/views/artifacts.ts   # 产物/记忆
└── index.html               # 单页壳 + 内联 CSS（含终端风格样式）+ 4 tab 导航

packages/studio/desktop/                     # 桌面壳（Tauri 2）
├── src-tauri/src/lib.rs     # ⭐ 壳逻辑：探测 5473 → 自动拉起后端；首启解压内置运行时；退出停后端
├── src-tauri/tauri.conf.json# frontendDist=../../web/dist；NSIS 安装包；resources=portable/node.exe+repo.zip
├── src-tauri/icons/         # 占位图标（待换正式 Logo）
├── scripts/bundle-backend.mjs # 打包可移植后端（portable/）
├── package.json             # dev/dev:all/bundle/build:installer/build:exe/check
└── portable/                # 构建产物（已 gitignore）：node.exe + repo.zip + repo/

start-dev.bat                # ⭐ Windows 一键开发启动（纯 ASCII + CRLF + goto 结构）
```

## 3. 如何运行

### 开发（热加载，推荐调试）
```bash
# 一键（Windows 双击 start-dev.bat）
#   = 杀残留 5473 + 单窗口跑 dev:all（Vite HMR + Tauri 窗口 + 后端 node --watch）
#   关窗 = 全部退出（concurrently -k）
cd packages/studio/desktop && npm run dev:all   # 或直接双击 start-dev.bat
```
- 前端改动 → Vite HMR **即时生效**
- 后端改动 → node --watch **自动重启**（懒加载 O(1) 约 6s，不再 tsx watch 失活问题）
- 壳(Rust)改动 → 重启 dev:all
- 单独跑后端：`npm run dev:backend`（根目录）

### 构建 / 打包
```bash
cd packages/studio/desktop
npm run bundle            # 打可移植后端 → portable/{node.exe,repo.zip}（含剥 .d.ts/.map）
npm run build:installer   # 编译 + NSIS 安装包 → MorPex Studio_x.y.z_x64-setup.exe
# ⚠️ 重打后端前必须 bump tauri.conf.json 的 version，否则已安装版不会重新解压新后端
# ⚠️ 打包版桌面壳退出时自动杀它拉起的后端（lib.rs RunEvent::Exit → kill_backend）
```

## 4. 本次会话已完成的关键改动（对齐 SESSION_LOG 17a-17g）

| 条目 | 内容 |
|---|---|
| 17a | 渲染层 v1：4 视图 + API 客户端 + 路由（浏览器模式跑通） |
| 17b | 桌面壳 v1（Tauri 2）+ 端口统一 **5473**（本机 8080 是 llama-server LLM 网关，勿动） |
| 17c | **控制台重构为 CLI 会话对话**（用户反馈：不要对话/执行分开）→ 单一输入框 + 终端风格会话流 |
| 17d | **双击 exe 即用**：壳自动拉起/停止后端 + CREATE_NO_WINDOW 防黑窗口 |
| 17e | **独立安装包**：后端打进安装包（node.exe + repo.zip），装完完全独立；用户 key 自配（%APPDATA%/MorPex/config.env） |
| 17f | **引擎级意图分流**：新增 IntentClassifier（闲聊 chat vs 任务 task），接进 executeGoal，你好→chat 秒回不建 Mission |
| — | **会话状态提升为模块级 + localStorage**（修复切标签自动新建会话）；start-dev.bat 一键脚本（CRLF 修复闪退） |
| **17h** | **会话页重构为统一浅色聊天应用**（替换白页+CLI 黑框）：左侧会话侧栏 + 右侧聊天区（气泡/模型下拉/上传附件）；**新增三功能**：删除会话、上传文件、模型切换。CSS 从 index.html 抽到 `src/styles.css`，路由作用域 `body[data-route=console]` 实现全视口且不破其余视图 |
| **17i** | **会话页执行反馈增强（纯前端）**：①占位气泡计时（转圈 + 已 Ns）；②发送时开 SSE 流，`mission.created` 目标匹配 → 占位升级为实时任务卡片，`workflow.step_*`/`mission.updated`/`node.*` 实时刷新步骤与进度条；③任务模式回复渲染为任务卡片（状态/耗时/步骤），点「查看实时进度」展开时间线 |
| **17i.18-21** | **开发体验 + 启动根治**：`tsx watch`→`node --watch`（不再失活）；`MORPEX_DEV_FAST` 快启；**产物/图快照**（102s→36s→7s）；懒加载启动 **O(1)**（与数据量无关，~6s）；契约测试 6-8s |
| **17i.22-24** | **规划方案确认门 + Goal 模式 + 应用内文件查看**：交互模式方案确认（不超时）、Goal 全自动；方案 .md 文件可点开；应用内查看器（md/txt/代码/docx/xlsx + 系统打开兜底）|
| **17i.25-27** | **文件查看增强**：markdown 渲染（marked）+ 代码语法高亮（highlight.js）+ 行号 |
| **17i.28-31** | **面板/聊天修复**：任务面板按会话归属；闲聊不再被当任务渲染（前端真 bug）；首句自动重试；「后端未就绪」状态清除 |
| **17i.32-36** | **流式 + 拟人化 + 意图 LLM 判歧义**：闲聊/任务总结真 token 流式；任务完成 LLM 拟人化总结；意图识别「正则只留铁定、疑问走 LLM」|
| **17i.37-40** | **关闭 UI 清理后端**：dev:all 后端入 concurrently -k（关窗=全退）；start-dev.bat ASCII+CRLF（修编码坑）+ 杀残留 5473；dev:all 路径 ../../../ |

## 4.1 会话 17h 改动明细（本次）

### 前端（packages/studio/web，全部为本次会话新增/重写）
- `src/styles.css`（**新建**）：原 index.html 内联样式全量迁移 + 浅色聊天布局（侧栏 264px / 气泡 / 输入条 / 附件 chip），作用域 `body[data-route="console"]`；`--topbar-h:53px` 供全视口高度计算。
- `index.html`：删除 `<style>` 块（CSS 已外置）。
- `src/main.ts`：`import './styles.css'`。
- `src/ui/router.ts`：渲染后 `document.body.dataset.route = route`（路由作用域依赖）。
- `src/api/http.ts`：新增 `del<T>(path)`（DELETE 风格与 get/post 一致）。
- `src/api/types.ts`：新增 `DeleteSessionResponse` / `UploadResponse` / `ModelInfoView` / `ModelsResponse` / `SetActiveModelResponse`。
- `src/api/client.ts`：新增 `deleteSession` / `uploadFile` / `getModels` / `setActiveModel`；`ChatSendOptions` 增 `attachments`。
- `src/views/console.ts`：**整页重写**。布局 = `.console-layout`（侧栏 + 主区）。侧栏：新对话按钮 + 会话列表（点击切换 / hover ✕ 删除 confirm）；主区：标题 + 模型下拉（全局切换）+ 状态 + 删除会话按钮 → 消息气泡（user 右蓝 / assistant 左灰）→ 输入条（📎 上传 + 附件 chips 可移除 + textarea + 发送）。保留：模块级会话状态 + localStorage 恢复 + 后端 5s 轮询重试 + Enter/Shift+Enter + 占位气泡 + raw JSON 折叠。

### 后端 / 核心（契约已对齐，`api-contract.test.ts` 37 passed）
- `packages/core/.../pi-bridge/PiBridge.ts`：`readonly defaultModel` → `private _defaultModel` + `get defaultModel()` + `setDefaultModel(modelId)`（全局切换，仅影响之后发起的调用）。PiBridge 三测试文件 23/23 通过。
- `packages/studio/server/SessionStore.ts`：新增 `listSessions()`（扫 chat-history/*.jsonl，名称/时间齐全，**会话唯一真相源**）与 `deleteSession(id)`（删 jsonl + 名称条目，幂等）；`saveSessionNames()` 抽取复用。
- `packages/studio/server/StudioServer.ts`：删除内存 `sessions` Map；`GET /api/sessions` 走 SessionStore；新增 `DELETE /api/session/:id`（幂等）、`POST /api/files/upload`（base64 JSON，≤5MB，文件名清洗防穿越，文本/二进制分流）、`GET /api/models`（bridge.listModels + active）、`POST /api/models/active`（校验存在性，`default` 恢复 config 默认，持久化 `data/runtime-config.json`）；`POST /api/chat/send` 支持 `attachments[]`（文本 32K 截断拼入消息，二进制仅引用）；`start()` 启动时恢复 runtime-config 的模型 override。
- `packages/studio/server/__tests__/api-contract.test.ts`：新增 7 用例（删除幂等 / 上传成功 / 路径穿越清洗 / 超大 413 / 模型列表 / 未知模型 400 / 切换生效+恢复默认）。

### 新端点一览（前端 client.ts 已封装）
```
DELETE /api/session/:id        → { ok, deleted }（非法 id 含 %2F 穿越 → 400）
POST   /api/files/upload       → { ok, fileId, name, size, mimeType, isText }   body { name, contentBase64 }
GET    /api/models             → { ok, active, models:[{id:'provider/model',...}] }
POST   /api/models/active      → { ok, active }                                  body { modelId } | 'default' 恢复
POST   /api/chat/send          → 新增可选 attachments:[{fileId,name}]
```

### review 修复轮（17h·r1，已随本次落地）
- **C1 路径穿越（Critical）**：SessionStore 全方法加 `SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/` 白名单（appendChatMessage/getChatHistory/deleteSession/appendTaskMessage/getTaskMessages）；DELETE 路由层再加 400 拦截（Express 会解码 %2F → 可穿越删任意 .jsonl）。回归测试 `DELETE /api/session/..%2F..%2F..%2Ffoo → 400`。
- **I1 IME 误发送**：console.ts Enter 处理加 `!ke.isComposing`（中文输入法候选词确认不再误发半截拼音）。
- **I2 模型恢复默认**：`POST /api/models/active {modelId:'default'}` 现在删除 runtime-config.json 且**不再写回**（config/morpex.yaml 保持唯一模型来源；此前会钉住旧默认）。
- **I3 测试污染**：api-contract 测试 beforeAll 记录 testStart + runtime-config 备份，afterAll 清理测试期创建的 uploads 文件并恢复 runtime-config。
- **I4 会话切换竞态**：console.ts loadHistory 加 historyToken 序号守卫（快速切换侧栏时旧响应不覆盖新会话）。
- **I5 测试去重**：删除末尾重复的 DELETE/上传两用例（与中部 fork 版合并），38 passed。
- 其它：删除当前会话后**切到剩余最近一个**（无则新建）；发送失败错误气泡也入 messages（切换路由不丢）；FILE_REGISTRY console.ts 描述同步。

## 4.2 会话 17i 执行反馈（本次，纯前端）

### 改动
- `src/views/console.ts`：占位气泡计时（`think-spinner` + `elapsedEl` + tick setInterval 1s）；发送时 `openEventStream(undefined, onStreamEvent)` 捕获事件；`consumeStreamEvent` 关联 mission（`matchMissionGoal`：goal===text \|\| goal.endsWith(text)，兼容附件前置与 200 字符截断）+ `isRunRelevant` 按 missionId/dagId 过滤事件；`showLiveCard` 占位→实时卡片；`renderLiveCard` 实时刷新（进度条 + 步骤 + 计时 span 经 `elapsedNode` 传入防悬空）；`buildFinalTaskCard` + `buildTimeline` 最终卡片与时间线；`finally` 用 `sseHandle===myHandle` 防并发误关。
- `src/styles.css`：新增 `.task-card(.running/.ok/.fail)` / `.task-progress*` / `.task-steps*` / `.task-timeline` / `.think-*` 浅色样式（约 +153 行）。

### 事件链路（实证）
- `CompanyFacade.executeGoal` → `MorPexRuntime.run` → PipelineOrchestrator（mission.created/updated）→ StepAgentExecutor.emitStepResult（execution.step.result，payload 含 nodeId/nodeName/success/error）→ EventBus → SSE `/api/stream/global`。
- web 引擎无 DAG，`workflow.step_*`/`node.*` 为防御分支（不产生）；桌面/CLI 接 SSE 则生效。

### 门禁
- web typecheck + vite build ✅；根 `tsc --noEmit` ✅（reviewer 复核通过）。

### 残留风险（已接受，reviewer 记录）
1. **>200 字符目标不触发实时卡片**：GoalParser 截断后用户消息不在 goal 尾部 → endsWith 不命中 → 占位保持到响应返回，最终卡片仍出现但步骤为空（优雅降级）。
2. **SSE 订阅竞态**：mission.created 在 SSE 注册前发射则漏匹配（毫秒级，降级同上）。
3. **`execution.step.result` 全收**：双 tab 并发任务时步骤可能交叉污染（桌面单用户可接受）。
4. **EventBus.onProjected 不过滤 INTERNAL（既有债务，非本次引入）**：emit 循环实际不过滤，反而保证 workflow.step_* 可达 SSE；若未来修 EventBus 过滤，17i 的 workflow 分支将成死路径（web 无 DAG，无功能影响）。
5. **交付提醒**：`packages/studio/web/` 整个目录 git untracked（`??`），17h/17i 代码未提交，请随 SESSION_LOG + 文档一并提交。

## 4.3 会话 17i.2 切页存活修复（本次，修复「任务执行中切页回来看不到会话」）

### 根因
- 任务执行中结果未落库：/api/chat/send 在 executeGoal **完成后**才写用户消息 → 执行中会话在磁盘/侧栏/历史均不可见。
- 发送中 SSE/占位/计时器挂在 renderConsole 闭包上，切 tab 触发 cleanup 卸载 → 回页重渲染时 loadHistory 空、实时状态丢失。

### 修复
- **后端** `StudioServer.ts` /api/chat/send：用户消息改在 executeGoal **之前** `appendChatMessage` 落库，系统回复仍之后追加（失败时仅留用户消息，合法）。
- **前端** `console.ts`（重写）：
  - 「活动运行」提升为**模块级**：`activeRun`(runId/sessionId/text/startedAt/state/done/resultMsg)、`runSse`、`runTimer`、`elapsedEl`、`syncRunHook`——切页存活。
  - `consumeStreamEvent`/`matchMissionGoal`/`isRunRelevant`/`renderLiveCard` 移至模块级。
  - `loadHistory` 后处理：在途同 session → `mountLiveCardForRun()` 重建实时卡片并挂 `syncRunHook` 续接更新；已完成 → 最后一条 assistant 文本升级为任务卡片并消费 activeRun。
  - `syncFromActiveRun()`：在途时禁输入，完成后恢复；其它会话在途显示「另一会话任务执行中…」。
  - send()：`activeRun?.runId !== runId` 守卫防新运行接管污染；`placeholder.isConnected` 判断「原地替换 vs 交当前渲染 finalize」；`clearRun()` 关流/清计时。
  - cleanup(切 tab)：只解 `syncRunHook`/`elapsedEl`，**不关** runSse/runTimer/activeRun。
  - newSession / deleteSessionById 清 activeRun。

### 门禁
- web typecheck + build ✅；根 tsc ✅；api-contract 38 passed / 2 skipped（本机负载高时 bootstrap 偶超 60s 内联 hook 上限，用临时 180s 验证通过后已还原；非本次回归）。

### 残留风险（已接受）
1. 第二次运行接管在途运行：旧 runId 完成时不更新 UI，结果仍在服务端持久化（罕见场景）。
2. 发送中切走标签且运行失败时，附件恢复到旧（已卸载）DOM，新渲染不持有该附件（既有局限）。
3. 同渲染内切会话（不重渲染）期间全局禁输入直到运行结束（设计如此，保证一致性）。

## 4.4 会话 17i.3 步骤实时显示修复（本次，修复「执行中无实质步骤」）

### 根因（实证）
- `workflow.step_*` 事件被 `EventBus.isProjectedEvent` 判为 **internal**（`INTERNAL_EVENT_PREFIXES = ['workflow.step_', 'agent.', 'gateway.']`，EventBus.ts:51-57）→ 不进前端 SSE。
- `execution.step.result` 虽可投射，但只在 **StepAgentExecutor.executeStep 末尾**（步骤完成）才发——长步骤（如 LLM 生成网页，耗时数分钟）执行期内无任何步骤事件 → 实时卡片一直「等待执行步骤…」。

### 修复
- **core** `StepAgentExecutor.ts`：新增 `emitStepStarted(node)`，在 `agent.prompt` **之前**发射 `execution.step.started`（payload: nodeId/nodeName/agentType）。execution.step.* 不在 INTERNAL 白名单 → 可投射 SSE。
- **前端** `console.ts`：`consumeStreamEvent` 新增 `execution.step.started` → `upsertStep(..., 'running')`；`isRunRelevant` 同步放行 `execution.step.started`。
- 效果：步骤一开始，实时卡片立即显示「正在执行：generate_website」⏳；完成后 `execution.step.result` 翻转 ✅/❌。

### 门禁
- root tsc / web typecheck + build ✅（未跑真实 LLM 任务——步骤事件链路经代码实证：ServiceContainer:160/161 编排器接入带 nodeHandler 的 dagRuntime → nodeHandler 构造 StepAgentExecutor → executeStep → emitStepStarted；此前任务已产生 step-agent 会话证明该路径活跃）。

### 备注
- **已放行 workflow**（用户确认，EventBus.ts `INTERNAL_EVENT_PREFIXES` 移除 `workflow.step_`）：web 路径真实 DAGRuntime（ServiceContainer:416 `createDAGRuntime()` 带 eventBus+nodeHandler）发射的 `workflow.step_started/completed/failed` 现已可到 SSE；前端 consumeStreamEvent 已处理这些类型（dagId 关联）。双通道（workflow.step_* + execution.step.*）对步骤 upsert 幂等不冲突。副作用：事件流视图会多显示 workflow.step_* 噪声（用户接受的取舍）。
- 验证：root tsc ✅；正在运行的 tsx watch 后端已热加载（EventBus 改动触发重启）。

## 4.5 会话 17i.4 步骤实时思考/输出（本次，用户要求「执行中的步骤也显示思考过程与输出」）

### 方案（数据源实证）
- step-agent 会话 JSONL 每条 message 含 `role`（user/assistant/toolResult）+ `content`（text/toolCall/toolResult 块 + usage）。`readEntries` 原只展平 text → 丢工具信息。

### 改动
- **core** `StepAgentExecutor.ts`：`emitStepStarted(node, sessionPath?)` → `execution.step.started` payload 增加 `sessionPath`（stepSession.path，供前端轮询该步骤会话）。
- **core** `AgentSessionStore.ts`：normalizeEntry message 附带 `contentBlocks`（原始块数组，纯加法，`content` 纯文本不受影响）。
- **前端**：
  - `client.ts`：新增 `getSessionEntries(path)`（GET /api/agent-sessions/entries?path=）；`types.ts` 新增 `AgentSessionEntriesResponse`/`AgentSessionEntryMessage`。
  - `console.ts`：`TaskStep` 增 `sessionPath`/`blocks`(StepBlock[])/`seen`(Set)/`_polling`；模块级 `runPoller`（1.5s）轮询 running 步骤的 entries，增量展平为 `StepBlock`（💭思考 / 🔧工具调用 / 📄结果），`syncRunHook` 刷新卡片；`buildStepRow` 渲染可折叠「实时输出」详情；clearRun 停轮询；send() 启动轮询。
- `styles.css`：新增 `.step-detail-box` / `.step-block*` 浅色样式。

### 验证
- root tsc ✅；web typecheck + build ✅。
- 实测 entries 端点：73/73 message 条目含 contentBlocks，块类型正确（assistant 含 toolCall/text/toolCall）。后端 tsx watch 已热加载。

### 残留/已知
1. 轮询全量读 jsonl（每 1.5s × running 步骤），长步骤条目多时略重；后续可加 offset 增量。
2. `workflow.step_started` 无 sessionPath（DAG 发射早于 step 会话创建）→ 轮询依赖 `execution.step.started`（后发，带 sessionPath，正常）。
3. 思考块即 assistant 的 text 内容（无独立 reasoning 字段时，usage.reasoning=0）；工具调用/结果为独立块。

## 4.6 会话 17i.5（本次，用户三项：流式输出 / 展开不折叠 / 人工审批提示）

### ① 流式输出 + 展开不折叠
- 根因：旧 `renderLiveCard` 每次 `cardEl.replaceChildren(...)` 整卡重建 → `<details>` 全部重建（展开状态丢失）+ 输出块重绘（非流式）。
- 修复：新增 `LiveCardController` 增量渲染——骨架建一次；步骤行按 key reconcile（只新建/删除/更新状态）；已存在的 `<details>` 不重建（展开保持）；新输出块 `appendChild` 到已有 body（流式）；计时 span 每次重建赋给模块 `elapsedEl`。

### ② 人工审批提示（web 路径高风险操作 waitForDecision 阻塞，此前 UI 完全无感知）
- 实证：`MorPexRuntime.run`（:~446）高风险/awaitApproval 时 `approvalGate.requestApproval` → `waitForDecision`（默认 30 分钟）阻塞，需 `approvalGate.decide()` 决议。
- 后端：`GET /api/approval/pending`、`POST /api/approval/:id/decide`（body {decision: APPROVED|REJECTED} → container.approvalGate.decide）。
- 前端：consume `approval.wait_human`/`approval.required` → `state.approvals` pending 项 → 卡片内 ⚠️ 审批提示（标题/风险/摘要 + ✅批准/❌拒绝按钮）；轮询器兜底 `getPendingApprovals` 合并；决议后本地置 resolved；pending 时进度文案变「⏸️ 等待人工审批…」。isRunRelevant 放行 approval.*。

### 门禁
- root tsc / web typecheck + build ✅；api-contract 38 passed（审批端点未加自动化用例，实机 curl /api/approval/pending 返回 {ok:true,approvals:[]}，且运行后端已热加载）。

### 残留/已知
1. `ApprovalGate.decide` 不发射决议事件（只改内存 request）→ 前端靠本地置 resolved 更新提示；任务恢复由 waitForDecision 轮询同一实例（container.approvalGate 单例）保证。
2. 审批提示对「其它并发任务」的审批也会展示（approval.* 全收，单用户可接受）。
3. 步骤详情 `details` 折叠状态在「步骤完成→升级为最终卡片」时重置（最终卡片是新建视图，预期）。

## 4.7 会话 17i.6 失败诊断 + 卡片显示错误原因（本次）

### 现象
用户任务 22s 失败、无步骤事件。

### 诊断（日志实证）
- 编排器会话只有 session 头（无 analysis/步骤）→ 失败发生在步骤执行前。
- chat-history 系统报告：`[OrchestratorAgent] 任务拆解响应无法解析为 JSON（LLM 输出为空或非 JSON）`。
- `scripts/check-llm.ts`：agnes 网关可达(HTTP 200)、key 有效(长度 51)、`agnes-2.5-flash` 在模型列表 → **配置正常**；失败为 Agnes 2.5 Flash 瞬时空转/限流（既有已知问题，SESSION_LOG#2）。minicpm 本地未起（fetch failed，无关）。

### 修复
- 任务卡片 `!ok` 时直接显示 `rec.error`（`.task-error` 红色框）；`TaskSummary.error` 透传。此前只显示 ❌ 失败，无法诊断。
- 无步骤事件 = 失败在步骤前（符合预期，卡片显示「未捕获到步骤事件」而非假进度）。

### 门禁
- web typecheck + build ✅。

### 用户行动建议
- 瞬时空转 → 直接重试；反复失败 → 下拉切 `agnes-2.5-pro`（更强）或检查 Agnes 配额/限流。

## 4.8 会话 17i.7 对话气泡投影（本次，用户要求「把 agent 实际对话投影出来，像 CLI 对话那样」）

### 改动
- `console.ts` `renderStepBlock` 从扁平 monospace 日志升级为**聊天气泡**（`.conv-msg`）：
  - 💭 思考/输出（MorPex，绿左边框）
  - 🔧 调用工具（MorPex，蓝左边框）
  - 📄 工具结果（工具，右侧/红左边框）
- `LiveCardController.updateStepRow`：**运行中的步骤自动展开**「实时输出」详情（`details.open=true`），对话随轮询流式滚动；已完成步骤保持用户展开状态。
- `flattenStepEntry` 跳过 role=user 的步骤指令（样板不入投影，避免误显示为「MorPex 思考」）。
- `styles.css`：`.conv-msg*` 气泡样式（左右对齐/角色色），替换旧 `.step-block*`。

### 效果
- 任务执行时，运行中步骤的「实时输出」自动展开，以聊天式气泡实时滚动 agent 的实际对话（思考→调工具→看结果→再思考），视觉与主聊天一致。

### 门禁
- web typecheck + build ✅；root tsc ✅。前端 HMR 生效，无需重启后端。

## 4.9 会话 17i.8 工具调用/JSON 可读化（本次，用户要求「对话别是裸 JSON，渲染美观易读」）

### 改动
- `StepBlock` 增加结构化字段（toolName/toolArgs/toolContent）；`flattenStepEntry` 保留结构化数据。
- 新增可读渲染：
  - `renderToolCallBlock`：工具调用 → 卡片（图标+中文名+参数键值行，如 artifact → 📄 生成产物/文档 + type/specification 分行）。
  - `renderToolResultBlock`：工具结果 → 卡片（提取文本 → JSON 语法高亮）。
  - `jsonToHtml`：JSON 语法高亮（key 蓝 / 字符串深蓝 / 数字蓝粗 / 布尔红粗）。
  - `toolLabel`：常见工具名 → 图标+中文（artifact/knowledge/shell/fs/code/web/search）。
  - `safeParse`：字符串 JSON 自动解析。
- `renderStepBlock`：按 kind 分发（think→可读 pre；tool/result→卡片）。

### 效果
- `artifact({"type":"doc","specification":"..."})` → 卡片化「📄 生成产物/文档（artifact）」+ `type: doc` / `specification: ...` 分行；工具结果 JSON 着色。

### 门禁
- web typecheck + build ✅；root tsc ✅（修复一次编辑残留的重复 flattenStepEntry）。

## 4.10 会话 17i.9 完整对话 + 修复工具结果丢失（本次，用户要求「看到思考过程/真实输出/引擎如何回复，要完整对话」）

### 根因（bug）
- 工具结果的 `toolName` 在**消息级**（entry.message.toolName），不在内容块级；且结果内容是 toolResult 消息里的 **text 块**，不是 toolResult 块。旧 flattenStepEntry 两处都没拿到 → 工具名变成「工具」、内容变成「(空结果)」。

### 修复
- 后端 `AgentSessionStore.normalizeEntry`：message 附带 `toolName`/`toolCallId`（加法）。
- 前端 `flattenStepEntry`：toolResult 消息的 text 块 → kind=result，toolName 取 `e.toolName`，content=原文（safeParse→JSON 高亮）。

### 新增「📜 原始对话」完整转录
- `LiveCardController` 第二个按钮；面板按步骤分区，忠实显示**每条原始消息**（含空消息/用户指令/时间戳），增量追加不折叠。
- `renderRawEntry`：role 头 + 时间戳 + text 块/toolCall 卡片/toolResult 卡片。
- 数据源：`step.raw`（轮询时保留原始条目）。

### 关于「思考过程」
- Agnes 2.5 Flash 配置 `reasoning: false`（无独立推理块），「思考」即 assistant 的 text（多数直接调工具，text 为空/换行）。要看真正推理需开启 reasoning 或换强模型（见待办）。

### 门禁
- web typecheck + build ✅；root tsc ✅；后端热加载实测：58/58 toolResult 带 toolName。

## 4.11 会话 17i.10 打开 Agnes 思考（reasoning）（本次，用户「打开」）

### 改动
- `config/morpex.yaml`：llm `reasoning: false → true`。
- `PiBridge.ts`：
  - `buildProvider` model 定义加 `compat: { thinkingFormat: 'qwen-chat-template' }`（pi-ai 据此发 `chat_template_kwargs.enable_thinking`，对应 config 注释）。
  - `generateTextOnce` complete() 与 `createAgentHarness` harness 均传 `reasoning: 'high'`（模型 reasoning=true 时；clampThinkingLevel 需具体级别，`true` 会落到 off）。
- 前端 `flattenStepEntry`/`renderRawEntry`：处理 `thinking`/`reasoning` 内容块 → 💭 投影。

### 链路（实证 pi-ai）
- 网关返回 `reasoning_content` → pi-ai 组装成 `{type:'thinking'}` 块（openai-completions.js:192-316）→ agent-loop 保留（agent-loop.js:212-214）→ 会话记录 → 前端 contentBlocks 读到 → 💭 显示。
- 编排器 generateText 路径：extractText 只取 text 块，thinking 不污染 JSON 解析。

### 验证
- root tsc / web typecheck+build ✅；后端热加载，`/api/models` 显示 agnes reasoning=True。

### 注意（待实测）
- 思考是否真正产出取决于 **Agnes 网关是否支持/返回 reasoning_content**（MorPex 侧已全链路就绪）。若网关不返回，需换 thinkingFormat（zai/deepseek 等）或强模型。
- `reasoning:'high'` 会显著更慢更贵；若想平衡可降到 'medium'（改 PiBridge 两处 'high'）。

## 4.12 会话 17i.11 拟人化人机对话编排（本次，用户要求「任务→经理接单→询问细节→DAG 执行」）

### 交付 ①真实澄清询问（后端 + 前端）
- 后端 `StudioServer` chat/send：生成类任务（做/写/生成 + 网页/网站/app…）且缺技术栈/风格 → 返回 `{mode:'clarify', questions:[techStack, style]}` **不执行**；带 `clarifications` 重发 → 注入 `【需求补充】` 到目标再执行；`force:true` 跳过澄清。
- 前端 `doSend()` 重构：`mode:'clarify'` → 渲染拟人化澄清卡片（经理 persona + 问题 chips + 自定义输入 + 「开始执行 ▶」「跳过，直接执行」）；回答后带 clarifications 重新发送；历史自然（任务→【等待澄清】→回答→结果）。

### 交付 ②拟人化对话叙事（前端）
- 实时任务卡片新增「对话叙事」面板：经理 persona 说话（`💻 软件部经理：好的，收到任务，马上分析` → `已指派 Agent 执行：X` → `✅ 完成/🎉 完成`），由捕获事件（mission/step/approval）实时生成，增量追加不折叠。
- 部门映射 `pickManager`：软件部/数据部/市场部/设计部。
- 原始「步骤对话 / 📜 原始转录 / 审批提示」保留（查看实时进度/原始对话内）。

### 验证
- root tsc / web typecheck+build ✅；后端热加载。
- 实测（UTF-8 请求）：`mode=clarify` + 2 问题返回 ✅；乱码 curl 误触发执行已排除（编码问题，浏览器正常）。
- 中间排查：tsx watch 偶发不热加载（touch 触发重启后正常）；curl 在 Git Bash 下中文变乱码导致正则不命中——用 UTF-8 文件 --data-binary 规避。

### 边界/后续（诚实说明）
- 经理「人话」是**呈现层翻译**（由事件生成的自然语言文案），不是模型真正生成的话；若要模型真正生成接单/提问语，属 v2（编排器新增对话式 step）。
- reasoning 已开：真实思考在「📜 原始对话」里可见；叙事面板是易读层。

## 4.13 会话 17i.12 流式终端转录（Codex/OpenCode 风格）（本次，用户要求「像 codex/opencode 那样实时流式对话输出」）

### 实现（真 token 级流式）
- **后端**：`PiBridge.createAgentHarness` 暴露 `subscribe`（透传 harness.subscribe）；`agentSpawner.spawn` 透传；`StepAgentExecutor` 订阅 harness 的 `message_update`（text_delta/thinking_delta），按节点**120ms 节流合并**后发 `execution.stream.text`/`execution.stream.think`（execution.* 非 internal → 可到 SSE）。
- **前端**：`consumeStreamEvent` 收流式事件 → 步骤缓冲 `streamText/streamThink`；`LiveCardController` 步骤详情改为**终端式转录**（`step-term` 深色终端）：💭 思考逐 token 流、▸ 文本逐 token 流、`$` 命令行、`↩` 输出行；流式已覆盖文本时跳过轮询 think 块防重复。

### 效果
- 任务执行时，运行步骤自动展开深色终端，**LLM 输出实时逐 token 涌现**（不再 1.5s 拉取卡片），命令 `$` 高亮、输出跟随滚动——接近 Codex/OpenCode。

### 门禁
- root tsc ✅（修复 StepAgentExecutor 本地 agent 类型缺 subscribe）；web typecheck + build ✅。

### ⚠️ 重要
- **后端需手动重启**：tsx watch 本次彻底失活（未热加载），且最终 health 无响应——重启（start-dev.bat / npm run dev:backend）后流式才生效。
- 若后端重启后流式仍不出现：检查 harness.subscribe 是否在 prompt() 时触发（pi-agent-core 事件链路）；或降级为轮询（已有）。

## 4.14 会话 17i.13 策略改版：任务卡片钉顶部 + 纯自然拟人对话（本次，用户澄清「要自然对话，不要终端/卡片塞气泡」）

### 新布局
```
顶部任务面板（钉在会话上方）
  📋 任务
  [⏳ 实时任务卡片（进度/叙事/步骤/流式，LiveCardController 放面板）]
  [已完成任务紧凑列表]
──────────────
对话区（纯自然气泡）
  👤 任务
  💬 软件部经理：好的，收到任务「...」，马上开始分析。
  💬 软件部经理：想确认技术栈/风格？[澄清卡片]
  💬 软件部经理：✅ 任务完成！
```

### 改动
- `console.ts` 布局：`taskPanelEl` 插在 chat-header 与 chat-log 之间（面板不占聊天气泡）。
- `createPanelTaskCard()`：任务卡片（LiveCardController）放面板；`renderPanelCompleted()`：已完成任务紧凑列表（模块级 `completedTasks`，cap 20，newSession 清空）。
- `doSend`：renderLive 改建**面板卡片**；检测到 mission → 聊天占位替换为**经理接单语**（buildManagerIntro）；完成 → `hook?.()` 面板卡片 finalize + 聊天追加**经理完成语**（buildManagerReport）+ 面板完成列表。
- `mountLiveCardForRun`：切页恢复改挂面板卡片。
- `styles.css`：`.task-panel` / `.panel-task-row` / `.task-panel-title`。

### 效果
- 聊天 = 纯自然拟人对话（接单/澄清/完成）；任务执行细节全在顶部任务面板（不再塞进气泡）。

### 门禁
- web typecheck + build ✅；root tsc ✅（修复 createPanelTaskCard 未用参数）。

### 注意
- 后端仍需手动重启（tsx watch 失活，见 4.13）。

## 4.15 会话 17i.14 澄清卡死修复 + 清理测试会话（本次，用户报告「【等待澄清】卡住 + 多出测试会话」）

### 问题
1. 澄清后聊天只剩「【等待澄清】已向用户询问…」原始系统消息卡死：后端把该原文写进历史，而澄清交互是前端 UI（不持久化）→ 刷新/切页后 loadHistory 只剩原文，无交互提示。
2. 多出 sess_v3/c5/c3/c4/clarify_tes(t) 等会话：均为本会话 curl 测试遗留（当时后端宕机 DELETE 未生效）。

### 修复
1. 后端 `StudioServer` chat/send：澄清分支**不再写原始系统消息**（澄清是 UI 交互，避免刷新残留原文）。
2. 前端：模块级 `pendingClarify`（sessionId/text/attachments/questions）——收到 clarify 时保存；`loadHistory` 若最后一条是用户消息且本会话有待澄清 → **重渲染交互澄清提示**（防卡死）；doSend 开始 / newSession 清空。
3. 清理测试会话（已删除）。

### 门禁
- web typecheck + build ✅；root tsc ✅。

### 注意
- 需重启后端（含本改动）后，新发送的澄清才会「无原始消息 + 刷新可恢复」。旧会话里已有的原文消息仍会残留（旧数据）。

## 4.16 会话 17i.15 LLM 自主决策问用户（ask_user 工具）（本次，用户澄清「要 OpenCode 式 LLM 驱动澄清，不要硬性预置」）

### 实现（真 LLM 驱动）
- **核心** `packages/core/src/execution/UserAskService.ts`：`createAskUserTool`（ask_user 工具，execute 返回 promise **阻塞直到用户回答/超时**）、`answerAsk`、`getPendingAsks`；发射 `user.ask` 事件（投影）。
- **工具注册** `primitiveAgentTools.createPrimitiveAgentTools`：eventBus 提供时追加 ask_user；`StepAgentExecutor` 传 eventBus + sessionId。→ **LLM 在执行中主动调用 ask_user 时，引擎暂停等回答，前端拟人对话呈现，回答后 agent 继续**。
- **后端端点**：`GET /api/ask/pending`、`POST /api/ask/:id/answer`。
- **前端**：`TaskRunState.asks`；consume `user.ask` → 聊天**拟人问答气泡**（`💻 软件部经理：你需要什么技术栈？` + 选项/输入 + 提交）；回答 → `answerAsk` → 气泡变「✅ 已收到你的回答…」；面板进度「⏸️ 等待你的回答…」。

### 与硬性预置的关系（诚实）
- **ask_user = 真 LLM 驱动**（模型想问你时才问，OpenCode 式）。
- 预置澄清（17i.11 正则门）**保留作为保底**：生成类网页任务默认必问技术栈/风格（你例子里正是这个），且呈现方式已拟人化。若想彻底只用 LLM 驱动、去掉预置门，可改（一行关闭）。
- 两者互补：预置保证常见场景一定问；ask_user 覆盖执行中突发的信息缺口。

### 门禁
- root tsc / web typecheck+build ✅。

### 注意
- 需重启后端（含 UserAskService/工具注册/端点）。
- 是否触发 ask_user 取决于模型判断（有 reasoning 后更可能）；若某任务模型直接执行不提问，是正常行为（不强制）。

## 4.17 会话 17i.16 移除预置澄清（本次，用户「不需要预置澄清」）

### 改动
- 后端 `StudioServer`：删除 `needsClarification` / `CLARIFY_QUESTIONS` / `formatClarifyText` / clarify 分支；chat/send 回到「M2 落库 → 附件 → executeGoal」，不再返回 mode:'clarify'。
- 前端 `console.ts`：删除 `pendingClarify` / `buildClarifyMessage` / `formatClarifyAnswers` / doSend clarify 分支。
- **只保留 LLM 驱动 ask_user**（17i.15）：是否问用户完全由模型自主决定。

### 门禁
- root tsc / web typecheck+build ✅。

### 注意
- 需重启后端。
- CSS `.clarify-*` 保留（ask_user 问答气泡复用）；`.clarify-q*`/`.clarify-intro` 成死代码（无害，未清理）。

## 4.18 会话 17i.17 进度视图改 DAG 节点图（本次，用户「第一眼只查 DAG 节点，点击展开渲染好的 LLM 输出」）

### 后端
- `DAGRuntime.run` 开头发射 `execution.dag`（nodes[id,name,deps] + edges[from,to]），前端据此渲染真实 DAG。

### 前端
- `TaskRunState.dag`（DagData/DagNode）；consume `execution.dag`；步骤事件（workflow/execution.step/node.*）同步节点状态（pending→running→done/failed）。
- `LiveCardController.renderDag`：**分层布局**（longest-path layering，level=max(deps)+1）→ 节点按层排，线性任务显示为 `规划 → 编程 → 审计`；节点卡片含状态图标/文案；点击展开/收起。
- `renderDagDetail`：展开节点 → 渲染好的 LLM 实际输出（streamThink/streamText，回退 think 文本块），**不含工具 JSON**。
- DAG 位于任务卡片最前（进度条下、叙事/步骤前），是主要进度视图。

### 门禁
- root tsc / web typecheck+build ✅（修一次误删 pickManager 函数体）。

### 注意
- 需重启后端（execution.dag 发射）。
- DAG 节点 id 与步骤事件 nodeId 同源（graph.nodes.id），状态同步可靠。

## 4.19 会话 17i.18 开发体验：可靠 watch + 快启（本次，用户「每次重启麻烦又慢，有没有别的办法」）

### 根因
1. `tsx watch` 在 Windows 反复失活（watcher 父进程死亡 → 孤儿，不热加载 → 被迫手动重启）。
2. 全量启动慢（EventStore 重建 2963 产物 + 图实体 → 40-90s，负载高时 >200s）。

### 方案（实测）
1. **可靠 watch**：`dev:backend` 改用 **Node 原生 `node --watch --import tsx`**（Node 24 内置 watcher，无 tsx 孤儿问题）。
2. **快启模式**：`MORPEX_DEV_FAST=1` 跳过 EventStore 状态重建（bootstrap-unified.ts 门控）→ **启动 5s、热重启 7s**（实测）。
   - `dev:backend:fast`（默认开发）= fast + node --watch；`dev:backend` = full + node --watch；`dev:backend:full` = 无 watch 完整启动。
3. `start-dev.bat` 改用 `dev:backend:fast`，标题注明。

### 代价（诚实）
- fast 模式跳过状态重建 → 产物/图谱视图在 fast 下为空或不全；需查产物/历史时用 `npm run dev:backend`（全量）。

### 门禁
- root tsc ✅。

### 用法
- `start-dev.bat` → fast + 自动热重启（改后端/核心 .ts 自动重启 ~5-7s，不再手动）。
- 改前端 → Vite HMR 即时。

## 4.20 会话 17i.19 产物/图快照（根治全量启动慢）（本次，用户「产物为什么要重建」→ 要求根治）

### 根因
- 事件溯源：产物/图没有快照，每次启动全量回放 ARTIFACT_CREATED/UPDATED + SYSTEM_ENTITY_REGISTERED/RELATION_ADDED 事件（2963 产物 + 9639 实体）→ 40-100s+。
- `artifacts.db` 是残缺旁路（save 为空操作，只持久化 transition），从未真正当快照用。

### 实现（快照 + 事件回放兜底）
- `ArtifactFacade`：`saveSnapshot()`/`restoreFromSnapshot()`（data/artifacts.snapshot.json）+ create/transition 变更后 500ms 防抖落盘。
- `SystemMetadataGraph`：`saveSnapshot()`/`restoreFromSnapshot()`（data/graph.snapshot.json，含实体+关系+去重基准）+ registerEntity/addRelation 防抖落盘。
- `bootstrapUnified`：图、产物均**快照优先 → 事件重放兜底**；恢复后存新快照。

### 实测
- 全量启动：无快照 102s → 有快照 **36s**（剩余为其它子系统，如 cognee/EventStore/装配）。
- **契约测试 38s 通过**（此前负载高时 >60s 超时需要临时改 hookTimeout）——快照同时解决测试启动超时。
- fast 模式（MORPEX_DEV_FAST=1，默认开发）仍 5s。

### 代价/边界
- 快照是**加速缓存**，不是真相源；缺失/损坏/过期 → 自动回退事件重放（正确性兜底）。
- 快照在变更后 500ms 防抖落盘；进程在防抖窗口内崩溃会丢最近变更 → 下次回退重放补齐。
- data/ 已 gitignore，快照不会进 git。

### 门禁
- root tsc ✅；api-contract 38 passed / 2 skipped ✅（无需改超时）。

## 4.21 会话 17i.20 定位并根治剩余启动耗时（本次，用户「优化」）

### 定位（加临时计时标记实测）
- 快照后 bootstrap 18s 分布：container.ready 94ms / workflows 1.7s / 快照恢复+Ontology 1.9s / 记忆引擎 2.0s → **Ontology 投影 projectAll 占 16.6s**。

### 根因
- `ArtifactProjector.projectAll()` 对 2963 产物逐个调 `ontology.upsertObject`；每次 upsert 做 **3 次 getObject + Deblackbox knowledge.write 审计写（L1 永久）+ 缓存失效** → 2963 次审计写即 16s。

### 修复
- `OntologyService` 加 `bulkProjection` 开关；`ArtifactProjector.projectAll` 批量模式跳过逐条 Deblackbox 审计（bootstrap 全量投影是回放，非用户动作）。
- 移除临时计时标记；保留一条 `启动完成 Xs` 总耗时日志。

### 实测（优化旅程）
| 场景 | 最初 | 快照后 | 快照+审计优化后 |
|---|---|---|---|
| 全量启动（含产物/图） | ~102s | ~36s | **~7s** |
| 契约测试 | >60s 超时 | 38s | **8s** |
| fast 开发模式 | — | 5s | 5s |

### 门禁
- root tsc ✅；api-contract 38 passed ✅。

## 4.22 会话 17i.21 懒加载：启动 O(1)（本次，用户「产物越多加载越慢，不合理」）

### 正确架构：启动不载入产物/图，首次使用才懒加载
- **ArtifactFacade**：`ensureLoaded()` 首次读（get/getAll/getByTask/getLineage）时从 `data/artifacts.snapshot.json` **合并**历史产物（只补缺，不覆盖会话新产物）。
- **SystemMetadataGraph**：`ensureLoaded()` 首次读（getEntities/getRelations/registerEntity/addRelation/findPath/getStats…）时从 `data/graph.snapshot.json` 合并实体/关系/去重基准。
- **OntologyService**：构造不再 refreshCache（会触发图懒加载）；首次 getObject 缓存未命中自动全图重建。
- **bootstrap**：移除急切 restoreFromSnapshot/restoreFromEvents + **移除急切 projectAll**（Ontology 查询本就读 graph.getEntities()，产物已是 graph 的 'artifact' 实体，投影冗余）。

### 效果（O(1)，与产物量无关）
- 启动：**6s（bootstrap 2.0s）**，完全不载入 2963 产物/9639 实体（日志无快照加载）。
- 首次访问 /api/artifacts → 触发懒加载补入 2963（一次性）；二次不再触发。
- 契约测试：**6s**（38 passed）。

### 正确性
- 懒加载=合并补缺（不覆盖会话中新产物/实体）；快照缺失/损坏 → 事件重放兜底（restoreFromEvents 保留）。
- 变更照常写 EventStore + 防抖落盘快照（快照保持较新）。

### 说明
- MORPEX_DEV_FAST 现在与全量启动等价（启动本就 O(1)），保留无碍。
- 代价：首次访问某产物/图数据时有一次快照读（~0.5s 级），之后内存命中。

## 4.23 会话 17i.22 规划方案确认门 + Goal 模式（本次，用户「规划出方案后自然汇报 xxx.md，需继续请回复；提供 Goal 模式全自动」）

### 实现
- **核心** `PlanGateService.ts`：`requestPlanConfirm`（Goal 模式立即放行；交互模式发 `plan.ready` 事件并**阻塞等待**确认/超时）、`confirmPlan`、`getPendingPlans`、`setAutoExecute`。
- **OrchestratorAgent**：规划分析产出 steps 后 → 生成**方案 markdown 文件**（data/plans/<planId>.md，含目标/复杂度/步骤/编排思路）→ `await requestPlanConfirm(...)` 暂停。
- **后端**：chat/send 按 `req.body.goalMode` 设 `setAutoExecute`；`GET /api/plan/pending` + `POST /api/plan/:id/continue`。
- **前端**：头部 **Goal 模式开关**（localStorage 持久化，发送时带 goalMode）；consume `plan.ready` → 聊天自然汇报「💻 经理：规划方案已经做好，文件 xxx.md，如需继续请回复」+ 步骤列表 + 「继续执行 ▶」按钮；面板「📋 等待确认方案…」；轮询兜底合并待确认方案。

### 实测（后端端到端）
- 交互模式发任务 → 分析产出 → **方案文件生成**（generate_html 步骤+编排思路）+ 1 个待确认方案 → 暂停。
- POST continue → 待确认清空 → 任务继续。

### 门禁
- root tsc / web typecheck+build ✅。

### 注意
- Goal 模式开启后任务全自动（无确认）；默认交互模式**暂停等确认，不设超时**（用户手动点「继续执行 ▶」或回复才继续；17i.22·用户要求去掉超时）。
- LLM 分析耗时与既有模型稳定性相关（reasoning 开启后更慢），非本功能引入。

## 4.24 会话 17i.23 方案文件可点击打开（本次，用户「具体文件应该可以点击打开」）

### 实现
- 后端 `GET /api/plan/file?path=`：读取方案 markdown；**防穿越**（仅允许 data/plans/ 下，其余 400）。
- 前端：方案消息里文件路径改为**可点击按钮**（`📄 plan_xxx.md`）→ 打开**应用内查看器**（modal 显示 markdown，跨浏览器/桌面可靠，不依赖被 webview 拦截的 file:// 链接）。

### 验证
- root tsc / web typecheck+build ✅。
- 实测：读取方案内容 ✅；穿越（读 package.json）→ 400 拦截 ✅。

### 说明
- 若想「在系统编辑器打开」而非应用内查看，可后续接 Tauri shell opener（需引入 @tauri-apps/api）；当前应用内查看最稳。

## 4.25 会话 17i.24 应用内文件查看器（office/md/txt/代码）（本次，用户澄清「在应用里打开」，非系统应用）

### 实现
- 安装依赖：`mammoth`（Word→HTML）、`xlsx`（SheetJS，Excel→表格）。
- 后端 `GET /api/files/view?path=`（防穿越，仅 data/）：
  - 文本类（md/txt/代码 c/h/js/py…）→ 读原文，`kind: text|markdown`；>2MB 提示用系统打开。
  - docx → mammoth → `kind: html`；xlsx/xls → SheetJS `sheet_to_html` → `kind: html`（表格）。
  - pptx/其它二进制 → `kind: unsupported` + 提示「在系统打开」。（pptx 内预览未实现——无成熟解析库，且 .pptx 需 zip+XML 手工解析）
- 前端：通用 `openFileViewer(path)`：
  - text/markdown → 等宽 `<pre>` 显示；html → `<iframe srcdoc>` 隔离渲染（docx 排版/Excel 表格）；unsupported → 提示 + 「🖥 在系统打开」按钮。
  - 模态框头部恒有「🖥 在系统打开」+「✕ 关闭」。
  - 方案消息文件链接 → 打开此查看器（应用内）。

### 验证
- root tsc / web typecheck+build ✅（修复 XLSX/mammoth ESM import：CJS 包用 default import）。
- 实测：md→markdown ✅；c→text ✅；xlsx→html 表格 ✅；穿越拦截 ✅。

### 边界
- pptx 内预览不支持（提示 + 系统打开）；后续可用 zip 解析 + slide XML 文本提取。
- markdown 目前以原样文本显示（未做 md 渲染高亮，可选后续）。

## 4.26 会话 17i.25 markdown 渲染（本次，用户「markdown 需要渲染」）

### 实现
- 装 `marked`（web 包，v18）。
- `console.ts`：`openFileViewer` 对 `kind=markdown` 用 `marked.parse` → `buildMarkdownDoc(html)`（带 markdown 样式：标题/代码块/表格/引用/列表/链接）→ `<iframe srcdoc>` 隔离渲染。
- 文本类（非 md）仍原样等宽显示。

### 验证
- web typecheck+build ✅（bundle +44KB 为 marked）。
- marked 渲染实测：h1/strong/pre-code/ul/blockquote 均输出 ✅。

### 说明
- 重启后端无需（纯前端 HMR）；需 Vite 已加载新依赖（npm install 后 dev server 会自动处理或需重启 dev:all）。

## 4.27 会话 17i.26 代码语法高亮（highlight.js）（本次，用户「代码文件也要高亮」）

### 实现
- 装 `highlight.js`（web 包，v11.12；用 lib/common 覆盖主流语言：c/cpp/js/ts/py/java/go/rs/rb/php/sql/json/html/css/yaml…）。
- `marked` 代码块接入 hljs（自定义 renderer.code：按 lang 高亮，未知语言 highlightAuto）。
- `openFileViewer`：代码/文本文件按扩展名 → `hljs.highlight` → 深色终端风展示（`.code-view`，`white-space: pre` 横向滚动）。
- 主题：应用侧 `import 'highlight.js/styles/github-dark.css'`；markdown iframe 内联同名主题。

### 验证
- web typecheck+build ✅（bundle 253KB，hljs 占大头）。
- marked+hljs 实测：代码块 `<span class="hljs-keyword">` ✅；c 文件高亮 ✅。

### 说明
- 纯前端改动，Vite HMR 生效；装了新依赖后若未自动识别重启 dev:all。

## 4.28 会话 17i.27 代码行号（本次，用户「要加行号」）

### 实现
- **文件查看器** `buildCodeView(raw, lang)`：左侧 `.code-gutter` 行号栏（深色、`position:sticky;left:0`，横向滚动固定）+ 右侧 `.code-view` 高亮代码（`white-space:pre` 横向滚动），同一 `.code-view-wrap` flex 容器滚动同步。
- **markdown 代码块**：marked `renderer.code` 返回 `.code-wrap`（gutter + code-body），iframe 内联同款样式。
- 行号 = 代码行数自动生成；无高亮语言时回退转义文本 + 行号。

### 验证
- web typecheck+build ✅。
- marked 输出含 code-wrap + gutter(1\n2) ✅；hljs 高亮 c 的 type/number/string/built_in ✅。

### 说明
- 纯前端改动，Vite HMR 生效。

## 4.29 会话 17i.28 修复任务面板会话归属（本次，用户「删会话新建后旧任务卡片残留任务栏」）

### 根因
- 任务面板（taskPanelEl）+ 已完成列表（completedTasks）**未按会话管理**：切换/删除/新建会话时不清空 → 旧会话的任务卡片/发送失败卡片残留到新会话面板。

### 修复
- `syncPanelForSession(id)`：面板归属当前会话——切到不同会话时清空面板 + completedTasks，回到该会话再重建（loadHistory / newSession / initWhenReady 调用）。
- 网络发送失败（Failed to fetch，未真正启动任务）不再生成面板失败卡片：catch 里 `if (state.isTask) hook?.()`——仅检测到 mission 才进面板；纯网络错误只在聊天显示。

### 门禁
- web typecheck+build ✅；root tsc ✅。

## 4.31 会话 17i.30 发送失败处理优化 + 「你好」误判排查（本次，用户「第一句必连不上 + 你好变成任务」）

### 排查结论（实测）
- `IntentClassifier.classify('你好')` = **chat**（启发式 CHAT_HINT_RE 命中）；后端 POST「你好」返回 `mode:'chat'`、HTTP 200——**当前代码正确**。「你好→任务」是**后端跑的旧代码**（node --watch 失活/孤儿进程未加载新逻辑）。

### 修复
- **失败文案**：网络/连接失败（无法连接/Failed to fetch/ECONNREFUSED…）不再误报「任务执行失败」，改「❌ 发送失败：无法连接后端，已自动重连」；非网络任务失败仍走任务报告。
- **输入恢复**：网络失败时把用户消息**恢复到输入框**（不再丢字）。
- **自动重连**：网络失败 → `setBackendReady(false)` + `startHealthRetry()`（抽出可复用 5s 重试），后端恢复后自动启用发送。

### 注意
- **需彻底重启后端**（先杀掉所有 5473 进程再 `start-dev.bat`）确保跑最新代码。
- 若重启后「你好」仍走任务：报后端日志，我再深挖。

## 4.32 会话 17i.31 修复聊天被当任务渲染（前端真 bug）（本次，用户「你好→聊天回复进了任务面板，聊天区却显示接单语」）

### 根因（前端）
- doSend 成功路径对**所有响应（含闲聊 mode=chat）都调用 `hook?.()`**——renderLive 会创建任务面板卡片 + 显示「收到任务」接单语。
- 结果：闲聊回复被放进**任务面板**，聊天区却显示接单语 +「任务已完成」。（后端分类正确，纯前端渲染分支错误。）

### 修复
- doSend 成功路径按 `isChat` 分支：
  - **聊天**（mode=chat）→ 直接替换占位为闲聊回复，**不进任务面板、不显示接单语/完成语**。
  - **任务** → 原有流程（面板卡片 finalize + 完成语 + 已完成列表）。
- 非网络发送失败统一报「❌ 发送失败：<err>」（不再误报「任务执行失败」，聊天失败同样适用）。

### 门禁
- web typecheck+build ✅；root tsc ✅。

### 说明
- 纯前端改动，Vite HMR 生效；后端无需重启（后端一直正确）。

## 4.33 会话 17i.32 闲聊回复流式输出（真 token 级）（本次，用户「改成流式输出」）

### 实现
- **PiBridge.generateChatStream**：复用 createAgentHarness 的 subscribe（text_delta），onDelta 逐 token 回调，返回完整文本。
- **CompanyFacade**：chat 路径优先用 `chatStreamer`（流式）；无则回退 llmProvider（非流式）。
- **bootstrap**：`setChatStreamer` 包装 → 每 token 发 `chat.stream.delta`（SSE 投影）。
- **前端**：moduleOnStreamEvent 收 `chat.stream.delta` → 追加到当前占位气泡（打字机），不触发任务面板；POST 返回后 replaceWith 完整回复定稿。

### 实测
- POST「你好」→ mode=chat，SSE 抓到 **14 个 chat.stream.delta**，拼接=完整回复「你好呀！很高兴见到你…」✅。

### 门禁
- root tsc / web typecheck+build ✅。

### 说明
- 需重启后端（流式链路在核心/后端）。前端 HMR 生效。

## 4.34 会话 17i.33 任务回复改 LLM 拟人化总结（流式）（本次，用户「之前任务回复是代码式，能否 LLM 直接拟人化回复」）

### 确认
- 之前任务完成语 = 模板 `buildManagerReport` + 原始 `==== CEO 执行报告`（代码式）。

### 实现
- **后端** `generateTaskSummary`（StudioServer）：任务完成后用 LLM（piBridge.generateChatStream）按拟人化 prompt（2-4 句、纯口语、不提架构）生成总结，**逐 token 发 `chat.stream.delta`**（SSE）；返回 `naturalReport`，历史存总结（不存 ==== 原始报告）。失败回退原始 report。
- **前端**：moduleOnStreamEvent 统一流式气泡——聊天用占位；**任务总结新建气泡**（聊天区追加拟人总结，流式打字机）；任务成功路径优先用 naturalReport（已流式则不重复追加）。

### 实测
- 聊天流式 14 delta ✅（上一轮）；任务总结复用同链路（触发点在任务完成后，任务本身因 reasoning 慢未在测试窗口内跑完，链路代码已通）。

### 门禁
- root tsc / web typecheck+build ✅。

### 说明
- 需重启后端（含 generateTaskSummary + 流式链路）。前端 HMR 生效。

## 4.35 会话 17i.34 修复「后端未就绪」不消失 + 「你能做什么」误判任务（本次，用户两处反馈）

### ① 后端未就绪状态不消失
- 根因：`setBackendReady(true)` 只启用按钮，**未清除**「后端未就绪」状态文字 → 一直显示直到发消息被覆盖。
- 修复：`setBackendReady(true)` 时清除状态文字。

### ② 「你能做什么」被当任务
- 根因：启发式先查 TASK_HINT_RE，「你能做什么」含「做」→ 误判 task。
- 修复：`IntentClassifier` 新增 `CAPABILITY_RE`（能/会/可以…做什么/什么功能/你是谁/介绍一下自己 等），**先于任务词判定** → chat。

### 验证
- `你能做什么/你会什么/你有什么功能/你好` → chat ✅；`帮我写一个todo应用/你能帮我写代码吗` → task ✅。
- root tsc / web typecheck+build ✅。

### 说明
- ①前端 HMR 生效；②核心改动需重启后端。

## 4.36 会话 17i.35 意图识别改「LLM 判歧义」（本次，用户「不是用 LLM 识别意图吗」）

### 新设计（正则只留铁定，疑问/歧义走 LLM）
- `IntentClassifier.heuristic` 重写：
  - **铁定任务**：强任务动词 + 具体对象 + 非疑问 → task（0 成本）：`帮我写一个todo应用` / `生成电子烟网页`。
  - **铁定闲聊**：问候/道谢/再见/极短非任务 → chat（0 成本）：`你好` / `谢谢` / `嗯`。
  - **疑问/能力询问**（能…什么/…吗/什么是…/怎么…/有什么功能）→ **unknown → 交给 LLM**：`你能做什么` / `你会什么` / `你能帮我写代码吗` / `什么是人工智能`。
  - LLM 失败兜底：疑问类 → chat（不把问题当任务执行）；其余 → task。
- 移除 17i.34 的 CAPABILITY_RE 正则补丁（由 LLM 泛化覆盖，不再枚举）。

### 验证
- 无 LLM：`你好/谢谢/嗯/好的`→chat、`帮我写todo/生成网页`→task、`你能做什么/你会什么/能帮我写代码吗/什么是AI`→chat（兜底）✅。
- 有 LLM：疑问类走 LLM 判定 ✅。
- root tsc ✅。

### 说明
- 核心改动需重启后端。代价：疑问/歧义句每次多一次 LLM 调用（慢 1-2s、花少量 token）；问候/清晰任务仍 0 成本。

## 4.37 会话 17i.36 首句必失败修复：网络错误自动重试（本次，用户「软件刚启动第一句必无法连接」）

### 根因
- 启动竞态：前端健康检查通过（后端已监听），但首个 POST 撞上后端预热/瞬时不可用 → `Failed to fetch`。

### 修复
- doSend 里 `api.sendChat` 包**自动重试**：网络/连接错误（Failed to fetch/ECONNREFUSED/无法连接…）重试最多 3 次、退避 1.2s/2.4s。
  - 网络失败 = 请求未达服务端（未执行）→ 重试安全，不会双执行任务。
  - 非网络错误（服务端返回 4xx/5xx）不重试。
- 抽出 `isNetErrText()` 模块函数（重试 + 失败处理共用）。

### 门禁
- web typecheck+build ✅；root tsc ✅。

### 说明
- 纯前端改动，Vite HMR 生效。首次网络抖动自动重试后大概率成功；若持续失败（>3 次）仍走「恢复输入 + 自动重连」兜底。

## 4.38 会话 17i.37 关闭 UI 清理所有后端（本次，用户「修改成关闭ui清理所有相关后端」）

### 方案
- **`dev:all`**（desktop/package.json）：后端加入 concurrently：`concurrently -k "vite" "tauri dev" "npm run dev:backend"` → `-k` 任一退出杀掉全部（关 UI = 关后端）。
- **`start-dev.bat`** 重写：
  - 启动前**杀掉 5473 残留后端**（消灭陈旧 keep-alive 连接根因）。
  - 单窗口（MorPex-Desktop）托管 Vite+Tauri+后端，关窗 = 全部退出（不再有独立 MorPex-Backend 窗口）。

### 效果
- 启动：先清残留 5473 → 干净启动。
- 关闭 UI：concurrently -k 连带杀掉后端 + vite。
- 减少陈旧连接 → 首句失败概率大幅下降（重试仍是兜底）。

### 门禁
- dev:all 命令有效、路径正确（../web=web、../../=根）；前端 tsc ✅。

### 说明
- 打包版桌面壳退出本就会杀它拉起的后端（lib.rs RunEvent::Exit → kill_backend），本次主要解决开发模式。
- 若用户单独跑 `npm run dev:backend`（自己的终端），关闭 UI 不会杀它（非 concurrently 托管）——建议统一用 start-dev.bat / dev:all。

## 4.39 会话 17i.38 修复 start-dev.bat 编码问题（本次，用户「批量报 不是内部或外部命令，Windows」）

### 根因
- 上一轮用 write 工具重写 start-dev.bat：**UTF-8 + LF**；Windows cmd 以 **GBK + CRLF** 解析 .bat → 中文乱码字节被当命令执行 → 批量报错。

### 修复
- start-dev.bat 改为**纯 ASCII（英文消息）+ CRLF 行尾**（`file` 确认：`DOS batch file, ASCII text, CRLF`，0 非 ASCII 字节）。
- 结构校验：5 个 goto 标签、3 次 npm install、1 个 for 清理循环、1 个 start 窗口全对。

### 说明
- .bat 文件含中文必须 GBK 或纯 ASCII；今后改 .bat 一律 ASCII+CRLF（避免再踩）。

## 4.40 会话 17i.39 修复 dev:all 根路径（本次，`npm --prefix ../../` 解析到 packages 而非仓库根）

### 根因
- 从 `packages/studio/desktop` 到仓库根需 **`../../../`**（三层），误写成 `../../`（只到 packages）→ `E:\Morpex\packages\package.json` ENOENT。

### 修复
- `dev:all` 后端命令改 `npm --prefix ../../../ run dev:backend`；已验证 `../../../` 解析到 `E:\Morpex`（含 package.json）。

### 门禁
- 路径解析验证 ✅。

## 4.30 会话 17i.29 修复启动竞态（后端未就绪时发送 → Failed to fetch）（本次，用户「前后端刚运行就发消息提示无法连接」）

### 根因
- 前端启动快，后端懒加载约 6s 才监听 5473；`initWhenReady` 只在启动查一次健康，就绪前**不禁用发送** → 用户立即发消息 → `Failed to fetch`。

### 修复
- `backendReady` 标志：初始 false，`initWhenReady` 的 getHealth 成功（初始 + 5s 重试循环）→ `setBackendReady(true)` 启用发送。
- `setSending` / 发送按钮：`sendBtn.disabled = sending || !backendReady`（输入框保持可打字，仅禁发送）。
- `doSend` 守卫：`!backendReady` → 提示「后端未就绪，正在启动，请稍候再试」并 return（不发起 fetch）。
- 未就绪时状态栏显示「后端未就绪，正在启动，自动重试中…」。

### 门禁
- web typecheck+build ✅；root tsc ✅。

### optimizer 优化轮（17h·opt，随本次落地）
- **send() 竞态污染（高）**：发送期间切会话会把 A 会话回复塞进 B；加 `token + sessionAtSend` 双重守卫，await 后不匹配则丢弃（服务端已持久化到原会话，不重发）。
- **附件名注入（高）**：`buildAttachmentContext` 对客户端 `att.name` 再过 `sanitizeFileName`（meta.name 写入时已清洗，双保险）。
- **loadHistory catch 守卫（中）**：过期失败响应不再 `messages=[]` 清空新会话。
- **ensureSession 覆盖（中）**：createSession await 期间用户已切会话则不覆盖。
- **deleteSessionById 去重（中）**：`refreshSessions` 返回列表复用，删当前会话请求 4→3 次。
- **loadModels 空态（中）**：服务端空列表/失败均显示「模型列表不可用」+ disabled。
- **上传 UX（低）**：客户端 5MB 预检（不读内存）、逐文件渲染 chip、`if(!sending)` 不覆盖状态、发送失败恢复附件快照。
- **getChatHistory 逐行容错（低）**：单行 JSON 损坏跳过，保留其余历史。
- **CSS 死代码（低）**：移除 6 个无引用类 + 1 死变量（521→507 行）。

### reviewer 终审轮（17h·rev，随本次落地）
- **newSession / deleteSessionById 未使在途 loadHistory 失效（真实竞态，终审修复）**：`historyToken++` 加在 newSession 入口与删除当前会话分支，防旧会话历史污染新会话空态。
- 独立复核四项诉求逐条通过（验收表见会话记录）；重跑全部门禁：root tsc ✅ / web typecheck+build ✅ / api-contract 38 passed / validate-architecture 100% / production-check 8/8。
- 已知可接受边界：空会话不显示侧栏；模型全局切换（影响编排链）；5MB 上传上限；历史回载不含 raw JSON/meta；桌面 portable 产物为旧快照（发布 exe 前须重跑 `scripts/bundle-backend.mjs` + tauri build）。

### 运行时数据（均已 gitignore）
- `data/uploads/<fileId>` + `<fileId>.meta.json`：上传文件存储。
- `data/runtime-config.json`：`{ activeModel }` 模型切换持久化（**不写 morpex.yaml**，config 仍是唯一模型来源；恢复默认会删除此文件）。

## 4.41 会话 17j.1 部门 Space 化 P1（本次，用户：「session 抽象成 space，秘书/部门/三层架构 + 多任务不乱 + 人工门统一」）

### 背景与设计（已落盘 docs/design/space-model.md）
- 用户拍板：Q1=A（Space=容器，会话=任务线程）、Q2=A（跨部门/工位交流自动+只读旁观）、Q3=读项目文档（工作流插件实锤：`packages/workflows/{xjmcu,hardware,software,ecommerce}` 每个含 manifest.json + workflow-provider + matchGoal）、Q4=LLM 判断路由、Q5=P1→P2 连做。
- 实证关键结论：引擎「编排-步骤-执行肢」三层已基本具备（OrchestratorAgent 编排 / AgentSessionStore 每步骤会话 / 原语工具纯执行）；**`agent.message` 事件类型已定义但无发射者**（跨会话交流需新建 AgentMailbox＝P2）；Department 有 `groupChatId` 预留字段（Space 映射基础）。

### P1 改动（后端 + 前端，全通过门禁）
**后端（核心 + server）**
- `packages/core/src/governance/control-plane/space-types.ts`（**新**）：Space/SpaceTree/SpaceAliasMap 类型。
- `packages/core/src/governance/control-plane/SpaceService.ts`（**新**）：扫描 `WorkflowRegistry.getAll()`（静态，bootstrap 已注册 4 provider）→ 生成部门 Space（`dept_${workflowId}`，中文名映射表 + `data/space-aliases.json` 自定义别名覆盖）；懒加载（ensureLoaded 首查触发，O(1) 对齐 17i.21）；防抖落盘 `data/spaces.json`；发 `space.created`；`routeGoal`＝matchGoal 兜底；`routingHint` 供 LLM 路由。
- `OrchestratorAgent.run(goal, { departmentId, contextHint, managerPersona, capabilities })`：persona 注入 analysis prompt（"你是X部门经理…工位按复杂度动态编排"，**capabilities 仅作提示不硬性绑定**——用户 Q3 要求工位 LLM 动态编排）；不传 persona 行为与现状一致。
- 透传链（无全局状态、并发安全）：`CompanyFacade.ExecuteGoalOptions.intentHint/managerPersona/capabilities` → `MorPexRuntime.run` RunOptions → `UnifiedExecutionEngine.ExecutionRequest` → `orchestrator.run`。**intentHint** 让 chat/send 与 executeGoal 共享一次意图判断（避免二次判断不一致）。
- `SessionStore`：appendChatMessage 消息加 `kind/spaceId/threadId/departmentId`（向后兼容）；新增 `patchLastUserMessage(sessionId, {threadId,spaceId,kind})` 回填（执行返回 missionId 后重写 jsonl 该行）。
- `bootstrap-unified.ts`：UnifiedBootstrapResult 加 `spaceService`；创建 SpaceService(注入 eventBus)。
- `StudioServer`：
  - `GET /api/spaces` → {ok, tree:{hq,departments[]}}
  - `GET /api/spaces/:id/messages?sessionId=` → 按 spaceId 过滤（无 spaceId 旧消息归 hq；非法 id 400 防穿越）
  - `chat/send` 改造：先 `IntentClassifier.classify(message, llm)` 预判意图 → task 则 `routeTaskToSpace`（**LLM 判断**注入各部门 routeHint → 输出 dept_xxx；失败回退 matchGoal；再失败默认软件部）→ executeGoal 带 `departmentId=space.id / managerPersona / capabilities / intentHint` → 返回后按 `mode` 回填用户消息（threadId=missionId）+ 系统总结落库带归属；响应新增 `spaceId` / `routedTo:{spaceId,departmentName}`。
  - 闲聊：kind='chat'/spaceId='hq'。
- api-contract 测试 **+3**（GET /api/spaces 树结构、空间消息、非法空间 id 400），**41 passed / 2 skipped**。

**前端（packages/studio/web）**
- `src/api/types.ts`：Space/SpaceTree/SpacesResponse/SpaceMessage/SpaceMessagesResponse；ChatSendResponse 加 spaceId/routedTo。
- `src/api/client.ts`：`getSpaces()`、`getSpaceMessages(spaceId, sessionId)`（**必须传 sessionId**，后端端点依赖）。
- `src/views/console.ts`：
  - 侧栏：会话列表 → **部门空间区（顶部 spaceListEl）+ 历史会话折叠区（底部保留，用户要求）**。
  - 模块级 `spaceTree/hqSpace/spaceDepartments`（跨 tab 存活）；视图状态 `viewMode:'session'|'hq'|'dept'` + `spaceViewId/spaceDeptId/spaceThread/spaceFull`。
  - **空间信息条**（spaceInfoBarEl）：部门名 + capabilities chips（"工位能力将由 AI 按任务复杂度动态编排"）；总部秘书说明。
  - **任务线程条**（threadBarEl）：按消息 threadId 分组 chips，可切换聚焦（全部/任务#），物理隔离多任务对话。
  - 空间视图发送：sendChat 带 spaceId/departmentId；总部下达任务 → 秘书转交提示「🤖 秘书：任务已转交 X 部门」（routedTo）。
  - 切换会话/删除自动回 session 视图。
- `src/styles.css`：space-tree/space-item/space-info-bar/space-info-caps/cap-chip/thread-bar 等浅色样式。
- **关键 bug 修复（本次审查发现）**：①后端部门 Space 无 departmentId → 前端用 `node.isDept` 判断（不再依赖 departmentId，防止所有部门误进 hq 模式）；②`getSpaceMessages` 未传 sessionId → 后端返回空 → 空间消息永远为空（已加 sessionId）。

### 门禁
- 根 `npx tsc --noEmit` ✅ / `npx vitest run api-contract.test.ts` **41 passed** ✅ / web `tsc --noEmit` + `vite build` ✅。

### 遗留 / 已知（P1）
1. `Space.departmentId` 后端未映射引擎 Department 实体（P3 完整化；当前路由/落库用 space.id=dept_xxx 即可）。
2. 空间消息历史：threadId=missionId；无 threadId 旧任务消息归"全部"（不丢消息）。
3. **P2 未做**：AgentMailbox（`agent.message` 事件发射者）+ 工位/部门间真交流 + 前端只读旁观投影；工作流包安装 UI（P3）。
4. 需要**重启后端**（含 SpaceService/bootstrap 改动）后 `/api/spaces` 与 chat/send 路由才生效；前端 HMR 即时。

## 4.42 会话 17j.2 任务工作台 UI 改版（本次，用户反馈 P1 交互：消息丢失 + 路由不跳转 + 要任务列表/进度/标题摘要）

### 用户反馈（硬需求）
1. 总部下任务→切走再切回→消息“丢失”（根因：任务消息归部门 spaceId，总部 hq 过滤看不到；非丢失而是归属设计+无自动跳转）。
2. 路由后应**直接跳转**到部门页面（而不是还在总部）。
3. **取消历史会话**；左下角（原历史会话位）改**全局任务列表**：每项=标题摘要（deepseek 风格）+状态/进度（✓完成/⏳1/3/⏸需回复/❌失败）；点击→右侧变该任务聊天（用户↔经理 + 经理↔工位投影）。

### 改动（前端 console.ts + styles.css + 后端 StudioServer 小改）
- **模块级任务列表**：`tasks: TaskListItem[]` + `currentTaskId` + `taskListHook`；localStorage('morpex.tasks') 持久化（cap 50）；`upsertTask/removeTask/taskTitle`（去语气词+截断≤14字）；`syncTaskFromRun`（SSE 事件→状态/进度/threadId 实时同步，等待人工门→'waiting'）。
- **viewMode +'task'**：`enterTask(task)` = 按 `t.threadId||t.id` 过滤 `getSpaceMessages`（无 threadId 兜底全空间）；任务聊天复用 messages/实时卡片/任务面板。
- **侧栏重构**：历史会话折叠区→**任务列表**（空间树上 + 任务列表下）；sessionListEl 保留但不渲染（sessionId 仍为存储单元）；「新对话」按钮保留。
- **addMsg 同步**：doSend/appendMessage 推送时若 `spaceFull!==messages` 同步推 spaceFull——**根治切视图消息丢失**。
- **路由自动跳转**：后端 chat/send 路由后发 `task.routed` SSE（{goal,spaceId,departmentName,sessionId}）；前端 `moduleOnStreamEvent` 收到→`spaceJumpHook` 早期跳部门视图 + 任务项关联部门+高亮；完成分支兜底跳部门（事件丢失时）+ 高亮。
- **完成语**：未自动跳转时才即时追加（已跳转则任务聊天从服务端加载总结，避免重复）。catch 分支：已确认任务标失败 / 未确认移除占位。
- **加固**：renderSpaceInfoBar 空节点防护；enterTask 无 node 防护；tab 离开清理 taskListHook/spaceJumpHook。

### 门禁
- web `tsc` + `vite build` ✅；根 `tsc --noEmit` ✅；api-contract **41 passed/2 skipped** ✅。

### 已知/后续
1. 早期跳转依赖 `task.routed` 事件（路由在 engine 之外、mission.created 不带部门字段）；任务聊天在完成前只显示部门视图实时卡片（未完成按任务点击进入则 threadId 未定→显示部门全部）。
2. “对已有任务追加发言”（任务视图输入条→threadId 追加上下文）**未实现**（本轮范围外，需后端 chat/send 支持 threadId 追加）；任务视图发送=发到该任务所属部门新消息。
3. P2 AgentMailbox / 工作流包安装 UI / 人工门统一（HumanDecision）仍未做。

## 5. 已知问题 / 待办

### 🔴 待解决
1. **0.1.1 安装包静默安装挂起**（`setup.exe /S` 挂起不装；0.1.0 曾正常）。未定位根因（疑似 NSIS/升级交互）。**不影响 dev 模式**。解决后可出正式安装包。
2. **底层模型行为怪**（Agnes 2.5 Flash）：你好回英文/谢谢胡诌俄语/简单句限流空转。已加"同语言 prompt + 空回复兜底"，但根治需换更强模型或调 config/morpex.yaml。

### 🟡 迭代方向（未做）
- **正式 Logo 图标**：当前是占位图（`src-tauri/icons/`）。用户曾贴 8-bit 像素画 Prompt 指南（意图是想要像素风图标，会话内未执行）。可用代码生成像素图标或外部 AI 生成后 `npx tauri icon <png>` 接入。
- **代码保护**（用户曾选 C=先独立、暂不加密）：后续可用 Bytenode 编译 V8 字节码 + 前端混淆提升"别人改不动"。
- 异常告警阈值可配置 UI、进化审批 UI。
- 后端 CORS 白名单化（生产部署前按 FRONTEND_URL 收敛）。
- 会话视图增强：打字机流式输出、停止/中断（当前 sendChat 带 sessionId，多轮可用）。
- 侧栏会话项显示首条消息摘要（`firstLine` 函数已预留注释位）；会话重命名。
- 上传文件：v1 无自动清理（data/uploads 会累积）；上传进度条。
- 模型切换：v1 为全局切换（影响整条编排链——切到 minicpm 这类 1B 本地模型时 goal 任务可能劣化，UI 已用「本地/轻量」标注提醒）；per-session / per-scope 模型（chat 层 override vs 编排层默认）为 v2。

### ⚠️ 注意
- 仓库有**此前会话遗留的未提交改动**（PiBridge/model-registry/yamlConfig 等，与 UI 无关），提交时只选本次文件。
- 打包产物 `portable/`（~300MB）已 gitignore。
- 本机 8080 = llama-server（LLM 网关），**不要**把 Studio 后端端口改回 8080。

## 4.43 会话 17j.3 P2 后端：AgentMailbox 跨部门/工位真交流（本次，用户 P2+P3 连做）

### 实现（调度器亲自落地，门禁亲验）
- **新增 `packages/core/src/execution/AgentMailbox.ts`**：`AgentMailbox` 服务——`sendAndWait({from,to,question,spaceId,taskId,goal})` 阻塞等回复；回复由 **LLM 扮演目标角色生成**（`to=dept:xxx` → SpaceService 部门 managerPersona；`to=station:xxx` → 通用工位人设）；落盘 `data/mailbox/<spaceId>.jsonl`；发 `agent.message`（发出）+ `agent.message.received`（回复）+ `agent.message.timeout`（超时）事件；超时兜底（默认 60s，可配）。**模块级单例**（`setMailboxInstance/getMailbox`，UserAskService 同构）供 StepAgentExecutor/StudioServer/bootstrap 共用。
- **`primitiveAgentTools.ts`**：`PrimitiveToolOptions` 加 `mailboxCtx`（from/spaceId/taskId/goal）；eventBus + mailboxCtx + mailbox 齐备时注册 **`mail` 工具**（描述指导 LLM 何时调：问采购部预算/问电路设计工位外设；阻塞等回复；失败/超时降级为「按不知道继续」，绝不使任务失败）。
- **`StepAgentExecutor.ts`**：构造加 `mailboxCtx`，tools 创建透传。
- **`ServiceContainer.ts`**（nodeHandler）：`mailboxCtx = { from: station:<node.agentType>, spaceId: departmentId(已 dept_xxx), taskId: ctxObj.executionId/missionId, goal }`。
- **`bootstrap-unified.ts`**：创建 AgentMailbox（eventBus + spaceService + LLM=piBridge.generateChatStream 懒加载），`setMailboxInstance`，挂 UnifiedBootstrapResult.mailbox。
- **`StudioServer.ts`**：`GET /api/mailbox/:spaceId`（只读旁观）、`POST /api/mailbox/send`（手动/调试发送，阻塞返回 reply）。

### 门禁（调度器亲跑）
- 根 `tsc --noEmit` ✅；api-contract **41 passed / 2 skipped** ✅（不回归）。
- 冒烟测试（tsx 实测）：无 LLM→模板兜底回复 ✅；落盘 jsonl ✅；listForSpace 返回 status=replied/from/to 正确 ✅；LLM 永不返回→400ms 超时降级 + status=timeout ✅。

### 关键边界（诚实）
1. **mail 触发依赖 LLM 判断**（step-agent 主动意识到需要别的工位/部门信息才调）；不是每任务必发生。
2. **回复是 LLM 扮演角色**（异步 step-agent 无法真实时互聊），属「信息参谋」，不伪造执行结果；用户在旁观投影看到的对话是角色模拟。
3. **前端只读旁观投影尚未做**（P2 前端，待续）。

## 4.44 会话 17j.4 P3 后端：人工门统一 + 工作流热插拔（本次，P2+P3 连做）

### P3-A 人工决策统一（HumanDecision）
- **StudioServer**：`GET /api/decisions/pending`（聚合 plan/ask/approval 三类 pending 为统一 HumanDecision 视图：id/kind/title/question/options/goal/meta/status）+ `POST /api/decisions/:id/respond`（kind 路由：plan→confirmPlan / ask→answerAsk / approval→approvalGate.decide；kind 缺失按 id 探测）。底层三个 service 不动，旧端点保留兼容。

### P3-B 工作流热插拔
- **SpaceService**：新增 `refresh()`（幂等重扫 WorkflowProvider 补齐部门 Space）。
- **StudioServer**：`GET /api/space/installable`（当前部门 + 已注册 provider 清单）、`POST /api/space/install-workflow {workflowId}`（已注册→直接 refresh 生成部门；未注册→尽力动态 import packages/workflows/<id>/workflow-provider.ts 注册后 refresh；失败返回提示重启自动发现）。bootstrap 启动仍自动发现已注册包（138-141 行显式注册 4 个 provider）。

### 门禁（调度器亲跑）
- 根 `tsc --noEmit` ✅；api-contract **41 passed / 2 skipped** ✅（不回归）。

### 待续（前端波次）
- ~~P2 前端：部门 Space 只读旁观投影（mailbox 消息流水，可折叠）。~~ ✅ 已完成（见 §4.45）
- ~~P3 前端：三套暂停统一渲染「需要你决定」卡片 + 会话级待处理徽章 🔔(n)。~~ ✅ 已完成（见 §4.45）
- ~~P3-B 前端：工作流安装入口 + 部门列表刷新。~~ ✅ 已完成（见 §4.45）

## 4.45 会话 17j.5 P2+P3 前端波次（本次，调度器亲手实施——fork 两次 No result，不再依赖 fork）

### 改动（仅前端 packages/studio/web，未动后端）
- `src/api/types.ts`：新增 `MailMessage/MailboxResponse/MailboxSendRequest`、`DecisionItem/DecisionsResponse`、`InstallableWorkflow/InstallableResponse/InstallWorkflowResponse`。
- `src/api/client.ts`：新增 `getMailboxMessages(spaceId)`、`mailboxSend`、`getPendingDecisions`、`respondDecision(id, decision?)`、`getInstallableWorkflows`、`installWorkflow(workflowId)`。
- `src/views/console.ts`：
  - **P2 只读旁观**：模块级 `mailCache(Record<spaceId, MailMessage[]>)`；`appendMailMessage`（按 id 去重+排序+增dong渲染）、`loadMailbox(spaceId)`（进入部门拉取全景）；`moduleOnStreamEvent` 处理 `agent.message / agent.message.received / agent.message.timeout`（增量追加+回复到达时 refetch）；`syncViewControls` 中 viewMode==='dept' 显示「🗣 协作对话(<details>)」并加载，否则隐藏；装配挂 `mailBox` 于 spaceInfoBarEl 与 threadBarEl 之间。
  - **P3-A 待处理徽章**：模块级 `pendingDecisions` + `refreshPendingDecisions()`（轮询 GET /api/decisions/pending，事件 plan.ready/user.ask/approval 到达时也刷新）+ `respondViaBadge(id, decision)`（走统一端点；ask 引导到聊天气泡输入）+ `pendingBadgeHook`；装配在 chat-header 加 `🔔 待处理(n)` 按钮 + `pending-pop` 下拉（plan→确认继续、approval→批准/拒绝、ask→提示去聊天气泡）；**保留旧三套渲染作降级**（后端 decisions 不可用时仍正常工作）。
  - **P3-B 安装入口**：sidebar-footer 加「➕ 安装工作流」→ `showInstallWf()` 弹层（GET /api/space/installable → 未安装列安装按钮 → POST install-workflow → updateStatus + loadSpaces 刷新空间树）。
  - 关键修复：模块级函数用 `api`（renderConsole 闭包参数）→ 新增模块级 `apiRef`（renderConsole 开头赋值）；pendingPop replaceChildren 展开数组；sort 回调显式类型。
- `src/styles.css`：追加 `.badge-pending/.pending-pop/.pending-item*/.mail-box/.mail-log/.mail-bubble/.mail-*/.modal-box/.modal-body/.install-item*/.sidebar-footer` 浅色样式。

### 门禁（调度器亲跑）
- `web tsc --noEmit` ✅（修 4 类错误后过）；`vite build` ✅（57 modules，270KB）。
- 仅改 web 包，根 tsc / api-contract 不受影响（根 tsconfig 不含 web，已实证）。

### 遗留 / 已知（P2+P3）
1. **ask 类决策**在徽章里只提示「到聊天问答气泡输入」（未做内联输入）——需要输入上下文，简化处理；plan/approval 可直接在徽章快速处理。
2. **统一决策卡片**未做成「一张卡融入任务聊天」——本波次以「叠加」策略（保留旧三套渲染 + 新增徽章快速处理）保证零回归；完整统一卡片可后续做。
3. **mail 旁观自动展开**：进入部门 Space 时 `<details>` 保持 `open`（便于看到工位/部门交流）；未做未读计数角标（N=总数）。
4. 徽章初始在装配时拉一次 `refreshPendingDecisions()`；后续靠事件/轮询刷新（现有 5s 健康轮询未并入决策轮询——可后续并入）。
5. 提交提醒：`packages/studio/web/` 全目录 git untracked，提交时整目录加入（含本次 4 文件 + styles.css）。

## 4.46 会话 17k.1 多任务并发 + 发送框解锁（本次，用户：「任务进行中发送框不要锁定；编排/stepagent 只是安排+对话，耗时的是执行肢」）

### 背景
- fork 派发两次失败（No result / 半成品中断），**调度器亲手接手完成**：fork 已完成模块级分发改造（activeRuns Map / moduleTick / moduleOnStreamEvent 广播 / clearRun(runId)），但 doSend/renderLive/完成/失败分支仍残留单例 activeRun/syncRunHook/elapsedEl（编译不过）。**教训：大重构 fork 易中断，改为调度器小步编辑 + 每步 tsc 验证。**

### 改动（仅 packages/studio/web/src/views/console.ts）
- **activeRuns Map 泛化完成**：doSend 新建 run 入 `activeRuns.set(runId, run)`，**不再 clearRun() 接管旧 run**（多任务并存）；run 对象带 per-run 字段（elapsedEl/syncHook/chatStreamEl/chatStreamStarted/chatLogEl）。
- **发送框不锁定**：`setSending(true)` 仅用于提交瞬间防抖；sendBody 构造后、`await sendChat` 前 `setSending(false)`——任务执行期间发送框可用（防双击靠「输入框已清空」拦截，无需长期锁）。
- **SSE/计时/轮询首开复用（关键并发 bug 修复）**：`if (!runSse) runSse = openEventStream(...)`、`if (runTimer===undefined) ...`、`if (runPoller===undefined) ...`——多任务并发不得重复订阅 SSE 导致事件双份消费；全部 run 结束后 clearRun 关闭。
- **chat.stream.delta 流式归属**：优先追加到 `lastSendId` 对应 run 的 chatStreamEl/chatLogEl（任务拟人总结各归各）；无 run 时用模块级兑底（闲聊）。
- **完成/失败分支**：per-run 检查 `!run || run.done || !activeRuns.has(runId)` → 置 done/resultMsg → 取 run.syncHook 执行 → `clearRun(runId)`（只清本 run，其它在途不受影响）。
- **LiveCardController.render** 加第 4 参 `elapsedSink`；createLiveCardHost 传 `(el)=>{ run.elapsedEl = el }`（替代删除的模块级 elapsedEl）。
- **cleanup（切 tab）**：遍历 activeRuns 解引 run.syncHook/run.elapsedEl（不关全局资源）。

### 门禁（调度器亲跑）
- web tsc ✅ / vite build ✅（57 modules，270.56KB）。
- 仅改 web，根 tsc / api-contract 不受影响。

### 已知 / 边界
1. 多任务并发后，左侧任务列表各任务独立更新（syncTaskFromRun 遍历 activeRuns）；完成状态由各自事件驱动。
2. runSse 复用后，事件仍按 missionId/goal 广播给所有在途 run（consumeStreamEvent 内部 isRunRelevant 过滤），任务间互不污染。
3. 流式 delta 归属是「最近发送 run」近似；极端并发下偶有占位替换竞争（可后续按 missionId 精确归属）。
4. **需求 2（取消顶部任务面板 → stepagent 方块工作台，点击任务切工作对话框）仍未做**——本轮仅完成需求 1（发送解锁+多任务并发）。

## 4.47 会话 17k.2 任务工作台（stepagent 方块）+ 需求1收尾（本次，用户两个需求：①发送框不锁定多任务并发 ②取消顶部任务面板 → 点击任务切换工作对话框，显示每个 stepagent 方块，点击展开详细工作）

### 需求 1（17k.1，fork 两次中断后调度器亲手完成）
- activeRun 单例 → `activeRuns: Map<runId, Run>`；发送框不锁定（sending 仅提交防抖，setSending(false) 在请求发出后）；SSE/计时/轮询首开复用（避免双份消费）；chat.stream.delta 按 lastSendId 归属 run；完成/失败 per-run clearRun(runId)。web tsc+build ✅。

### 需求 2（本波，调度器亲手实现）
- **取消顶部任务面板常驻**：taskPanelEl 改为「任务工作台」，仅 viewMode==='task' 显示（syncViewControls 控制显隐/清空/解锁 activeWorkbenchRunId）。
- **点击左侧任务 → 主区变该任务工作对话框**：enterTask 重建 taskPanelEl（在途＝buildTaskWorkbench 实时方块；完成/历史＝renderStaticTaskSummary 静态摘要）。
- **stepagent 方块**：buildTaskWorkbench 渲染方块网格（数据源：state.dag.nodes 优先、缺省回退 state.steps；状态由 steps 实时覆盖）。每个方块＝一个工位/步骤，点击展开其详情（复用 buildStepRow：思考💭/工具🔧/结果📄/失败原因）。经理（规划）= 第一个方块（用户拍板 A 方案）。
- **完整执行视图保留**：工作台下方折叠「📄 查看完整执行视图（DAG/终端/审批）」→ 复用 createLiveCardHost/LiveCardController 整卡（展开即渲染，完成时隐藏）。
- **后台并发任务不占工作台**：createPanelTaskCard 仅当 run.runId === activeWorkbenchRunId 才建（后台任务只更新任务列表状态）。
- styles.css 追加 .workbench/.wb-* 浅色样式；LiveCardController/createLiveCardHost 保留（完整视图折叠使用）。

### 门禁（调度器亲跑）
- web tsc ✅ / vite build ✅（57 modules，273.45KB）。仅改 web，后端/根不受影响。

### 已知 / 边界
1. 后台并发任务只显示在左侧任务列表（状态实时更新），不占主工作台；点进该任务即见其实时方块。
2. 历史任务（无在途 run）工作台为静态摘要，详情回退到下方聊天历史。
3. 方块来源优先 DAG 节点（编排器真实结构）；无 DAG 事件（web 引擎路径）时回退步骤列表。
4. ask/plan/approval 交互由 P3 待处理徽章 + 聊天气泡兜住（工作台专注执行方块展示）。

## 4.48 会话 17k.4 修复「任务需回复却找不到回复入口」（切视图后 plan/ask 确认气泡丢失）

### 根因（实证）
- plan.ready / ask_user / approval 的**回复气泡是运行时 UI**（renderLive 往 logEl append），**不持久化到服务端 chat-history**（17i.14 澄清同理）。
- 切换视图（部门/任务）→ loadSpaceMessages 从服务端重载消息 → **运行时气泡丢失**；但任务项 status='waiting'（run.state.plan/asks 内存仍在）→ 用户看到「需回复」却无回复入口。
- 关键：服务端统一决策队列 `pendingDecisions`（GET /api/decisions/pending，plan/ask/approval 聚合）**不受视图切换影响**——可作恢复源。

### 修复（纯前端）
- 新增模块级 `buildDecisionCard(d)`：统一「待你决定」交互卡片（plan=确认继续▶ / approval=批准/拒绝 / ask=输入+提交），提交走 `respondDecision(id, decision)`（ask 传输入值）。
- 新增闭包内 `renderPendingPromptCards(goalText?)`：从 pendingDecisions 过滤匹配当前任务 goal 的 pending 项，append 到聊天区底部；先移除旧 `.pending-prompt` 再渲染（幂等不堆叠）。
- `loadSpaceMessages` 渲染后调用：先按现有队列渲染，再 `refreshPendingDecisions().then(再渲染)`（确保服务端最新）。enterTask/enterSpace 都走 loadSpaceMessages → 切回即重建回复入口。
- styles.css 追加 .pending-prompt/.pending-card* 浅色样式。

### 门禁（调度器亲跑）
- web tsc ✅ / vite build ✅（275KB）。仅改 web。

### 已知 / 边界
1. pendingDecisions 是服务端内存队列（PlanGate/UserAsk/Approval 的 pending Map）——后端重启会丢（既有设计，17i.22 不设超时；本修复不改此点）。
2. 非任务视图（dept/hq）下 goalText=undefined → 展示全部 pending（跨任务也可见可处理，可接受）。
3. ask 的输入提交走 decisions/:id/respond 的 kind 探测路由（后端 P3-A 已支持）。

## 4.49 会话 17k.5 UI 状态持久化（P-A/P-B/P-C，第一性原理「真相源」落地；用户：页面组件只存内存+事件流不行）

### 规则
- AGENTS.md 新增 §3.0「编程第一性原理」7 条（真相源第一/状态是数据/事件与查询分离/先契约后实现/可恢复即正确/复用优先/先问为什么）。

### 方案
- docs/design/ui-state-persistence.md：现状真源盘点 + 根因（**事件无任务级关联键**：execution.step.* 只有 nodeId）+ 三段式（投影/决策持久化/前端恢复）。

### P-A 任务状态投影（后端，真相源）
- 新增 `core/src/execution/TaskStateProjector.ts`：订阅 execution.dag / execution.step.* / workflow.step_* → 投影 data/tasks/<missionId>.json（steps/dag/progress，500ms 防抖落盘）；启动扫描载入；键=missionId（贯穿 MissionController ↔ DAGExecutorAdapter ↔ 前端 threadId）。
- **任务级关联键透传**：DAGRuntime（execution.dag/workflow.step_* 加 ctxMeta missionId/goal）+ StepAgentExecutor（Options 加 missionId/executionId，step 事件 payload 加）+ ServiceContainer nodeHandler（传 missionId）。
- 端点：GET /api/tasks、GET /api/tasks/:id；bootstrap 装配（attach+restore）。

### P-B 未决决策持久化（后端）
- 新增 `core/src/execution/DecisionStore.ts`：data/decisions.jsonl（record/resolve 事件行 append）+ restoreDecisions 重放恢复。
- 接入：PlanGateService（record/resolve）、UserAskService（record/resolve）、ApprovalGate（WAIT_HUMAN record / decide resolve）。
- StudioServer /api/decisions/pending 改为「持久化决策为主源 + 三 service 去重补充」；bootstrap 启动 restore。

### P-C 前端恢复（web）
- types/client：TaskProjection/TasksListResponse、getTaskProjection/getTasks。
- console.ts：历史/已完成任务点进时 renderStaticTaskSummary 异步 GET /api/tasks/:missionId → buildStaticProjection 重建静态工位方块（切视图/重启后历史任务仍可看结构）+ 进度；在途任务仍走实时 workbench。

### 门禁（调度器亲跑）
- 根 tsc ✅ / web tsc ✅ / vite build ✅（275KB）/ api-contract 41 passed / 2 skipped。

### 已知 / 边界
1. 投影是「当前状态」缓存；事件溯源仍是根本真源（投影损坏 → 重放/丢弃重建）。
2. 事件补 TaskContext 为纯加法（新 payload 字段），旧事件（无 missionId）投影跳过，前端仍以 goal 文本匹配兑底（兼容）。
3. 任务列表仍以 localStorage 为主源（P-C 未做服务端列表首源——可后续）；历史任务工作台已能从服务端恢复。
4. 决策持久化是 append-only jsonl；长期运行可考虑轮转/压缩（后续）。

## 4.50 会话 17k.6 修复「ask 回答气泡归属错乱 + 空问题文案」（用户：发布任务后回『需要我补充一些信息』只有一句；回答气泡消失；所有部门页面都出现回答气泡）

### 根因（实证）
- `createAskUserTool` 只传 sessionId，**无 spaceId/goal** → ask 决策项无归属键。
- 前端 renderPendingPromptCards 在 dept 视图 goalText=undefined 时 `mine = pend`（**展示全部 pending**）→ 每个部门页面都出现同一任务的回答气泡。
- LLM 调 ask_user 未传 question → 文案是默认『需要你补充一些信息』（模糊无用）。

### 修复（第一性原理：决策项必须有归属键）
- 后端：DecisionStore.recordDecision 支持 `spaceId`；UserAskService.createAskUserTool opts 加 spaceId/goal（record 带上）；primitiveAgentTools 调 ask_user 时透传 mailboxCtx.spaceId/goal（StepAgentExecutor 已带 dept_xxx）。
- 前端：DecisionItem 加 `spaceId`；StudioServer stored 映射透传 spaceId。
- console.ts renderPendingPromptCards 改为**归属过滤**（不再全展示）：
  - task 视图：goal 匹配当前任务
  - dept 视图：spaceId===当前部门 或 goal 匹配该部门任一任务
  - 其它（hq/session）：不显示 prompt 卡片（全局入口 = header 🔔 待处理徽章）
- buildDecisionCard：ask 且 question 空/默认时显示引导文案（『请补充技术栈/风格/预算等』）——不再只有一句模糊话。

### 门禁（调度器亲跑）
- 根 tsc ✅ / web tsc ✅ / vite build ✅（276KB）/ api-contract 41 passed。

### 已知 / 边界
1. plan/approval 暂无 spaceId（plan 有 goal 可经任务→dept 关联；approval 无 goal/spaceId——dept 视图不会显示，仅 task 视图按 goal 或徽章可见）。可后续给 plan/approval 也补归属。
2. ask 问题文案依赖 LLM 传 question；未传时已给引导（用户可直接输入回答，respondDecision 会 answerAsk）。

## 4.51 会话 17k.7 追查「重启后仍无回答气泡」——归属透传未生效 + 旧数据兜底（用户：重启后还是没看到回答气泡）

### 实证根因（不信自报，查 data/decisions.jsonl）
- decisions.jsonl 里 ask 记录 `ask_1786986914115_1` **无 goal/spaceId**，且 `meta.sessionId = '帮我做一个任务'`（任务文本）——说明：
  1. 该 ask 由旧代码写入（透传未生效时）；
  2. `spaceId` 依赖的 `departmentId` **没穿到 DAG 层**（DAGExecutorAdapter 的 context 只有 missionId/goal/channel/sessionId，无 departmentId）→ mailboxCtx.spaceId=undefined；
  3. `sessionId` 兜底成了 goal 文本（step 会话未建时 `stepSession?.sessionId || this.opts.goal`）。
- 前端新归属过滤按 goal/spaceId 匹配 → 全匹配不上 → **不显示**（导致「看不到回复」）。

### 修复
- 后端（primitiveAgentTools）：createAskUserTool 改传 `goal: options.goal`（StepAgentExecutor 可靠传入 mission goal，不再依赖 mailboxCtx.goal）+ `spaceId: options.mailboxCtx?.spaceId ?? options.departmentId`。
- 前端（console.ts renderPendingPromptCards 匹配兜底）：
  - 归属文本 `dg = d.goal || d.meta.sessionId`（旧 ask 把 goal 存进 sessionId，兜底可匹配）；
  - 无归属 ask 且当前任务在途（activeRuns 有 runId）→ task 视图也显示（防看不到回复入口）。

### 门禁（调度器亲跑）
- 根 tsc ✅ / web tsc ✅ / vite build ✅（276KB）。

### 已知 / 边界
1. 遗留旧 ask（无 goal/spaceId）现在靠 meta.sessionId 兜底匹配；新 ask 走 goal 精确归属。
2. departmentId 未穿到 DAG 层是深层问题（spaceId 依赖它）——ask 已用 goal 兜底，不阻塞；可后续给 DAGExecutorAdapter context 补 departmentId 根治。
3. 需重启后端（透传改动在 core）+ 前端 HMR。

## 6. 下个会话建议续接点

### 先确认环境（每次）
1. `netstat -ano | findstr 5473` —— 应**无残留监听**（或只有 1 个）。有残留先杀（`taskkill /PID <pid> /T /F`）再 `start-dev.bat`。
2. `start-dev.bat` → 单窗口（Vite+Tauri+后端），等状态栏「后端未就绪」消失（~6s）→ 发「你好」应**闲聊流式回复**（不是任务）。
3. 后端改动生效需重启后端（node --watch 自动，但若失活就重开 start-dev.bat）；前端改动 HMR 即时。

### 当前 UI 已具备
- 浅色聊天应用：左侧会话侧栏（新对话/删除/切换）+ 右侧聊天（拟人对话：接单→方案确认→LLM 流式总结）+ 顶部任务面板（DAG 节点图/步骤/流式输出/审批/ask_user 问答）+ Goal 模式开关。
- 文件查看器：md 渲染/代码高亮+行号/docx/xlsx/系统打开。
- 意图识别：正则只判铁定、疑问走 LLM。

### 待办 / 可选迭代（按优先级）
1. **pptx 内预览**（当前提示 + 系统打开）：zip+XML 提取文字（需 zip 解析库）。
2. **make 所有拟人话术走 LLM**（接单语/审批提示目前是模板）——用户问过，尚未定。
3. **上传文件点开查看**（附件 chip 点击 → openFileViewer）。
4. **正式 Logo 图标**（像素风，`npx tauri icon` 接入）。
5. **0.1.1 静默安装挂起**（NSIS，不影响 dev）。
6. **桌面打包前重跑 `scripts/bundle-backend.mjs` + tauri build**（portable 是旧快照，不含 17h-17i 代码）。
7. **提交代码**：`packages/studio/web/` 整个目录 git untracked（`??`）——17h-17i 全未提交，提交时只选本次文件（仓库有其它会话遗留未提交改动）。

### ⚠️ 常踩的坑（回顾）
- **.bat 改 ASCII+CRLF**（见 §0），否则 Windows cmd 报「不是内部或外部命令」。
- **后端改代码 → 记得重启**（node --watch 失活就重开 start-dev.bat）。
- **curl 测中文** → 用 UTF-8 文件 `--data-binary @f.json`（Git Bash 下 curl 中文乱码）。
- **首句失败** = 陈旧 keep-alive / 启动竞态 → 已加自动重试兜底；保持 5473 单后端。
- **8080 = llama-server**（LLM 网关），勿动 Studio 端口。
