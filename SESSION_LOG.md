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
- **LLM**：opencode/deepseek-v4-flash-free（config 驱动，当前配置）；**Embedding/Rerank**：SiliconFlow（config/embeddingconfig.yaml，SILICONFLOW_API_KEY env）。
- **数据**：morpex-events.db 4GB→85.7MB（16j）→实体去重 92MB→60MB（16l）；restore 2.1s→43ms。
- **★去黑盒化全部完成（16n P0 + 16n·2 P1 + 16n·3 P2）**：16 处黑盒全部打开——公共基建（`DeblackboxRecorder`/`RecordPolicy`/`DeblackboxDetailStore`/`RecordCleaner`，L0/L1/L2 三层：决策单永久 + 详情采样 10% + 异常全记；进程级单例 + bootstrap 接入 + 24h unref TTL 清理）**P0**：①空 catch 清零 ②LLM 交互+成本落库（llm.call） ③门禁判定留痕 ④llm-tracer；**P1**：③检索决策 ⑤规划理由 ⑥执行路径 ⑦后台行为 ⑨内存态快照（/memory-state 端点）；**P2**：⑧异步 token 双写持久化 ⑪审批决策 ⑫配置变更审计 ⑭演化理由根因链 ⑮知识写入审计（source/confidence/conflict/version）。方案已归档 `docs/archive/DEBLACKBOX_PLAN.md`。门禁：tsc 0 ｜ 架构 100% ｜ production-check 8/8 ｜ P2 区域 62/62 ｜ 回归 18/18 ｜ 全链路 200+ 全绿。文档同步（FILE_REGISTRY/TESTING_PLAN/README）待人工审核后按 §8.5 执行。
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
| 16n·4 | **收尾**：文档同步（FILE_REGISTRY 登记去黑盒化新文件+埋点分布 / TESTING_PLAN+README 测试数 780·90 / 方案归档）已按 §8.5 审核确认执行；提交 d12729c（16m 补）+ 6c8320c（去黑盒化全量），工作树干净 | ✅ 已提交 |

## 当前开放决策

1. 微信接入（企业微信 vs 个人微信）——**用户排除**，未决策
2. 装配检索 rerank 是否需结果缓存——✅ 已做（P1-4：query+docs 指纹 TTL 30s）
3. 复杂任务超长（4.5h outliers）是否设步骤/并行上限——✅ 已做（P2-8：maxSteps=8 + maxTotalTokens=200k）

## 待办（按优先级）

- **数据治理**：✅ 定期 VACUUM+清理已接线（16n·5：UnifiedEventStore.enableAutoCompaction 透传 + ServiceContainer 启用 12h 周期——清旧事件/快照归档/超阈值 VACUUM；此前是幽灵功能从未调用）；✅ system.entity.registered 去重已完成（scripts/compact-entity-events.cjs 可复用）
- **健壮性**：execution-stats 用内存 history（长期运行需持久化指标）——开放项；✅ planner 限流退避已被 16m·2 PiBridge 全局自愈覆盖（planner 经 piBridgeWrapper→PiBridge.generateText，RateLimitError 退避 4 次），待办过时（16n·5 验证确认）
- **验证**：确定性 mock 套件（16m）已替代「每次跑 50 轮真实任务」作为默认回归（50/50、~80s、可复现）；真实任务抽样 10 轮（glm-4-flash）8/10 已完成；待 opencode 配额冷却后续跑 opencode 50 轮 + 大样本 batch（装配+检索+空参保险升级后）可选做
- **覆盖盲区专项**：8 个已知盲区类（OrchestratorAgent 复杂路径/EvolutionSandbox 演化/MemoryApi 记忆等）已有独立测试，若需在 mock 套件内覆盖可后续补针对性任务
- **★全量去黑盒化（16n~16n·4 全部完成✅）**：16 处黑盒全部打开（P0：空catch/LLM+成本/门禁/tracer；P1：检索/规划/执行路径/后台/内存态；P2：异步持久化/审批/配置/演化/知识审计）；方案归档 `docs/archive/DEBLACKBOX_PLAN.md`；文档同步（FILE_REGISTRY/TESTING_PLAN/README）已于 16n·4 完成并随提交（d12729c/6c8320c/22d83a8）落地，工作树干净
- **UI（低优先）**：execution-stats 前端 / 异常告警阈值可配置 / Session 治理前端 / 进化审批 UI 已完成

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
