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

### ② 升级记忆系统（规则中断更正）—— ⭐ L3 Gate 扩展（关键认知：这本质是"规则执行器"非记忆系统）
- 架构映射：规则文档 = L2 知识权威（tier-0/1）；中断器 = L3 新组件 `RuleEnforcementGuard`（挂 runOntologyGroundedReasoning Phase 2 后）；修正 = 携带规则约束重试（受 L5 预算保护）
- 检测机制：**确定性规则匹配器**（规则条目 `{condition, disallowedPattern, allowedAction}`，正则/语法匹配 LLM 输出，命中→中断）——非 LLM 自检（弱）
- **待决策**：① 规则来源（人工 tier-0 vs 演化 tier-2）② 是否接受确定性匹配器 ③ 修正策略（先确定性替换、失败再重试，受预算限制）
- 风险：误报卡死（需规则优先级/降级）

### ③ 升级上下文管理 —— L2/L4 组装
- `ContextAssemblyEngine` 已存在（Builder/Enricher/FragmentRegistry/Versioner），是"升级"非"新建"
- **待决策**："优化"具体指体积/token 预算控制、相关性排序、风险分级组装、还是部门隔离强化？

**优先级建议**：③ 上下文（基础）→ ② 规则中断（核心价值）→ ① 微信（独立通道）

---

## 当前状态

- **仓库**：单一 8 层纯净架构；696 tracked / 306 core 源文件；与 origin/master 同步
- **门禁**：tsc 0 ｜ validate-architecture 100% ｜ vitest 60 文件/589 通过 ｜ production runner 19/19
- **持续项**（非紧急）：覆盖率 37% 提升；L6 未来功能（人工覆盖评分/Performance Profile）；bootstrap-unified.ts 拆分；真实 token 成本计费未接入

## 当前开放决策（会话 2 待定）

1. ② 规则来源：人工 tier-0 vs 演化 tier-2
2. ② 检测机制：是否接受确定性规则匹配器
3. ① 微信类型：企业微信 vs 个人微信
4. ③ 上下文"优化"的具体方向
