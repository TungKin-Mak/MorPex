# MorPex 会话交接日志（SESSION LOG）

> **本文件是每次会话的「记忆入口」。** 规则：
> - **会话开始时**：先读本文件（项目状态 + 待办 + 上轮摘要）
> - **会话结束时**：更新「会话历史」表 + 「当前待办」，确保下个会话零上下文丢失
> - **发现机制**：`AGENTS.md`（主流 Agent 工具自动发现 + pi 项目级 `.pi/SYSTEM.md` 系统入口）→ 指向本文件
> - 架构详情见 `morpex_ARCHITECTURE.md`（唯一真相源）；实现度矩阵见 `docs/IMPLEMENTATION_AUDIT.md`

---

## 1. 项目快速概览（2026-07-31 快照）

**MorPex v16** — 一人公司 AI 工作助理（TypeScript / Node.js / pi-ai 0.81.1）

- **理想架构**：10 层 vNext+（README / morpex_ARCHITECTURE.md）——分级 Ontology Gate / Bounded Autonomy / QueryMiss is Signal / Verifiable Evolution
- **统一运行时**：`packages/core/src/bootstrap-unified.ts`（`bootstrapUnified()` 全 10 层装配）
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

---

## 3. 当前待办（TO-DO）

### 🔴 立即可做
- [ ] **推送提交**：本地 `master` 领先远端 1 提交（`982a9b9`，S16 修复）。当前推送失败：`git push` 报连不上 github.com:443（Recv failure: Connection was reset）。网络恢复后执行 `git push origin master`

### 🟢 已排期（下一会话主任务）
- [ ] **记忆系统（L7）整合（S13/S14 已收敛核心，剩深水区）**：
  · ✅ 已交付：统一记忆层 @morpex/memory（MemoryAPI+白名单+确认队列+强制门禁+cognee引擎）+ Gate 第5工具 + 读写入口统一（rememberEpisode/MemoryApiBus/search-tool/PersonalBrain纯内存化/BrainPersistor走统一层）+ 废弃 Python company_memory
  · ⏳ 剩余碎片（需收敛到 SQLite/统一层）：① ~~KnowledgeGraph(JSONL)→SQLite~~ ✅（S15 完成）；② ~~BrainFacade 学习闭环→MemoryAPI~~ ✅（S15 完成）；③ **MemoryActivationEngine** working 数据源统一到 MemoryAPI（装配层：memoryStore 由统一层注入）；④ SystemMetadataGraph（运行时对象图，内存+EventStore）保留非记忆
  · ✅ 全栈已可运行（S16）：`./scripts/run-all.sh`；cognee 数据目录 `~/.morpex/cognee`；venv 复用 `/tmp/cognee_spike/.venv`（无则 start-cognee.sh 建 `.venv-cognee`）
  · ⚠️ 环境：cognee 需 Python（venv 就绪）；Docker 不需要；前端 `packages/studio/ui` 尚不存在（后端仅 API 模式）

### 🟡 已知遗留（外部依赖，非紧急）
- [ ] L9 真实领域插件：ecommerce(Amazon SP-API)/software(云部署) 需外部凭证，骨架已就绪（`packages/workflows/<domain>/src/actions/`）
- [ ] hardware/xjmcu 工具链：需本机 python + buildcli（真实逻辑已实现，环境就绪自动生效）
- [ ] L8 自动回滚具体变更：当前为版本化回滚入口（`EvolutionSandbox` 半自动）
- [ ] phase0-smoke 2 个部门路由测试：**预存失败**（ControlPlane 审批策略行为，HEAD 上同样失败，非回归）

### ⚪ 潜在优化（无排期）
- [ ] BrainFacade 聚合门面完整重包（各能力已直连运行时事件）
- [ ] DeliveryPlanner/HierarchicalPlanner 在非 Mission 路径的更广接入

---

## 4. 关键路径速查

| 关注点 | 路径 |
|--------|------|
| 统一运行时装配 | `packages/core/src/bootstrap-unified.ts` |
| Ontology Gate | `packages/core/src/ontology/`（types/runOntologyGroundedReasoning/OntologyService） |
| 执行引擎 + 原语兜底 | `packages/core/src/execution/UnifiedExecutionEngine.ts` |
| 原语注册中心 | `packages/core/src/tools/DomainPrimitiveRegistry.ts` + `tools/primitives/` |
| Connector 层 | `packages/connectors/src/` |
| 规划层 | `packages/core/src/planner/`（DeliveryPlanner + Adapter + Arbitration） |
| 演化沙箱 | `packages/core/src/evolution/EvolutionSandbox.ts` |
| 治理/观测 | `packages/core/src/governance/GovernanceDashboard.ts` |
| 记忆 | `packages/memory/src/`（MemoryWiki/ZVec）+ `packages/core/src/memory/knowledge/` |
| 插件 | `packages/workflows/<domain>/` |
| 实现度矩阵 | `docs/IMPLEMENTATION_AUDIT.md` |

---

## 5. 版本基线

- 当前 HEAD：`dcb045b docs(session-log): 记录 S15…`（S16 修复待提交）
- 上游基线：`origin/master`（已同步，0 ahead）
- 架构唯一真相源：`morpex_ARCHITECTURE.md`
