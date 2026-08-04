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
- **门禁**：tsc 0 ｜ validate-architecture 100% ｜ vitest **83 文件/727 通过+5 skipped（零失败）** ｜ production-check 8/8 ｜ verify-e2e 通过
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
- **门禁全绿**：tsc 0 ｜ validate-architecture 100% ｜ vitest **82 文件 723 通过 + 5 skipped（零失败）** ｜ production-check 8/8 ｜ verify-e2e 通过
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
