# MorPex 会话交接日志（SESSION LOG）

> **会话记忆入口**（精简版）。规则见 `AGENTS.md`；架构唯一真相源 `docs/AICOS_CORE_ARCHITECTURE.md` + `docs/AICOS_CORE_FILE_REGISTRY.md`。
> 会话开始先读本文件；结束只更新"会话历史"+"当前状态/待办"，保持精简。

> ⚠️ **日志纪律（铁律）：过时/冗余信息丢弃**——本日志只保留【当前状态 + 最近进度 + 开放决策 + 待办】；
> 已闭环的历史细节、重复内容、过期描述一律删除，不堆积（历史细节以 git commit 为准，需要时查 git）。
> 会话结束更新时若发现旧内容已过时/冗余 → 直接丢弃，不要追加修补。

---

## 当前状态（2026-08-07，会话 16l·3 后）

- **架构**：AICOS-Core 8 层纯净架构；多 Agent 编排（OrchestratorAgent→step-agent）+ 单执行引擎（UnifiedExecutionEngine v3）；RAG-lazy 上下文装配（Dense bge-m3 + Sparse BM25 → RRF → Cross-Encoder bge-reranker 重排）。
- **门禁**：tsc 0 ｜ validate-architecture 100% ｜ depcheck 0 ｜ production-check 8/8 ｜ core vitest **88 文件 / 771 通过 + 3 限额 e2e** ｜ api-contract 30 通过。
- **LLM**：opencode/deepseek-v4-flash-free（config 驱动）；**Embedding/Rerank**：SiliconFlow（config/embeddingconfig.yaml，SILICONFLOW_API_KEY env）。
- **数据**：morpex-events.db 4GB→85.7MB（16j）→实体去重 92MB→60MB（16l）；restore 2.1s→43ms。
- **P0（16l）**：实体注册去重 + restore 分页全量 + PiBridge 进程级单例。
- **P1（16l·2）**：rerank 缓存 + type 索引 + Gate 限流退避（execution-stats 持久化评估后不做）。
- **P2（16l·3）**：复杂任务 cap（maxSteps=8 + maxTotalTokens=200k）+ batch 并发自适应（--adaptive）+ TraceRecorder 采样/开关（策略按 goal 过滤评估后不做）。
- **batch 终验**：74 任务真实成功率 **31/31=100%**、空参 0（历史 40/199）、耗时 65-133s（提速 60%+）；43 非成功全为 opencode 配额（C1 显式化），0 系统缺陷。
- **GLM-4-Flash-250414 试跑（16l·4）**：10 轮 **成功 9/10**、限流 0、总耗时 376s；唯一失败=跨境电商物流方案（依赖外部 mock API api.example.com 检索失败，非模型问题）；平均 22,823 函数/任务（TraceRecorder 全量）。期间暴露并修复 batch-run ESM bug（require→import）。配置已恢复 opencode。
- **GLM-4-Flash-250414 50 轮（16l·5）**：**成功 28/50（56%）**、限流跳过 3、失败 19、总耗时 2845s（47min）；失败主因=GLM 工具空参（query/command 空 7 次）+ 部分步骤失败 9 + 限流 3——验证 GLM 空参弱点（会话 9 已知）。★首跑 5 并发 TraceRecorder 全量记录（2-8 万调用/任务）→ **4GB 堆 OOM 崩溃**（关键教训 #5 再现）；修复：batch-run 加 --trace-max 5000 采样限制 + 8GB 堆重启，内存受控零 OOM。配置已恢复 opencode。
- **opencode 50 轮（16l·6，部分完成 23/50）**：额度恢复后开跑，**23 轮时免费额度再次耗尽**（HTTP 429 FreeUsageLimitError）→ 暂停。已完成 23 轮：成功 15、失败 8（其中 **5 个为额度耗尽后限流**，非模型问题）；排除限流后真实 **15/19=79%**，空参仅 1 次（vs GLM 7 次）——opencode 质量优势验证。待额度恢复补跑剩余 27 轮。
- **通用空参保险（16l·7）**：彻查空参根因——★发现架构缺陷：pi-ai `validateToolArguments` 在 `beforeToolCall`（goal 兜底所在）**之前**执行，空参（minLength:1）直接 throw → goal 兜底永远执行不到。★修复：用 pi-agent-core 官方 `prepareArguments` 钩子（validate **之前**运行）做模型无关保险——knowledge 空 query 注入 goal、file 空 path 注入默认路径；打通 3 层透传（createPrimitiveAgentTools→agentSpawner.mapToolForAgent→PiBridge.createAgentHarness）。对任意模型（GLM/opencode/未来）生效，不依赖 LLM 是否乖乖填参。新增 4 用例。

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

## 当前开放决策

1. 微信接入（企业微信 vs 个人微信）——**用户排除**，未决策
2. 装配检索 rerank 是否需结果缓存（同 query+docs 指纹）——待定
3. 复杂任务超长（4.5h outliers）是否设步骤/并行上限——待定

## 待办（按优先级）

- **数据治理**：morpex-events.db 会再增长（快照归档策略 + 定期 VACUUM）；✅ system.entity.registered 去重已完成（scripts/compact-entity-events.cjs 可复用）
- **运行时性能**：✅ PiBridge 进程级共享单例（getSharedPiBridge）；✅ bootstrap restore 分页全量（43ms）+ 去重后无臃肿；rerank 结果缓存（P1-4 候选）
- **健壮性**：core 内 Gate/planner 调用方未统一退避重试（batch 有）；execution-stats 用内存 history（长期运行需持久化指标）
- **UI（低优先）**：execution-stats 前端 / 异常告警阈值可配置 / Session 治理前端 / 进化审批 UI 已完成
- **验证**：opencode 配额冷却后复跑 full-closed-loop + 大样本 batch（装配+检索升级后）

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
5. **并行 OOM**：batch + vitest 并行会堆爆 → 独占运行 + 加大堆
6. **e2e 污染**：step-agent 工具写仓库根 → 沙箱隔离 + git status 自查
