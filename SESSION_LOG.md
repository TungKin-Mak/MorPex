# MorPex 会话交接日志（SESSION LOG）

> **会话记忆入口**。规则：
> - **会话开始**：先读本文件（两会话摘要 + 当前状态 + 开放决策）
> - **会话结束**：只更新对应会话摘要 + 当前状态/决策，保持精简
> - 架构详情：`docs/AICOS_CORE_ARCHITECTURE.md`（唯一真相源）+ `docs/AICOS_DATA_FLOW.md`（数据流全链路）+ `docs/AICOS_CORE_FILE_REGISTRY.md`（逐文件）

---

## 会话 1 摘要：架构收敛与遗留清除（已闭环）

**主题**：依据评估（L4 演化双轨 / L6 过薄 / Gate 靠约定 / 技术债+多版本+冗余遗留），经 Wave 3→9.7 收敛到**单一 8 层纯净现架构**。

**关键成果**：
- **演化单轨**：L4 演化逻辑 → L7 单轨；`SelfImprovementLoop` 只产 pending 提案、审批晋升唯一经 `EvolutionSandbox.approveAndApply`（Gate 硬校验）；`EvolutionController`/`cognitive-loop`/`FeedbackAwareLearner`/`PatternMigrationEngine` 删除
- **L6 做实**：修复 `evaluation.scored` 无人 emit 的死桥；`EvaluationEngine` = 质量+本体合规+血缘健康三合一（血缘 20% 折入）；新增 `evaluation.verification.completed` 审计事件
- **Gate/Tier 运行时硬拦截**：`gate/context.ts`（KnowledgeContextPackage / TierWriteGuard / ProposalStatusGuard）；原语/Artifact 注册/提案创建/晋升四处硬拦截（64 用例实测全抛错）；L5 预算硬限制（timeout/cost/iteration 超限→failed+事件）
- **L4 单一学习入口**：`MetaLearner` 并入 `LearningLoop`（程序性+声明性）
- **零兼容垫片**：全仓 0 个 `@deprecated`（Wave 9 清除 artifact.ts/ObservabilityLite/EventStore 等 4 文件 + 迁移消费者）
- **遗留清除**：`packages/archived`(24 目录)+`docs/archived/_archive`+死演化文件+cognitive-loop 层+孤儿（累计 -4000+ 行）
- **文档闭环**：`AICOS_DATA_FLOW.md`（架构+数据流全链路）+ README/REGISTRY 四文档一致，零过期引用

**最终状态**：696→ tracked 文件 / 306 core 源文件；`tsc 0`、`validate-architecture 100%`、`vitest 60 文件/589 通过`、production runner 19/19；与 origin/master 同步。提交区间 `03ed8e8..9db3a87`。

**运营验证**：`scripts/ops-validate.ts`（真实目标全链路 + QueryMiss/评分区分度/审批频率/成本四信号观测）；首次实测 20.5s，评分区分度生效（low_score+needsHumanReview）、0 知识缺口。

---

## 会话 2 摘要：三功能升级方案（讨论中 ⏳）

**主题**：规划 3 个功能升级，**当前处于方案讨论阶段，未开始实现**。逐个讨论（不要混在一起）。

### ① 接入微信 —— L8 外部通道
- 定位：入站消息通道（非 action connector），`微信适配器 → ChannelAdapter → L1 executeGoal/chat`
- 微信域逻辑必须留在适配器/插件层（领域隔离）
- **待决策**：企业微信（合规）vs 个人微信（风险）？微信可否作 human-approval 通道？

### ② 升级记忆系统（规则中断更正）—— ✅ 方案定稿 + Phase 1 已实现（2026-08-03）

**文档**：`docs/FEATURE_RULE_ENFORCEMENT.md`（唯一真相源：架构分层/数据结构/流程/落点拆解/验收标准）

**已定决策**（多轮讨论收敛）：
1. 规则来源：**人工反馈→LLM 提炼→人工确认生效**（pending/active，存 L2 tier-0/1 RuleEntity）；演化 tier-2 延后 Phase 3（TierWriteGuard 已预留闸门）
2. 检测机制：**确定性优先**——规范化管道(NFKC+casefold+去空白)+正则为主力，别名表补充，模糊匹配可选，LLM 语义复核仅兜底
3. 检测器架构：**core 管骨架/领域管内容**——5 维分类（文本/结构/代码/行为/合规）；正则引擎内置 core，AST/编译/Lint 走 `Detector` 接口由领域实现；复用现有 validateReferences/QualityRule/PolicyRuleRegistry/TierWriteGuard/L5 预算
4. 修正策略：ERROR 命中→中断→**通用修正管线**（①词法 ②结构为 Phase 2 待实现；③语义=带约束重试 maxAttempts=3 已实现；④人工=needs_human_review 已实现）→每层重新检测验证，通过才放行，失败升级下一层
5. 误报降级：ERROR/WARNING 分级 + 连续命中 2 次自动降级 + rule.violation/rule.downgraded 事件（字符串字面量 type，不走 EventType 枚举）
6. 已识别的坑：groundingCache 缓存跳过校验（Phase 2 规则版本入 key）；Gate 无预算感知（重试管道自控）
7. **规范驱动（2026-08-03 定，取代硬替换）**：领域只声明"什么合法"（白名单/范围/示例），不写"违规怎么改"；`allowedAction` 确定性替换**降级**为词法层可选微优化（非核心，多领域维护不起）；Phase 2 主线改为**通用修正管线 + 检测器类型扩展**（API 白名单前缀如 MCU `IOCP_`/AST/schema，统一走 Detector 接口）；**Phase 1 代码零改动**（检测/中断/重试/降级骨架本就通用，已同步方案文档 §2/§5/§6/§7）

**Phase 1 落点**（7 新文件+4 改文件+测试+1 插件示例）：`gate/rules/{types,RuleRegistry,normalize,RuleEnforcementGuard,ruleEvents,RuleExtractor,rulePersistence}.ts`；改 `runOntologyGroundedReasoning`（Phase 2 后挂载+带约束重试）/`gate/index`/`objectTypes`(Rule 类型)/`bootstrap-unified`；测试 normalize 管道/guard 匹配/重试循环/连续降级；ecommerce 插件示例（**默认 pending 待确认**）。
- 已实现（commit 2d69672 及后续）：门禁 tsc 0 / validate 100% / vitest 全绿；domain 路由接口已留（`options.domain` + `getActiveRules(domain)`），但 **4 个调用方无 domain 信号 → 全局匹配，domain 沿调用链传递为 Phase 2 项**；示例规则 pending 消除跨域误伤。验收：tsc 0 / validate 100% / 新测试全绿 / 集成验证中断-重试-降级链路。
- **✅ Phase 2 已完成（2026-08-03）**：B1 白名单剥注释/字符串（stripCommentsAndStrings，零依赖状态机）+ B2 DetectorRegistry 领域注入机制（custom:no-eval 示例）+ E 预算接线（onTokenUsage 估算回调 + try/catch 防御，emit execution.gate.token_usage）+ F domain 传递（MorPexRuntime context.goal.domain 按域路由）+ 缓存指纹（第一批）。门禁 67 文件 647 通过 + 5 skipped。剩余：②结构层 AST/tsc-eslint 适配器（依赖解析待验证）、schema/AST 规则、精确计费。
- **✅ keyword 通用两级模型（2026-08-03 定，用户主导设计）**：规则 = 关注点关键词 + 自然语言要求，**全行业通用**（不绑领域语法：编程 isr_interrupt / 电商 价格 / 金融 利率）。第一级 `KeywordDetector` 确定性扫名（零成本）→ 第二级按需 LLM 语义复核（仅命中时调，按 description 判定 triggered）→ 触发进修正重生成（注入判定理由/建议）；未触发放行；解析失败保守触发转人工；语义判断 token 已计入 onTokenUsage。门禁 69 文件 658 通过 + 5 skipped（零回归）。reviewer 建议：多关键词只按首个命中判断（MVP 可接受）、WARNING 未触发不记事件（语义一致）。

**✅ Phase 1 已实现并验证（2026-08-03）**：全部落点落地（含 ecommerce 插件 `rule-register.ts`、validate-architecture 白名单加 `/gate/rules/`）；tsc 0 / validate 100% / vitest 64 文件 614 通过（新增 4 测试文件 25 用例，原 589 零回归）；集成测试证明中断-重试-降级-转人工链路 + eventStore undefined 兼容（4 调用方）。实现中修复 2 个设计缺口：① 降级后违规内容会静默放行 → 补"降级后转人工"；② 重试温度统一 0.3 → 重试轮 0.2。剩余建议项（WARNING 事件冗余、缓存规则版本并入 key）归 Phase 2。

**✅ 功能③ 全链路（2026-08-03）**：身份 ID 驱动 + 三分法聚焦（系统级必装/任务级按 taskRef/历史抽离）+ 抽离三级（完整快照入 EventStore + 摘要 + experienceMiner）+ ContextArchive.loadByTaskRef 按 ID 召回 + **mode 收敛**（ExecuteGoalOptions/RunOptions 移除执行 mode，统一规划前置 MorPexRuntime orchestrate 后，MissionRuntime FSM 复用 plan 防重复）+ **装配统一**（orchestrate 后装配，真实 missionId/taskRef）+ **真实 Provider**（goal_graph 读 OntologyService / mission_state 读 MissionController）。门禁：tsc 0 / validate 100% / vitest 74 文件 675 通过零回归（commit b6d2806）。

**✅ Phase 2 第一批已实现（2026-08-03）**：C 检测器扩展（Detector 接口正式化 + ApiWhitelistDetector 白名单前缀，MCU `IOCP_` 场景钥匙）/ A 词法修正保守版（lexicalCorrection，allowedAction 可选微优化，安全兑底）/ D 缓存一致性（RuleRegistry.fingerprint 并入 groundingCache key，规则变更天然失效）。xjmcu 插件示例 `platform-rule.ts`（白名单规则 pending）。门禁 tsc 0 / validate 100% / vitest 66 文件 634 通过（零回归）。reviewer 终审有条件通过（无必须修；3 建议项入后续：白名单注释误判→结构层 AST 解决、前缀粒度粗、fingerprint 补 aliases/severity）。**Phase 2 剩余（第二批）：结构层 tsc/eslint 适配器 + L5 预算接线 + domain 上下文传递**。

**✅ Phase 2 第一批已实现并验证（2026-08-03，commit f09fb3c + 12b32a4）**：
- ① **Detector 接口正式化**（`gate/rules/detectors.ts`）：RuleDetector 契约 + detectorRegistry 按 ruleType 分派；RegexDetector 迁移（零回归）+ **ApiWhitelistDetector**（厂商风格 API token 前缀白名单，MCU IOCP vs STM32 HAL/LL 场景）；RuleType 扩 'whitelist'、RuleEntity.allowedApiPrefixes、disallowedPattern 改可选
- ② **词法修正**（`gate/rules/lexicalCorrection.ts`，修正管线①保守版）：allowedAction 机械替换，定位不到/异常兜底；runOntologyGroundedReasoning 在重试前先词法修正 → 重新 check → 合规放行
- ③ **缓存一致性**：`RuleRegistry.fingerprint()` 并入 groundingCache key —— 规则变更 → 指纹变 → 旧缓存天然失效
- 领域示例：xjmcu 平台 API 白名单规则（pending 待确认）+ bootstrap 接线
- 门禁：tsc 0 / validate 100% / vitest 66 文件 634 通过 + 5 skipped（规则测试 6 文件 45 用例全绿）
- 剩余：修正管线②结构层（tsc/eslint 适配器）、schema/AST 检测器、L5 预算接线、domain 上下文传递 → 第二批

### ③ 升级上下文管理 —— L2/L4 组装 ✅ 方案定稿（2026-08-03）

- `ContextAssemblyEngine` 已存在（Builder/Enricher/FragmentRegistry/Versioner），**零业务调用方（孤立组件）**，需先接通
- **设计哲学（用户定稿）**：上下文不是堆砌，是**聚焦 + 按需召回**。四条原则（不新增层，现有 8 层内固化）：
  1. **聚焦**：工作上下文 = 系统约束 + Goal/PlanContract/TaskContract + 本步 ontologyRefs + ≤N 条近期摘要；禁止塞已完成 Mission 的完整对话/中间推理
  2. **抽离**：已完成历史默认进 EventStore/Artifact/Evaluation/Experience；工作上下文只留 {missionId, 摘要, keyRefs, score}
  3. **召回经 Gate**：需要历史 → 显式 KnowledgeQuery/Ontology → KnowledgeContextPackage（来源+置信度）；QueryMiss 仍是信号，禁贴旧聊天
  4. **时机**：L4 规划前装配一次；L5 关键 Step/Primitive 前可精炼
- **接线点（已探索）**：L1 授权后 = CompanyFacade.executeGoal:162（ControlPlane 门禁后）+ domain 信号可用（options.departmentName）；历史抽离 = MorPexRuntime COMPLETED+evaluation 后（:354-444）；⚠️ 两个 ExecutionContext 类型不同（runtime vs knowledge/context）需映射；Agent 注入可走 harness setContextBias
- **与功能②协同**：domain 复用 + keyword 规则 description 前置注入（平台信息前置预防，比事后拦截省钱）
- **Phase 1 已实现并验证（2026-08-03，含身份 ID 重构）**：①聚焦——ContextAssemblyEngine 聚焦模式**重构为身份 ID 驱动 + 三分法**（系统级 user_profile/约束永不省略；任务级按 taskRef 归属匹配 currentTask【同会话多任务可分】；历史级跳过；硬截断降为兜底上限>maxTokens×10 才截）；focusedSummary 含任务身份；focusMode=false 向后兼容；②抽离三级——MorPexRuntime COMPLETED+evaluation 后：missionSummary（带 taskRef）→ context.archived + 完整快照 context.snapshot 入 EventStore（setEventStore 注入）+ experienceMiner 承载；召回按 taskRef（ContextPersistence.loadByTaskRef）；③④时机——CompanyFacade L1 门禁后装配（可选注入非阻断）→ 并入 extraContext + context.assembled 真实 emit + keyword 规则 description 前置注入（与功能②协同）；bootstrap 注入引擎（聚焦模式）。门禁：tsc 0 / validate 100% / vitest 72 文件 668 通过零回归（commit 9fdf2e6）。**剩余/建议**：①真实 Provider（goal_graph 等）未挂 taskRef → 身份过滤真实场景暂靠保守装，Provider 层归属标记待 Phase 2；②抽离快照在 EventStore、loadByTaskRef 在 ContextPersistence，两存储独立，统一召回接口待 Phase 2；近期摘要消费端拼接、Planner/Primitive domain 传递、风险分级（可延后）

**优先级建议**：③ 上下文（基础）→ ② 规则中断（核心价值）→ ① 微信（独立通道）

---

## 当前状态

- **仓库**：单一 8 层纯净架构；696 tracked / 306 core 源文件；与 origin/master 同步
- **门禁**：tsc 0 ｜ validate-architecture 100% ｜ vitest **83 文件/727 通过+5 skipped（零失败）** ｜ production-check 7/8（Dependency Check 步在 Windows 下 spawnSync 超时；底层 2 条 dep 违规为 evaluation/ 遗留，本会话未触碰）｜ verify-e2e 通过
- **✅ 会话 4 多 Agent 编排框架已交付**（提交区间 `aa72aff..f770603`，6 提交）：总大脑（OrchestratorAgent 审计循环）+ step-agent（agentSpawner + 原语工具）+ DAG 上游传递；生成类任务主路径从 executeViaMission（嵌套卡死）切到 orchestrator；修复 3 个隐藏根因（DAGRuntime 构造器丢 nodeHandler、PiBridge 不传 models/丢工具 execute、yaml CRLF 注释解析）+ 审查轮必修（工具参数丢弃假阳性）+ 优化轮（onTokenUsage 真实 token / step-agent 显式超时）；e2e 实测 GLM 交付完整架构文档
- **持续项**（非紧急）：覆盖率提升；L6 未来功能（人工覆盖评分/Performance Profile）；bootstrap-unified.ts 拆分；CostController 全链路计费未接（onTokenUsage hook 精度已修）；总大脑/step-agent Session 化（跨会话讨论）未做（当前进程内编排）；① 微信接入、②③ Phase 2 第二批仍开放

## 当前开放决策（会话 2 待定）

1. ② 规则来源：人工 tier-0 vs 演化 tier-2 → **已定**（反馈提炼+确认，演化延后）
2. ② 检测机制：是否接受确定性规则匹配器 → **已定**（确定性优先+语义兜底）
3. ① 微信类型：企业微信 vs 个人微信（未讨论）
4. ③ 上下文"优化"的具体方向（未讨论）
5. ✅ ② Phase 1 实现已确认开工并完成（2026-08-03，验收全绿）
   - **Phase 2 待办**（方案文档 §7）：确定性替换 allowedAction / 缓存规则版本入 key / L5 预算接线（重试计入 costTokens）/ 代码层 Detector 适配器（tsc/eslint）/ domain 上下文沿调用链传递 / ReDoS 限制 / WARNING 事件去重

---

## ═════════ 会话 3 架构决策：多 Agent 编排执行框架（2026-08-04）═════════

### 决策背景
- 真实任务审计（99 任务）发现：生成类任务走 executeAuto（参数提取不稳）或 executeViaMission（嵌套 Mission + DAG 无 Agent 能力 → 卡死）均失败
- 根因：Mission 路径 DAG 节点依赖 ExecutionFabric（**无通用 Agent 能力注册**，cap='execute' 无匹配 → 空转）；嵌套 = MorPexRuntime 与 MissionRuntime 两层 Mission
- 用户定稿新架构（**多 Agent 编排，Session 化**）

### 架构定稿（用户确认）

```
用户输入
  → [Session 总大脑]（双职责）
  │    ├─ 开始：分析复杂度 → 编排
  │    │    简单 → 创建 1 个 step-agent
  │    │    复杂 → 调用【DAG 工具】创建 N 个 step-agent
  │    └─ 后期：汇总所有 step 成果 → LLM 审计
  │          pass → 生成最终交付物 ｜ fail → 生成补充任务 → 再调 DAG 分发（迭代）
  → 【DAG 工具】（非 Session，调度/分发工具：拓扑排序、创建 step-agent、传上游成果）
  → [Session Step-Agent i]（每节点一个：接收职责+上游成果，可跨会话讨论，决策执行方案）
  → [Session 执行肢 i]（独立 Session，每 step 一个：调原语工具 knowledge/file/shell/api/artifact，产出结果报告给 step-agent）
```

### 关键设计点
1. **总大脑不只规划**——双职责（任务开始分析复杂度编排 + 后期汇总审计 pass/fail）
2. **DAG 是工具不是 Session**——只做调度/分发/传依赖，创建 step-agent
3. **step-agent 可跨会话讨论**——交流成果/方案（DAG 依赖传递 + 讨论）
4. **执行肢是独立 Session**——调原语工具（动手），报告给 step-agent
5. **简单任务走单 step-agent**（不走 DAG）
6. **每个组件独立 Session**（总大脑 / step-agent / 执行肢）

### Session 统计（实际创建）
- 复杂任务：1 总大脑 + N step-agent + N 执行肢 = **2N+1**（例：DAG 4 step → 9 Session）
- 简单任务：1 总大脑 + 1 step-agent + 1 执行肢 = **3**
- 迭代（fail）：总大脑审计 → 补充任务 → **新增 step-agent + 执行肢**

### 与现有差距（实施计划）
| 预想 | 现有 | 差距 |
|---|---|---|
| 总大脑规划+审计 | DeliveryPlanner（只规划）| ✅规划有；❌审计循环需新增 |
| DAG 工具 | DAGRuntime/计划 | ✅ 框架有 |
| step-agent 执行 | DAG 节点→ExecutionFabric（无 Agent）| ❌ **核心缺口**：需 AgentHarness（pi-agent-core）执行 step 职责 |
| 跨会话讨论 | 无 | ❌ 需 DAG 依赖传递 + agent 交流 |
| 审计循环 pass/fail | 无 | ❌ 需新增评估 Agent + 迭代分发 |
| 简单任务单 agent | executeAuto（原语）| ⚠️ 需单 Agent 路径（LLM 而非原语提取）|

### 实施优先级
- P0：DAG 节点 nodeHandler：ExecutionFabric → **AgentHarness**（step-agent 执行肢）
- P1：跨会话交流（上游 output → 下游 context + step-agent 讨论）
- P2：总大脑审计循环（pass/fail + 迭代分发）
- P3：简单任务单 Agent 路径

### 本会话已做（相关积累）
- batch-run 5 并发 + GLM 限流容错 + 参数补全层（maxTokens 不设限）+ 路径分配探索（生成类走 Mission 实测嵌套失败，回退待定）
- 生成类走 Mission 实测：嵌套 Mission（MorPexRuntime + MissionRuntime 双层）+ 内层 DAG 无 Agent 能力 → 300s 超时 —— **教训：Mission 执行层依赖未实现的 Agent 能力池**
- 后续实现：在另一个会话继续（本会话只讨论定稿 + 记录）

---

## ═════════ 会话 3 测试工具链（脚本清单，2026-08-04）═════════

### 数据流审计工具链（本会话构建）
| 脚本 | 用途 | 用法 |
|---|---|---|
| `scripts/verify-e2e.ts` | 快速全链路验证（executeGoal→装配→抽离→召回）| `npx tsx scripts/verify-e2e.ts` |
| `scripts/check-llm.ts` | LLM 配置自检（apiKey 状态/网关可达/模型名）| `npx tsx scripts/check-llm.ts` |
| `scripts/batch-run.ts` | 批量闭环测试（默认 100 任务，5 并发）| `npx tsx scripts/batch-run.ts [--limit N] [--concurrency N] [--only 行业] [--no-prompt]` |
| `scripts/batch-tasks.ts` | 100 任务集（ecommerce/hardware/software/xjmcu 各 25）| 被 batch-run 引用 |
| `scripts/tracing/TraceRecorder.ts` | 函数调用追踪器（wrap 服务实例，记录调用链/耗时/入参出参）| 被 batch-run 引用 |
| `scripts/analyze-trace-reports.ts` | 分析 data/trace-reports/*.md 函数频次（高频/低频/从未调用）| `npx tsx scripts/analyze-trace-reports.ts` |
| `scripts/_mission-session.ts` | Mission 会话诊断（临时，打印各阶段事件）| 诊断用 |

### batch-run 容错参数（GLM/grok 限流处理）
```
--timeout <ms>    单任务超时（默认 180000，无响应抛错）
--retries <n>     429/5XX/1305 限流自动重试（默认 2，退避 30s/60s/90s）
--delay <ms>      任务间限流退避（默认 3000）
--concurrency <n> 并发数（默认 5，总耗时=最慢任务）
--only <行业>     按行业过滤
```
限流识别：HTTP 429/5xx + GLM 1305（"访问量过大"）+ 关键词（限流/过载/稍后再试）→ 自动退避重试；耗尽标记 RATE_LIMITED（退出码 2，不算失败）。

### 报告产物
- 每任务一份数据流报告：`data/trace-reports/task-{NNN}.md`（任务信息+数据流调用链+函数明细表+抽离/召回）
- 50/100 份报告用于功能模块审计（哪个模块被调用/未调用/有问题）

### LLM 配置（config/morpex.yaml）
```
llm:
  enabled: true            # true=自定义网关 / false=内置 deepseek
  baseUrl: <OpenAI 兼容端点>
  apiKey: ${VAR}           # 环境变量引用（process.env → Windows 用户级兜底）
  model: <模型名>
  maxTokens: 128000        # 不设单次限制（走 model 默认）；成本由 onTokenUsage/CostController 控
```
已验证模型：GLM-4.7-Flash（智谱，思考模式默认，限流 1305 自动重试）；grok-4.20-0309-reasoning（grok2api 唯一可靠）；deepseek（最稳，测试/CI）。

---

## ═════════ 会话 3 补充：新会话实现指南（2026-08-04）═════════

### step-agent 执行基础（P0 抓手）
- **agentSpawner**（`packages/core/src/infrastructure/adapters/agent-spawner.ts`）：现有 Agent 创建能力
  `spawn({ identityToken, ring, tools: AgentTool[], systemPrompt, provider, modelId, domainId })`
  → 返回 `{ prompt(input) → content, abort() }`——**LLM 思考 + 工具调用循环**（pi-agent-core Agent）
- **AgentTool** = 原语工具（AgentTool 类型，见 `pi-bridge/index.ts`）——step-agent 的执行肢
- **AgentHarness**（自研 `execution/harness/AgentHarness.ts`）是 harness 上下文框架，**不是执行循环**；真正执行用 agentSpawner / pi-agent-core Agent
- 现有空壳：`DAGExecutorAdapter` → `DAGRuntime` → nodeHandler（ServiceContainer:339）→ ExecutionFabric（无 Agent 能力）——**替换点**

### 关键代码位置
```
ServiceContainer:333-360   DAGRuntime nodeHandler（ExecutionFabric → 待改 AgentHarness/agentSpawner）
UnifiedExecutionEngine:672  executeAuto（生成类路径分配）
UnifiedExecutionEngine:743  生成类 → executeViaMission（fcab3e7 加的，待处理）
execution/runtime/mission/adapters/DAGExecutorAdapter.ts  Mission 执行器（DAG 转换）
infrastructure/adapters/agent-spawner.ts  Agent 创建
cognition/planning/DeliveryPlannerAdapter.ts  plan→DAG（agentType 定义）
```

### 待处理改动（回退 or 改造）
- **fcab3e7**：生成类走 executeViaMission（实测嵌套 Mission 失败）——新会话按多 Agent 框架**改造**而非简单回退
- 生成类任务当前：executeAuto 提取不稳 + Mission 嵌套卡死 → 按新框架（总大脑→DAG→step-agent→执行肢）重构

### 环境状态
- config/morpex.yaml：enabled=true（GLM-4.7-Flash），apiKey=${GLM_API_KEY}（Windows 用户级）
- 测试稳定：deepseek 下跑（enabled=false）；GLM 限流（1305）batch-run 自动重试
- observability-bridge/sse 测试：生成类走 Mission 后超时（已调 timeout 180s，需在新框架下验证）

### 已知坑（避免重蹈）
1. 嵌套 Mission：MorPexRuntime 已建 Mission + executeViaMission 再建 → 双层（新框架 DAG 是工具，不建 Mission）
2. DAG 节点 ExecutionFabric 无 Agent 能力 → 空转（新框架用 agentSpawner/AgentHarness 执行）
3. 参数提取不稳（GLM JSON）→ 生成类用 LLM 自然生成（step-agent 输出），不强制提取
4. 成本：maxTokens 不设限 → 靠 onTokenUsage/CostController 控

---

## ═════════ 会话 4：多 Agent 编排框架已实现并全链路验证（2026-08-04）═════════

### 交付内容（P0+P1+P2 全部落地 + 3 个隐藏根因修复）

**新增文件**：
- `execution/orchestration/OrchestratorAgent.ts` —— 总大脑（P2 审计循环：分析复杂度→单 step-agent 或 DAG 分发→LLM 审计 pass/fail→fail 生成补充任务再分发（上限 3 轮）→LLM 汇总交付物；LLM 不可用/解析失败自动降级单 step 直跑）
- `execution/runtime/dag/StepAgentExecutor.ts` —— step-agent 执行器（agentSpawner + 原语工具循环；上游成果注入 prompt；失败降级 fallback）
- `infrastructure/tools/primitiveAgentTools.ts` —— 原语→AgentTool 桥（knowledge/file/shell/api/artifact 5 工具，execute 真正调原语）
- `__tests__/multi-agent-orchestration.test.ts` —— 13 用例（桥/执行器/DAG 上游传递/审计迭代/降级）

**修改文件**：
- `UnifiedExecutionEngine.ts`：ExecutionMode 增 'orchestrator'；setOrchestratorAgent + executeViaOrchestrator；生成类任务优先走总大脑（不依赖原语匹配置信度，覆盖 medium/complex 生成类），取代 executeViaMission 嵌套路径（fcab3e7 的卡死路径）
- `ServiceContainer.ts`：构造器接总大脑（createOrchestratorAgent，LLM=PiBridge 网关 + DAG 工具 + stepExecutor）；DAG nodeHandler：ExecutionFabric → StepAgentExecutor（fabric 降级 fallback）
- `DAGRuntime.ts`：① 构造器不再丢弃 nodeHandler（此前传入即丢 → 节点无 handler 直接 success output=null——**DAG 空转真正根因**）② P1 上游成果注入：handler context 加 upstreamResults（Map<depId, output>）
- `pi-bridge/PiBridge.ts`：createAgentHarness 三修复——①透传工具 execute（此前丢弃 → 声明的工具不可调用）②传 models（此前不传 → this.models=undefined → 'Cannot read properties of undefined (reading streamSimple)' → agent 4ms 返回空）③工具结果规范化 AgentToolResult
- `agent-spawner.ts`：未指定 provider/modelId 时不硬编码 deepseek（网关启用时 deepseek 不在注册表 → model.provider=undefined → 'Unknown provider: undefined'）
- `pi-bridge/yamlConfig.ts`：**CRLF 注释解析 bug**——JS 正则 `.` 不匹配 `\r`，CRLF 文件里 `/\s*#.*$/` 永不匹配 → 注释残留进值（enabled 变真值字符串、apiKey/baseUrl 带中文注释 → Agent 请求 ByteString 报错）；修复：先 CRLF→LF 规范化
- `observability/architecture-contract.ts`：brain-facade expectedCallers 'company-facade'→'morpex-runtime'（company-facade 不发事件，实际 span 父=运行时锚；链路修通后暴露的潜伏契约错位）
- `sse-execute-e2e.test.ts`：SSE 闭环测试改为不阻塞 POST 完成（先读 SSE started 事件再 await POST），超时 45s→180s，afterAll 15s→60s（多 Agent 编排多轮 LLM，POST 在完整执行后返回）
- `observability-bridge.test.ts`：仅超时上浮（前会话遗留改动保留）

### 验证结果
- **门禁全绿**：tsc 0 ｜ validate-architecture 100% ｜ vitest **82 文件 723 通过 + 5 skipped（零失败）** ｜ production-check 7/8（Dependency Check 步 Windows spawnSync 超时；底层 2 条 dep 违规 pre-existing：evaluation/lineageCompliance→ArtifactLineage、EvaluationEngine→EventTypes，本会话零相关改动）｜ verify-e2e 通过
- **observability 测试 6 个失败 → 全绿**（HEAD 基线 6/9 失败：executeViaMission 卡死）
- **e2e 实测（GLM 生产模型）**：`生成一个软件系统架构设计方案` → ok=true mode=orchestrator，总大脑判 simple → 1 step-agent 工具循环 → 审计 pass → 交付完整架构设计文档（180s）
- **模型差异**：GLM 工具调用可靠；deepseek-v4-flash 在 pi-agent-core harness 下工具调用不稳定（常直接聊天不调工具）——测试/CI 用 deepseek 没问题（mock/不依赖工具），生产用 GLM

### 遗留/后续（下一会话）
- P3 简单任务单 Agent 路径已隐含实现（OrchestratorAgent simple 分支），但 executeAuto 的简单操作类任务仍走原语参数提取（未改）
- 总大脑/step-agent 会话化（独立 Session 持久化）未做——当前为进程内编排（Session 化是后续增强）
- ~~step-agent 无显式超时~~ → **✅ 优化轮已加**（timeoutMs 默认 180s，超时 abort + fallback 降级）
- ~~精确 token 计费未接~~ → **✅ 优化轮已修 onTokenUsage 精度**（llm 类型加宽带 usage.total，真实 token 优先）；CostController 全链路计费仍待接
- deepseek 工具调用不稳定（pi-agent-core harness + deepseek-v4-flash）——若需 deepseek 工具链路可查 thinking 配置
- config/morpex.yaml 默认 enabled=false（deepseek），生产切 GLM 需手动改

---

### ═══════ 会话 4 优化轮（2026-08-04，commit f83e102）═══════

实现轮（aa72aff）之后的强制优化阶段，两处真实修复 + 测试补强：

1. **onTokenUsage 精度修复**：`OrchestratorOptions.llm` 类型从 `{ text }` 加宽为 `{ text, usage? }`（PiBridge.generateText 本就返回 usage），新增 `tokenCount()` helper——`usage.total` 优先、缺失回退字符数估算；三处调用点（分析/审计/汇总）改用真实 token。
2. **step-agent 显式超时**：`StepAgentExecutor` 新增 `timeoutMs`（默认 180000），`withTimeout()` 用 Promise.race 包裹 agent.prompt；超时 → catch → `agent.abort()` 清理 → 走既有 fallback 降级。防 LLM 挂起永久卡住。
3. **测试补强**：新增 `__tests__/step-agent-timeout.test.ts`（2 用例：超时降级 + 超时无 fallback 返回失败）；P3 单 step 直跑闭环在 multi-agent-orchestration.test.ts:305 已有覆盖，未重复。

**门禁实测**：tsc 0 ｜ validate-architecture 100% ｜ vitest **83 文件 726 通过 + 5 skipped（零失败）**。

---

### ═══════ 会话 4 审查轮（2026-08-04，commit f20fff3 + b1ac441）═══════

**审查发现 1 个必修 bug + 修复 + 回归测试 + e2e 预算调整**：

1. **⚠️ 必修：step-agent 工具参数被丢弃（aa72aff 引入的假阳性）**：`agent-spawner.ts` 工具映射适配器单参调用 `t.execute(p)` → p 落到 toolCallId、params=undefined → 原语以空参执行（knowledge_query 空 query 快速失败、产物靠 LLM 自身知识生成）——e2e“成功”是假阳性。契约确认：pi-agent-core `AgentTool.execute = (toolCallId, params, signal?, onUpdate?)`（types.d.ts:333）。修复：`mapToolForAgent` 提取为可测纯函数，显式 `('', p)` 双参调用；新增回归测试（probe 实测：修复前 params=null，修复后 =完整 params）。
2. **连带影响**：工具现在真正执行 → knowledge_query 两阶段 Gate LLM 推理在 deepseek 下显著变慢 → SSE/observability e2e 测试 180s 预算不足 → 上浮 300s（生产 GLM 下 180s 足够）。
3. **⚠️ 教训：e2e 测试污染**——step-agent 的 file/shell 工具以进程 CWD（=仓库根）写文件（hello.py/todo-app.html/probe.txt 等）→ 提交时被 `git add -A` 扫进 commit；已剔除并删除，后续 e2e 前注意 git status。

**门禁实测**：tsc 0 ｜ validate-architecture 100% ｜ vitest **83 文件 727 通过 + 5 skipped（零失败）**。

---

### ═══════ 会话 4 审查轮补：e2e 预算 flaky 修复（2026-08-05，commit f770603）═══════

审查轮把 SSE/observability e2e 预算 180s→300s 后，独立复跑发现**仍 flaky**：

1. **根因 ①（测试级超时）**：deepseek 下真实执行探针实测 **276.8s**（step-agent 180s 超时 → fallback 完成），300s 预算在 LLM 延迟波动下超时（实测 300007ms 失败）→ **420s**（实测×1.5 余量），span-tree/modules-v2/exercise-status 的失败全是同一 POST 超时的级联。
2. **根因 ②（客户端 headersTimeout）**：`/api/execute` 在服务端完整执行后才返回 headers，undici 全局 fetch 默认 `headersTimeout=300s` 会提前中断（`UND_ERR_HEADERS_TIMEOUT`）→ 新增 devDependency `undici`，用 `new Agent({ headersTimeout: 600000, bodyTimeout: 600000 })` 作 dispatcher 传入长 POST（observability 的 /api/execute + /api/chat/send、SSE 的 /api/execute 三处）。
3. **e2e 污染复现**：真实工具执行在仓库根留下 f2.txt/hello.py/todo-app.html 等产物（进程 CWD=仓库根）——已删除，复跑前 git status 自查。

**门禁实测（最终）**：tsc 0 ｜ validate-architecture 100% ｜ vitest **83 文件 727 通过 + 5 skipped（零失败）**，工作树干净。

---

### 会话 3 遗留任务（未做，继续开放）
- ① 微信接入：企业微信 vs 个人微信未决策
- ② Phase 2 第二批：结构层 tsc/eslint 适配器、schema/AST 检测器、L5 精确计费、domain 沿调用链传递
- ③ 上下文 Phase 2：Provider 归属标记、统一召回接口、Planner/Primitive domain 传递

---

### ═══════ 会话 4 独立终审（reviewer，2026-08-05，调度器内联执行）═══════

**终审结论：✅ 通过（有条件）**——无必须修项；1 建议项（已记录待后续）+ 1 信息项。

**复核要点（全部独立验证）**：
1. **AgentTool.execute 双参契约（f20fff3）** ✅：pi-agent-core `types.d.ts:342` 确认 `execute(toolCallId, params, signal?, onUpdate?)`；`('', p)` 显式双参正确，toolCallId 空串安全（PiBridge 包装层不消费）；回归测试断言原语收到完整 params。
2. **超时实现（f83e102）** ✅：withTimeout 用 Promise.race + finally clearTimeout（无定时器泄漏）；catch 中调用 agent.abort() 后走 fallback。注意：超时后原 prompt Promise 仍挂起（无法取消），靠 abort 清理 LLM 会话——可接受。
3. **onTokenUsage 精度** ✅：llm 类型加宽为可选 usage（PiBridge.generateText 本就返回）；tokenCount() usage.total 优先、缺失回退字符数；ServiceContainer 接线与测试 mock 均兼容。
4. **DAGRuntime nodeHandler 修复** ✅：构造器存储为纯增量；其余构造点（workflow-sdk bootstrap.ts:457、architecture-integration.test.ts:52）不传 nodeHandler → 零行为变化；upstreamResults 注入为 spread 追加不覆盖既有 ctx。
5. **orchestrator 路由** ✅：操作类简单任务仍走 executeAuto 参数提取（无回归）；mode='orchestrator' 为引擎内部值（StudioServer 默认传 'auto'，无枚举校验冲突；DeliveryPlanner 仅判 `!== 'auto'`）。
6. **安全（Gate）** ✅ 一致且更严：primitiveAgentTools 不传 gateContext → 破坏性原语（file write/shell build/api POST）经 PrimitiveGate.gateDestructive **硬拦截**（gateBinding.ts），与 executeAuto 路径同一文档化安全默认，**非新绕过**。
7. **架构合规** ✅：提交区间零 validate-architecture 白名单改动，100% 为真实对齐非规避。
8. **测试质量** ✅：mock 原语注册进真实 DomainPrimitiveRegistry、execute 断言真实参数；DAG 上游用真实 DAGRuntime+TaskGraph；e2e 超时改动合理（先读 SSE started 再 await POST）。
9. **死代码** ✅：f83e102 已清重复计时；tokenCount/mapToolForAgent/extractText 均有使用与测试。

**建议项（后续，非阻塞）**：step-agent 执行肢**当前无法执行破坏性操作**（file write/shell build 被 Gate 硬拦）——编排路径未供给 KnowledgeContextPackage。后续：orchestrator 执行前经 Gate 两阶段获取知识包 → StepAgentExecutor → primitiveAgentTools context.gateContext 传递，解锁真实文件/shell 动手能力。**信息项**：SSE e2e 在满负载下仍偶发时序 flaky（复跑即绿，CI 上留意）。

---

### ═══════ 会话 4 补：调度器独立复核（2026-08-05）═══════

会话 4 交付后，调度器（本会话）独立重跑全部门禁复核：
- ✅ **tsc 0**（`npx tsc --noEmit -p tsconfig.json`）
- ✅ **validate-architecture 100%**（`node scripts/validate-architecture.js`，零白名单规避）
- ✅ **vitest 83 文件 / 727 通过 + 5 skipped 零失败**（含 2 次 SSE e2e 真实 LLM 执行，独立复跑）
- ✅ **production-check 7/8**——⚠️ 修正此前记录：Dependency Check 步在 Windows 下 `spawnSync npx` 超时（ETIMEDOUT）；底层 2 条 dep 违规（evaluation/lineageCompliance→ArtifactLineage、EvaluationEngine→EventTypes）为 **pre-existing**（两文件自 Wave 6b 后未改动，本会话零相关 import），非本会话引入
- ✅ 代码抽查（OrchestratorAgent/StepAgentExecutor/primitiveAgentTools/ServiceContainer/DAGRuntime/PiBridge/agent-spawner/yamlConfig）逻辑与注释一致；测试为真实断言（mock 原语入真实注册表、真实 DAGRuntime+TaskGraph、execute 断言完整参数）
- ✅ 工作树干净；SESSION_LOG 已同步（含本次 production-check 精度修正）

**结论**：会话 4 多 Agent 框架（P0+P1+P2）真实可用，门禁全绿（除上述 pre-existing dep 违规与环境性超时）。遗留方向不变：Session 化（跨会话讨论）为下一会话优先候选。

---

## ═════════ 会话 5：按建议顺序执行五项升级（2026-08-05，微信接入除外）═════════

调度器直接实施（fork 机制本会话不可用，三次 No result 后转为直接落地）。五项全部交付，每项独立门禁验证（tsc 0 / validate 100% / core vitest 全绿）。

### ① ✅ Session 化（多 Agent P1 跨会话讨论）— commit c4f28ac
- **AgentSessionStore**（新，execution/orchestration）：pi-agent-core `JsonlSessionRepo` 包装（create/open/list/fork + appendCustom），落盘 `data/sessions/agent-sessions/<component>/<ts>_<id>.jsonl`，component 分组（orchestrator/step-agent/executor）；fork 的 parentSessionPath = 会话树/跨会话引用原语
- **PiBridge**：createAgentHarness 支持注入持久化 session（AgentHarness 自动落盘对话/工具调用）；静态工厂 `createJsonlSessionRepo`；`pi-agent-core.d.ts` 补 JsonlSessionRepo 窄接口（该文件本就为"运行时导出缺类型声明"的补丁）
- **agent-spawner**：SpawnParams.session 透传
- **StepAgentExecutor**：sessionStore + stepOpts（session/sessionPath/upstreamSessions）；step 会话创建 + `step-result` 条目 + 上游会话引用进 prompt；result 携带 sessionId/path
- **OrchestratorAgent**：总大脑会话（`orchestration.analysis/audit/synthesis` 条目）+ stepSessions 追踪 + 依赖链 parentSessionPath；DAG 分支预建 step 会话经 ctx 传 nodeHandler
- **ServiceContainer**：共享 AgentSessionStore 接线（orchestrator + 两处 StepAgentExecutor）
- 测试 agent-session-store.test.ts 7 用例；门禁 core vitest 63 文件 575 通过

### ② ✅ 执行肢 Gate 凭证供给 — commit a1ebb6a
- **OrchestratorAgent.gateRunner**（ServiceContainer 注入）：run() 一次经 `runOntologyGroundedReasoning` 签发 `knowledgeContextPackage` 覆盖整个编排；失败/不可用 → null 不阻断（破坏性保持硬拦截，安全降级）
- **StepAgentExecutor**：stepOpts.gateContext → `createPrimitiveAgentTools({ gateContext })`；Options 兜底
- **primitiveAgentTools**：PrimitiveToolOptions.gateContext → 原语 execute context.gateContext（file write/shell build/api POST 凭有效凭证通过 gateDestructive）
- **ServiceContainer**：setOntology 保存 ontology/guard 引用（此前只透传 runtime）；gateRunner 实现（domain=departmentId）
- 测试 step-agent-gate.test.ts 4 用例；门禁 64 文件 579 通过

### ③ ✅ 规则 Phase 2 第二批 — commit 391c3f4
- **精确计费（L5）**：runOntologyGroundedReasoning 三处 onTokenUsage（Phase1/Phase2/语义判断）改 `countTokens`——真实 usage.total 优先，缺失回退估算；piBridge 返回类型加宽 usage
- **SchemaDetector**（ruleType='schema'）：RuleEntity.expectedSchema（JSON Schema 子集 type/required/properties/enum/items）+ validateAgainstSchema 纯函数；非 JSON/缺字段/类型错/枚举越界 → 结构性 ERROR；detectorRegistry 注册
- **结构修正管线②**：`StructuralCorrectionRegistry`（领域注入）+ `applyStructuralCorrection`（引擎统一入口，maxPasses 防抖，修正器异常不阻断，按 correctedCount 判定原地/新对象）；runOntologyGroundedReasoning 词法修正后挂载（修正→recheck→合规放行）；software eslint 适配器示例（Linter.verifyAndFix，no-var/prefer-const 规则 pending）+ bootstrap 接线
- **domain 传递补齐**：HierarchicalPlanner（context.departmentId）+ KnowledgeQueryPrimitive（departmentId 非 global 时）按域路由规则
- 测试 rule-phase2b.test.ts 13 用例；门禁 65 文件 592 通过

### ④ ✅ 上下文 Phase 2 — commit d9bcb1f
- **统一召回接口**：ContextArchive.loadMerged(eventStore, persistence, taskRef) → MergedTaskContext（archived 权威快照 + snapshots 装配快照 + summary.source 四态 both/event-store/persistence/none）；任一存储异常不阻断另一侧
- **ServiceContainer**：getContextPersistence() 惰性构造（共享 SqliteEventStore.getDatabase()，非 SQLite → null 退化）+ recallTaskContext(taskRef) 公开 API——**ContextPersistence 首次接线**（此前从未实例化，孤立组件）
- 测试 context-archive-recall.test.ts 6 用例；门禁 66 文件 598 通过

### ⑤ ✅ CostController 全链路计费 — commit 317081f
- **CostController**：recordTokens/getTokenUsage/getTotalCost（token 累计 + setTokenPrice 单价折算 + 时长成本合并）；init 监听 `execution.gate.token_usage` → global + gate:<domain> 自动分账；resetInstance 测试隔离
- **ServiceContainer**：orchestrator onTokenUsage → emit `execution.gate.token_usage`（编排 LLM 真实 usage.total 进入统一计费链，与 Gate 两阶段/规则重试/语义复核同账）
- 测试 cost-controller.test.ts 6 用例；门禁 67 文件 604 通过

### 当前状态（会话 5 末）
- **门禁**：tsc 0 ｜ validate-architecture 100% ｜ core vitest **67 文件 604 通过零失败**
- **提交区间**：`c4f28ac..317081f`（5 提交，Session 化→执行肢→规则→上下文→计费）
- **遗留（下一会话候选）**：
  1. ① 微信接入（企业微信 vs 个人微信未决策，用户本次跳过）
  2. 编排 Session 化的会话级 UI/治理面板（agent-sessions 目录已落盘，无读取端点）
  3. 结构修正器全量接入验证（software eslint 规则 pending；AST/tsc 适配器增强）
  4. ③ 上下文：近期摘要消费端拼接、Provider 归属标记到装配层、风险分级（均标记可延后）
  5. production-check 的 2 条 pre-existing dep 违规（evaluation/ 遗留）可清理

---

### ═══════ 会话 5 补：调度器独立复核 + 生产接线修复（2026-08-05，commit bed8e53）═══════

会话 5 五项交付后，调度器独立复核（不信任 fork 叙述，全部亲自验证）：
- ✅ **tsc 0** ｜ ✅ **validate-architecture 100%** ｜ ✅ **vitest 88 文件 / 763 通过 + 5 skipped 零失败**（独立重跑，含 studio 真实 LLM e2e）
- ✅ 逐项代码审查：① AgentSessionStore/PiBridge JsonlSessionRepo 注入（AgentHarness 自动落盘）② gateRunner 签名与 runOntologyGroundedReasoning 匹配、失败→null→破坏性保持硬拦截（安全边界正确）③ countTokens/SchemaDetector/StructuralCorrectionRegistry/software eslint 适配器/domain 传递 ④ loadMerged 四态 ⑤ CostController 事件链（MorPexRuntime 带 domain、orchestrator 归 global）
- ⚠️ **审查发现并修复 1 个生产断点**（commit bed8e53）：`UnifiedEventStore` 未暴露 `getDatabase` → `ServiceContainer.getContextPersistence()` 恒返 null → **④ 装配快照持久化在生产路径是死代码**（ContextPersistence 从未实例化成功）。修复：UnifiedEventStore.getDatabase() 委托内部 SqliteEventStore + recallTaskContext 前置 `await init()`（惰性 init 兼容）+ 端到端测试（UnifiedEventStore→getDatabase→ContextPersistence save/loadByTaskRef 同一连接，7/7）。门禁复跑全绿（88 文件 764 通过）。
- ✅ 无测试污染、工作树干净

**遗留（不变）**：微信接入（用户跳过）；编排 Session 化治理 UI/读取端点（agent-sessions 已落盘无消费端）；结构修正器全量验证（eslint 规则 pending）；上下文近期摘要消费端/Provider 归属标记/风险分级；production-check 2 条 pre-existing dep 违规。

---

### ═══════ 会话 5 补：调度器实核确认（2026-08-05）═══════

调度器（本会话）实际独立复核五项交付（非仅依赖 fork 叙述），全部亲测通过：
- ✅ **tsc 0**（`npx tsc --noEmit -p tsconfig.json`）
- ✅ **validate-architecture 100%**（`node scripts/validate-architecture.js`）
- ✅ **vitest 88 文件 / 764 通过 + 5 skipped 零失败**（含 studio 真实 LLM e2e，独立重跑）
- ✅ **① JsonlSessionRepo 运行时存在性 + 落盘往返实测**（create→appendCustom→appendMessage→open→磁盘 3 行 JSONL，probe 通过）
- ✅ **② 安全边界实测确认**：gateContext 仅经 `requireKnowledgeContext` 强校验（queryCallCount≥1 + referenceCheck.valid）放行；签发失败→null→`gateDestructive` 抛 GateContextRequiredError 硬拦（无新绕过）
- ✅ **③ 规则 P2**：'eslint' ruleType 无检测器时 RuleEnforcementGuard 安全跳过（warn 不炸）；SchemaDetector/structuralCorrection/domain 传递逐行核对
- ✅ **④ production 接线修复属实**（bed8e53：UnifiedEventStore.getDatabase 委托 + recall 前置 init）
- ✅ **⑤ CostController** 事件链（execution.gate.token_usage → global + gate:<domain> 分账）核对
- ✅ 工作树干净、零测试污染（data/ 已 gitignore）；SESSION_LOG 记录与实测数字完全一致

**结论**：五项升级（Session 化 / 执行肢 Gate 凭证 / 规则 P2 第二批 / 上下文 P2 / CostController 计费）真实交付且门禁全绿，可交接。遗留方向不变。

---

## ═════════ 会话 6：四任务续执行（2026-08-05，微信接入除外）═════════

调度器直接实施（fork 无结果，任务转回主线程）。提交区间 `b1d13da..64f0065`（5 提交，+2 测试文件）。

### ② ✅ Session 化治理读取端点（feat bc9a1c0）
- `AgentSessionStore.readEntries(path)`：repo.open + session.getEntries → 归一化纯对象（message→role/content 文本、custom→customType/data、custom_message/thinking_level_change/model_change/... 按类型提取）；失败返回 [] 不抛
- `StudioServer`：`GET /api/agent-sessions`（?component=orchestrator|step-agent|executor 过滤，非法 400）+ `GET /api/agent-sessions/entries?path=`（缺 path 400，不存在路径 → ok+[] 容错）
- 测试：agent-session-store +2（归一化/容错）、新 agent-session-api.test.ts 6 用例（真实 JsonlSessionRepo 临时目录，仅 HTTP 读取层不触发 LLM）

### ⑤ ✅ dep 违规清理（fix b1d13da + 64f0065）
- **根因**：`.dependency-cruiser.js` `eval-ontology-allowed` 白名单是重构前旧目录（ontology//metadata//protocol/ 在 8 层布局不存在）→ 2 条假违规（evaluation→knowledge/artifact、evaluation→infrastructure/protocol/events）
- 修复：白名单对齐 8 层意图（evaluation 读 L2 knowledge 合规评分 + infrastructure/protocol 发审计事件）→ **depcheck 2→0 violations**
- 连带：production-check Dependency Check 步 Windows 下 120s execSync 超时（npx depcheck 全量巡航 601 模块）→ 240s → **production-check 8/8 全绿（本环境首次）**

### ③ ✅ 结构修正器全量验证（test 617620f）
- 新 rule-structural-e2e.test.ts 4 用例（无 LLM）：①真实 ruleEnforcementCheck 闭环（命中→修正→重检无 ERROR）②真实 software eslint 适配器全链路（registerSoftwareStructuralCorrector + DetectorRegistry eslint 检测器 + active no-var → Linter.verifyAndFix → `var x`→`let x` → 重检合规）③eslint 无违规不触碰 ④maxPasses 防抖（sticky corrector 2 轮停止）
- **实测发现**：no-var 的 eslint 正确输出是 `let` 而非 `const`（const 推断属 prefer-const 另一条规则）——修正器行为正确，断言按 eslint 语义修正
- 测试还暴露：ruleEnforcementCheck 先规范化（NFKC+去空白），`var x`→`varx`，regex 模式须匹配规范化后文本（`var\w*` 而非 `var\s+\w+`）

### ④ ✅ 上下文 Provider 归属标记（feat 23ca140）
- `ContextFragment.attribution?: { providerType: 'registered'|'fallback' }`（可选，向后兼容）
- `ExecutionContext.providerAttribution?: Array<{ source, providerType, collectedAt }>`（装配层汇总）
- assemble()：兜底来源（missingFragments）→ fallback，其余 → registered；随快照持久化
- 测试 +2（全 registered / 缺失来源 fallback 区分）

### 门禁（本会话全量实测）
- ✅ tsc 0 ｜ ✅ validate-architecture 100% ｜ ✅ depcheck **0 violations** ｜ ✅ vitest **90 文件 / 778 通过 + 5 skipped 零失败**（含 studio 真实 LLM e2e）｜ ✅ **production-check 8/8**
- ⚠️ e2e 污染复现并清理：全量 vitest 真实 LLM e2e 的 step-agent 工具在仓库根写 hello.py/hello_run.js（已删，tree clean）

### 遗留（下一会话候选）
1. **微信接入**（企业微信 vs 个人微信，用户跳过待决策）
2. agent-sessions 治理前端/面板消费端点（读取 API 已就绪，UI 未做）
3. 上下文近期摘要消费端拼接、风险分级（标记可延后）
4. 结构修正器 AST/tsc 适配器增强（eslint 已验，tsc 型校验未接）

---

### ═══════ 会话 6 补：调度器实核确认（2026-08-05）═══════

调度器（本会话）对会话 6 四任务独立复核（非依赖实施叙述，全部亲测）：
- ✅ **tsc 0** ｜ ✅ **validate-architecture 100%** ｜ ✅ **depcheck 0 violations**（`npx dependency-cruiser` 独立跑，601 模块 1183 依赖，2→0）｜ ✅ **production-check 8/8**（Dependency Check 首次通过：dep 违规清零 + execSync 超时 120s→240s 均亲测）
- ✅ **vitest 90 文件 / 778 通过 + 5 skipped 零失败**（含 studio 真实 LLM e2e，独立重跑 290s）
- ✅ 逐项代码审查：② readEntries 归一化（message/custom/custom_message/...各类型）+ StudioServer 两路由（component 校验 400、path 校验 400、失败→ok+[] 容错）+ HTTP 层测试不触发 LLM ③ rule-structural-e2e 4 用例（真实 ruleEnforcementCheck + 真实 eslint Linter.verifyAndFix 全链路 + maxPasses 防抖，无 LLM；`var x`→`let x` 符合 eslint no-var 语义）④ ContextFragment.attribution + providerAttribution 汇总（registered/fallback 可区分，向后兼容可选字段）
- ✅ ⑤ 属"对齐旧规则意图"非规避：规则注释 + 架构文档（evaluation 读 L2 knowledge 合规评分 + 发标准审计事件）双重印证
- ✅ 工作树干净、e2e 污染已清（hello.py/hello_run.js 删除）；SESSION_LOG 记录与实测数字完全一致
- ⚠️ 叙述勘误：会话 6 正文"fork 无结果，任务转回主线程"不实——实施 fork 实际返回结果并完成了全部提交；本文档以调度器独立复核为准

**结论**：四任务（Session 治理端点 / dep 清理 / 结构修正验证 / Provider 归属）真实交付，门禁全绿（production-check 首次 8/8），可交接。遗留不变：微信接入（待决策）、Session 治理前端 UI、上下文近期摘要/风险分级（可延后）、AST/tsc 结构修正适配器。

---

## ═════════ 会话 7：上下文遗留项③ 近期摘要消费端拼接 + 风险分级（2026-08-05）═════════

### 交付内容（commit 31135d6 + 3cb6741）
1. **近期摘要消费端拼接**（功能③ 设计哲学闭环：工作上下文 = 系统约束 + Goal/Plan/Task + ontologyRefs + ≤N 条近期摘要）
   - `ContextPersistence.loadRecent(limit)`：装配快照跨任务按 assembled_at 倒序取最近 N 条
   - `ContextAssemblyEngine`：config 增 `recentSummaryReader?`/`recentSummaryLimit?`（默认 5）/`riskGrader?`；assemble() 聚焦模式下召回 ≤N 条归档摘要 → `context.recentSummaries` + 追加【近期任务摘要】节到 focusedSummary（reader 异常/空 → 不阻断）
   - bootstrap 生产接线：双源 reader（① ContextPersistence 装配快照 ② EventStore 权威快照 goal+result+score 合成摘要；taskRef 去重 EventStore 优先；任一源异常兜底）；`setRecentSummaryReader`/`setRiskGrader` setter 时序安全
2. **风险分级**：`defaultRiskGrader` 确定性关键词分级（high=破坏性 delete/drop/wipe…、medium=副作用 write/deploy/commit…、low=只读默认，零 LLM）+ `context.riskLevel` 写入 + 自定义覆写

### ⚠️ 调度器复核发现并修复 1 个生产接线断点（commit 3cb6741）
- **根因**：bootstrap 构造引擎传 6 参（**不传 persistence**）→ `assemble()` 的 `this.persistence` 恒空 → **ContextPersistence（装配快照，与 reader 源①同库）在生产路径从未落库** → 双源召回退化为单源（EventStore）；且 `hydrate` 不还原 focusedSummary → reader 源①即使有数据也拿不到摘要文本
- **修复**：①`setPersistenceProvider` 惰性 provider（bootstrap 注入 `() => container.getContextPersistence()`，assemble 运行时才解析，EventStore 初始化时序无关）②`focusedSummary/riskLevel/recentSummaries` 经 base_data `__` 保留键持久化 + hydrate 还原（免表结构迁移，旧行向后兼容）③+2 新用例（provider 落库回读含 taskRef/focusedSummary；null 不阻断）
- 修复后：装配快照真实落库 → reader 源①有真实 focusedSummary → **双源召回闭环成立**

### 门禁（全部亲测）
- ✅ tsc 0 ｜ ✅ validate-architecture 100% ｜ ✅ depcheck 0 violations（601 模块 1185 依赖）｜ ✅ 全量 vitest **90 文件 / 790 通过 + 5 skipped 零失败**（core 68 文件 625）｜ ✅ 工作树干净、无 e2e 污染

### 遗留（下一会话候选）
1. **微信接入**（企业微信 vs 个人微信待决策，用户跳过）
2. **Session 治理前端/UI**（agent-sessions 读取 API 已就绪，UI 未做）
3. **结构修正器 AST/tsc 适配器增强**（eslint 已验，tsc 型校验未接）
4. 中文关键词风险分级（defaultRiskGrader 当前英文-only，中文 goal 落 low）

---

## ═════════ 会话 8：结构修正 AST/tsc 适配器（2026-08-05，commit 06f836c）═════════

### 交付内容（功能② Phase 2 第二批增强——eslint 之后补 AST + tsc 两级）
1. **ast-utils.ts**（新，workflows/software/src/rules）——TypeScript Compiler API 工具：
   - `typeCheck`：内存内 TS Program 类型检查（自定义 CompilerHost 虚拟文件 + typescript 自带 lib.d.ts，零磁盘写入，自包含单文件；>100KB 跳过不误报）
   - `findVarDeclarations`：AST 识别 var（`variable`/`var2` 标识符零误报）
   - `findEvalCalls`：裸 eval()/Function()/new Function() 调用（`foo.eval()`/`obj.Function()` 成员访问零误报 = "区分声明/调用/成员访问"）
   - `fixVarToLetConst`：AST 变换 var→const/let（**const 推断**：有初始化且未重赋值→const，否则→let——优于 eslint no-var 恒转 let；覆盖 VariableStatement + For 初始化）
2. **structural-ast-tsc.ts**（新）——三个组件 + 注册：
   - `ASTDetector`（ruleType='ast'）：规则 no-var-ast / no-eval-call（AST 级，无文本误报）
   - `TscTypeCheckDetector`（ruleType='tsc'）：规则 tsc-type-check——生成代码须通过内存内 tsc 类型校验（语法+语义诊断清零）
   - `TscStructuralCorrector`（type='tsc'）：canHandle tsc 规则 + no-var-ast；机械修 var→const/let，不可修的类型错误以 note 报告（信息经违规 matchedText 传给 LLM 重试路径）
3. **bootstrap** 接线（3 规则默认 pending 待人工确认）+ **13 新用例**（全程无 LLM，纯确定性）

### 关键设计决策
- canHandle 覆盖 no-var-ast：var 不是类型错误（tsc 接受 var），但 AST 检测命中 var 后需修正器机械修——故 tsc 修正器同时处理 'tsc' 与 'no-var-ast' 规则；'no-eval-call' 无机械修法（移除 eval 不安全）→ 不匹配 → 升级 LLM 重试，不静默放行（已测）
- correctedCount=0 时 core 的 applyStructuralCorrection 不收集修正器 note（信息经违规 matchedText 承载，测试已按此契约断言）
- TS 版本坑：`ts.factory.updateVariableDeclarationList` 只保留原 flags，改 let/const 需 `createVariableDeclarationList(decls, newFlags)`；transformer 返回类型需显式断言 SourceFile

### 门禁（全部亲测）
- ✅ tsc 0 ｜ ✅ validate-architecture 100% ｜ ✅ depcheck 0 violations（604 模块 1191 依赖）｜ ✅ 全量 vitest **91 文件 / 803 通过 + 5 skipped 零失败** ｜ ✅ 工作树干净、无 e2e 污染

### 遗留（下一会话候选）
1. **微信接入**（企业微信 vs 个人微信待决策，用户跳过）
2. **Session 治理前端/UI**（agent-sessions 读取 API 已就绪，UI 未做）
3. **中文关键词风险分级增强**（defaultRiskGrader 英文-only，中文 goal 落 low）
4. AST/tsc 修正器增强：`var x: number = "str"` 类类型错误当前不可机械修（依赖 LLM 重试）；完整 AST 重写（import 补全/类型推断）为后续

---

## ═════════ 会话 9：100 任务全量实测（2026-08-05，GLM-4.7-Flash）═════════

### 运行配置
- **LLM**：`config/morpex.yaml` → `enabled: true` + `provider: zhipu-glm` + `model: glm-4.7-flash`（原配置）
- **apiKey**：`${GLM_API_KEY}` 经 Windows 用户级环境变量解析（49 字符，f53c2bbb…，yamlConfig User 级兜底）
- **⚠️ 关键澄清**：`DEFAULT_MODEL='deepseek/deepseek-v4-flash'` 只是**回退默认**；构造器在 `llm.enabled=true` 时走网关分支（`zhipu-glm/glm-4.7-flash`），日志 `[PiBridge] ✅ 自定义 LLM 网关已配置: https://open.bigmodel.cn/api/paas/v4 (zhipu-glm/glm-4.7-flash)` 反复出现 = **确认用 GLM，非 deepseek**
- **冒烟验证**：raw HTTP `glm-4.7-flash` 200 + PiBridge.generateText 正常返回（"你好，请问有什么我可以帮您的？" usage 383）；**GLM 思考模式默认开启**（reasoning_content），小 max_tokens 会被思考吃满 → 不设限（走 model 默认 128K）
- 命令：`npx tsx scripts/batch-run.ts --timeout 300000 --retries 3 --delay 2000`（5 并发）
- 日志：`data/batch-runs/run-100-glm-20260805-044513.log`；报告：`data/trace-reports/task-001..099.md`

### 结果（99 任务，batch-tasks 实际导出 99）
**成功 77/99（77.8%）｜ 失败 22 ｜ 限流 0 ｜ 总耗时 1501s（25 分钟）｜ 平均 1956 函数调用/任务 ｜ 自动审批 0**

早段任务 2-8s 秒成功；后段 40-50s 且失败增多（知识库随 99 Mission 增长，Gate 查询变慢）。

### 失败根因（22）
1. **step-agent 工具调用参数为空（19/22，主因）**：KnowledgeQueryPrimitive query 空 9× / APICallPrimitive url 空 6× / ShellExecutionPrimitive command 空 4× → step-agent 返回空内容 → 降级 fallback。
   - **探针证明 GLM 原始 tool_calls 参数完整**（`tool_calls:[{function:{arguments:"{\"query\":\"...\"}",name:"knowledge"}}]`）→ 是 **pi-agent-core ↔ GLM（思考模式）tool_call arguments 解析的集成问题**（间歇性），非 GLM 模型本身
   - 与 session-4 f20fff3（AgentTool.execute 单参调用）**同族不同层**：这次在 pi-agent-core 解析 GLM tool_calls arguments 环节
2. **3 次 300s 超时**（任务 26/57/93）——GLM 思考模式超长响应/无响应
3. **xjmcu astrocli 连 MCU 硬件失败**（`RuntimeError: 未找到设备 VID=8235, PID=584B`）——测试环境无设备，预期场景

### 其他发现
- `ruleType='eslint' 检测器未注册，规则 no-var 跳过`——eslint 规则激活但**无检测器**（session-8 已有 AST 检测器 no-var-ast，eslint 规则冗余/需补 Detector 或移除）
- `无法解析查询计划 JSON，执行默认安全查询`——GLM 思考模式影响 Gate 查询计划 JSON 提取（有兜底，但查询针对性下降）
- **工作树污染**：step-agent 文件工具写到 CWD=仓库根（`开发设计规划/XC8P9530_main.c`，xjmcu 产物）——**Gate 凭证解锁破坏性操作后需工作目录治理（sandbox）**，已 git clean 清理
- 任务集实际 99（batch-tasks.ts 99 条，非声明 100）
- 平均 1956 函数调用/任务 = TraceRecorder 全量包装计数（含低层调用），指标口径偏大

### 遗留事项（下一会话候选，按优先级）
1. **【P0】pi-agent-core ↔ GLM 工具调用参数解析**：思考模式下 tool_call arguments 间歇性丢失（19/99 失败主因）。深挖 pi-agent-core 对 GLM reasoning_content + tool_calls 的解析；可能需关思考模式（thinking disabled）或升级/打补丁 pi-agent-core
2. **【P1】step-agent 工作目录治理**：文件工具写 CWD=仓库根 → 注入 sandbox 工作目录（如 data/agent-workspace/<sessionId>/），防污染 + 隔离
3. **【P1】GLM 思考模式响应治理**：Gate 查询计划 JSON 提取失败（有兜底但降低质量）+ 300s 超时 3 次 → 思考 token 预算/超时控制
4. **【P2】eslint 规则清理**：no-var/prefer-const/no-unused-vars（ruleType='eslint'）激活后无检测器被跳过——补 eslint Detector 或移除（AST 检测器 no-var-ast 已覆盖 no-var）
5. **【P2】xjmcu 硬件依赖**：astrocli 需真实 MCU——batch 需排除硬件任务或标记 expected-fail
6. **【P2】config**：`enabled: true` 已提交（用户启用 GLM）；CI/测试默认仍建议 false（deepseek 稳定）——测试前注意切换

### 门禁（批量前已全绿；批量后工作树仅 config 变更 + 已清理污染）
✅ tsc 0 ｜ ✅ validate-architecture 100% ｜ ✅ depcheck 0 ｜ ✅ vitest 91 文件 803 通过（批量前基线）

---

## ═════════ 会话 10：GLM-only 切换 + 遗留 P0/P1 修复（2026-08-05）═════════

### 用户决策：**直接删除 deepseek，只使用 glm-4.7-flash**（不能关思考模式）
提交区间：`7860533`（feat）+ `5ac912c`（test）+ `b0c6bb6`（chore）

### ① 移除 deepseek（全部代码路径 → GLM）
- `PiBridge.DEFAULT_MODEL`：`deepseek/deepseek-v4-flash` → `zhipu-glm/glm-4.7-flash`（构造器 + parseModel fallback）
- `MorPexConfig` zod 默认 modelProvider/modelId + fsm → `zhipu-glm`/`glm-4.7-flash`
- `model-registry.getDefaultModel` + providers fallback、`model-resolver` fallbacks → GLM
- `PiModelRegistry`（workflow-sdk）：默认 GLM + 直接 HTTP 回退改 bigmodel 端点（glm-4.7-flash）
- shell 脚本（run-all.sh / start-cognee.sh）：LLM 默认 → GLM 端点；check-llm 去 Grok2API g2a_ 警告
- 注释/测试断言全部更新（pi-bridge-yaml 默认模型断言改 GLM）；仅保留"会话 10 移除"标记 + 历史预算注释

### ② P0 修复（99 任务实测 19/22 失败根因）
1. **maxTokens 2000/3000 上限 → 32000**（PiBridge 一致）：GLM 思考模式把 2000 吃满 → content 空 → 参数补全/提取返回空 → 原语缺参失败。修：`piBridgeWrapper.generateText`、workflow-sdk bootstrap、PiModelRegistry HTTP、bootstrapFromDocs
2. **param-completer 鲁棒 JSON 提取**：剥 ```json 代码块 + 平衡括号 + 修复转义/尾逗号；不再因 GLM 思考模式输出格式失败
3. **RateLimitError 限流检测**：pi-ai openai-completions 不查 response.ok——GLM HTTP 429（1302/1305）静默返回空结果（text='' usage=0）→ 全链路静默失败。修：generateText 经 onResponse 回调检测 429/5xx → 抛 RateLimitError（batch-run 已按 429/5xx 重试，core 现在也显式感知）
4. **工具必填参数校验**（primitiveAgentTools）：按 inputSchema.required 校验，空参不传原语 → 返回精确重新调用指引（self-healing）
5. **step-agent 空内容纠正重试**：GLM 思考模式工具错误后只出 reasoning_content、content 空 → extractText 判空 → 之前直接降级；现带纠正指令重试（默认 1 次）再降级

### 实测（全量 core vitest 70 文件 / 635 通过）
- ✅ tsc 0 ｜ ✅ validate-architecture 100% ｜ ✅ depcheck 0 violations（606 模块）｜ ✅ core vitest **70 文件 / 635 通过零失败**（含 full-closed-loop 3 场景）
- ⚠️ full-closed-loop 在 GLM 限流高峰期单跑会 flaky（全量套件内通过；单独跑在配额耗尽后触发 429）——GLM 账户速率限制特性，非代码 bug；RateLimitError 检测已让失败显式可重试
- ⚠️ GLM 思考模式慢（单场景 167s，此前 deepseek 校准 180s 预算 → 场景1 已改 300s）

### 遗留（下一会话候选）
1. **GLM 限流治理**：429/1305 目前靠 batch-run 退避重试；core 内 generateText 抛 RateLimitError 后，调用方（param-completer/Gate/orchestrator）尚未统一接入退避重试——需在 onTokenUsage/调用点统一 retry-with-backoff
2. **full-closed-loop GLM 限流 flaky**：建议测试内加 RateLimitError 重试或标记 skip-if-rate-limited
3. **P1 step-agent 工作目录治理**：文件工具写 CWD=仓库根（实测 `开发设计规划/XC8P9530_main.c`）→ sandbox 工作目录
4. **eslint 规则清理**：no-var 等 ruleType='eslint' 激活后无检测器被跳过（AST 检测器 no-var-ast 已覆盖 no-var）
5. **xjmcu 硬件依赖**：astrocli 需真实 MCU——batch 排除/标记
6. **微信接入**（企业微信 vs 个人微信待决策）

---

## ═════════ 会话 11：改用 opencode/deepseek-v4-flash-free + 模型配置抽离到 config.yaml（2026-08-05）═════════

### 用户决策：不用 glm-4.7-flash，改用 model 中的 `deepseek-v4-flash-free[opencode]`，抽离文件硬编码模型，全部用 config.yaml 配置

### 交付（commit `4f482ff`，13 文件 +142/-81）
1. **config 新增 `llm.mode`**：`builtin`（pi-ai 内置 provider，如 opencode）/ `gateway`（自定义 OpenAI 兼容网关）
   - config/morpex.yaml：`mode: builtin` + `provider: opencode` + `model: deepseek-v4-flash-free` + `apiKey: ${OPENCODE_API_KEY}`
   - opencode provider：`https://opencode.ai/zen/v1`，contextWindow 200K / maxTokens 128K / reasoning
   - OPENCODE_API_KEY 在 Windows 用户级环境变量（sk-iEY2x63S...，67 字符）
2. **PiBridge 构造器按 mode 分流**：
   - `builtin` → gateway=null 走 pi-ai builtinModels；config apiKey 注入 `process.env.<PROVIDER>_API_KEY`（内置 provider 的 envApiKeyAuth 只读 process.env）
   - `gateway` → initGateway 自定义网关（保留旧能力）
   - `DEFAULT_MODEL` → `opencode/deepseek-v4-flash-free`（仅 config 缺失时兜底）
3. **抽离硬编码模型（config 为唯一来源）**：新增 `resolveDefaultModel()` helper（读 config → `${provider}/${model}`，缺失兜底 DEFAULT_MODEL）
   - model-registry / model-resolver / MorPexConfig(zod) / PiModelRegistry / thinking-level 全部改为 config 驱动
   - **零残留 glm/zhipu 硬编码**（grep 确认仅注释/历史）
4. **check-llm 按 mode 区分验证**：builtin → pi-ai 注册表查模型；gateway → HTTP /models
5. 测试断言更新（pi-bridge-yaml 默认模型 → opencode/deepseek-v4-flash-free）

### 实测
- ✅ check-llm：`内置 provider "opencode" 模型 "deepseek-v4-flash-free": ✅ 在注册表`，apiKey 解析（sk-iEY2x...）
- ✅ 直接 complete 5.8s 返回（thinking 模式）
- ✅ **门禁全绿**：tsc 0 ｜ validate-architecture 100% ｜ depcheck 0（606 模块）｜ core vitest **70 文件 / 635 通过零失败**（含 full-closed-loop 3 场景 opencode 真实 LLM 跑通，**无限流、比 GLM 稳定**）

### 遗留（下一会话候选）
1. **GLM 限流治理**（会话 10 遗留）：core 抛 RateLimitError 后调用方尚未统一接入退避重试（当前换 opencode 已规避 GLM 限流；若回 gateway 模式仍需）
2. **step-agent 工作目录治理**（sandbox，防写仓库根）
3. **eslint 规则清理**（no-var 等 ruleType='eslint' 激活后无检测器被跳过）
4. **xjmcu 硬件依赖**（astrocli 需真实 MCU，batch 排除/标记）
5. **微信接入**（企业微信 vs 个人微信待决策）
6. **config 迁移说明**：`llm.mode` 语义已扩展——老 config（仅 enabled/provider/baseUrl/apiKey/model，无 mode）默认按 builtin 处理（provider 需是 pi-ai 内置 provider）；如需自定义网关须显式 `mode: gateway`
