# MorPex 全量去黑盒化方案（Deblackbox Plan）

> **状态**：🟢 P0 + P1 已完成（P2 治理完善待续；**全部实现完成后**本文件移入 `docs/archive/` 归档）
> **日期**：2026-08-10（会话 16m·2 定稿，16n 启动，16n·2 P1）
> **依据**：纯代码审计（非文档），覆盖引擎全部环节
> **配套**：实现进度见 SESSION_LOG；P0 完成项见下文 ✅

---

## 0. 目标与核心思想

### 目标
消除引擎内**所有黑盒**——任何数据、决策、后台动作、异常，都能回答"当时为什么这样"。

### 核心思想（防膨胀关键）
```
❌ 零黑盒 ≠ 全程录像（会爆炸）
✅ 零黑盒 = 每个决策有依据可查（量小、可查）
```

**三层记录粒度**（贯穿所有黑盒方案）：

| 层 | 记什么 | 量级 | 保留 |
|---|---|---|---|
| **L0 任务摘要** | 任务级：目标/结果/耗时/成本/成败 | ~1KB/任务 | 永久 |
| **L1 决策单** | 每次关键决策：为什么这么干 | ~0.2KB/条 | 永久 |
| **L2 详情** | 原始数据：LLM 全文/检索候选 | 量大 | 采样 + 短期 |

**三条铁律**：
1. 只记"决策依据"，不记"原始数据"（L2 采样）
2. 一切可配置（采样率/保留天数/归档，旋钮不写死）
3. **异常永远全记**（失败/异常 100% 记录，不管采样率多少）

---

## 1. 16 处黑盒总览

| # | 黑盒 | 现状 | 风险等级 |
|---|---|---|---|
| 1 | LLM 交互 | AI 说/回/耗时/成本全无记录 | 🔴 |
| 2 | 成本计费 | token 走内存回调不落库 | 🔴 |
| 3 | 检索决策 | 装配不记"为什么选这些材料" | 🟡 |
| 4 | 门禁判定 | 查了没查/为什么放行，理由无记录 | 🔴 |
| 5 | 规划理由 | 为什么拆成这几步，无记录 | 🟡 |
| 6 | 执行路径 | 为什么走快/编排/重试，无记录 | 🟡 |
| 7 | 后台行为 | 定时反思/巩固做了什么，无记录 | 🟡 |
| 8 | 异步回调 | 进度/成本只存内存，重启丢 | 🟡 |
| 9 | 内存态数据 | 团队/缓存/步骤结果重启全丢 | 🟡 |
| 10 | 静默吞异常 | 7 处空 catch 吞异常无日志 | 🔴 |
| 11 | 审批决策 | 谁批/何时/为何，留痕不全 | 🟡 |
| 12 | 配置变更 | 改了配置无记录 | 🟡 |
| 13 | LLM tracer | 观测系统独缺 LLM 交互追踪 | 🔴 |
| 14 | 演化理由 | 升级有账本但"为什么改"根因不全 | 🟡 |
| 15 | 知识写入审计 | 有格式校验，无"谁/为何/来源"完整审计 | 🟡 |
| 16 | 门禁只读放行 | 只读操作免查知识且放行不留痕 | 🔴 |

---

## 2. 统一实现框架（每个黑盒都套用）

```
记录管线：
  emit(事件类型, { ...决策单字段 })
    → 写 EventStore（L0/L1 永久）
    → 摘要写"决策单表"（可查询）
    → 详情按采样率写"详情库"（L2，短期）
    → 异常 → 强制全记（忽略采样率）
清理：
  TTL 任务（定期）→ 压缩 → 归档 → 过期删除
```

**通用实现组件**（新增，供所有黑盒复用）：
- `DeblackboxRecorder`：统一记录入口（emit 决策单 + 采样详情）
- `RecordPolicy`：采样率/TTL 配置中心（可运行时调整）
- `RecordCleaner`：TTL 压缩归档清理任务（复用 CompactionService 经验）
- `llm-tracer`：observability 新增（LLM 交互可视化）

---

## 3. 逐黑盒打开方案

### 🔴 黑盒①：LLM 交互记录（P0）
- **记录内容**（每次 PiBridge.generateText 调用）：
  `llm.call` 事件 = { 时间, 调用方(规划/执行/反思/参数提取), provider/model, prompt摘要(前200字), 响应摘要(前200字), 耗时ms, inputTokens, outputTokens, 成本估算, 成功/失败, 失败原因 }
- **详情**：prompt/响应全文 → L2 采样（默认 10%）+ **异常全记**
- **存储**：L1 决策单永久（EventStore）+ L2 详情短期
- **落点**：`PiBridge.generateText` 统一埋点（含 generateTextOnce 重试路径）；新增 `llm-tracer.ts` 接入 observability
- **验收**：桌宠"显微镜"能看到"引擎某一步问了 AI 什么、AI 回什么、花了多少钱"

### 🔴 黑盒②：成本计费落库（P0）
- **记录内容**：`cost.llm.call` = { 任务id, 环节, provider, tokens, 估算成本, 时间 }
- **聚合**：任务级成本汇总（`cost.task` 事件）
- **存储**：独立成本表（或 EventStore 事件），持久化
- **落点**：PiBridge 埋点处同步写成本；`onTokenUsage` 回调改为持久化
- **验收**：能回答"这个任务/这个月花了多少钱、花在哪一步"

### 🔴 黑盒④：门禁判定留痕（P0）
- **记录内容**：`gate.decision` = { 目标, riskTier, 是否强制查询, 查询次数, 命中数, QueryMiss?, 判定(放行/拦截/降级), **判定理由**, 是否只读放行 }
- **关键**：明确记录"只读操作 WARN 放行"这个决策（黑盒16 合并此处）
- **落点**：`runOntologyGroundedReasoning` + `PrimitiveGate.gateReadonly/gateDestructive` 埋点
- **验收**：能回答"这次为什么允许输出"（含只读放行场景）

### 🔴 黑盒⑩：静默吞异常清零（P0）
- **动作**：全项目 grep `catch {}`（已确认 7 处），逐处补日志（至少 `console.warn` + 事件）
- **铁律**：禁止空 catch；异常必留痕
- **验收**：`grep -rn "catch\s*{\s*}"` 结果为 0

### 🔴 黑盒⑬：LLM tracer（P0）
- **动作**：observability 新增 `llm-tracer.ts`（与 agent/dag/fsm/tool/execution tracer 并列），订阅 llm.call 事件
- **验收**：observability `/llm-trace` 端点能看到 LLM 调用链

### 🟡 黑盒③：检索决策记录（P1）
- **记录**：`context.retrieval` = { 任务, 查询, 候选数, 各源命中数, 排序依据(Dense/Sparse/RRF), 最终Top-K }
- **验收**：能回答"工作台里为什么是这些材料"

### 🟡 黑盒⑤：规划理由（P1）
- **记录**：`planner.decision` = { 目标, 拆解出的步骤[], 每步理由, 被否决的备选方案? }
- **验收**：能回答"为什么这么规划"

### 🟡 黑盒⑥：执行路径（P1）
- **记录**：`execution.path` = { 目标, 复杂度判定, 选择(快路径/编排), 理由, 重试/重规划记录 }
- **验收**：能回答"为什么走这条路、为什么重试"

### 🟡 黑盒⑦：后台行为（P1）
- **记录**：`brain.background` = { 动作(反思/巩固/学习), 触发时间, 读了什么, 改了什么, 结果 }
- **验收**：定时后台动作可查

### 🟡 黑盒⑨：内存态数据快照（P1）
- **动作**：关键 Map（teams/agentPool/capabilityCache/stepResults 等）在任务完成时写"状态快照"到 EventStore（L1）；提供"当前内存态"查询端点
- **验收**：重启后能查"上次运行时的团队/能力/步骤状态"

### 🟡 黑盒⑧：异步回调持久化（P2）
- **动作**：onProgress/onTokenUsage 改为"内存 + 持久化"双写（或定期 flush）
- **验收**：重启后进度/成本可追溯

### 🟡 黑盒⑪：审批决策（P2）
- **记录**：`approval.decision` = { 审批对象, 决策人(auto/用户), 结果, 时间, 理由 }
- **验收**：高风险操作审批可追溯

### 🟡 黑盒⑫：配置变更审计（P2）
- **记录**：`config.change` = { 配置项, 旧值, 新值, 时间, 来源 }
- **验收**：任何配置改动有记录

### 🟡 黑盒⑭：演化理由（P2）
- **记录**：`evolution.proposal` 补充根因链 = { 触发反馈/事件, 根因分析, 补丁内容, 沙箱结果, 版本 }
- **验收**：能回答"为什么它自我改了这个"

### 🟡 黑盒⑮：知识写入审计（P2）
- **记录**：`knowledge.write` = { 内容, 来源(任务沉淀/人工喂入/AI生成), 置信度, 校验结果(重复/矛盾/乱码), 触发者, 时间 }
- **新增**：写入前"污染检查"（重复/矛盾/乱码检测）
- **验收**：每条知识可追溯来源，污染的能定位删除

### 🟡 黑盒⑯：门禁只读放行（P0，随④）
- **动作**：与黑盒④合并——`gateReadonly` 每次放行都写决策单（含"只读放行"标记 + 原因"性能优先"）
- **可选**：提供开关 `GATE_STRICT_READONLY=1` 让只读操作也强制先查知识（默认关，保守）
- **验收**：只读放行可查、可配置

---

## 4. 数据生命周期与防膨胀

```
写入（增量）→ 短期详情库
   → 每日清理任务：
       ① 详情 > TTL(默认30天) → 压缩归档
       ② 归档 > 归档TTL(默认365天) → 删除
       ③ 决策单/摘要 → 永久保留（量小）
       ④ EventStore 定期 VACUUM + 实体去重（复用 16j/16l 经验）
```

**默认 TTL 建议**（RecordPolicy 可调）：
| 数据 | 默认 TTL |
|---|---|
| L0 任务摘要 | 永久 |
| L1 决策单 | 永久 |
| L2 详情（正常） | 30 天 |
| L2 详情（异常） | 365 天 |
| 归档压缩 | 365 天 |

**存储预算**（1 万任务/年）：~150MB，可控。

---

## 5. 落地顺序与验收

### P0（先做，打开最危险的黑盒）

1. ✅ 黑盒⑩ 空 catch 清零（7 处生产代码 + 测试 3 处加意图注释，16n）
2. ✅ 黑盒① LLM 交互记录 + 黑盒② 成本落库（PiBridge 统一埋点 → `llm.call` 决策单，16n）
3. ✅ 黑盒④/⑯ 门禁判定留痕（runOntologyGroundedReasoning `gate.decision` + gateBinding 只读放行/破坏性拦截，16n）

> P0 公共基建（16n）：`DeblackboxRecorder`/`RecordPolicy`/`DeblackboxDetailStore`/`RecordCleaner`（L0/L1/L2 三层 + 24h unref TTL 清理）+ 黑盒⑬ llm-tracer（`/api/observability/llm-trace`）

### P1（补齐"为什么"）

4. ✅ 黑盒③ 检索决策记录（ContextAssemblyEngine → `context.retrieval`：装配选材原因/来源命中/分层预算/耗时，16n·2）
5. ✅ 黑盒⑤ 规划理由（HierarchicalPlanner `planner.decision`：拆解子目标/复杂度/风险/ontology 依据 + DeliveryPlanner：模式/经验建议/SOP 提示，16n·2）
6. ✅ 黑盒⑥ 执行路径（UnifiedExecutionEngine → `execution.path`：复杂度/快路径/编排/降级原因，16n·2）
7. ✅ 黑盒⑦ 后台行为（BrainFacade → `brain.background`：反思/巩固/学习留痕，16n·2）
9. ✅ 黑盒⑨ 内存态数据快照（`memory.state.snapshot`：DynamicTeamOrchestrator teams / ExecutionFabric agentPool / OrchestratorAgent stepResults + studio `/memory-state` 端点，16n·2）

### P2（治理完善）
6. 黑盒⑧ 异步持久化、⑪ 审批、⑫ 配置变更、⑭ 演化理由、⑮ 知识写入审计、⑬ LLM tracer 接入界面

### 整体验收标准
- [ ] `grep "catch {}"` 结果为 0
- [ ] 每次任务产生 L0 摘要 + L1 决策单（可查询）
- [ ] 任何 LLM 调用可查（谁/何时/说了啥/花了多少钱）
- [ ] 任何门禁放行/拦截有理由
- [ ] 记忆/知识写入可追溯来源、可清洗
- [ ] 重启后关键状态可查（快照）
- [ ] 存储有 TTL 自动清理，不无限膨胀
- [ ] 桌宠"显微镜"能回放任一任务的完整决策链

---

## 6. 涉及代码（下会话定位用）

| 黑盒 | 主要文件 |
|---|---|
| ① ② | `infrastructure/adapters/pi-bridge/PiBridge.ts` |
| ④ ⑯ | `gate/runOntologyGroundedReasoning.ts`、`infrastructure/tools/primitives/gateBinding.ts`、各 Primitive |
| ③ | `knowledge/context/ContextAssemblyEngine.ts` |
| ⑤ | `cognition/planning/HierarchicalPlanner.ts`、`DeliveryPlanner.ts` |
| ⑥ | `execution/UnifiedExecutionEngine.ts` |
| ⑦ | `cognition/BrainFacade.ts` |
| ⑨ | `execution/DynamicTeamOrchestrator.ts`、`execution/fabric/ExecutionFabric.ts`、`orchestration/OrchestratorAgent.ts` |
| ⑩ | 全项目（grep 定位 7 处） |
| ⑪ | `cognition/twin/OrganizationTwin.ts`、`BehaviorTwin.ts` |
| ⑫ | `infrastructure/adapters/pi-bridge/yamlConfig.ts` |
| ⑬ | `studio/server/observability/`（新增 llm-tracer） |
| ⑭ | `evolution/EvolutionSandbox.ts`、`evolution/EvolutionApplyLoop.ts` |
| ⑮ | `knowledge/ontology/OntologyService.ts`、`memory/api/MemoryApi.ts` |

---

## 7. 归档说明

- 本方案**实现完成后**：更新 SESSION_LOG 勾选待办，将本文件移入 `docs/archive/`
- 实现过程中如发现与代码不符 → **以代码为准**（AGENTS.md §3.2），并回改本方案
