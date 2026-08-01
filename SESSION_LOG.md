# MorPex 会话交接日志（SESSION LOG）

> **本文件是每次会话的「记忆入口」。** 规则：
> - **会话开始时**：先读本文件（项目状态 + 待办 + 上轮摘要）
> - **会话结束时**：更新「会话历史」表 + 「当前待办」，确保下个会话零上下文丢失
> - **发现机制**：`AGENTS.md`（主流 Agent 工具自动发现 + pi 项目级 `.pi/SYSTEM.md` 系统入口）→ 指向本文件
> - 架构详情见 `docs/AICOS_CORE_ARCHITECTURE.md`（AICOS-Core 8 层唯一真相源）+ `docs/AICOS_CORE_FILE_REGISTRY.md`（逐文件职责边界）

---

## 1. 项目快速概览（2026-07-31 快照）

**MorPex v16** — 一人公司 AI 工作助理（TypeScript / Node.js / pi-ai 0.81.1）

- **理想架构**：AICOS-Core 8 层（docs/AICOS_CORE_ARCHITECTURE.md）——L1 治理 / L2 知识 / L3 Ontology Gate / L4 认知规划 / L5 执行 / L6 评价 / L7 演化 / L8 基础设施
- **统一运行时**：`packages/core/src/bootstrap-unified.ts`（`bootstrapUnified()` 全 8 层装配）
- **核心执行链**：`CompanyFacade.executeGoal` → ControlPlane 门禁 → 管线编排 → 仿真 → Ontology Grounding(真实 LLM) → UnifiedExecutionEngine（auto：原语兜底 → fabric/dag/mission）
- **原语注册中心**：`DomainPrimitiveRegistry`（19 个原语 = 5 通用 + 14 插件），`executeAuto` 消费 + NL→参数提取
- **验证命令**：
  ```bash
  npx tsc --noEmit -p tsconfig.json          # 编译
  node scripts/validate-architecture.js      # 架构对齐（当前 100%，0/0）
  node scripts/production-check.cjs          # 生产就绪（8/8）
  npx vitest run packages/core/__tests__/ontology-gate-tiering.test.ts packages/core/__tests__/bounded-autonomy.test.ts packages/core/__tests__/feature-regression.test.ts   # 核心测试（16 用例）
  ```
- **一键运行（全栈 3 服务）**：
  ```bash
  ./scripts/run-all.sh            # cognee :8001 + embedding :3100 + backend :8080（后端前台）
  ./scripts/run-all.sh --bg       # 全部后台运行
  ./scripts/run-all.sh --status   # 健康检查
  ./scripts/run-all.sh stop       # 停止
  npm run dev                     # 仅后端（自动接 COGNEE_URL=:8001）
  npx tsx scripts/e2e-cognee.ts   # 记忆系统端到端验证
  ```
- **⚠️ pi-ai 0.81.1 兼容**：`getModel/completeSimple/streamSimple` 已移至 `@earendil-works/pi-ai/compat`（根导出不再提供），StudioServer/LLMFactory 已改走 compat（S16）
- **门禁状态**：✅ tsc 0 错误 · ✅ 架构 100% · ✅ production-check 8/8 · ✅ 测试 16/16 · ✅ 工作树干净

---

## 2. 会话历史

| 会话 | 日期 | 主题 | 完成内容 | 提交 |
|------|------|------|----------|------|
| S1 | 07-31 | vNext+ 升级（P0/P1） | Graded Gate(tier-0/1/2) + QueryMiss 闭环 + SubAgent/Mission 迭代与成本上限 + Plan ontologyRefs + 副作用前校验 + 文档对齐 | 并入后续提交 |
| S2 | 07-31 | 修复校验器「放水」+ 插件层 | 领域质检/合规规则真迁移至插件（移除 /verification/ 豁免）；4 插件标准化（14 原语）；xjmcu 真实逻辑恢复 | `feat(workflows)` |
| S3 | 07-31 | planes/ 迁移 | planes/ 全部实现迁至 canonical 层（runtime/artifact/metadata/memory/agent/goal-intelligence/control-plane），孤儿删除，对齐 26→0 | `refactor(planes)` |
| S4 | 07-31 | 实现度审计 + 第 6 层接线 | 10 层实现度矩阵；primitives 注入真实 piBridge + 注册 + fs/LLM/Connector | `feat(execution)` 等 |
| S5 | 07-31 | P0a/P0b/P1a + 全层接线 | 执行引擎消费原语注册中心 + ConnectorRegistry 装配（修 FileSystemConnector 双 bug）+ Brain 事件接线 + MemoryWiki/Governance/Evolution 接线 + ManagementHub crash 修复 | `feat(execution)`/`feat(bootstrap)`/`fix(connectors)` |
| S6 | 07-31 | L3 接入 + 沙箱 + 治理 P2 | DeliveryPlannerAdapter(HTN replan+Arbitration) 接入 MissionRuntime + EvolutionSandbox + 成本-质量仪表盘 + Ontology 元数据/冲突 + Policy 热更新快照 + BrainFacade 学习闭环 + 回归测试 | `feat(planner)`/`feat(evolution)`/`feat(governance)` 等 |
| S7 | 07-31 | 分提交 + BrainFacade + 回归测试 | 198 项变更分 11 个逻辑提交（docs/planes/ontology/execution/workflows/evolution/planner/governance/connectors/bootstrap/brain）；BrainFacade 接入 executeGoal→learn；feature-regression 测试(7 用例) | `2a86e61` 等 11 提交 |
| S8 | 07-31 | 会话记忆机制 | 创建 `SESSION_LOG.md`（会话历史/待办/关键路径）+ CLAUDE.md 会话交接约定；提交 `5b3fe92` | `5b3fe92` |
| S9 | 07-31 | AGENTS.md 跨工具入口 | 创建 `AGENTS.md`（主流工具自动发现的标准入口，指向 SESSION_LOG）；提交 `2e68840` | `2e68840` |
| S10 | 07-31 | pi-coding-agent 项目配置 | 探索 `~/.pi` 机制（CONFIG_DIR_NAME=.pi）；创建项目级 `.pi/SYSTEM.md`（pi 系统入口薄壳）；撤销全局配置；提交 `0b7f521` | `0b7f521` |
| S11 | 07-31 | 文档职责分工 | **AGENTS.md=项目规则（吸收原 CLAUDE.md 全部规则并更新）**；**SESSION_LOG.md=会话进度**；**舍弃 CLAUDE.md**（git rm）；更新引用；提交 `c891fb0` | `c891fb0` |
| S12 | 07-31 | 记忆系统 company_memory（Python） | 按《一人AI公司记忆系统详细设计方案》实现独立 Python 模块 `company_memory/`：Graphiti(graphiti-core 0.29.3+Neo4j5.26)权威层 + SQLite 情景层 + Working Buffer + 确认队列 + 衰减/巩固生命周期 + MCP stdio；26 pytest 通过；真实 Graphiti+DeepSeek 端到端验证（产品事实自动写+优先检索 / 低置信进确认队列 / need_human 硬逻辑）；Docker compose 起 Neo4j；TS 桥接示例 examples/ts_bridge.ts | 未提交（待推） |
| S13 | 08-01 | 记忆系统统一改造（TS + cognee 引擎） | **选型收敛**：MemoryJS(npm包损坏+4★)/supermemory(Win CLI不支持+版本早)/mem0(图弱+服务重)/agentmemory(coding专用) → **cognee**（29.6k★,TS SDK,本地文件存储 SQLite+LanceDB+KuzuDB,图核心+本体生成+TEMPORAL双时间,无Docker）；cognee P0 spike 全过；**统一记忆层 @morpex/memory 落地**（P0，8测试）：MemoryAPI契约/本体白名单/确认队列/强制门禁/L2隔离/cognee HTTP适配器(手动multipart)/MockEngine；**Gate接线**：ontologyTools第5工具 ontology_queryCompanyKnowledge + CompanyKnowledge注册表 + bootstrap装配；**废弃重复的 Python company_memory/**（被 cognee 取代）；**真实联调通**：TS→cognee 写入/图证据检索/空检索→need_human；门禁：tsc 0 + 28测试 + validate-architecture 100% + production-check 8/8 | `cdc6aba` `eb80acb` `a18fee9` |
| S14 | 08-01 | 记忆读写入口统一收敛（碎片） | **碎片审查**：发现读写入口不统一（6读/5写）+ 独立存储并存（PersonalBrain自带SQLite死代码 / KnowledgeGraph JSONL / MemoryWiki）；**收敛执行**：MemoryAPI新增 `rememberEpisode`（情景统一入口）；`MemoryApiBus`（MemoryHooks→统一层）；`memory-search-tool` 走统一检索 + 空/低置信→need_human（防幻觉，不再鼓励模型自答）；**PersonalBrain 纯内存化**（删 SQLite memory_entries 死代码，持久化统一经 BrainPersistor→MemoryAPI）；BrainPersistor 优先 memoryApi 回退 wiki；bootstrap 装配 MemoryApiBus；门禁：tsc 0 + 38测试 + validate-architecture 100% + production-check 8/8 | `69bb33f` `7c535e2` |
| S15 | 08-01 | 记忆碎片深水收敛（SQLite 统一） | **KnowledgeGraph 存储 JSONL→SQLite**（better-sqlite3 实时持久化，接口不变，消费方零感知；兼容旧 JSONL 自动迁移；4 测试）；**BrainFacade 学习闭环接统一层**（setMemoryApi：remember→rememberEpisode、recall→query 合并；bootstrap 装配）；**MemoryActivationEngine** 数据源统一留待装配层（engine 本身职责=激活评分，存储由装配方从统一层注入）；门禁：tsc 0 + 43测试 + validate-architecture 100% + production-check 8/8 | `21288e0` `0b401dc` |
| S16 | 08-01 | 全栈跑起来（pi-ai 兼容修复） | **根因**：pi-ai 升 0.81.1 后 `getModel/streamSimple/completeSimple` 移至 `/compat`，StudioServer/LLMFactory 动态导入根包 → 启动即抛 `getModel is not a function`（tsc 漏检，动态 import）。**修复**：两处改 `@earendil-works/pi-ai/compat`（对齐已有约定 model-resolver/model-registry/SessionManager/pi-utils）。**新增 `scripts/run-all.sh`**（一键 cognee:8001 + embed:3100 + backend:8080，自动探测 venv/复用 spike venv，支持 --bg/--status/stop）；`scripts/start.ts` 默认注入 `COGNEE_URL=:8001`（createEngine 默认 8000 是陷阱）。**实测**：cognee 1.4.0 就绪 + embed BGE-M3 就绪 + backend 健康（14 原语/4 插件/记忆已接线）+ e2e-cognee 全过（upsert written → 图检索命中 → 空检索 need_human） | 待推 |
| S17 | 08-01 | 去除 bge-m3 + zvec（废弃组件） | **移除**：`@zvec/zvec` 依赖（根+memory包+lock）、`ZVecStorage.ts`/`EmbeddingClient.ts`/`ZVecLockRecovery.ts`（vector/ 目录）、core 死代码 `knowledge/VectorStore.ts`、`tools-python/embedding-server.py`、`data/models/bge-m3`（7MB 模型）+ 全部 zvec 数据目录、`configs/Dockerfile.embedding`、pm2 `morpex-embed`、run-all.sh embed 段、docker-compose embedding 服务、`memory-bus-v2-audit.spec.ts`（引用不存在的 MemoryBus，陈旧）、StudioServer.ts 编辑器残留备份(.bak/.new/.part*)。**改造**：`MemoryWiki` 剥成 SQLite-only（去 zvecColl/embedder/L2 缓存/向量召回/zvecReady 统计，query 签名保留 vectors 恒空）；`MetaPlanner`/`pipeline/stages/types` 的 ZVecStorage 类型 → 结构接口 `VectorStoreLike`；StudioServer/observability 移除 zvec-storage 心跳与契约；adapters/memory 与 memory index 导出清理；bootstrap L7 无 zvecPath。**门禁**：tsc 0 + 架构 100% + production 8/8 + 核心 16 + memory 12 + metaplanner 26 + e2e-cognee 全过 + 后端干净重启（ExerciseAll 72 模块无 zvec）；跟进打磨（8905da8）：query() 移除不可达图遍历死代码、清理 L1/L2 缓存、修复 dbPath 未生效 bug | 待推 |
| S18 | 08-01 | L7 深水区收官：MemoryActivationEngine 数据源统一 | **改造**：`MemoryActivationEngine` 新增 `MemoryActivationSource` 接口（load/available）+ `setSource` + 异步 `refresh()`（拉快照替换内存存储；离线保留旧快照不误清空）+ `isSourceAvailable`/`lastRefreshedAt`；`MemoryApiBus` 新增 `createMemoryActivationSource(memoryApi, engine)` + `hitToMemoryRecord`（type 从 metadata 推断；过滤 cognee 内部工件 TextSummary_/DocumentChunk_ 噪音；need_human→空防幻觉）；新增 `memory/activationRegistry.ts` 全局注册表（set/get，对齐 ExerciseContext 模式）；bootstrap 装配：engine.setSource(统一层) + 异步首拉 + 注册；RuntimeAPI `/api/memory/activate` 复用装配引擎（不再 new 空引擎）。**实测**：后端重启装配日志「首拉 7 条，可用=true」；activate 端点返回真实记忆（'899 元/月' 命中）；噪音过滤 9→7。**门禁**：tsc 0 + 架构 100% + production 8/8 + 核心 27（16+11 新）+ memory 12 + metaplanner 26。**废弃尝试**：SessionManager 接线核心 AgentHarness 失败（生产 harness 是 pi-bridge AgentHarnessClass，无 attachMemoryEngine，已撤销）；memory-activation.test.ts 原为无 test() 脚本（vitest 4 拒绝）已重写为规范 vitest 文件 | 待推 |
| S19 | 08-01 | L8 自动回滚具体变更（EvolutionSandbox） | **改造**：`EvolutionChangeInput` 携带 apply/revert/verify 可执行动作（动作存侧表，记录保持可序列化）；`approveAndApply` 真正执行 apply（成功→applied，失败→failed 可补偿回滚）；`rollback` 真正执行 revert（仅限 applied/failed；成功→rolled_back + verify 校验，失败→保留状态可重试）；新增 applyOutcome/applyError/revertOutcome/revertError/verifyOutcome 审计字段 + apply_failed/revert_failed 事件；兼容旧行为（无 apply/revert 时维持标记式）。**reviewer 建议落地**：inflight Set 防 TOCTOU 双执行 + 重试成功清残留错误 + reject 守卫（仅 pending/rejected 可拒）。**测试**：8 个 L8 用例（含幂等/补偿/verify=false 边界）。**门禁**：tsc 0 + 架构 100% + production 8/8 + 6 文件 73 测试全过 | `18bb397` `1b19853` |
| S20 | 08-01 | 完成全部候选（L9 插件/phase0-smoke/BrainFacade 重包/Planner 接入） | **B. phase0-smoke 修复（真 bug）**：`ApprovalAction` 无 `execute_goal` → `!policy→true` 兜底 → 所有 goal 永远需人工审批（主入口被卡死）；补 execute_goal 默认策略（LOW/MEDIUM 自动批准、HIGH/CRITICAL 人工）+ CompanyFacade 部门校验前置（先于审批门禁）+ sendTask 消息含路由部门 + 测试注入 stub runtime/真实 ControlPlane（19/19）。**A. L9 插件**：`.env.example` 加凭证占位（AMAZON_SP_API_KEY/AWS_*/GITHUB_TOKEN 等，缺省 mock 降级、凭证就绪即生效）+ workflow-plugins 测试（4 provider 加载 + mock 降级，3/3）。**D. Planner 非 Mission 接入**：CompanyFacade.setDeliveryPlanner + executeGoal 非 mission 模式先规划（planId 注入 runOpts + 返回 plan 字段，失败非阻断）；bootstrap 装配（4/4）。**C. BrainFacade 完整重包**：聚合 MemoryActivationEngine（activateMemory）+ DeliveryPlanner（planGoal），getStats.systems 扩展（6/6）。**附带**：critical-cognitive-pipeline 脚本式→规范 vitest（9/9，修复 worker 挂起）。**门禁**：tsc 0 + 架构 100% + production 8/8 + 精选 11 文件 114 测试全过 + 后端重启装配验证 | `780868d` `12fee5b` `769ad86` `6c62aaa` `3b4866e` |
| S21 | 08-01 | 测试专项清理（全量 vitest 全绿） | **根因**：`vitest run` 全目录 32 文件失败——①30+ 脚本式测试（v11 遗留，main()/process.exit 直跑）混入 include 致 No test suite/worker 挂起；②vitest alias 只配根、缺 `@morpex/contracts/*` 等子路径（tsconfig 已配）；③S17 移除 zvec 后残留死引用。**修复**：vitest.config exclude 32 个脚本式（保留 tsx 手动运行）+ alias 补全 contracts/connectors/core/memory/workflow-sdk 子路径；清理 morpex-knowledge 的 VectorStore 块、morpex-crossdomain 的 VectorStoreAdapter/MemoryBusListener 条目。**效果**：`npx vitest run` **35 文件 254 测试全过**（原 32 failed）。**门禁**：tsc 0 + 架构 100% + production 8/8 + 全量 vitest 254 全过 | `da63678` |
| S22 | 08-01 | 架构严格审计（揭露“100% 对齐”虚标）+ 接线修复 + LearningLoop 补全 + brain 迁移 + capability 推断 | **审计结论**：`validate-architecture.js` 的 100% 是**负向合规**（检测无违规），不验证组件存在/实现/装配。正向核验 53 组件：L2/L3/L5/L6/L7/L9/L10 真实；**L8 autoEvolve 永不触发**、**L4 BrainFacade reflectionEngine/metaLearner 字段 null + Synthesizer 未装配**、**L1 Agent/Evolution Controller 死组件**、**BrainFacade.learningLoop 无实现类**、文档称“Brain 已并入 cognition/”但实际未迁。**修复**：① bootstrap 注入 SelfImprovementLoop + setReflectionEngine/setMetaLearner + Synthesizer 装配；② checkAll 可选 capability 门禁 + **goal→capability 自动推断**（enableCapabilityInference 默认关）；③ **LearningLoop 实现**（聚合 learning/ 三件套，注入 BrainFacade）；④ **brain/ 8 文件真实迁移 cognition/**（目录删除）；⑤ 修复 `checkCapabilityAvailable` 存在性≠可用性（改 findForCapability）+ `CapabilityRegistry.init()` 从未被调用（改惰性 seed）。**文档**：morpex_ARCHITECTURE.md 100% 降级 + §6 审计记录表 + 10/10 层真实落地。**门禁**：tsc 0 + 架构无违规 + production 8/8 + 全量 vitest 37 文件 265 全过 | `deb84eb` `8fa3729` `0e2c1af` |
| S23 | 08-01 | **AICOS-Core 8 层架构重构**（10层→8层）+ 逐文件注册表 + 全量清理 + 冒烟验证 | **架构重构**（用户定夺 4 裁决）：Evaluation 独立 L6（从 governance 拆出）；Gate 独立目录（从 ontology 拆出 ForcedQueryGuard/runOntologyGroundedReasoning/types/ontologyEvents）；planning+learning 并入 cognition/（planner/→cognition/planning/）；knowledge/ 聚合（ontology-service+graph+artifact+memory+context）；infrastructure/ 聚合（common+observability+tools+protocol+utils+adapters）；governance/ 聚合（control-plane+capability）；execution/ 聚合（runtime→execution/runtime/）；evolution/ 聚合（capability feedback 并入）。core/src 收敛为 **10 顶层目录**（facade/governance/knowledge/gate/cognition/execution/evaluation/evolution/infrastructure/workflow）。**文档**：docs/AICOS_CORE_ARCHITECTURE.md（8 层单一真相源，取代 morpex_ARCHITECTURE.md）+ docs/AICOS_CORE_FILE_REGISTRY.md（346 文件功能+职责边界）+ docs/PROJECT_TREE.md。**清理**：19 份历史文档→docs/_archive/；死测试/孤儿脚本/benchmark→packages/archived/；AGENTS/README/.pi/SESSION_LOG 全部 10层→8层更新；validate-architecture.js 8 层路径化。**冒烟**：实机启动 StudioServer（8080/8099），8 层管线端到端贯通（Governance→Gate→Cognition→Execution→Evaluation→Evolution），53✅/0错误；发现并修复 MemoryMessages.ts pi-augmentations 引用 bug。**门禁**：tsc 0 + validate 100% + vitest 30 文件 199 全过 + production 8/8 | `0818014` `ccaaef8` `17da849` |
| S24 | 08-02 | **全功能测试方案 + 测试覆盖补缺 + 修复 2 个真实 bug（与并行会话整合）** | **方案**：`docs/TESTING_PLAN.md`（功能→测试矩阵 + L0-L6 金字塔 + 统一执行器 + CI 修复清单）。**统一执行器**：`scripts/run-everything.ts`（`npm run test:full` 一键测全部，L0 门禁→L1 vitest→L2 系统→L3 脚本式核心→L4 生产→L5 CLI→L6 k6 可选，报告 data/test-report/full-suite.json；实测 **25 步骤全绿 / 0 失败**）。**新增 5 个测试文件 +65 用例**（vitest 30→35 文件 / 199→264）：`eventbus-idempotency`（10 用例）、`governance-controllers`（13）、`evolution-closed-loop`（8）、`packages/connectors/__tests__/connectors`（12）、`packages/studio/server/__tests__/api-contract`（26 端点 24 通过/2 LLM 门禁）——填平治理控制器/演化/连接器/API/EventBus 幂等此前**零测试引用**缺口。**修复 2 个真实 bug（测试驱动发现）**：① `EventBus.triggerWildcard` 用 lastIndexOf 只匹配最深父命名空间，文档称 `runtime.*` 可收 `runtime.tool.called` 但实现不符 → 改匹配全部祖先命名空间；② `StudioServer` 从未挂载 `registerRuntimeRoutes`（RuntimeAPI 11 路由全部 404/死代码面）→ 已挂载；另加 `StudioServer.getPort()`（port 0 测试用）。**vitest.config.ts** include 补 connectors/workflows 模式。**并行会话整合**：检测到另一会话同时实现同一任务（run-full-test-suite.ts/tests/api/tests/cli/CI 修复），已收敛——以 run-everything.ts 为规范（package.json test:full 指向），删孤儿 run-full-test-suite.ts，修其 `critical-*/` 注释提前终止块注释致 tsc 崩溃 + `{}` 类型错误两处，保留其 CLI 测试（11/11）并采纳其方案文档。**门禁**：tsc 0 + validate 100% + vitest 35/264 + `npm run test:full` 25/25 全绿 | `c3f228f` `99cd4b2` `2ab07ed` `e8090d2` `5a68f2e` |
| S25 | 08-02 | **P1 测试补强：EvaluationEngine / primitives / OrganizationTwin 三组件零覆盖 → 86 用例** | 新增 3 个测试文件 **+86 用例**（vitest 35/264 → 38/350）：`evaluation-matrix.test.ts`（**26** 用例：QualityScorer 加权总分+decide 四档边界+EvaluationEngine 5 维聚合/缺省 0.5+Ontology 硬门禁 replan+引用缺失降级 retry+SafetyMonitor 阈值与 EventBus 广播）；`primitives-registry.test.ts`（**40** 用例：DomainPrimitiveRegistry 热注册/匹配排序/执行统计/清理 + 5 原语 canHandle + 执行器注入/未注入降级/Shell 白名单拦截/ArtifactGeneration Gate 守卫+副作用前校验+文件写入+部门隔离）；`organization-twin.test.ts`（**20** 用例：4 角色装配+simulateDecision 风险审批（LOW/MEDIUM/HIGH/CRITICAL）+上市投票 GO/REVISIT）。**修正 2 处测试自身错误**：① evaluation 空输入预期 decision=retry 实际应为 replan（decide(50) 在 [40,65) 区间，实现正确）；② primitives 测试 `setAllowedCommands(['echo'])` 未恢复默认白名单致后续用例 'pwd' 被拦截（已硬编码恢复）。**门禁**：tsc 0 + validate 100% + vitest 38/350 + `npm run test:full` 25/25 全绿（140s） | `07085ed` `528ba7d` |
| S26 | 08-02 | **P1 续：FSM 直接测试 + SSE 真实推送 + execute 闭环（vitest 350→387）** | `9e3e0a7` **加固**：primitives 两个「Gate 未初始化→reject」用例改用 `vi.resetModules()`+动态 import 拿全新模块副本，消除对文件执行顺序的依赖（fork 自曝脆弱点）+ 修正 TESTING_PLAN 用例数。`808edc5` **+38**：`artifact-facade.test.ts`（15：产物状态机 VALID_TRANSITIONS 全链/非法拒绝/FAILED 恢复 + Blueprint 依赖就绪 + 事件广播）、`execution-fsm.test.ts`（15：ExecutionFSM 合法/非法转换/onEnter-onExit-onTransition 回调/审计成对/快照持久化恢复，autoPersist 竞态规避）、`morpex-runtime.test.ts`（5：run() 9 阶段闭环 execute→artifact→verification→mission COMPLETED，stub engine 其余真实装配）、`sse-execute-e2e.test.ts`（2：真实建连收 connected 首帧 + POST /api/execute → SSE 实时收到 `execution.engine.started`）。**修复测试自身 2 错**：① departmentId 由 `context.team.departments[0]` 派生（非 options 直传）；② SSE 竞态——POST execute 可能在 onProjected 订阅建立前触发致事件丢失（先等 connected 帧再触发）。**门禁**：tsc 0 + vitest 42/387 + test:full 25/25（156.7s） | `9e3e0a7` `808edc5` |
| S27 | 08-02 | **P1 尾项：PolicyEngine/EvolutionController + Synthesizer/ExecutionFabric（vitest 387→430）** | `885e004` **+43**：`policy-engine.test.ts`（25：默认规则优先级 critical→block/high→approval/medium+敏感工具/medium→notify/low→auto + 自定义规则覆盖/removeRule/setConfig 兜底 + execute() approvalEngine 副作用 + evaluateWorkflow 达标/强制人工/不达标/边界 needs_review/general 兜底 + evaluateAgentAction 默认放行/角色规则/remove + EvolutionController 集成）；`synthesizer-fabric.test.ts`（18：CrossDepartmentKnowledgeSynthesizer 依赖注入/跨部门融合/highValueMigration/migratePattern adapted·partial·failed/事件 + ExecutionFabric 能力注册/未知能力/注销/findCoverage/批量解析/重试/agentId 直连）。**修复测试自身 1 错**：custom_t 策略 successRate 0.9 落在 0.99 阈值 10% 边界内→needs_review（正确），改远低于阈值才断言 reject。**里程碑：覆盖矩阵 ❌ 清零（0/0）**。门禁：tsc 0 + vitest 44/430 + test:full 25/25（179.8s） | `885e004` |
| S28 | 08-02 | **P2：覆盖率报告(c8) + security-middleware 认证 + k6 冒烟（vitest 430→447）** | `962e05b`：① 覆盖率——安装 `@vitest/coverage-v8` + vitest.config coverage 配置（include 核心源码/exclude 桶与测试，阈值 25/20/24/27 略低于基线防回退，报告 data/test-report/coverage/）+ `npm run test:coverage` + runner `--with-coverage` 阶段 + CI coverage job；② `security-middleware.test.ts`（17：API Key 认证开放/401/header+query/observability+stream 豁免 + 安全头 6 项 + CORS + 速率限制 429 + 输入校验截断/强转 + applySecurityMiddleware 注册 5 中间件）；③ k6——新增 `scripts/k6-smoke.js`（:8080 真实只读端点 + P95/错误率阈值）+ run-k6-test.sh 校准端口/脚本选择/预检 + CI k6-smoke job（Docker）。门禁：tsc 0 + vitest 45/447 + test:full --with-coverage 25/25 | `962e05b` |
| S29 | 08-02 | **P2 尾项：混沌注入（EventBus 崩溃/存储写满/TOCTOU）+ 领域插件工具链（vitest 447→469）** | `91fba20` **+22**：`chaos-concurrency.test.ts`（6：EventBus 崩溃韧性——通配符/projected listener 崩溃不阻塞其他 + 多次崩溃状态不腐坏；EvolutionSandbox TOCTOU 并发守卫——并发 approveAndApply→apply 只执行一次 / 并发 rollback→revert 只一次）；`storage-resilience.spec.ts`（9：JSONLWriter 缓冲/刷盘/存储写满降级——数据保留→重试→丢弃不崩/shutdown 拒写 + LogRotator 阈值轮转/防并发/cleanupOldFiles 过期清理）；`plugin-toolchain.test.ts`（7：vi.mock child_process 模拟 buildcli 缺失 → xjmcu compile 优雅降级 / pipeline 部分降级 steps.compile.ok=false / generate 纯 fs 真实产出 C 源码）。`ddfba2f`：gitignore 补 `build/`。**修复测试自身 3 错**：① TOCTOU 测试死锁（先 await inflight 守卫返回的 p2 再 release gate）；② JSONLWriter MAX_RETRY=3 需 4 次 flush 才丢弃（count 0→3）；③ pipeline 编译失败被捕获记录为 partial 非致命。门禁：tsc 0 + vitest 48/469 + test:full 25/25（151.9s） | `91fba20` `ddfba2f` |

> ⚠️ **记录更正（S29 附注）**：① S24 行所述「并行会话」实为本会话自身并行 fork——三 fork 共享同一工作目录、互相看到对方改动所致，非外部独立会话；产物已收敛且全部验证通过。② S25 用例数更正为 86（26/40/20），S24/S25 原始行数字有出入，以本文档更正后为准。

---

## 3. 当前待办（TO-DO）

### 🔴 立即可做
- [ ] **推送提交**：本地 `master` 领先远端 **17** 提交（S22×4 + S23×3 + S24×5：`c3f228f`~`5a68f2e` + S25×2：`07085ed`/`528ba7d` + S26×2：`9e3e0a7`/`808edc5` + S27×1：`885e004` + S28×1：`962e05b` + S29×2：`91fba20`/`ddfba2f`）。**github.com 被网络层封锁**（curl/bing 可达、github:443 超时、git:// 超时、无代理），换可访问网络后 `git push origin master` 一次性推送

### 🟢 已排期（下一会话主任务）
- [ ] **测试体系已全面建成（S24-S29，vitest 48 文件/469 用例，`npm run test:full` 一键 25/25）**：
  · ✅ 已交付：方案 `docs/TESTING_PLAN.md`（覆盖矩阵 ❌ 清零）+ 统一执行器 `run-everything.ts`（--with-coverage/--with-k6/--quick）+ 覆盖率报告（c8，阈值防回退）+ 修复 EventBus 通配符/RuntimeAPI 未挂载 2 个真实 bug + 15 个新测试文件 +275 用例（vitest 199→469）
  · ✅ P1 全部完成：EvaluationEngine/primitives/OrganizationTwin/ArtifactFacade/ExecutionFSM/MorPexRuntime/SSE/execute 闭环/PolicyEngine/EvolutionController/Synthesizer/ExecutionFabric
  · ✅ P2 全部完成：coverage 报告 + security-middleware 认证 + k6 冒烟（scripts/k6-smoke.js，:8080）+ 混沌注入（EventBus 崩溃/存储写满/TOCTOU）+ 插件工具链降级
  · ⏳ 唯一 P2 尾项：cognee 真实链路测试（需外部 cognee 服务，`scripts/run-all.sh` 就绪后补）
  · ⚠️ 注意：`tests/api/` 已删除（API 契约以 `api-contract.test.ts` 为准）；S24「并行会话」实为本会话自身并行 fork（见 S29 附注）
- [ ] **记忆系统（L7）整合（S13/S14 已收敛核心，剩深水区）**：
  · ✅ 已交付：统一记忆层 @morpex/memory（MemoryAPI+白名单+确认队列+强制门禁+cognee引擎）+ Gate 第5工具 + 读写入口统一（rememberEpisode/MemoryApiBus/search-tool/PersonalBrain纯内存化/BrainPersistor走统一层）+ 废弃 Python company_memory
  · ⏳ 剩余碎片（需收敛到 SQLite/统一层）：① ~~KnowledgeGraph(JSONL)→SQLite~~ ✅（S15 完成）；② ~~BrainFacade 学习闭环→MemoryAPI~~ ✅（S15 完成）；③ ~~MemoryActivationEngine working 数据源统一到 MemoryAPI~~ ✅（S18 完成：MemoryActivationSource + refresh + bootstrap 装配 + RuntimeAPI 复用，首拉 7 条实测）；④ SystemMetadataGraph（运行时对象图，内存+EventStore）保留非记忆
  · ✅ zvec + BGE-M3 已移除（S17）：MemoryWiki SQLite-only；语义检索走 cognee；run-all.sh 仅 cognee+backend
  · ✅ 全栈已可运行（S16）：`./scripts/run-all.sh`；cognee 数据目录 `~/.morpex/cognee`；venv 复用 `/tmp/cognee_spike/.venv`（无则 start-cognee.sh 建 `.venv-cognee`）
  · ⚠️ 环境：cognee 需 Python（venv 就绪）；Docker 不需要；前端 `packages/studio/ui` 尚不存在（后端仅 API 模式）

### 🟡 已知遗留（外部依赖，非紧急）
- [x] ~~L9 真实领域插件~~ ✅（S20 完成骨架验证 + 凭证占位 + mock 降级测试；真实调用需外部凭证，`.env.example` 配置后即生效）
- [ ] hardware/xjmcu 工具链：需本机 python + buildcli（真实逻辑已实现，环境就绪自动生效）
- [x] ~~L8 自动回滚具体变更~~ ✅（S19 完成：EvolutionSandbox apply/revert/verify + 失败补偿 + 并发守卫，8 用例）
- [x] ~~phase0-smoke 2 个部门路由测试~~ ✅（S20 修复：根因 execute_goal 审批策略缺失，主入口被卡死；19/19 全过）

### ⚪ 潜在优化（无排期）
- [ ] **S22 审计遗留**：① ~~BrainFacade.learningLoop 无实现类~~ ✅（S22 补全：LearningLoop 聚合 learning/ 三件套并注入）；② ~~L1 Agent/Evolution Controller 未进完整门禁~~ ✅（S22：capability 门禁 + goal→capability 自动推断 enableCapabilityInference，默认关）；③ ~~ReflectionEngine/MetaLearner 未真实迁移~~ ✅（S22：brain/ 8 文件 git mv 至 cognition/，目录删除）
- [x] ~~BrainFacade 聚合门面完整重包~~ ✅（S20 完成：聚合 MemoryActivationEngine + DeliveryPlanner，activateMemory/planGoal 门面）
- [x] ~~DeliveryPlanner/HierarchicalPlanner 在非 Mission 路径的更广接入~~ ✅（S20 完成：CompanyFacade 非 mission 模式先规划）
- [x] ~~⚠️ 新发现（既有，非本轮引入）：`__tests__/` 下 30+ 脚本式测试文件混入 vitest include 致全目录跑失败（v11 遗留）+ vitest alias 未配 `@morpex/contracts/*` 子路径 + `morpex-knowledge.test.ts` 残留已删 VectorStore 引用（S17）~~ ✅（S21 完成：exclude 脚本式 + alias 子路径 + 死引用清理，`npx vitest run` 35 文件 254 测试全绿）

---

## 4. 关键路径速查

| 关注点 | 路径 |
|--------|------|
| 统一运行时装配 | `packages/core/src/bootstrap-unified.ts` |
| L1 治理/授权 | `packages/core/src/governance/`（control-plane + capability + policy/risk/approval/resource/alert/verification） |
| L2 知识权威 | `packages/core/src/knowledge/`（ontology + graph + artifact + memory + context） |
| L3 Ontology Gate | `packages/core/src/gate/`（ForcedQueryGuard/runOntologyGroundedReasoning/types/ontologyEvents） |
| L4 认知与规划 | `packages/core/src/cognition/`（brain + planning + learning + twin/goal/workflow/decision/memory） |
| L5 执行 | `packages/core/src/execution/`（fabric + harness + runtime/） |
| L6 评价 | `packages/core/src/evaluation/`（EvaluationEngine/QualityScorer/ontologyCompliance） |
| L7 演化 | `packages/core/src/evolution/`（EvolutionSandbox + workflow + mining） |
| L8 基础设施 | `packages/core/src/infrastructure/`（adapters/common/observability/protocol/tools/utils） |
| 唯一入口 | `packages/core/src/facade/`（CompanyFacade + gateway） |
| 插件 | `packages/workflows/<domain>/` |

---

## 5. 版本基线

- 当前 HEAD：`ddfba2f chore(gitignore): 忽略 build/`（S29，本地领先远端 **17**，未推送）
- 上游基线：`origin/master`（`dcb045b`，已同步）
- 测试体系：`docs/TESTING_PLAN.md`（方案+覆盖矩阵，❌ 清零）+ `scripts/run-everything.ts`（`npm run test:full` 一键 25/25，~150s）+ vitest 48 文件/469 用例 + 覆盖率 `data/test-report/coverage/`
- 架构唯一真相源：`docs/AICOS_CORE_ARCHITECTURE.md`（AICOS-Core 8 层）+ `docs/AICOS_CORE_FILE_REGISTRY.md`（346 文件注册表）；旧 `morpex_ARCHITECTURE.md` 已归档
