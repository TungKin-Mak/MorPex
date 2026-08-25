# 12-Factor Agent 升级改造方案（目标 - 约束 - 审计实证版）

> 状态：方案 v2（基于纯代码实证审计修订，取代此前基于文档转述的 v1 判断）
> 参照系：humanlayer/12-factor-agents · 审计方式：三路并行代码级取证，全部结论带 file:line 锚点
> 范围：仅覆盖执行链与会话系统；不含桌面打包（已完成）与记忆系统（T5-T7 已完成）

---

## 一、目标

**总目标**：让 MorPex 的执行链符合 12-Factor Agent 的可靠性精神——状态可恢复、行为可预期、失败可消化、人类可随时介入——同时保持一人可维护的复杂度上限。

分解为五个可验收子目标：

| # | 目标 | 对应 Factor | 验收标准 |
|---|---|---|---|
| G1 | 意图分流全面 LLM 化 | F1 | IntentClassifier 无正则优先路径；LLM 失败时启发式仅作降级兜底并打日志 |
| G2 | 错误信息结构化压缩进上下文 | F9 | 喂给 LLM 的错误统一为 `{失败了什么/为什么/试过什么/建议下一步}`；结果注入一律经截断助手 |
| G3 | 运行主动可控 | F6 | 提供 `pause/resume/cancel` API；任务跑偏可踩刹车而非杀进程 |
| G4 | 任务运行态事件溯源 | F5 补完 | DAG 步骤状态变迁全部落事件源；进程任意时刻崩溃 → 从步骤边界续跑，不整体重来 |
| G5（可选） | Prompt 资产化 + 多入口触发 | F2+F11 | Prompt 抽到独立文件调优不改代码；提供带鉴权的 webhook 触发入口 |

## 二、约束

### 架构铁律（违反即失败）
1. **EventBus Only**：模块间通信只走事件总线
2. **PiBridge 隔离**：`@earendil-works/*` 仅可在 PiBridge 内 import
3. **真相源优先**：有状态实体必须有持久化真相源；禁止内存裸奔（本方案 G4 的立论基础）
4. **禁裸 any / 禁吞异常**

### 用户拍板的原则
5. **触发判断全 LLM 化**：禁止信号词/正则做触发机制（易纰漏）；安全兜底层（宁可误杀的拦截类校验）不受此限但必须显式标注
6. **无状态的边界**：采纳"第 2 层"（编排调度事件溯源化）；**不做第 3 层**（每步独立进程的彻底无状态/多机分布式）——单机一人规模属过度设计

### 明确不做清单（避免重复建设）
| 不做项 | 理由 |
|---|---|
| 把 OrchestratorAgent 改造成大工具循环 agent | 现有"规划→确认→委派→审计"确定性骨架更稳更可调试，且正是 F10 推崇形态 |
| 自研上下文窗口管理 / 归约器 | pi harness 的 buildContext 已实现 F3/F12，重复建设零收益 |
| IM 渠道集成（微信等） | 用户已排除；webhook 入口已预留演进位 |

### 可复用的既有资产（本方案的立柱）
| 资产 | 用在哪 |
|---|---|
| PersistentMissionStore 事件源（missions.db） | G4 只需接入 step 级事件类型，不新建存储 |
| pi `AgentHarness.abort()` | G3 的刹车片现成 |
| PlanGateService pending-Promise 模式 | G3 的暂停等待机制样板 |
| StepAgentExecutor.previewText(2000) | G2 的截断助手现成，只差接线 |
| ontology/prompts/*.ts 独立文件先例 | G5 prompt 资产化的范式模板 |

## 三、审计结论（纯代码实证，2026-08）

### 评级总表

```
✅ 达标（6）：F3 上下文可控 · F4 结构化输出三层防线 · F7 触达人类三层
            · F8 控制流确定性（审计 JSON 解析失败即 throw/replan 有界）
            · F10 六类角色各司其职 · F12 pi 归约器原生成立
🟡 部分（5）：F1 正则优先 · F5 任务态三套并存 · F6 无主动刹车
            · F9 错误无压缩格式 · F2 prompt 散落 13+ 文件
❌ 缺失（1）：F11 触发入口仅 Studio UI 一个
```

### 关键证据锚点（决定评级的实锤）

| 结论 | 锚点 |
|---|---|
| DAG step 态纯内存，崩则丢 | `DAGRuntime.ts:276`（nodeResults 内存 Map）、`:153-172`（就地改 node.status） |
| checkpoint 三件套是休眠模块 | 全仓仅 index.ts 导出、零接线 |
| PersistentMissionStore 会静默降级 | `PersistentMissionStore.ts:24,30-32`（ready=false 后 append 转内存） |
| IntentClassifier 正则优先 | `IntentClassifier.ts` 四组正则（CHAT_HINT_RE 等），歧义才交 LLM |
| formatResults 无截断进 prompt | OrchestratorAgent formatResults（JSON.stringify 直拼）；previewText 助手存在但未接喂 LLM 路径 |
| 全仓无 pause/cancel 路由 | StudioServer 路由 grep 零命中；pi `abort()` 能力闲置（仅 StepAgentExecutor:470 内部用过） |
| 触发入口唯一 | 全仓触达 executeGoal 的产品级入口仅 `/api/chat/send`（StudioServer.ts:1050→1161） |
| ⚠️ custom_message 必进 LLM 上下文 | pi `session.js:69-77` 三分支——审批存根正在影响后续模型行为（待产品拍板：保留=AI 记得历史审批 / 改 custom=上下文干净） |

### 被推翻的文档期认知（教训记录）
1. ~~"单一 Transcript 是 F5 教科书实现"~~ → 只统一了聊天面，DAG step 态从未入账
2. ~~"IntentClassifier 已校准≈解决"~~ → 只是正则打补丁，机制未变
3. ~~"失败策略四项修复在主链"~~ → 在休眠的手册运行时里，主链是另一套逻辑
4. ~~"演化触发器可自动触发改进"~~ → 只发提案事件，非执行入口

## 四、实施方案（分阶段）

### U1：意图 LLM 化 + 错误压缩（F1+F9）｜半天
- IntentClassifier 重构：LLM 结构化输出为主路径，四组正则降为 LLM 失败时的降级兜底（触发日志）
- 新增统一错误压缩器 `{失败了什么/为什么/试过什么/建议下一步}`；formatResults/failuresText 全部改走它 + previewText 截断
- 验收：含中文的意图样本分类正确；长错误信息进 prompt 前被压缩截断（断言长度上界）
- 范围：IntentClassifier.ts、OrchestratorAgent.ts（formatResults 区域）、StepAgentExecutor.ts

### U2+U3 合并：事件溯源编排 + 运行控制（F5+F6）｜✅ 已完成
- DAGRuntime 步骤状态变迁追加事件到 PersistentMissionStore（新增 step.started/completed/failed/skipped/retry 事件类型）；调度器启动时重放事件恢复到断点边界
- 新增路由 `POST /api/runs/:missionId/pause|resume|cancel`：pause=停止调度新步骤（shouldPause 钩子每轮迭代检查，复用 PlanGate 等待模式语义）；cancel=控制钩子触发 pending 节点标 skipped（运行中节点不硬杀——一人规模步骤级粒度足够，注释说明）；resume 双语义：活跃循环解除暂停 / 冷恢复从事件源重建计划只重跑未完成步骤
- 顺带修复：PersistentMissionStore 静默降级改为显式告警（启动横幅+isReady 可查）+ **init 重放顺序 bug**（query DESC→时间正序，原最新状态被最旧事件覆盖）
- 验收：u23-run-control 3/3（pause 停住/resume 续跑、cancel 全 skipped 且重启不复活、冷恢复只重跑 b 且下游消费 a 的结果预览）+ dag-step-events 3/3；tsc 0 错
- 范围：DAGRuntime.ts、PersistentMissionStore.ts、StudioServer.ts、StepEventRecorder.ts、RunRegistry.ts（新）、RunRegistry 控制钩子接线 ServiceContainer.createRawDAGRuntime()
- 附带产品决策已拍板：审批存根（custom_message）保留进 LLM 上下文

### U4 可选：Prompt 资产化 + Webhook（F2+F11）｜✅ 已完成（Orchestrator 四件套 + ArtifactGenerationPrimitive 已资产化；webhook 带 secret 鉴权，未配置时 404 不暴露）
- 收编优先级：OrchestratorAgent 四件套 > ArtifactGenerationPrimitive（三元嵌套最严重）> 其余
- webhook：`POST /api/hooks/trigger`（secret 校验）→ executeGoal，最小实现
- 范围：config/prompts/（新）、13+ 处 prompt 定义点、StudioServer.ts

### 总量估算：U1 半天 · U2+U3 约 2-3 天 · U4 约 1 天

---

## 五、收尾缺口（已全部完成）

| 缺口 | 实现 | 结果 |
|---|---|---|
| F11 尾巴·定时触发 | schedule-manager.ts（自写简化 cron+JSON 真相源+分钟 tick）；/api/schedules CRUD；触发委派 chatSendHandler 全链路；宕机错过跳过不补跑 | 测试 7/7 |
| F5 尾巴·投影防抖窗口 | TaskStateProjector.setTruthSource/reconcileWithTruth：restore 后按 PersistentMissionStore 事件源校正并同步落盘（快照降级为即时兜底）；完结且无痕迹任务不凭空造条目 | 测试 4/4 |

**最终评级：11✅（F5/F6/F11 补完）· 1🟡（F2 其余内联 prompt 低优先打磨）· 0❌**

---

*本文档由三轮讨论收敛而成：v1 文档转述审计 → 用户提供反例要求代码实证 → 三路并行纯代码审计修订。后续实施以本文档为准，实施中的偏离须回写。*
