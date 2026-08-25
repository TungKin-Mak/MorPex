# CAPABILITY_INDEX — MorPex 能力索引（功能 → 锚点 + 别名 + 状态）

> 用途：**开发流程第一步「定位」**——新增/改造功能前先查本索引，判断"是否已实现、在哪个锚点"，避免：重复实现、已实现未接入被误删、greases 关键词误判"没有"。
> 维护：**改哪条更新哪条（统一模板）**；新增能力按域加行；锚点 = 文件·类/函数（可 grep/跳转）。
> 状态：✅ 已接入（有生产调用链）｜🟡 部分/待接入 ｜ 规划中。

## 0. 怎么用（给 LLM 的决策）
1. 用「功能语义」在此索引查（含别名）→ 命中 = 已实现，看锚点决定**复用/扩展**；
2. 未命中 → 走 `HOOK_MAP.md` 找插入点；不要在索引无命中时直接造轮子。

---

## 1. 治理 / 授权（L1）
| 能力 | 别名 | 锚点 | 状态 | 扩展怎么做 |
|---|---|---|---|---|
| 目标授权与计划签发 | goal 授权、AuthorizedGoal | `governance/control-plane/ControlPlane.ts`·checkAll / GoalController | ✅ | 在 Controller 加规则或 autorize 后置逻辑 |
| 策略决策（自动/通知/审批/阻断） | 策略引擎、policy 规则、RiskDecision | `governance/PolicyEngine.ts`·decide | ✅ | 加策略规则（PolicyRuleRegistry）|
| 人工审批请求 | 审批、approval、需人工确认 | `governance/ApprovalGate.ts`·request | ✅ | 接入 `eventContractCatalog` approval 契约 + 前端审批卡片 |
| 风险评级 | 风险评估、risk 分级 | `governance/RiskAnalyzer.ts`·analyze | ✅ | 扩展风险因子 |
| 成本/资源配额 | 预算、CostController | `governance/CostController.ts` `control-plane/ResourceController.ts` | ✅ | 加配额维度 |
| 部门空间隔离 | Space、部门视图 | `governance/control-plane/SpaceService.ts` | ✅ | 新部门类型→space-types |

## 2. 知识 / 记忆（L2）
| 能力 | 别名 | 锚点 | 状态 | 扩展怎么做 |
|---|---|---|---|---|
| 报告/汇总/摘要生成 | 简报、日报、复盘、report、summary、成本报告、治理报告 | `cognition/BrainFacade.generateCEOReport` ｜ `facade/CompanyFacade.generateDailyReport` ｜ `evaluation/EvaluationEngine.computeReport` ｜ `governance/AuditTrail.generateReport` ｜ `StudioServer.generateTaskSummary` ｜ `GovernanceDashboard.getCostReport/getGovernanceReport` 等（分散多模块） | ✅ 能力已存在（分散） | 要统一“复盘简报”→ 订阅 `evaluation.profile.scored`（HOOK_MAP 后置）+ 新增原语或复用 `ArtifactFacade.create`；勿重复造 generateReport |
| 本体查询 | Ontology、图谱检索 | `knowledge/ontology/OntologyService.ts` + `gate/runOntologyGroundedReasoning.ts` | ✅ | 新实体/投影→objectTypes/Projector |
| 知识库检索（QueryMiss 信号） | 检索、knowledge query | `infrastructure/tools/primitives/KnowledgeQueryPrimitive.ts` | ✅ | QueryMiss 事件→演化 |
| 产物注册/生成/血缘 | artifact、产物 | `knowledge/artifact/`ArtifactBlueprint / ArtifactFacade | ✅ | 新产物类型→Blueprint |
| 记忆 API（cognee/wiki/SQLite） | 记忆、Memory API | `memory/src/MemoryApi.ts`（引擎 cognee/mock） | ✅ | 新引擎→engines/factory |
| 用户画像/纠错/澄清/约定四类记忆 + 权重沉淀 | 记住xxx、画像、纠错、澄清、遗忘、永久记忆 | `studio/server/transcript/memory-extractor.ts`（LLM 提取四路分流）+ `memory/src/storage/MemoryWeightStore.ts`（tier/weight）+ `scripts/memory-consolidate.mts`（晋升衰减批处理）+ MemoryApi.confirm/invalidate | ✅ | 新记忆类型→EXTRACT_SYSTEM prompt 分类+routeCandidate 分流；调参→MemoryWeightStore 阈值常量 |
| MemoryWiki 持久化 | wiki、SQLite 记忆 | `memory/src/wiki/MemoryWiki.ts` | ✅ | 扩展 schema |
| 定时触发任务 | 定时、cron、schedule、到点执行 | `studio/server/schedule-manager.ts`（CronScheduler）+ StudioServer /api/schedules | ✅ | 触发走 chatSendHandler 同款链路；补跑策略=跳过 |
| 用户画像记忆（跨会话） | 画像、记住我、长期记忆、memory extractor | `studio/server/transcript/memory-extractor.ts`（订阅 chat.turn.completed 提取候选→确认工单）｜`MemoryApi.confirm/listPendingConfirmations`（批准落库）｜`StudioServer.ts:1101` 召回注入直答开场 | ✅ T5 | 新候选类型→EXTRACT_SYSTEM 提示词；调阈值→confidence 0.6/autoWrite 0.8 |
| 记忆分类与召回分级（纠错/澄清/约定） | 纠错、教训、澄清、术语表、约定、T6 | `memory-extractor.ts`（四类候选+mapCandidateEntity 实体名前缀 纠错:/术语:/约定:）｜`MemoryApi.confirm`（覆盖语义：批准纠错/澄清自动 invalidate 同主题旧条目）｜`OrchestratorAgent.lessonQuery`（执行前教训召回，ServiceContainer 注入）｜StudioServer 直答三路查询（画像/约定/术语表） | ✅ T6 | 新分类→VALID_TYPES+EXTRACT_SYSTEM+mapCandidateEntity 三处同步；调召回→各处 query 文本与前缀过滤 |
| 任务瞬间上下文装配（RAG-lazy） | 上下文、RAG、聚焦摘要 | `knowledge/context/ContextAssemblyEngine.ts` | ✅ | 新 fragment 源→ContextFragmentRegistry |

## 3. 认知 / 规划（L4）
| 能力 | 别名 | 锚点 | 状态 | 扩展怎么做 |
|---|---|---|---|---|
| 意图分流（闲聊 vs 任务） | 意图、chat/goal | `facade/CompanyFacade.ts`·executeGoal | ✅ | 分流启发式 |
| 分层规划（战略/执行） | planning、DeliveryPlanner | `cognition/planning/DeliveryPlanner.ts` + HierarchicalPlanner | ✅ | 新规划策略 |
| 跨部门仲裁 | 仲裁、Arbitration | `cognition/planning/CrossDepartmentArbitrationEngine.ts` | ✅ | 仲裁规则 |

## 4. 执行 / 工具 / 原语（L5 / 工具层）
| 能力 | 别名 | 锚点 | 状态 | 扩展怎么做 |
|---|---|---|---|---|
| 简单任务原语快路径 | 快路径、UnifiedExecutionEngine | `execution/UnifiedExecutionEngine.ts` | ✅ | 新原语→注册 |
| 复杂任务编排（Orchestrator+step-agent） | 编排、orchestration | `execution/orchestration/OrchestratorAgent.ts` + `dag/StepAgentExecutor.ts` | ✅ | 新 step 能力→工具集 |
| 通用原语（knowledge/file/shell/api/artifact） | Primitive、原语 | `infrastructure/tools/primitives/*` + `DomainPrimitiveRegistry` | ✅ | **新增原语 = 注册点** |
| 安全执行（白名单/shell:false/凭据清洗） | secureExec、命令安全 | `infrastructure/common/secureExec.ts` + `connectors/ShellConnector.ts` | ✅ | executor 模式（local/msys/docker 待接）|
| 问用户（人工决策） | ask、需要用户、澄清 | `execution/UserAskService.ts` | ✅ | 绑定 EVENT_SPEC human 块 |
| 子代理/任务分派 | SubAgent、fork | `execution/SubAgentFork.ts` | ✅ | fork 策略 |

## 5. 评价 / 演化 / 人工（L6 / L7）
| 能力 | 别名 | 锚点 | 状态 | 扩展怎么做 |
|---|---|---|---|---|
| 质量/合规/血缘 5 维评分 | 评分、Evaluation | `evaluation/EvaluationEngine.ts` + QualityScorer | ✅ | 评分维度 |
| 演化提案 + 沙箱试跑 + 审批 | evolution、改进 | `evolution/EvolutionSandbox.ts` + ActiveEvolutionTrigger | ✅ | 演化动作 |
| QueryMiss→演化闭环 | feedback、学习 | `evolution/KnowledgeGapListener.ts` + LearningLoop | ✅ | 新事件源 |

## 6. 事件 / 消息 / 前端
| 能力 | 别名 | 锚点 | 状态 | 扩展怎么做 |
|---|---|---|---|---|
| 事件总线（at-least-once+契约校验） | EventBus、事件 | `infrastructure/common/EventBus.ts` + `contracts/eventContractCatalog.ts` | ✅ | 新事件=契约+emit |
| 任务状态投影（卡片真相源） | 任务卡片、tasks API | `execution/TaskStateProjector.ts` + `StudioServer /api/tasks` | ✅ | 卡片字段=EVENT_SPEC 块 |
| SSE 实时推送 | 事件流、ws | `studio/server/observability/ws-handler.ts` + `event-bus.ts` | ✅ | 订阅新事件 |
| 消息载荷规格（Envelope/MessageBox） | 消息、payload | `docs/EVENT_PAYLOAD_SPEC.md` + `protocol/events/Envelope.ts` | ✅ | 新块=加 namespace |
| 前端视图（会话/仪表盘/事件/产物） | UI、web | `studio/web/src/views/*` | ✅ | 新视图/卡片→views |

## 7. 领域插件（packages/workflows）
| 能力 | 别名 | 锚点 | 状态 | 扩展怎么做 |
|---|---|---|---|---|
| 电商工作流 | ecommerce、Amazon | `workflows/ecommerce/workflow-provider.ts` + `src/actions/amazon-primitives.ts` | ✅ | 新行动=ActionPrimitive |
| 硬件/固件/仿真 | hardware、MCU | `workflows/hardware/`（firmware+simulation） | ✅ | 同上 |
| 软件开发流程 | software、GitHub/Docker | `workflows/software/workflow-provider.ts` | ✅ | 同上 |
| MCU 开发 | xjmcu、编译/烧录 | `workflows/xjmcu/src/actions/*.ts` | ✅ | 同上 |
| 部门手册（yaml 工作流） | 部门、yaml、manual、矽杰微开发部、回跳 | `execution/runtime/manual/YamlManualLoader.ts` + `YamlWorkflowRuntime.ts` + `workflows/xjmcu/department/manual.yaml` | ✅ | 新部门=加 manual.yaml 一行 + `bootstrap-unified` 清单注册 |