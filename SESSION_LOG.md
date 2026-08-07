# MorPex 会话交接日志（SESSION LOG）

> **会话记忆入口**（精简版）。规则见 `AGENTS.md`；架构唯一真相源 `docs/AICOS_CORE_ARCHITECTURE.md` + `docs/AICOS_CORE_FILE_REGISTRY.md`。
> 会话开始先读本文件；结束只更新"会话历史"+"当前状态/待办"，保持精简。

---

## 当前状态（2026-08-06，会话 16k·4 后）

- **架构**：AICOS-Core 8 层纯净架构；多 Agent 编排（OrchestratorAgent→step-agent）+ 单执行引擎（UnifiedExecutionEngine v3）；RAG-lazy 上下文装配（Dense bge-m3 + Sparse BM25 → RRF → Cross-Encoder bge-reranker 重排）。
- **门禁**：tsc 0 ｜ validate-architecture 100% ｜ depcheck 0 ｜ production-check 8/8 ｜ core vitest **82 文件 / 736 通过 + 3 限额 e2e** ｜ api-contract 30 通过。
- **LLM**：opencode/deepseek-v4-flash-free（config 驱动）；**Embedding/Rerank**：SiliconFlow（config/embeddingconfig.yaml，SILICONFLOW_API_KEY env）。
- **数据**：morpex-events.db 已从 4GB 清理至 85.7MB（删 58 条 >1MB 装配快照 + VACUUM，备份 backup-20260806-big-snapshots.json）。
- **batch 终验**：74 任务真实成功率 **31/31=100%**、空参 0（历史 40/199）、耗时 65-133s（提速 60%+）；43 非成功全为 opencode 配额（C1 显式化），0 系统缺陷。

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

## 当前开放决策

1. 微信接入（企业微信 vs 个人微信）——**用户排除**，未决策
2. 装配检索 rerank 是否需结果缓存（同 query+docs 指纹）——待定
3. 复杂任务超长（4.5h outliers）是否设步骤/并行上限——待定

## 待办（按优先级）

- **数据治理**：morpex-events.db 会再增长（快照归档策略 + 定期 VACUUM）；system.entity.registered 42k 事件（实体去重/批量注册）
- **运行时性能**：PiBridge/agent-spawner 每次 spawn 新建（连接复用）；bootstrap 每次重建 Ontology（42k 实体，启动慢）；rerank 结果缓存
- **健壮性**：core 内 Gate/planner 调用方未统一退避重试（batch 有）；execution-stats 用内存 history（长期运行需持久化指标）
- **UI（低优先）**：execution-stats 前端 / 异常告警阈值可配置 / Session 治理前端 / 进化审批 UI 已完成
- **验证**：opencode 配额冷却后复跑 full-closed-loop + 大样本 batch（装配+检索升级后）

## 架构优化候选（2026-08-06 审计产出，用户暂缓实施）

**P0 高价值（数据膨胀/运行时持续消耗）**：
1. 实体注册去重/批量：system.entity.registered 42,469 条（events 82%）→ 同 key 覆盖不重复 append + 事件瘦身
2. PiBridge/连接复用：agent-spawner 每次 new PiBridge+init → 进程级共享单例
3. bootstrap 启动重建：42k 实体 restore → 实体缓存持久化（快照文件加载）

**P1 性能/资源**：
4. rerank 结果缓存（query+docs 指纹 TTL 30s，当前每装配 808ms）
5. queryObjects 无索引（O(n) 全扫）→ graph 按 type 建索引 Map<type, Entity[]>
6. core 内 Gate/planner 限流退避未统一（RateLimitError → retry-with-backoff）
7. execution-stats 内存聚合 → 指标持久化（SQLite 周期汇总）

**P2 架构/体验**：
8. 复杂任务超长（4.5h 无步骤上限）→ Orchestrator 步骤数 cap + 每步 token 预算
9. batch 5 并发无资源上限（曾 OOM）→ worker 并发自适应
10. TraceRecorder 全量包装（1956 调用/任务）→ 采样/开关
11. 已应用策略全局注入 → 按 goal 语义过滤（复用 reranker）

**P3 低优先**：execution-stats 前端 UI、告警阈值可配置、Session 治理前端、结构修正器 tsc 型校验

## 关键教训（避免重蹈）

1. **嵌套 Mission 卡死**：DAG 节点无 Agent 能力 → 总大脑编排（不建嵌套 Mission）
2. **工具空参**：TypeBox required 只查键不查非空 → minLength:1 + beforeToolCall 拦截
3. **递归上下文膨胀**：装配产物当输入摘要（每代≈5×）→ 短摘要+分层预算+指针
4. **静默限流**：内置 provider 空+零 usage → C1 显式 RateLimitError
5. **并行 OOM**：batch + vitest 并行会堆爆 → 独占运行 + 加大堆
6. **e2e 污染**：step-agent 工具写仓库根 → 沙箱隔离 + git status 自查
