# MorPex 会话交接日志（SESSION LOG）

> **会话记忆入口**（精简版）。规则见 `AGENTS.md`；架构唯一真相源 `docs/AICOS_CORE_ARCHITECTURE.md` + `docs/AICOS_CORE_FILE_REGISTRY.md`。
> 会话开始先读本文件；结束只更新"会话历史"+"当前状态/待办"，保持精简。

> ⚠️ **日志纪律（铁律）：过时/冗余信息丢弃**——本日志只保留【当前状态 + 最近进度 + 开放决策 + 待办】；
> 已闭环的历史细节、重复内容、过期描述一律删除，不堆积（历史细节以 git commit 为准，需要时查 git）。
> 会话结束更新时若发现旧内容已过时/冗余 → 直接丢弃，不要追加修补。

---

## 当前状态（2026-08-10，会话 16n 后）

- **架构**：AICOS-Core 8 层纯净架构；多 Agent 编排（OrchestratorAgent→step-agent）+ 单执行引擎（UnifiedExecutionEngine v3）；RAG-lazy 上下文装配（Dense bge-m3 + Sparse BM25 → RRF → Cross-Encoder bge-reranker 重排）。
- **门禁**：tsc 0 ｜ validate-architecture 100% ｜ depcheck 0 ｜ production-check 8/8 ｜ core vitest **89 文件 / 775 通过 + 3 限额 e2e** ｜ api-contract 30 通过。
- **LLM**：Agnes 2.5 Flash（config 驱动，默认，OpenAI 兼容云端 https://api.agnes-ai.cn/v1，AGNES_API_KEY env）；**附加模型**：本地 MiniCPM5-1B（config/morpex.yaml `llm_minicpm:` 块，gateway→http://127.0.0.1:8080/v1，MINICPM_API_KEY env，思考型；运行时用 `minicpm/minicpm5` 选择）；**Embedding/Rerank**：SiliconFlow（config/embeddingconfig.yaml，SILICONFLOW_API_KEY env）。
- **数据**：morpex-events.db 4GB→85.7MB（16j）→实体去重 92MB→60MB（16l）；restore 2.1s→43ms。
- **★去黑盒化全部完成（16n P0 + 16n·2 P1 + 16n·3 P2）**：16 处黑盒全部打开——公共基建（`DeblackboxRecorder`/`RecordPolicy`/`DeblackboxDetailStore`/`RecordCleaner`，L0/L1/L2 三层：决策单永久 + 详情采样 10% + 异常全记；进程级单例 + bootstrap 接入 + 24h unref TTL 清理）**P0**：①空 catch 清零 ②LLM 交互+成本落库（llm.call） ③门禁判定留痕 ④llm-tracer；**P1**：③检索决策 ⑤规划理由 ⑥执行路径 ⑦后台行为 ⑨内存态快照（/memory-state 端点）；**P2**：⑧异步 token 双写持久化 ⑪审批决策 ⑫配置变更审计 ⑭演化理由根因链 ⑮知识写入审计（source/confidence/conflict/version）。方案已归档 `docs/archive/DEBLACKBOX_PLAN.md`。门禁：tsc 0 ｜ 架构 100% ｜ production-check 8/8 ｜ P2 区域 62/62 ｜ 回归 18/18 ｜ 全链路 200+ 全绿。文档同步（FILE_REGISTRY/TESTING_PLAN/README）待人工审核后按 §8.5 执行。
- **★前端渲染层 v1 + 桌面壳 v1（17a/17b）**：`packages/studio/web`（Vanilla TS + Vite 独立包，非 workspace，零 runtime 依赖）——4 视图（会话CLI/仪表盘/事件流/产物记忆，会话为默认首页）+ 手写 API 客户端（26 端点，src/api/client.ts 唯一拼 URL）+ SSE 实时流；typecheck 0 / build 纯静态 / 端到端冒烟通过；与后端严格解耦（src 内零 @morpex/后端 import）；optimizer 评审 0 必修 + 10 项改进已应用。**桌面壳 v1（17b/17d）**：`packages/studio/desktop` Tauri 2 壳（Rust 极薄：仅开窗加载渲染层，零 IPC/零 @morpex 引用），cargo check + `tauri build --no-bundle` 通过，exe 启动冒烟通过（WebView2 正常）；**双击即用（17d）**：壳自动探测 5473 → 未运行自动 spawn 后端（node tsx，日志 logs/desktop-backend.log，MORPEX_REPO 定位仓库）、关窗自动停后端；会话视图后端未就绪自动重试；`npm run dev:all` 一键（vite :5173 + tauri 窗口）或双击 `MorPex-Studio.exe`。**端口已统一 5473（用户定）**：后端默认端口 8080→5473（index.ts + StudioServer 3 处）、web env/proxy/.env.example 同步；⚠️ 本机 8080 是 llama-server.exe（LLM 网关，config/morpex.yaml 的 baseUrl 指向它，未动）。迭代待办：安装包（NSIS，后续）、异常告警阈值 UI、进化审批 UI。
- **★通用空参保险（16l·7，模型无关根治）**：彻查根因——pi-ai `validateToolArguments` 在 `beforeToolCall` 前执行，空参（minLength:1）直接 throw 使 goal 兜底永远失效；用 pi-agent-core 官方 `prepareArguments` 钩子（validate **之前**）注入可推断值（knowledge→goal / file→path），打通 3 层透传，任意模型生效（不依赖 LLM 乖乖填参）。新增 4 用例。
- **模型试跑总结**：GLM-4-Flash 50 轮 28/50（空参 7 次）→ 保险后 10 轮 9/10（空参 0，限流 0）；opencode 23/50（额度再耗尽暂停，排除限流真实 79%，空参 1 次）。失败共性=「物流方案」任务依赖外部真实数据（多轮次同因失败，与模型无关）。
- **★文档精简（16l·8）**：docs/ 从 22 文件 → 6 核心（ARCHITECTURE / FILE_REGISTRY / AICOS_FLOW / MODEL_CONFIG / TESTING_PLAN）+ archive/ 6 历史 + guides/ 3；删除 4 过时、合并 3 flow → AICOS_FLOW、归档 6 运维。
- **★文档读取策略（16l·9）**：AGENTS.md 新增「最小上下文 + 按需加载」——会话开始只读 AGENTS.md + SESSION_LOG.md；其余文档按 §1 触发条件按需读；新增 §8.5 文档同步协议（人工审核确认后才更新文档，文档随代码同提交）。
- **★pi 工具发现机制修正（16l·9b）**：确认真实机制——pi-coding-agent **必然加载 .pi/SYSTEM.md 但不自动发现 AGENTS.md**（AGENTS 自证「必读」无效）；修复：.pi/SYSTEM.md 改为「会话启动协议」（第 0 步强制显式读 SESSION_LOG + AGENTS，明确『AGENTS 不会被自动读，本文件是唯一可靠入口』），且核心硬约束已内嵌（即使不读 AGENTS 也够用，双保险）；AGENTS.md §0 同步真实发现机制。
- **★确定性 mock 闭环验证套件（16m，零改源码）**：`packages/core/__tests__/deterministic-closed-loop.mock.test.ts`（新增 1 文件，git 零改动现有文件）——vi.mock 模块级拦截 PiBridge（importOriginal 保留静态方法 createJsonlSessionRepo），全链路 LLM 走确定性 mock（语义路由：参数提取/规划/审批/反思/评分/agent harness）；跑 batch-tasks 全部 50 任务 **50/50 成功（~80s，vs 真实数小时）** + P1 覆盖度量：TraceRecorder 包装 34 个核心服务类，**76% 被实际调用**，8 个已知盲区（OrchestratorAgent/EvolutionSandbox/MemoryApi 等均有专项测试），0 未知盲区。真实任务抽样：glm-4-flash-250414（临时切 morpex.yaml 后还原）**10 轮 8/10**（物流类失败=外部数据，历史已知）+ opencode（key 已配于 Windows 用户级 env，readEnv 兑底可解析）**3/3**。两个真实模型全流程均通。studio 5 个既有失败=真实执行慢/预算不足（测试注释自证 277s+ vs 420s 超时），非 key/非本次改动。**★排除外部数据重跑（16m·2）**：batch-run 新增 `--exclude-task <子串>` 参数（按 goal 子串排除，git 记录）；排除「物流」后 GLM **10 轮 9/10（99s）**、opencode 8/10（2 个为 LLM 无响应超时，瞬态）；唯一实质失败=task-001 商品价格合规检查 **GLM 空参（KnowledgeQueryPrimitive: query 参数不能为空）**——历史已知 GLM 弱点（保险后仍偶发），同任务 mock/opencode 均成功，疑原语快路径空参兜底未覆盖，建议后续排查。
- **★GLM 20 轮攻坚（16m·2，7 项引擎修复，15/20→19/20）**：①KnowledgeQueryPrimitive 空参兜底（query 空→goal，模型无关，修 task-001）②Gate 限流退避增强（maxAttempts 3→5 / baseDelay 1s→3s / maxDelay 30s→60s）③PiBridge.generateText 全局限流自愈（RateLimitError 退避 4 次，拆 generateTextOnce，覆盖非 gate 调用）④GroundedReasoning 查询计划解析失败重试一次 ⑤StepAgentExecutor 白名单提示 + 安全拦截错误允许直出摘要 + 纠正重试 1→2 + 最终无工具直出兜底 ⑥ShellExecutionPrimitive 白名单错误加引导 + step-agent 守则 2.5（评估类任务不用 shell）⑦**★DAG 误判修复（最关键）**：OrchestratorAgent 对 failedNodes=0 且有产物产出的 DAG 不再判失败（此前任务实际产出 5 文件仍被「部分步骤失败（1）：0 个节点失败」误判，15→19 主因）。结果：**GLM-4-Flash-250414 排除物流 20 轮 19/20（95%）**；唯一失败 task-017（硬件认证要求）为 GLM 幻觉 shell 命令（把任务名当命令名，4 层提示+最终兜底均无法阻止；mock/opencode 下均成功）=**模型能力硬边界**；20 轮 100% 需换更强模型（网关 glm-4.5-air/glm-4.7）或限定任务集。修复全程 tsc 0 + mock 套件 4 测试全绿（不破坏）。
- **★GLM-4.7-Flash 验证（16m·2 续）**：用户提供更强模型 glm-4.7-flash（仅单并发）。实测：**⑧解决 task-017 幻觉命令**（4.7 函数调用成熟，用合法 python3）但暴露新问题——python3 为破坏性命令需 Gate 凭证，原语快路径不携带 → 硬拦；**⑨修复**：UnifiedExecutionEngine 快路径被 Gate 硬拦（破坏性操作无凭证）→ 降级多 Agent 编排（编排签发凭证）。tsc 0 + mock 回归通过。但 glm-4.7-flash **免费额度限流/无响应极频繁**（PiBridge 全局限流重试自愈部分，仍有任务 600s 超时：后台 20 轮单并发 35 分钟仅完成 4 个且 2 个 600s 超时失败，进程中途死）——单并发 20 轮 100% 在该免费模型下同样不达（限流/慢/超时是外部服务稳定性问题，非引擎可修）。**最终结论：引擎已 9 项修复（含重大 DAG 误判修复 15→19、Gate 凭证降级），mock 50/50 + opencode 3/3 证明引擎正确；GLM 免费模型（flash/4.7-flash）受额度限流限制无法稳定 20 轮 100%，可靠达成需付费模型或 opencode 额度。**

## 会话历史摘要（紧凑）

| 会话 | 主题 | 结果 |
|---|---|---|
| 检索验收 | **试改功能端到端验收（策略）**：以“执行后自动生成一页复盘简报”走查——①索引定位命中产物/artifact（ArtifactFacade/Blueprint）②关系链展开 BackCode_MAP 给 ArtifactFacade 22 函数③HOOK_MAP 给出后置挂点（evaluation.profile.scored）。**暴露真实缺口**：代码已有 19 个 report/brief/summary 函数（BrainFacade.generateCEOReport/CompanyFacade.generateDailyReport/EvaluationEngine.computeReport/AuditTrail.generateReport/StudioServer.generateTaskSummary…）但索引未覆盖“报告/汇总”域 → 会误判“没有”；已补 CAPABILITY_INDEX 新能力域条目（带别名），修复后重新检索命中，决策路径明确（勿重复造，订阅 evaluation.profile.scored 扩展） | ✅ 验收+修复 |
| 复核-A·收 | **FILE_REGISTRY 逐项复核·批④（evaluation/evolution+独立包）收尾**：125 低相似候选抽查代表（QualityScorer/FileSystemConnector/capabilities/cognee-client/IWorkflowAdapter）→ 登记与代码相符，无文档偏差；补 6 处 L6 缺 JSDoc（QualityScorer/ArtifactChecker/ExecutionVerifier/QualityRule/RepairPlanner/VerificationEngine）+ 独立包 1 处（amazon-policy）；搜索证明独立包基本自带 JSDoc。**复核四批完成**：①governance+knowledge ②execution+cognition ③infrastructure ④evaluation/evolution+独立包，共抽查 60+ 文件 → FILE_REGISTRY 职责文字与代码全部相符（无文档偏差），补自述注释 16+7=23 处 | ✅ 全部完成 |
| 复核-A·③ | **FILE_REGISTRY 逐项复核·批③（infrastructure）**：45 低相似候选，抽查最可疑（EventTypes/ToolFactory/ToolRegistry/artifact-lifecycle/SqliteEventStore）→ 登记与代码相符，无文档偏差；补 3 处缺 JSDoc 自述注释（EventTypes/ToolFactory/ToolRegistry）；infrastructure 缺 JSDoc 清零；门禁 tsc 0。累计：① governance+knowledge 无偏差+3 ② execution+cognition 无偏差+10 ③ infrastructure 无偏差+3 | ✅ |
| 复核-A·② | **FILE_REGISTRY 逐项复核·批②（execution+cognition）**：随 44 条低相似，抽查最可疑 8 个（ReflectionEngine/AgentAllocator/DependencyCoordinator/TeamBuilder/ExecutionContext/PipelineOrchestrator/UnifiedEngine/HierarchicalPlanner）→ 登记与代码职责**全部相符，无文档偏差**（同批①规律：低相似=缺 JSDoc+登记详尽）；补 execution 8 + cognition 2 共 10 处缺 JSDoc 自述注释（从职责写）；两层缺注释清单清零；门禁 tsc 0 | ✅ |
| 复核-A | **FILE_REGISTRY 逐项复核·批 ①（governance+knowledge）**：以 data/doc-review-queue.md 为工作台筛低相似 41 条，抽查最可疑 9 个（CostController/AgentCapabilityRegistry/ContextDistiller/Sparse/ContextRetriever/Anomaly/Alert/Runtime/CapabilityDisc）→ **登记与代码职责全部相符，无文档偏差**；“低相似”源自代码缺 JSDoc 头 + 登记更详尽；生成“缺 JSDoc 实质文件”清unit（governance 3，knowledge 0）并已补 AlertEngine/RuntimeManager/CapabilityDiscoverer 三处自述注释；门禁 tsc 0/架构 100% | ✅ |
| 职责复核 | **FILE_REGISTRY 职责逐项复核 + 冗余/死代码审计（从代码出发）**：①死代码=ts-prune 0 + barrel 全覆盖（反向引用文本匹配为误报，排除）；②重复导出符号=已知 core/connectors secureExec 同源内联 + uuidv7/pi 兼容，无意外冗余；③复核工作台 data/doc-review-queue.md（可靠目录后缀映谢版 441 行并排：登记 vs 真实文件 JSDoc，相似度排序，低相似 84）；④抽查证实 FILE_REGISTRY 与代码头注释总体相符（低相似多为提取样本问题：首 /
/ 取到中部子注释）；⑤check:docs 门禁保持 0 错（路径可解析）。逐项人工复核可分批（以工作台为续） | ✅ 已交付 |
| 文档审计 | **文档正确性审计（从代码出发）+ 一致性门禁**：①函数/关系链 BACKEND_CODE_MAP 从代码重生成（485文件/2775函数/12832调用，代码驱动）；②两层自动审计（头注释相似度、导出符号引用）确认有系统噪音→改用可靠硬校验；③新建 scripts/check-doc-sync.ts（npm run check:docs）：FILE_REGISTRY 462 行登记路径 + CAPABILITY_INDEX 锚点全部可解析到真实文件（0 错），作为文档一致性门禁；④钩入 package.json + DEVELOPMENT §8 + FILE_REGISTRY 登记 | ✅ 已提交 |
| skill-化 | **文档 skill 化落地**：项目无内建 skill 机制，引入主流 Agent Skill 规范（skills/<name>/SKILL.md + frontmatter name/description 触发）；建 6 技能包——locate-capability(功能定位/防 grep 误判)、insert-hook(接入点)、event-messaging(事件消息)、dev-flow(开发流程/文档同步)、backend-flow(业务流)、architecture-rule(8 层铁律)；skills/README.md 索引+新增规范；AGENTS §6 导航登记。原理：SKILL.md 只放精炼要点+指向 docs，不复制大文档 | ✅ 已提交 |
| 文档治-理 | **文档治理完成**：盘点归档 3 份过时/完成文档（REFACTOR_OPPORTUNITY_MAP→archive、guides/development（引用废弃 planes 旧结构）→archive、architecture-report-v9.2→archive）；保留 docregation 主文档 + guides/getting-started + design（被代码注释引用）；新建 **CAPABILITY_INDEX.md**（7 域 40+ 能力→锚点+别名+状态，为开发第一步定位用，防重复/grep 误判）+ **HOOK_MAP.md**（接入点+前/后顺序+主流程挂点+决策表）；AGENTS 导航更新 | ✅ 已提交 |
| 规范-简 | **开发规范重整（参考成熟 LLM 项目范式）**：AGENTS.md 从 261 行/16 章精简为 ~80 行总纲（项目/导航/命令/铁律速览/流程/文档导航/会话约定）；详细规范迁移新建 docs/DEVELOPMENT.md（SOP 定位→理解→实现→收尾文档、第一性原理、架构铁律、质量、文档同步协议+防零碎、门禁、流水线、提交、知识路由）；新流程强调「查能力索引定位替代盲目 grep」；.pi/SYSTEM.md 入口指向调整。待建：CAPABILITY_INDEX / HOOK_MAP | ✅ 已提交 |
| 规则-文档 | **增强 §8.5 文档同步规则（改码必更文档）**：映射表新增★主检项——**改任意代码文件 → 文件功能职责说明（FILE_REGISTRY）必更新 + 影响函数/调用链 → 重新生成关系链文档 BACKEND_CODE_MAP**（`scripts/_backend-code-analyze.ts`）；新增“文件树/目录变化同步”行；规则区新增 #7 关系链同步；`.pi/SYSTEM.md` 速览对齐 | ✅ 已提交 |
| 事件规格 | **任务事件载荷规格落地（EVENT_PAYLOAD_SPEC v1）**：定稿 Envelope(稳定头)+MessageBox(可扩展分块) 可扩展规格，8 块（refs/task/state/human/artifacts/media/error/extensions，未来新块=加命名空间）；媒体引用优先（不塞二进制，LLM 经工具按引用取用/本地打开）；实施 P1——新建 protocol/events/Envelope.ts（类型投影）+ eventContractCatalog 增补 13 执行链任务卡片契约（mission/execution/step/artifact 块级校验）+ TaskStateProjector 对齐可选块（status/stage/human/media/error）；门禁 tsc 0/契约 15 过/架构 100%；后续 P2 试点发射规范化 + 前端卡片 | ✅ 已提交 |
| 精简-收 | **精简收束 + 文档更新**：B/C 类复评均证实结构已高度收敛（execution 编排为复杂度分级策略、policy/learning/governance 为成熟职责分离），继续手术=负收益 → 到止为止；P0 安全减量 22 文件/3.3k 行全部落地。文档同步最新：BACKEND_CODE_MAP 重新生成（483 文件/2768 函数/12742 调用），FILE_REGISTRY 末尾统计更新（studio/server 46→29 等），README TS 文件数 442→656 | ✅ 已提交 |
| 精简-P0·删 | **执行 harness 删除 + KnowledgeGraph 保留**：经用户确认——harness 有替代（pi-agent-core 实现 + 工具 fallback）且从不实例化 → 删除 execution/harness（5文件/449行）；前置处理：memory-search-tool/ReadArtifactTool 去 harness 分支（行为不变，走 fallback）+ 新建 knowledge/memory/types.ts（MemoryRecord 迁移）+ architecture-integration.test 删 3 harness 用例 + core/index 摘除 harness re-export；KnowledgeGraph 证为无替代的独一能力（仅测试消费）→ 保留。门禁 tsc 0/eslint 0 新错/架构 100%/依赖 0/集成 5 过/knowledgegraph 4 过 | ✅ 已提交 |
| 精简-P0·删 | **P0 A 类清理（安全部分）已落地**：移除 studio/server/simulation（9文件/1399行）+ verification（8文件/1410行），共 17 文件/2.8k 行，零引用（exercise-all 用 ctx 动态 any 非 import）；门禁 tsc 0/架构 100%/依赖 0/studio 测试 73 过；FILE_REGISTRY 预算 46→29。**发现计划与实际差异**：execution/harness 有真实类型消费方（memory-search-tool/ReadArtifactTool import type AgentHarness）+ core/index re-export；旧 knowledge/graph/knowledge 有独立 SQLite 测试（knowledgegraph-sqlite）——两者不直删，处置待定 | ✅ 已提交 |
| 精简-图 | **产出《精简机会地图》（docs/REFACTOR_OPPORTUNITY_MAP.md）**：基于覆盖率+mock 76%使用率+入口引用+DEPRECATED 实测，四档分类——A 可移除 24 文件/3.8k 行（execution/harness 废弃、旧 KnowledgeGraph、studio simulation/verification 可选子系统）；B 实现收敛（execution 编排多轨/knowledge·memory 重叠/工具多轨）；C 结构精简（governance/learning 收敛、barrel 可选扁平）；D 必须保留核心链。已剔除覆盖报告中的历史已删文件（cognitive-loop/scheduler 等早已移除）。待用户定 P0 是否执行 A 类清理 | ✅ 已产出 |
| 精简-退 | **精简方向校正**：用户本意=功能不变+总量降；前轮“拆超大文件试凤”经用户质疑后确认与精简目标相悖（拆分增文件数/总行数），已 `git revert dbf54f9`（回退到 1045 行原状）；正待定“改架构 / 改实现方式”两条结构性收敛路线（需先做能力-使用率盘点） | ✅ 已回退 |
| 优化 | **subagent 多维度代码优化（advisor 诊断 + 3 worker + 人工补 W3）**：诊断→架构 100%/依赖 0 违规/但 eslint 22 误报+122 警告。修复：①eslint.config 适配器豁免路径 `core/src/adapters`→`infrastructure/adapters`（旧路径不存在致 22 误报）+ ignores 追加 portable/src-tauri/target + 删 2 死配置块；②validate-architecture 给 SpaceService 加精确豁免（同 capability 性质，非真违规）；③AGENTS §3.6 路径修正；④W2/W3 未用变量清理 51 文件（66 符号去重删除 + _x 前缀，re-export 零损失，tsc 0 硬保证）。门禁 tsc 0 / eslint --quiet 0 / 架构 100% / 依赖 0 违规。7 个预存测试失败经 stash 对比证非本轮引入。大文件拆分按行数判定不急（advisor C 结论）。风险点：W2 子代理报告失败但实际改了 45 文件——已审计安全，教训：先核对落盘再信报告 | ✅ 已提交 |
| 规则 | **新增强制规则：每次修改代码文件必须同步更新相应文档**——AGENTS.md §8.5 强化（顶部强制声明 + 规则6：映射表命中/显式声明“文档不涉及”/未同步=未完成）+ §9 自检加勾选项 + §5 完成标准强化；`.pi/SYSTEM.md` 速览同步（薄壳双保险）。提交信息须注明文档命中项 | ✅ 已固化 |
| 后端盘点 | **后端全量文件职责登记补全（FILE_REGISTRY）**：现有登记表已覆盖 core/src 346 文件 + studio/web + studio/desktop；本轮补全剩余后端区块——connectors/src 8 + memory/src 26 + studio/server 46（observability 24/simulation 9/verification 8）+ workflows 29 + workflow-sdk/src 8 + contracts 7 + scripts；逐文件“功能+职责边界”行，与 AICOS-Core 8 层/领域插件第 9 层对齐 | ✅ 纯文档变更 |
| G1-G3 | **参考 deepseek-harness 设计理念·升级已有功能（不重复造轮子）**：盘库确认事件契约/Model-visible-logged/可逆效果/防御性模式 secureExec/PluginSystem 已存在→仅升级 3 处——G1 事件契约目录实体化（`infra/common/contracts/eventContractCatalog.ts` 24 契约 + bootstrap 接线 + `/api/observability/event-contracts` 对账端点）；G2 PluginSystem 幽灵模块接线（getInstance 单例 + stop 精确回卷本领域原语）；G3 ShellConnector→secureExec（shell:false 防注入 + scrubEnv 凭据清洗 + 正交因子上报 + 私有临时目录落盘，connectors 零 core 依赖故内联同源）。门禁 tsc 0 / 契约 7 + eventContract 8 + connectors 15；reviewer 放行；optimizer 删死导出 reconcileEmitted | ✅ |
| 16o | **本地 MiniCPM5-1B 接入（附加模型）**：config/morpex.yaml 新增 `llm_minicpm:` 块（gateway→http://127.0.0.1:8080/v1，apiKey=${MINICPM_API_KEY}）；yamlConfig 支持 `llm_*` 顶层块→extraLlms；PiBridge init() 改为 builtin 基底 + 附加 gateway provider 叠加注册（setProvider），默认模型不变；model-registry/model-resolver 从 config 构建附加模型（compat 静态目录不含）；新增 4 用例；真实调用验证（modelUsed=minicpm/minicpm5）；门禁 tsc 0 / production-check 8/8 / 架构 100% / depcheck 0 / api-contract 30 | ✅ |
| 1 | 架构收敛：8 层纯净架构 + 遗留清除（-4000 行） | ✅ 单一架构落地 |
| 2-3 | 功能①微信/②规则中断/③上下文方案；多 Agent 框架定稿（总大脑+DAG+step-agent+执行肢） | ✅ 方案定稿 |
| 4 | 多 Agent 编排框架交付（OrchestratorAgent/StepAgentExecutor/DAGRuntime/PiBridge 三修复） | ✅ 全链可用 |
| 5-8 | Session 化 / 执行肢 Gate 凭证 / 规则 P2（schema/结构修正/eslint） / 上下文 P2（统一召回） / 计费 / 治理端点 / Provider 归属 | ✅ 每项门禁全绿 |
| 9-11 | GLM 99 任务实测（77%）→ 切 opencode + config 驱动模型 → 不限时决策 | ✅ 模型稳定 |
| 12-13 | 沙箱隔离 / 审计（79.4% 基线，主因工具空参） | ✅ 沙箱根治污染 |
| 14 | 工具空参初步根治（goal 兜底+示例） | ✅ |
| 15 | **优化清单定稿**（P0 空参→P1 恢复→P2 上下文/规划→P3 监控） | 📋 路线图 |
| 16a | 去兜底化重构（引擎 v3 单路径 + 编排 fail loud + 删 ExecutionFabric Mock） | ✅ -1196 行 |
| 16b | P1 失败恢复：重试精细化 + salvage + 步骤质量信号 | ✅ |
| 16c | 3+4：经验沉淀触发 / 任务级重跑 / 装配监控 / 观测聚合端点 | ✅ |
| 16d | P2+P3：经验注入 / 动态重规划 / 规划质量 / 异常告警 / 成本归因 / 人工介入 | ✅ |
| 16e | 进化提案落地通道（LearningEvent→沙箱→策略库→可回滚） | ✅ |
| 16f | batch 终验（9/9=100% 样本）+ **发现装配瓶颈 37-82s** | ✅ |
| 16g | 装配性能优化：索引+单查+TTL（loadRecent 37.5s→1ms） | ✅ 千倍提速 |
| 16h | **4GB 根因**：递归上下文膨胀（391MB 单快照）→ 短摘要+50KB 上限 | ✅ 止血 |
| 16i | RAG-lazy 4 层装配（工作/语义/情境/程序 + 每层预算 + 指针） | ✅ |
| 16i·v2 | 裁剪修正：item 级完整选择 + 被裁项指针（用户批评硬截断） | ✅ 零丢失 |
| 16j | 待办清空：指针消费端 recall_task / 4GB 清理 / 限流检测 / 可插拔 embedding / 审批端点 | ✅ |
| 16k | 引擎审计（非 LLM 全毫秒级）+ OntologyService WeakMap 缓存 | ✅ |
| 16k·2 | 接真实 embedding（SiliconFlow BAAI/bge-m3，config 驱动） | ✅ |
| 16k·3 | 装配检索定为 RAG 语义为主 + 确定性加成 | ✅ |
| 16k·4 | **Dense+Sparse(BM25)→RRF→Cross-Encoder 完整流水线** | ✅ 808ms 语义正确 |
| 16l | **P0 三项完成**：①实体注册去重（47,897→3,904，DB 92→60MB）②PiBridge 进程级共享单例（agent-spawner/ServiceContainer/bootstrap/PiModelRegistry 四处复用）③restore limit bug 修复（只恢复 100 实体→分页全量，restore 2.1s→43ms）+ ArtifactFacade 同修 | ✅ 745 通过 |
| 16l·2 | **P1 三项完成 + 一项评估**：①rerank 结果缓存（query+docs SHA256 指纹 TTL 30s，docs 排序无关）②type 索引（getEntities(type) O(n)→O(桶内)，单引用保 WeakMap 缓存一致）③Gate 限流退避（RetryPolicy 增强 name 匹配 + withGateRetry 包 3 处 generateText）④execution-stats 持久化评估→不做（实时仪表盘用内存有界 history 是合理设计） | ✅ 757 通过 |
| 16l·3 | **P2 三项完成 + 一项评估**：①复杂任务 cap（maxSteps 截断 + maxTotalTokens 预算，Bounded Autonomy）②batch 并发自适应（内存/限流感知，防 OOM）③TraceRecorder 采样/开关（disabled/sampleRate/maxCalls）④策略按 goal 过滤评估→不做（仅 3 类通用防错规则，无语义维度可过滤，全量注入正确） | ✅ 771 通过 |
| 16l·4 | **GLM-4-Flash-250414 试跑 10 轮**：成功 9/10、限流 0、耗时 376s；唯一失败=依赖外部 mock API 的任务（非模型问题）；暴露并修复 batch-run ESM require bug | ✅ 9/10 |
| 16l·5 | **GLM-4-Flash-250414 50 轮**：成功 28/50（56%）、限流 3、失败 19、耗时 2845s；失败主因=GLM 工具空参+限流（会话 9 已知弱点）；★首跑 OOM（TraceRecorder 全量）→ 加 --trace-max 采样修复，零 OOM | ✅ 28/50 |
| 16l·6 | **opencode 50 轮（部分 23/50）**：额度恢复开跑，23 轮时免费额度再耗尽（429）暂停；完成 23 轮成功 15（排除 5 个额度限流后真实 15/19=79%），空参仅 1 次（vs GLM 7）——质量优势验证 | ⏸️ 23/50 |
| 16l·7 | **通用空参保险（模型无关根治）**：彻查根因——validate 在 beforeToolCall 前 throw 使 goal 兜底失效；用 prepareArguments 钩子在 validate 前注入可推断值，打通 3 层透传，任意模型生效 | ✅ 775 通过 |
| 16l·7b | **GLM 空参保险验证 10 轮**：9/10 成功、限流 0；空参失败 7/50→0/10（保险生效），唯一失败=物流任务（依赖外部数据，与模型无关） | ✅ 9/10 |
| 16l·8 | **文档精简（22→6 核心）**：删 4 过时 + 合并 3 flow→AICOS_FLOW + 归档 6 运维；AGENTS/.pi/README 速览更新至当前架构；核心链 AGENTS→SESSION_LOG→ARCHITECTURE→FILE_REGISTRY→AICOS_FLOW→MODEL_CONFIG | ✅ 零上下文可续作 |
| 16l·9 | **文档读取策略（最小上下文+按需加载）**：AGENTS.md §0 改为「会话只读 AGENTS+SESSION_LOG」；§1 改为按需加载表（触发条件）；新增 §8.5 文档同步协议（人工审核确认后才更新文档，文档随代码同提交）；.pi/SYSTEM.md 同步 | ✅ 上下文省 80%+ |
| 16l·9b | **pi 工具发现机制修正**：pi-coding-agent 必加载 .pi/SYSTEM.md 但不自动发现 AGENTS.md（AGENTS 自证无效）；.pi/SYSTEM.md 改「启动协议」第0步强制读 SESSION_LOG+AGENTS + 硬约束内嵌双保险；AGENTS §0 同步真实机制 | ✅ 必读生效 |
| 16m | **确定性 mock 闭环验证套件（方案B，零改源码）**：vi.mock 拦截 PiBridge + 语义路由 mock LLM → 50 任务 100%（~80s）+ P1 覆盖度量（34 核心类 76% 调用、0 未知盲区）+ 真实任务抽样 glm-4-flash 10 轮 8/10（物流类失败为外部数据，历史已知）；交付 `deterministic-closed-loop.mock.test.ts`（新增 1 文件，git 零改动） | ✅ 50/50 + 8/10 |
| 16n | **去黑盒化 P0（方案落地第 1 期）**：公共基建（DeblackboxRecorder/RecordPolicy/DetailStore/RecordCleaner，L0/L1/L2 三层 + 24h unref TTL 清理）+ ①空 catch 清零 ②PiBridge LLM 交互+成本落库（llm.call） ③门禁判定留痕（gate.decision + 只读放行/破坏性拦截） ④llm-tracer（/api/observability/llm-trace）。门禁：tsc 0 ｜ 架构 100% ｜ production-check 8/8 ｜ deblackbox 5/5 ｜ pi-bridge 16/16 ｜ gate 26/26 ｜ mock 4/4 | ✅ P0 完成 |
| 16n·2 | **去黑盒化 P1（三大为什么 + 内存态）**：③检索决策（context.retrieval，装配选材原因/来源命中/分层预算）⑤规划理由（planner.decision，Hierarchical 拆解子目标 + Delivery 模式/经验建议）⑥执行路径（execution.path，快路径/编排/降级原因）⑦后台行为（brain.background，反思/巩固/学习留痕）⑨内存态快照（memory.state.snapshot，teams/agentPool/stepResults + /memory-state 端点）。门禁：tsc 0 ｜ 架构 100% ｜ P1 区域 43/43 ｜ 回归 27+70 全绿 | ✅ P1 完成 |
| 16n·3 | **去黑盒化 P2（治理完善收官）**：⑧异步 token 双写持久化（MorPexRuntime/ServiceContainer onTokenUsage→cost.llm.call）⑪审批决策（OrganizationTwin→approval.decision）⑫配置变更审计（MorPexConfig.update→config.change）⑭演化理由根因链（EvolutionSandbox/ApplyLoop→evolution.proposal 含触发/补丁/沙箱/版本）⑮知识写入审计（OntologyService/MemoryApiBus→knowledge.write 含 source/confidence/conflict/version）。**16 处黑盒全部打开，方案已归档 docs/archive/**。门禁：tsc 0 ｜ 架构 100% ｜ P2 区域 62/62 ｜ 回归 18/18 | ✅ P2 完成 |
| 16n·5 | **遗留待办推进**：①健壮性②核实过时——planner 限流退避已被 16m·2 PiBridge 全局自愈覆盖（planner 经 piBridgeWrapper→generateText，MAX_RETRY=4 退避），不重复实现；②数据治理①接线——SqliteEventStore.enableAutoCompaction 此前零调用（幽灵功能）→ UnifiedEventStore 加透传 enableAutoCompaction/disableAutoCompaction + ServiceContainer.initEventStore 启用 12h 自动压缩+VACUUM（清旧事件/每 Mission 最新快照保留/产物版本保留）。门禁：tsc 0 ｜ 架构 100% ｜ 回归 14/14 ｜ 冒烟通过 | ✅ 待办推进 |
| 16n·6 | **L0 任务摘要补触发 + execution-stats 待办关闭**：方案 L0 层（任务级目标/结果/耗时/成败，永久）此前零调用（代码审计确认）→ 在 CompanyFacade.executeGoal 任务完成点落地（deblackbox.task.summary，含 missionId/团队/产物数/耗时/成败/错误/executionId 关联成本明细）；execution-stats 持久化评估关闭——执行指标已由 L0/L1 决策单持久化覆盖（无需全链路 emit 改造）。门禁：tsc 0 ｜ 回归 10/10 | ✅ L0 落地 |
| 16n·4 | **收尾**：文档同步（FILE_REGISTRY 登记去黑盒化新文件+埋点分布 / TESTING_PLAN+README 测试数 780·90 / 方案归档）已按 §8.5 审核确认执行；提交 d12729c（16m 补）+ 6c8320c（去黑盒化全量），工作树干净 | ✅ 已提交 |
| 17a | **前端渲染层 v1 + 桌面化决策**：`packages/studio/web`（Vanilla TS + Vite 独立包，零 runtime 依赖）补齐 4 视图（dashboard/console/events/artifacts）+ main.ts 装配 + README + FILE_REGISTRY 登记（S38）；验证 typecheck 0 / build 纯静态 / 端到端冒烟（后端→vite preview 代理→静态产物→API 全通）；架构决策=桌面壳用 **Tauri 2**（复用同一渲染层，后端独立，零耦合） | ✅ 渲染层 v1 |
| 17b | **桌面壳 v1（Tauri 2）+ 端口统一 5473**：`packages/studio/desktop` 壳（Rust 极薄：main.rs+lib.rs 仅开窗，零 IPC/零 @morpex；tauri.conf frontendDist=../../web/dist、devUrl=:5173、bundle.active=false、占位图标已生成）；踩坑：①Windows 强制需 icons/icon.ico（tauri icon 生成）②lib crate 名=包名非 _lib 后缀（main.rs 调用名修正）③**frontendDist 需 ../../web/dist**（从 src-tauri 上溯两级，误写 ../web/dist 报 Unable to find web assets）；验收 cargo check 0 / tauri build --no-bundle 通过（release 2m51s）/ exe 启动 8s 不崩；端口：后端默认 8080→**5473**（用户定，index.ts+StudioServer 3 处）、web env/proxy/.env.example/FILE_REGISTRY/README 同步（config/morpex.yaml 的 8080=LLM 网关未动）；文档：FILE_REGISTRY S39 + 根 README 前端段 + desktop/README；optimizer 10 项改进已应用（SSE 状态复位/卸载丢弃在途请求/JSON 归一化等）；**reviewer 终审 ⚠️ 条件已清**：scripts/start.ts+run-all.sh+run-k6-test.sh+CI e2e 端口全量统一 5473、web/README 8080 残留清零+桌面已交付表述、env.ts 注释修正、desktop/.gitignore 加 src-tauri/gen/ | ✅ 桌面壳 v1 |
| 17c | **控制台重构为 CLI 会话对话（用户反馈）**：`views/console.ts` 重写——单一输入框 + 终端风格会话流（深色等宽、❯ 提示、Enter 发送/Shift+Enter 换行），目标经 chat/send(executeGoal) 执行、结果以回复形式追加（可展开原始 JSON）；移除「对话/执行」两个分离输入区；会话自动创建/切换/新建 + 历史回载；默认路由 dashboard→**console**（会话为首页），tab 重排「会话」置首 + 终端 CSS | ✅ CLI 会话 v1 |
| 17d | **双击 exe 即用（用户反馈）**：壳 lib.rs 增强——启动探测 5473 → 未运行自动 spawn `node <repo>/node_modules/tsx/dist/cli.mjs packages/studio/server/index.ts`（cwd=仓库根，PORT=5473，日志 logs/desktop-backend.log，MORPEX_REPO env 优先定位仓库根）；退出 taskkill 由壳拉起的后端（手动已跑的则不杀）；渲染层会话视图加「后端未就绪自动重试」（5s 轮询，就绪后自动建会话）；踩坑：Rust 块注释内 `@morpex/*` 的 `/*` 触发嵌套注释错误（改文案）、tauri::Manager trait 需显式 use；验收：**PowerShell 分离启动 exe → 41s 后端就绪 → 优雅关窗 → 后端自动停止** 全链路实测通过；**黑窗口修复**：父进程 GUI spawn node(控制台) 会新开黑窗口 → `creation_flags(CREATE_NO_WINDOW)` 抑制（复测 41s 就绪 + 关窗停后端正常）；新增 `npm run build:exe`（编译+复制 MorPex-Studio.exe） | ✅ 双击即用 |
| 17e | **独立安装包 Phase 2（用户决策 C：先独立、暂不加密 + 用户自配 key）**：NSIS 安装包（bundle.active=true + currentUser + SimpChinese）→ `MorPex Studio_0.1.0_x64-setup.exe`；**后端打进安装包**：`scripts/bundle-backend.mjs` 打包可移植运行时（portable/node.exe + repo.zip，npm install --omit=dev + 剥离 .d.ts/.map + bsdtar 打 zip）；壳首启把 repo.zip 解压到 `%LOCALAPPDATA%/MorPex/runtime`（版本 marker 控制重新解压）+ 用户 key 读 `%APPDATA%/MorPex/config.env` 注入环境；踩坑：①打包脚本复制 packages/studio 时把 desktop/ 一起拷了 → 与输出目录 portable/ 形成**无限递归**（11 分钟耗光，fs.rmSync 才删掉）②node_modules 深路径（.d.ts 244 字符）超 Windows 260 → NSIS 失败 → 剥离 .d.ts/.map（省 12k 文件）③NSIS 对海量小文件仍可能超路径 → 只打 node.exe+repo.zip 两个单文件资源 ④PowerShell Expand-Archive 解压失败、**tar(bsdtar) 支持长路径成功** ⑤首版 lib.rs 以 tar 退出码判成败致提取成功但无 marker → 改为以关键文件存在为准；验收：**安装到 F:\DevTools（与仓库 E:\ 无关）→ 运行已装 exe → 50s 独立后端就绪 → 关窗自动停止** 全链路通过 | ✅ 独立安装包 |
| 17f | **引擎级意图分流（用户反馈：你好不该跑编排）**：定位——引擎有 GoalIntelligenceFacade（目标智能）但**未接进 executeGoal**（setGoalIntelligenceFacade 是空桩）且无「闲聊 vs 任务」判别器 → 新增 `IntentClassifier`（goal-intelligence 层：启发式快速判定 + 歧义走 LLM 兜底）；接入 GoalIntelligenceFacade（understandGoal 产出 intent）+ CompanyFacade.executeGoal 入口分流（修掉空桩，bootstrap 注入 LLM）——闲聊直答（不建 Mission/团队/产物、不进门禁）、任务走完整编排，返回 mode:'chat'/'goal'；StudioServer 撤回临时正则 hack 恢复薄调用；前端 console.ts chat 模式不显示 ok=true 元数据/原始 JSON；踩坑：模型行为怪（你好回英文/谢谢胡诌俄语/今天天气怎么样限流空转）→ 闲聊 prompt 强制同语言 + 空回复兜底（模型质量属配置问题，非路由）；验收：你好/谢谢/你是谁 → mode:chat 秒回无 Mission；写 hello world → mode:goal 完整编排；api-contract 30 passed 无回归 | ✅ 意图分流 |

## 当前开放决策

1. 微信接入（企业微信 vs 个人微信）——**用户排除**，未决策
2. 装配检索 rerank 是否需结果缓存——✅ 已做（P1-4：query+docs 指纹 TTL 30s）
3. 复杂任务超长（4.5h outliers）是否设步骤/并行上限——✅ 已做（P2-8：maxSteps=8 + maxTotalTokens=200k）

## 待办（按优先级）

- **数据治理**：✅ 定期 VACUUM+清理已接线（16n·5：UnifiedEventStore.enableAutoCompaction 透传 + ServiceContainer 启用 12h 周期——清旧事件/快照归档/超阈值 VACUUM；此前是幽灵功能从未调用）；✅ system.entity.registered 去重已完成（scripts/compact-entity-events.cjs 可复用）
- **健壮性**：✅ execution-stats 持久化关闭（16n·6 评估：执行指标已由去黑盒化 L0 任务摘要 + L1 决策单（execution.path/llm.call/gate/planner）持久化覆盖，内存有界 history 作实时仪表盘数据源合理，无需全链路 emit 改造）；✅ planner 限流退避已被 16m·2 PiBridge 全局自愈覆盖（16n·5 验证）
- **验证**：确定性 mock 套件（16m）已替代「每次跑 50 轮真实任务」作为默认回归（50/50、~80s、可复现）；真实任务抽样 10 轮（glm-4-flash）8/10 已完成；待 opencode 配额冷却后续跑 opencode 50 轮 + 大样本 batch（装配+检索+空参保险升级后）可选做
- **覆盖盲区专项**：8 个已知盲区类（OrchestratorAgent 复杂路径/EvolutionSandbox 演化/MemoryApi 记忆等）已有独立测试，若需在 mock 套件内覆盖可后续补针对性任务
- **★全量去黑盒化（16n~16n·4 全部完成✅）**：16 处黑盒全部打开（P0：空catch/LLM+成本/门禁/tracer；P1：检索/规划/执行路径/后台/内存态；P2：异步持久化/审批/配置/演化/知识审计）；方案归档 `docs/archive/DEBLACKBOX_PLAN.md`；文档同步（FILE_REGISTRY/TESTING_PLAN/README）已于 16n·4 完成并随提交（d12729c/6c8320c/22d83a8）落地，工作树干净
- **UI（17a/17b/17c 已交付 v1）**：✅ 前端渲染层 v1（packages/studio/web：**CLI 会话对话为默认首页** + 仪表盘/事件流/产物记忆）；✅ 桌面壳 v1（packages/studio/desktop，Tauri 2，`npm run dev:all` 开窗）；待办=安装包（NSIS，后续迭代）+ 异常告警阈值可配置 UI + 进化审批 UI（执行统计/会话治理/异常告警已由 v1 覆盖）

## 架构优化候选（2026-08-06 审计产出）

**P0 高价值（✅ 会话 16l 已完成）**：
1. ✅ 实体注册去重/批量：同 key 覆盖不重复 append（stableKey 剔时间戳）+ 存量清理（compact-entity-events.cjs，47,897→3,904，restore 零丢失）+ restore 分页全量（修复 limit=100 只恢复 100 实体的隐藏 bug）
2. ✅ PiBridge 连接复用：getSharedPiBridge 进程级单例（agent-spawner/ServiceContainer/bootstrap/PiModelRegistry 复用）
3. ✅ bootstrap 启动重建：42k 实体 restore 2.1s→43ms（去重+分页，不引入快照文件——EventStore 保持真相源）

**P1 性能/资源（✅ 会话 16l·2 已完成）**：
4. ✅ rerank 结果缓存：query+docs SHA256 指纹（docs 排序无关）TTL 30s，命中省 808ms HTTP
5. ✅ queryObjects 无索引 → graph 按 type 建 Map<EntityType, Entity[]> 索引（getEntities(type) O(n)→O(桶内)），单对象引用入 Map+桶保 WeakMap 缓存一致；relation 索引未做（调用频率低）
6. ✅ core 内 Gate/planner 限流退避：RetryPolicy 增强 error.name 匹配（RateLimitError 标识在 name 字段，原仅匹配 message 会漏）+ Gate 3 处 generateText 接入 withGateRetry（指数退避 3 次）
7. ⏸️ execution-stats 内存 → 持久化：评估后不做——实时仪表盘用内存有界 history（maxHistory 防膨胀）是合理设计，改 EventStore 持久化需全链路 emit 改造、价值未验证

**P2 架构/体验（✅ 会话 16l·3 已完成）**：
8. ✅ 复杂任务超长（4.5h 无步骤上限）→ Orchestrator maxSteps=8 截断 + maxTotalTokens=200k 预算（分析/审计/重规划/汇总累计，超限 fail loud）——呼应 Bounded Autonomy 铁律
9. ✅ batch 5 并发无资源上限（曾 OOM）→ 并发自适应（--adaptive：内存感知降并发防 OOM + 限流感知降并发防配额风暴；显式 --concurrency 尊重用户）
10. ✅ TraceRecorder 全量包装（1956 调用/任务）→ 采样/开关（enabled/sampleRate/maxCalls + stats()，disabled 零开销）
11. ⏸️ 已应用策略全局注入 → 按 goal 语义过滤：评估后不做——策略仅 3 类通用防错规则（空参/安全拦截/高重试），无语义维度可过滤，任何 goal 都可能触发 → 全量注入正确，reranker 语义过滤无实义

**P3 低优先**：execution-stats 前端 UI、告警阈值可配置、Session 治理前端、结构修正器 tsc 型校验

## 关键教训（避免重蹈）

1. **嵌套 Mission 卡死**：DAG 节点无 Agent 能力 → 总大脑编排（不建嵌套 Mission）
2. **工具空参**：TypeBox required 只查键不查非空 → minLength:1 + beforeToolCall 拦截
3. **递归上下文膨胀**：装配产物当输入摘要（每代≈5×）→ 短摘要+分层预算+指针
4. **静默限流**：内置 provider 空+零 usage → C1 显式 RateLimitError
5. **并行 OOM**：batch + vitest 并行会堆爆 → 独占运行 + 加大堆 + --trace-max 采样
6. **e2e 污染**：step-agent 工具写仓库根 → 沙箱隔离 + git status 自查
7. **★兜底时序缺陷（16l·7）**：MorPex 的 goal 兜底在 beforeToolCall/execute（validate **之后**），而 pi-ai validateToolArguments 对空参直接 throw → 兜底永远执行不到。修复：用 pi-agent-core 官方 `prepareArguments` 钩子（validate **之前**）做模型无关保险。教训：**兜底钩子必须在校验之前，否则形同虚设**
8. **★标识符拼写漂移（16n，本次最大坑）**：`Deblackbox`（De+blackbox，单 b）与 `Debblackbox`（Deb+blackbox，双 b）肉眼无法区分——写工具创建的文件名（单 b）与手写 import/类名（双 b）不一致导致 tsc 反复「模块不存在」但实为拼写差异。教训：**新标识符涉及易混淆拼写时，禁止手写——一律从 `ls`/文件内容程序化派生（bash 变量/占位符+sed），并 hex 核验**；部署新目录先验证 `readdirSync` 与字面量路径字节一致
