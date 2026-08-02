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

**✅ Phase 2 第一批已实现（2026-08-03）**：C 检测器扩展（Detector 接口正式化 + ApiWhitelistDetector 白名单前缀，MCU `IOCP_` 场景钥匙）/ A 词法修正保守版（lexicalCorrection，allowedAction 可选微优化，安全兑底）/ D 缓存一致性（RuleRegistry.fingerprint 并入 groundingCache key，规则变更天然失效）。xjmcu 插件示例 `platform-rule.ts`（白名单规则 pending）。门禁 tsc 0 / validate 100% / vitest 66 文件 634 通过（零回归）。reviewer 终审有条件通过（无必须修；3 建议项入后续：白名单注释误判→结构层 AST 解决、前缀粒度粗、fingerprint 补 aliases/severity）。**Phase 2 剩余（第二批）：结构层 tsc/eslint 适配器 + L5 预算接线 + domain 上下文传递**。

**✅ Phase 2 第一批已实现并验证（2026-08-03，commit f09fb3c + 12b32a4）**：
- ① **Detector 接口正式化**（`gate/rules/detectors.ts`）：RuleDetector 契约 + detectorRegistry 按 ruleType 分派；RegexDetector 迁移（零回归）+ **ApiWhitelistDetector**（厂商风格 API token 前缀白名单，MCU IOCP vs STM32 HAL/LL 场景）；RuleType 扩 'whitelist'、RuleEntity.allowedApiPrefixes、disallowedPattern 改可选
- ② **词法修正**（`gate/rules/lexicalCorrection.ts`，修正管线①保守版）：allowedAction 机械替换，定位不到/异常兜底；runOntologyGroundedReasoning 在重试前先词法修正 → 重新 check → 合规放行
- ③ **缓存一致性**：`RuleRegistry.fingerprint()` 并入 groundingCache key —— 规则变更 → 指纹变 → 旧缓存天然失效
- 领域示例：xjmcu 平台 API 白名单规则（pending 待确认）+ bootstrap 接线
- 门禁：tsc 0 / validate 100% / vitest 66 文件 634 通过 + 5 skipped（规则测试 6 文件 45 用例全绿）
- 剩余：修正管线②结构层（tsc/eslint 适配器）、schema/AST 检测器、L5 预算接线、domain 上下文传递 → 第二批

### ③ 升级上下文管理 —— L2/L4 组装
- `ContextAssemblyEngine` 已存在（Builder/Enricher/FragmentRegistry/Versioner），是"升级"非"新建"
- **待决策**："优化"具体指体积/token 预算控制、相关性排序、风险分级组装、还是部门隔离强化？

**优先级建议**：③ 上下文（基础）→ ② 规则中断（核心价值）→ ① 微信（独立通道）

---

## 当前状态

- **仓库**：单一 8 层纯净架构；696 tracked / 306 core 源文件；与 origin/master 同步
- **门禁**：tsc 0 ｜ validate-architecture 100% ｜ vitest 64 文件/616 通过+5 skipped ｜ production runner 19/19
- **功能② Phase 1 已交付**（commits 2d69672/2f76fc9/726a42e/33b6fbf/3888b7a）：gate/rules 7 文件 + runOntologyGroundedReasoning 挂载（中断/重试≤3/连续命中降级/domain 路由）+ objectTypes Rule 类型 + ecommerce 示例（pending）+ 4 测试文件 27 用例；reviewer 终审通过（2 个建议项入 Phase 2：WARNING 事件去重、ReDoS 限制）
- **持续项**（非紧急）：覆盖率 37% 提升；L6 未来功能（人工覆盖评分/Performance Profile）；bootstrap-unified.ts 拆分；真实 token 成本计费未接入

## 当前开放决策（会话 2 待定）

1. ② 规则来源：人工 tier-0 vs 演化 tier-2 → **已定**（反馈提炼+确认，演化延后）
2. ② 检测机制：是否接受确定性规则匹配器 → **已定**（确定性优先+语义兜底）
3. ① 微信类型：企业微信 vs 个人微信（未讨论）
4. ③ 上下文"优化"的具体方向（未讨论）
5. ✅ ② Phase 1 实现已确认开工并完成（2026-08-03，验收全绿）
   - **Phase 2 待办**（方案文档 §7）：确定性替换 allowedAction / 缓存规则版本入 key / L5 预算接线（重试计入 costTokens）/ 代码层 Detector 适配器（tsc/eslint）/ domain 上下文沿调用链传递 / ReDoS 限制 / WARNING 事件去重
