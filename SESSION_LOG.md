# MorPex 会话交接日志（SESSION LOG）

> 会话记忆入口（精简）。规则见 `AGENTS.md`；架构真相源 `docs/AICOS_CORE_ARCHITECTURE.md`。
> 纪律：**只留【当前状态 + 最近进度 + 开放决策 + 待办 + 关键教训】**；历史细节以 git 为准，不堆积。会话结束更新本文件。

---

## 当前状态（2026-08-22，文档体系/复核收尾后）

- **架构**：AICOS-Core 8 层纯净架构；执行链 = `CompanyFacade.executeGoal` → ControlPlane(L1) → Ontology Gate(L3) → 规划(L4) → `UnifiedExecutionEngine`（简单→原语快 / 复杂→Orchestrator+step-agent）→ 评价(L6) → 演化(L7)；EventBus only；PiBridge 隔离 `adapters/pi-bridge/PiBridge.ts`。
- **门禁基线**：`tsc 0 ｜ validate-architecture 100% ｜ depcheck 0 ｜ check:docs 0 ｜ production 8/8 ｜ vitest ~790（`npm run test:full` 一键）`；关系链文档由 `scripts/_backend-code-analyze.ts` 重生成保证代码驱动。
- **文档体系（开发决策支持，免全量读码）**：`AGENTS`(精简总纲) → `DEVELOPMENT`(SOP/门禁/文档同步) → `CAPABILITY_INDEX`(功能→锚点+别名+状态，定位第一步) → `HOOK_MAP`(插入点/前后) → `BACKEND_CODE_MAP`(函数关系链，可重生成) → `AICOS_FLOW`/`EVENT_PAYLOAD_SPEC`(业务流/事件载荷) → `FILE_REGISTRY`(职责)；6 个 `skills/*` 按需触发（pi 读 `.pi/SYSTEM.md` §0.5 检索四连；Claude Code 用 `.claude/skills` 镜像）。
- **事件载荷**：`EVENT_PAYLOAD_SPEC v1`（Envelope 稳定头 + MessageBox 分块可扩展：task/state/human/artifacts/media/error/extensions）；`Envelope.ts` 类型化；`eventContractCatalog` 24+13 执行链契约；`TaskStateProjector` 投影对齐（status/stage/human/media/error）。
- **精简**：P0 已移除 studio simulation/verification(17)+废弃 harness(5)→ -22 文件/-3.3k 行（B/C 复评证实结构已收敛，不再手术）。
- **代码自述**：全部实质代码文件已补 JSDoc（死代码=ts-prune 0；重复=仅已知同源/兼容）；FILE_REGISTRY 职责经四批复核与代码相符（0 偏差）。
- **新会话自动检索**：`.pi/SYSTEM.md` §0.5 强制"收到需求→检索四连"（定位→理解→决策→收尾），不盲 grep 判无。

## 最近进度（里程碑，细节以 git 为准）

- **T1 档案室三件套（单一 Transcript 架构第二批，未提交）**：新增 packages/studio/server/transcript/{TranscriptStore,Indexer,ChatTranscriptService}。TranscriptStore = SQLite 读模型（transcript_windows/transcript_events/chat_index/index_watermark 四表；指针式不存正文）；Indexer = jsonl→指针索引（水位线增量/半行防护/幂等 upsert/回缩重建/classifyEntryLine 分类+preview）；ChatTranscriptService = resolve 复用同一本 orchestrator 账本 + 旧 chat-orch-map.json 自动迁移（载入即改名 .imported）。StudioServer：chat-orch-map 三方法废弃，绑定持久化迁至 transcript_windows 表，回合收尾触发增量索引。验证：tsc 0 错；验收脚本 15/15（含 offset 读回一致、幂等、回缩重建、迁移、半行防护），临时脚本已清理。偏离设计文档两处：windows 表加 file_path 列（定位账本文件必需）；新增 index_watermark 表（水位需按字节记，chat_index 按 chat 维度不合用；偏离已补记入设计文档 §3.2）。reviewer 修复 1 项数据安全隐患：旧映射迁移中途崩溃会使旧绑定永久孤儿化 → importLegacyIfNeeded 回退读 .imported（实测恢复成功）。待做已清零（第二批完成）：parent 链接入（AgentSessionStore.onSessionCreated 回调 + OrchestratorAgent ensureStepSession 传 parentSessionId，登记键统一修复双重登记 bug）+ 崩杀恢复实测通过（中途 taskkill → 重启 → 窗口存活 → 同账本续写）+ patch 双写移除（patchLastUserMessage 已删，回合收尾 user+assistant 成对入账）。reviewer 复核：T1 通过；遗留建议——byte_offset 字节域契约需写入 T2 投影层文件头注释。
- **T0 多轮对话连续性热修（单一 Transcript 架构第一步）**：ExecuteGoalOptions/RunOptions/ExecutionRequest 全链透传 `orchestratorSessionPath`；OrchestratorAgent.run 支持账本 resume（不再每次 `orch_${ts}` 新建）+ 历史注入分析 prompt + goal/交付物以 message 条目入账；AgentSessionStore 新增 openHandle/appendMessage；StudioServer chat/send 按 sessionId 绑定账本（chat-orch-map.json 持久化）+ 并发排队护栏（reviewer 修复：无 sessionId 请求不参与绑定，避免 "undefined" 账本上下文串门）+ chat 直答注入近期历史。验证：tsc 0 错；实测同一 sessionId 三次请求写同一 jsonl；openHandle/readEntries/appendMessage 闭环脚本通过。**同轮修复存量挂起（原误判为 step-agent 问题）**：根因 = PlanGateService 方案确认门交互模式无限等待且零日志（decisions.jsonl 新增 pending 记录实锤），chat/send 未带 goalMode 即静默卡死、5 个编排测试文件直调 run() 同因超时；修复 = requestPlanConfirm 等待时打日志 + 测试显式 setAutoExecute(true)；39/39 用例通过（1.8s，原先 330s+ 超时）、端到端 goalMode 任务 completed。设计文档：docs/SINGLE_TRANSCRIPT_DESIGN.md（Q1/Q3 已拍板：思考链默认隐藏、归档 30 天；Q4 已拍板：做回填，入 T4）。
- **桌面打包 esbuild 单文件改造（方案 A）**：新增 `desktop/scripts/bundle-server.mjs`（esbuild → server.mjs 单文件 11.2MB + better-sqlite3 闭包 prebuilt + config 复制；external=better-sqlite3/jiti；banner shim=createRequire+__filename+__dirname）；`bundle-backend.mjs` 默认新布局 portable/{node.exe, runtime/}（--legacy 保留旧 tsx 流程）；lib.rs 改 RuntimeLayout 探测（SingleFile/LegacyTsx）+ spawn_backend 参数化 + 解压校验放宽。效果：安装器资源 254MB→115MB、冷启动 ~40s→~4s（实测 5473 就绪）。optimizer 落地 3 项清理；reviewer 有条件通过（无阻断）。subagent/fork LLM 已统一切 opencode-go/ox-alpha-free。
- **桌面分发收尾**：① 端到端 NSIS 冒烟待人工验证（`npm run bundle` → `build:installer` → 双击 exe）；② 升级残留清理需先迁数据再清目录（数据在 runtime/data，直接删=毁数据）；③ 三张保命牌：代码签名（SmartScreen）/ API Key 图形向导 / 数据与程序分离；④ 中期评估 bun --compile 单 exe（复用同一 server.mjs）。
- **文档体系全建成**：AGENTS 精简(261→80) + DEVELOPMENT + CAPABILITY_INDEX + HOOK_MAP + skills×6 + check:docs 门禁 + EVENT_PAYLOAD_SPEC/Envelope/契约 + BACKEND_CODE_MAP 代码驱动重生成（485 文件/2775 函数/12832 调用）。
- **职责复核四批完成**：governance+knowledge / execution+cognition / infrastructure / evaluation·evolution+独立包 → 抽查 60+ 文件，FILE_REGISTRY 职责文字与代码**全部相符（0 偏差）**；补 23 处缺失 JSDoc 自述；死代码=ts-prune 0，重复=仅 core/connectors secureExec 同源内联等已知项。
- **检索验收**：以"复盘简报"走查端到端命中产物/关系链/插入点；暴露并修复 CAPABILITY_INDEX 缺"报告/汇总"能力域（19 个 report 函数曾不可检索→已补别名条目）。
- **精简**：P0 移除可选子系统（-22 文件/-3.3k 行）；拆分试点经质疑回退（拆分=增文件数/总行数，与"精简"相悖）；B/C 判不动（结构已收敛）。
- **事件消息**：EVENT_PAYLOAD_SPEC v1 + 13 执行链契约 + Envelope.ts + TaskStateProjector 可选块对齐（P2 待做：试点发射规范化 + 前端卡片）。
- 更早（去黑盒化/前端/桌面/GLM 攻坚/mock 套件等 16a~17f）：已完成并提交，见 git（无需在本文件保留）。

## 当前开放决策

- 微信接入：用户已排除，未做。
- UI 迭代（安装包已交付）：异常告警阈值可配置 UI、进化审批 UI 待做。
- 沙箱/Linux 执行：曾讨论（MSYS 桥+程序级沙箱 vs Docker/WSL）——用户暂缓，后续再定。

## 待办（按优先级）

- **文档体系持续维护**：能力索引随代码补全（发现"索引未覆盖但代码已有"→补条目，防漏判）；`check:docs` 保持 0。
- **事件 P2**（可选）：试点发射规范化（DAGRuntime workflow.step_started 带 state 块）+ 前端任务卡片消费标准字段。
- **UI 迭代**（待做）：异常告警阈值 UI、进化审批 UI。
- **验证**（可选）：opencode 50 轮 / 大样本 batch。
- **沙箱/Linux 执行**（暂缓，用户重提再动）：MSYS 桥 + 程序级 sandbox（Job Object/目录白名单）方案已设计。
- **DEVKIT 单文件已产出**：`devkit/DEVKIT.md`——LLM 新项目读它（或探测未初始化）即自动建 AGENTS/DEVELOPMENT/CAPABILITY_INDEX/HOOK_MAP/SESSION_LOG/skills 并引导填占位符；旧多骨架建议已清理（改用单文件）。
- **文档时效清理**：归档 guides/getting-started（旧端口 8080/3000、clone 流程严重过时）；FLOW 附 A 标题改“Agent 执行循环（pi，非自研 harness）”消除歧义；DEVELOPMENT/DEVKIT 新增“时效标记+防误读”规则（过时即归档或 ⚠️ 横幅，LLM 勿采信；读文档先交叉代码）——直接防“误读过时文档错误判断”。

## 关键教训（避免重蹈）

1. **兜底钩子必须在校验之前**（16l·7）：pi-ai validateToolArguments 在 beforeToolCall 前 throw → goal 兜底永远失效；用官方 prepareArguments 钩子（validate 前）做模型无关保险。
2. **易混淆拼写禁止手写**（16n）：`Deblackbox`(单b) vs `Debblackbox`(双b) 肉眼不可分，tsc 反复"模块不存在"实为拼写漂移。新标识符一律程序化派生 + hex 核验。
3. **拆分 ≠ 精简**：拆分增文件数/总行数（可读性↑、总量↑）；精简的正确路径=删"不触发的名义能力"（可选子系统/废弃层），需先证零引用+测试兜底。
4. **文档线性续写会零碎**：登记/索引用统一模板、改哪条更新哪条；过时文档移 archive；`check:docs` 门禁守路径真实性。
5. **子代理报告 ≠ 落盘**：报告"失败/完成"都要 `git status`/`git diff` 核对实盘再信。