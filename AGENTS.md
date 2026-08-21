# AGENTS.md — MorPex 项目规则（开发铁律）

> **本文件是 MorPex 的项目规则主文档**（主流 Agent 工具自动发现的标准入口）。所有 Agent、所有任务必须遵守；违反任一条视为任务失败。
> **会话进度**（历史摘要 / 待办 / 关键路径）在 `SESSION_LOG.md`——两者分工：本文件=规则，SESSION_LOG=进度。

---

## 0. 会话交接约定（铁律）

- **发现机制（重要）**：
  - `AGENTS.md` 是 Cursor / Codex / 新版 Claude Code 自动发现的标准入口。
  - **pi-coding-agent 不会自动发现 AGENTS.md**——它必然加载 `.pi/SYSTEM.md`（system prompt 源），由 `.pi/SYSTEM.md` 第 0 步**强制引导显式读取本文件 + SESSION_LOG.md**。
  - 其它工具若不自动发现，需在会话开始时显式 `cat AGENTS.md SESSION_LOG.md`。
  - 均指向 `SESSION_LOG.md`。
- **会话开始【必读最小上下文】**：必须读且只读两个文件——`AGENTS.md`（本文件=规则）+ `SESSION_LOG.md`（进度/待办/关键路径）。禁止对项目一无所知地开始；**禁止新会话开始时把架构/注册表/流程等大文档全部读入上下文**（它们体积大、大多与当前任务无关，读入即浪费上下文窗口）。工具不自动读文件时，显式执行 `cat AGENTS.md SESSION_LOG.md`。
- **按需加载**：其余文档（架构/文件注册表/数据流/模型配置）**只在任务实际涉及时才读取**，触发条件见 §1 按需加载表。读完用完即止，不长期占用上下文。
- **会话结束**：必须更新 `SESSION_LOG.md` 的「会话历史」（追加摘要+提交）与「当前待办」（勾选/新增），确保下个会话零上下文丢失。
- 待办有「推送提交」未做时，会话结束提醒。

## 1. 按需文档加载（不默认全读，只读需要的）

> **最小上下文**：会话开始只读 `AGENTS.md` + `SESSION_LOG.md`。以下文档**仅在任务实际涉及时才读取**，避免新会话把大文档全部塞进上下文。读完用毕即弃，不长期保留。

| 文档 | 何时需要读（触发条件） | 规模 |
|---|---|---|
| `docs/AICOS_CORE_ARCHITECTURE.md` | 新增/修改模块、涉及层间调用、架构相关改动时 | 110 行 |
| `docs/AICOS_CORE_FILE_REGISTRY.md` | 新增/重命名/删除文件、改文件职责时（必须登记/更新） | 430 行 |
| `docs/AICOS_FLOW.md` | 改执行链/数据流/编排/Gate/装配相关代码，或要理解运行时顺序时 | 389 行 |
| `docs/MODEL_CONFIG.md` | 改模型配置、跑 batch 试跑、LLM/Embedding 相关时 | 113 行 |
| `docs/TESTING_PLAN.md` | 新增/修改测试、跑全量测试、测覆盖时 | 330 行 |
| `docs/archive/*` | 部署/安全/监控/记忆部署等运维专项（按需查阅，历史参考） | 各 ~100-200 行 |

**通用规则**：
1. 只读当前任务涉及到的文档；无关文档不读（省上下文）。
2. 不确定是否需要时：先 grep 相关代码确认影响范围，再决定读哪份文档。
3. 读完即弃（不把文档内容长期留在思考中）。
4. 若文档描述与代码实际不符 → 以代码为准（铁律 §3.2 真实状态优先级），并提示更新文档。

## 2. 项目速览

**MorPex v16** — 一人公司 AI 工作助理（TypeScript / Node.js / pi-ai 0.81.1）
- **AICOS-Core 8 层架构**（详见 docs/AICOS_CORE_ARCHITECTURE.md）：
  L1 Governance · L2 Knowledge · L3 Ontology Gate ★ · L4 Cognition&Planning · L5 Execution · L6 Evaluation · L7 Evolution · L8 Infrastructure（领域插件在 packages/workflows/）
- **统一运行时**：`packages/core/src/bootstrap-unified.ts`（`bootstrapUnified()` 全层装配，含 RAG-lazy 上下文装配 + PiBridge + 全模块接线）
- **核心执行链**：`CompanyFacade.executeGoal` → ControlPlane 门禁 → Ontology Gate(真实 LLM，tier-0/1/2 分级) → UnifiedExecutionEngine（简单→原语快路径；复杂→OrchestratorAgent 总大脑编排 step-agent）
- **上下文装配（RAG-lazy）**：Dense(bge-m3 向量) + Sparse(BM25) → RRF 融合 → Cross-Encoder(bge-reranker) 重排 → 领域/新鲜度 → Top-K 指针+蒸馏（`knowledge/context/`）
- **通用空参保险（模型无关，16l·7）**：pi-agent-core `prepareArguments` 钩子在 schema 校验前注入可推断值（knowledge 空 query→goal / file 空 path→沙箱），对任意 LLM 生效——定位：`infrastructure/tools/primitiveAgentTools.ts`（见 SESSION_LOG 关键教训 #7）
- **原语注册中心**：`DomainPrimitiveRegistry`（5 通用 + 14 插件原语），`executeAuto` 消费 + NL→参数提取
- **模型配置**：`config/morpex.yaml` 是唯一模型来源（builtin=pi-ai 内置 provider / gateway=OpenAI 兼容网关，如智谱 GLM）；Embedding/Rerank 见 `config/embeddingconfig.yaml`（SiliconFlow）。详见 docs/MODEL_CONFIG.md
- **状态源**：`morpex-events.db`（EventStore 事件溯源，实体注册已去重 + restore 分页全量）

## 3. 架构铁律

### 3.0 编程第一性原理（最高优先——所有实现决策从本源推导，不套模板、不循惯例、不为已有代码背书）

1. **真相源第一（Source of Truth）**：任何「有状态的实体」（任务/会话/决策/产物/进度）必须先确立**持久化真相源**。UI 只是它的投影；事件流（SSE）只是「发生了什么」的增量广播；内存只是「当前进程视角」——三者都**不可作为真相源**。真相源缺失或只在内存 → 视为缺陷，**必须先补持久化，再写依赖它的 UI**。
2. **状态是数据，不是 DOM/闭包**：页面组件的可见状态必须能从真相源重建。禁止「组件只活在内存 + 事件流」（切视图/刷新/重启即丢）。凡是能重建才叫正确。
3. **事件驱动与状态查询分离**：SSE 用于实时增量推进；但任何时刻都必须能从真相源 `GET` 出完整状态（恢复能力）。事件到达时若持久化尚未就绪，UI 可先行但必须能在就绪后重建。
4. **先契约后实现**：实体 / 端点 / 事件先定型（TS 接口），再写读写两端；两端必须共用同一契约（单文件类型定义）。
5. **可恢复即正确**：刷新 / 切视图 / 后端重启后，系统必须能重建当前视图与关键状态（含未决决策）——做不到即未完成，不得以「罕见场景」接受。
6. **复用优先**：能复用既有真相源（EventStore 事件溯源 / 快照 / 会话 jsonl / chat-history）不新建；新增真相源必须在 `docs/AICOS_CORE_FILE_REGISTRY.md` 与 `SESSION_LOG.md` 登记。
7. **先问为什么，再写什么**：接到需求先回答「这个状态的真相源在哪、生命周期多长、谁写谁读」，答不出就先调研，不猜。

### 3.1 理想架构对齐（AICOS-Core 8 层）
所有迭代、升级、重构必须严格对齐 `docs/AICOS_CORE_ARCHITECTURE.md` 的 8 层模型，并同步更新 `docs/AICOS_CORE_FILE_REGISTRY.md`（新增/修改文件必须登记）。

**禁止**：
- 在 `planes/` 下新增任何代码（已废弃，仅剩 DEPRECATED.md）
- 在 `brain/` 下新增新模块（已合并到 `cognition/`，brain/index 仅兼容）
- 在 `governance/control-plane/` 之外创建重复 Controller 层
- 领域逻辑进入 core（必须放 `packages/workflows/<domain>/`）

**必须**：
- 新模块必须对应理想架构某一层
- Ontology Gate（第 2 层）是所有知识检索/生成的强制前置
- 所有通用原语必须先调用 Ontology Gate
- Brain 能力统一通过 `cognition/BrainFacade` 暴露

### 3.2 真实状态优先级
```
Runtime 执行路径 > 代码调用关系 > 测试结果 > 架构文档 > 设计计划
```
禁止根据旧文档假设系统状态，先验证再动手。

### 3.3 数据流闭环
```
Input → Process → Output → Consumer → Storage
```
禁止创建无人消费的对象（幽灵模块）。

### 3.4 Planning 与 Execution 分离
- Planning 只产出 Plan，不执行、不调 Agent、不写外部系统
- Execution 只执行 Plan，不修改 Plan
- 通过 EventBus 反馈结果

### 3.5 核心管道与 EventBus Only
```
CompanyFacade → ControlPlane → Runtime(FSM/DAG) → EventBus → Knowledge/Memory
```
EventBus 是唯一通信通道；禁止模块间直接调用。

### 3.6 PiBridge 隔离铁律
- **唯一入口**：`packages/core/src/infrastructure/adapters/pi-bridge/PiBridge.ts` 是唯一允许运行时 `import ... from '@earendil-works/pi-ai'` / `pi-agent-core` 的文件
- **类型桥接**：`pi-types.ts` 允许 `import type`
- **升级隔离**：pi 包升级只需改 PiBridge.ts，业务代码零修改
- 检查：`grep -rn "from '@earendil-works/pi-ai'" --include="*.ts" packages/ | grep -v pi-bridge | grep -v pi-types | grep -v compat`

### 3.7 vNext+ 生产级约束（分级闸门 / 有界执行 / 缺失即信号）
1. **Graded Ontology Gate**：tier-0（资金/发布/架构/演化）强制两阶段禁缓存；tier-1（默认）短 TTL 缓存；tier-2（草稿）受控探索。禁止一刀切。
2. **Bounded Autonomy**：每个 SubAgent/Mission 必须有迭代/成本上限（`maxAttempts`/`maxIterations`/`maxCostTokens`），超限终止并产生 Failure 事件，禁止空转。
3. **QueryMiss is Signal**：知识缺失必须 emit `ontology.query.miss`（EventStore + EventBus）→ KnowledgeGapListener → Feedback，禁止静默。
4. **Verifiable Evolution**：演化产物必须 Ontology Gate(Tier-0) → 评估 → 沙箱试跑 → 人工审批 → 版本化落地 + 可回滚（`EvolutionSandbox`），禁止「分析完直接改生产行为」。
5. **Plan 可追溯**：规划输出必须携带 `ontologyRefs[]`。

## 4. 文件操作

| 规则 | 说明 |
|------|------|
| **搜索优先** | 新建前 `grep -r "关键词"` 确认同类文件不存在 |
| **修改优于新建** | 能扩展现有文件绝不新建 |
| **行数限制** | >800 行考虑拆分，>2000 行强制拆分 |
| **.js 后缀** | `import { X } from './X.js'`（非 `.ts`） |
| **变更传播** | 移动/重命名 → grep 更新所有 import → tsc；删除 → 清引用 + barrel 残留 |

## 5. 新模块硬性要求

**创建前**：是否已有类似能力？影响范围（caller/consumer/runtime/storage/events）？
**创建后集成检查**：谁实例化它（有 `new Xxx()`）？谁调用它（非仅测试）？在 barrel 链（index.ts 导出）？对接 EventBus？旧代码删除？
**完成标准（全部满足才算 DONE）**：文件存在 + 类型完整 + export 完整；Runtime 接入 + 真实调用路径；输入/输出/错误处理完整；对应文档已同步（映射表命中或显式声明“文档不涉及”）。

## 6. 代码质量

| 规则 | 说明 |
|------|------|
| **禁止裸 `any`** | 仅允许：外部依赖无类型、动态 LLM provider |
| **null 安全** | 访问可空属性前必须检查或使用 `!` |
| **禁止吞异常** | `catch {}` 至少加 `console.warn` |
| **Promise 不等待** | 必须 `.catch(err => console.warn(...))` |

## 7. Bug 修复流程

```
1. 追溯完整数据流 → 找到最上游分岔点
2. 在分岔点修复 → 不在下游加 if/guard
3. 修复应降低系统复杂度 → 复杂度增加说明方向错了
```
禁止：下游 filter、setTimeout hack、单一边缘 case 的全局状态、绕过 EventBus。

## 8. 新功能生命周期

```
需求 → 架构定位 → 搜索已有能力 → 影响分析 → 设计方案
  → 实现 → Runtime 接入 → 数据流验证 → 文档同步 → 验收
```
禁止：需求 → 新建文件 → 宣布完成。

## 8.5 文档同步协议（人工审核确认后自动更新）

> **★强制规则（本次新增）**：**每次修改任何代码文件，必须同步更新相应文档文件。**
> 判定“相应文档”依下方映射表，禁止无文档地改代码——新增/修改/删除/重命名文件、改调用链/Gate/装配、改测试、改模型配置，都必须命中映射表 ≥1 项文档更新；
> 若确实无对应文档可更新，**必须在提交信息中显式中注明“文档不涉及（原因）”**，禁止默认跳过。文档未同步 = 任务未完成 → 禁止宣布完成/提交。

> **原则**：代码改动后，先由人审（review）确认代码正确，确认通过后才更新对应文档；文档随代码走，不提前写。

**流程**（每次代码改动后）：
```
实现 → 门禁（tsc/架构/测试）→ 人工审核确认 ✓ → 更新受影响文档 → 提交（代码+文档同提交）
```

**文档更新映射**（按改动类型）：

| 改动类型 | 必须更新 | 说明 |
|---|---|---|
| 新增/修改/重命名/删除文件 | `docs/AICOS_CORE_FILE_REGISTRY.md` | 逐文件登记功能+职责边界，防止碎片化 |
| 新增/修改模块、层间调用变化 | `docs/AICOS_CORE_ARCHITECTURE.md` | 若影响层职责/宪法/目录结构才改 |
| 改执行链/数据流/编排/Gate/装配 | `docs/AICOS_FLOW.md` | 实证执行链或机制速查表需同步 |
| 改模型/LLM/Embedding/跑 batch | `docs/MODEL_CONFIG.md` | 模型配置/试跑参数/实测对比更新 |
| 新增/修改测试 | `docs/TESTING_PLAN.md` + README 测试数 | 用例数与覆盖情况更新 |
| 任一功能改动（推荐） | `SESSION_LOG.md` 会话历史 + README 近期特性 | 保持进度可追溯 |
| 其他运维/安全/部署改动 | `docs/archive/*`（若存在） | 按需更新归档文档 |

**规则**：
1. **先审核后更新**：人工确认代码正确（review 通过）后，才更新文档；未确认不更新文档。
2. **文档随提交**：文档更新与对应代码改动**同一次提交**（避免代码与文档分离）。
3. **过时即删**：文档描述与代码不符时，以代码为准并修正文档；无法修正的过时文档移入 `docs/archive/`。
4. **不扩文档**：小改动不重写文档，只做最小更新（加一行/改一行）。
5. **登记优先**：新增文件必须先登记 FILE_REGISTRY 再提交（铁律 §3.1）。
6. **每次代码改动必配文档（新增）**：任何代码文件改动都必须命中下方映射表 ≥1 个文档更新；映射表未覆盖的新场景，先在本表登记再改码；无对应文档时须在提交信息显式声明“文档不涉及（原因）”，禁止静默跳过。

## 9. 任务结束自检

```
□ tsc --noEmit → 零错误
□ node scripts/production-check.cjs → 8/8 通过
□ node scripts/validate-architecture.js → 0 ERROR
□ 无残留旧路径引用
□ 新文件在 barrel 链中 + 有实例化 + 调用者
□ 无重复文件 / 无幽灵模块
□ 对应文档已同步更新（映射表命中或显式声明“文档不涉及”）
```

## 10. 反模式速查

| 反模式 | 修复 |
|--------|------|
| 幽灵模块（存在但无运行时引用） | 接入 Runtime 或删除 |
| 别名壳文件 `export { X as Y }` | 删除，更新 import 到规范名 |
| try-catch 吞异常 | 至少 `console.warn` |
| `any` 类型 | 改为具体类型或 `unknown` |
| 条件永不触发（未实例化） | 构造函数中实例化 |
| 直接创建文件宣布完成 | 走完整生命周期 |
| 用目录豁免掩盖违规 | 如实修复（领域规则/校验器豁免曾发生并修复） |

## 11. 模块分层速查

```
CEO 层:       CompanyFacade (统一入口)
治理层:       ControlPlane (Goal/Policy/Resource/Agent/Evolution 5 控制器)
大脑层:       cognition/BrainFacade (Reflection/MetaLearner/SelfImprovementLoop)
规划层:       cognition/planning/DeliveryPlanner + HierarchicalPlanner + Arbitration
执行层:       execution/UnifiedExecutionEngine + OrchestratorAgent + StepAgentExecutor + DAGRuntime
原语层:       tools/DomainPrimitiveRegistry + tools/primitives (5 通用原语)
知识层:       knowledge/(ontology + graph/SystemMetadataGraph + artifact + memory + context/RAG-lazy)
演化层:       evolution/(ExperienceMiner/FailureAnalyzer/ActiveEvolutionTrigger/EvolutionSandbox/KnowledgeGapListener)
插件层:       packages/workflows/<domain>/ (xjmcu/ecommerce/hardware/software — 14 领域原语)
基础设施:     common/EventBus(唯一通道) + infrastructure/(adapters/pi-bridge + observability + protocol) + connectors/
```

**Facade 模式**：Facade 不替代被包裹模块、零破坏、优雅降级、通过接口依赖（`Like` 后缀）。

**部门隔离**：`DepartmentContext.partitionKey(deptId)` → `dept:{id}`；CEO 全局视图不传 departmentId。

**学习闭环**：任务完成 → BrainFacade.learn → remember(内存/持久化) → SOPEngine → LearningLoop → 广播 → 影响下次规划。

## 12. 验证门禁（任何改动后必须跑）

```bash
npx tsc --noEmit -p tsconfig.json          # 编译 0 错误
node scripts/validate-architecture.js      # 架构对齐（当前 100%，0/0）
node scripts/production-check.cjs          # 生产就绪（8/8）
npx vitest run                             # 全量单元/集成（89 文件 / 775 用例，3 个 e2e 为 opencode 配额非回归）
# 完整门禁（推荐）：npm run test:full      # 25 步全绿（tsc/架构/vitest/生产/CLI）
# 覆盖率：npm run test:coverage            # 行覆盖 37%+，阈值防回退
# 可观测验证（后端启动后）：curl localhost:8080/api/observability/audit
```

## 13. 开发流水线

```
advisor → fork/worker（可并行）→ optimizer → reviewer
 决策      实现                去冗余      审查
```
- 架构决策 → advisor；大型实现 → fork；独立小任务 → worker
- 实现完成 → optimizer（必须）→ reviewer（必须）

## 14. 提交约定

- 按功能分逻辑提交：`feat:` / `fix:` / `refactor:` / `docs:` / `chore:` / `test:`
- 中文信息说明意图；避免大杂烩提交；改动后必须过门禁
