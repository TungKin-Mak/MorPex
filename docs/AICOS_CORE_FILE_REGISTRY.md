# AICOS-Core 逐文件注册表（功能 + 职责边界）

> 版本: 2.1 | 单一真相源: `docs/AICOS_CORE_ARCHITECTURE.md`

> **目的**：逐文件登记「功能」与「职责边界」，防止功能碎片化、重复实现、职责边界模糊。

> **维护规则**：新增/修改文件必须同步本表；同一职责只允许一个文件拥有；跨层访问必须经 L3 Gate。

> **列说明**：功能 = 文件顶部声明；职责边界 = 文件自身声明中的边界条款（含"职责/不做/只做/禁止"者直接引用），否则用层边界规则。


## `facade/`（4 文件）

> 层边界规则：编排与协议适配；不承载业务/认知/存储逻辑

| 文件                                     | 功能                                                                                                                                                                                                                                                                   | 职责边界                                                                                                                                                                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `facade/CompanyFacade.ts`              | CompanyFacade — CEO 高层操作入口（v16 Unified） ═══ 硬管道 ═══ - Runtime 与 ControlPlane 构造时强制（NODE_ENV=production 旧签名抛错） - executeGoal: ControlPlane.checkAll() + RunOptions 透传 - sendTask: 委托 executeGoal（不跳过门禁）；T0 多轮连续：新增 orchestratorSessionPath 透传/resume（chat 会话复用同一本 orchestrator 账本，历史注入分析 prompt） /                                                             | 编排与协议适配；不承载业务/认知/存储逻辑                                                                                                                                                                                                                                                |
| `facade/gateway/ExecutionGateway.ts`   | ExecutionGateway — 统一执行网关 职责： - 管理多个运行时适配器（PiAdapter 等） - 根据 agentRole 路由到对应 adapter - 确保 executionId 已设置 - 调用 adapter.execute() 并标准化返回结果 - 通过 EventBus 广播 runtime.* 事件 设计约束： - Gateway 不缓存状态（薄桥转发） - 所有事件通过 EventBus 广播 - 所有事件 ID 必须通过 ExecutionIdentity.createEven | ExecutionGateway — 统一执行网关 职责： - 管理多个运行时适配器（PiAdapter 等） - 根据 agentRole 路由到对应 adapter - 确保 executionId 已设置 - 调用 adapter.execute() 并标准化返回结果 - 通过 EventBus 广播 runtime.* 事件 设计约束： - Gateway 不缓存状态（薄桥转发） - 所有事件通过 EventBus 广播 - 所有事件 ID 必须通过 ExecutionIdentity.createEven |
| `facade/gateway/adapters/PiAdapter.ts` | PiAdapter — pi AgentRuntime → AgentRuntimeAdapter 适配器 将现有 AgentRuntime（src/core/runtime.ts）包装为标准的 AgentRuntimeAdapter。 包装对象：AgentRuntime（src/core/runtime.ts） 不包装：Orchestrator、MentionRouter、FSMAgentRuntime 内部逻辑： execute(request) ├── ExecutionRequest.input → pi  | 编排与协议适配；不承载业务/认知/存储逻辑                                                                                                                                                                                                                                                |
| `facade/index.ts`                      | facade — CEO 高层操作入口模块 Phase 0 / 基础设施层 CompanyFacade = 一人虚拟公司的"CEO 控制台" /                                                                                                                                                                                             | 编排与协议适配；不承载业务/认知/存储逻辑                                                                                                                                                                                                                                                |


## `governance/`（29 文件）

> 层边界规则：目标级授权；不推理/不执行/不直接查知识

| 文件 | 功能 | 职责边界 |
|---|---|---|
| `governance/AlertEngine.ts` | AlertEngine — 告警引擎（基于 EventBus） | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/ApprovalGate.ts` | ApprovalGate — 审批门 v16: Compliance → RiskAssessment → ApprovalGate → Release Stabilization: 增加 ApprovalPolicyRegistry 商业级策略引擎 / | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/AuditTrail.ts` | AuditTrail — 审计追踪层 Phase 8 / MorPex v8: 不可篡改的治理决策记录。 职责： 1. 记录所有风险分析结果 2. 记录所有审批决策（approve/deny/expire） 3. 记录所有执行状态变更 4. 提供审计报告生成 5. 支持按 Mission/类型/时间范围查询 设计原则： - 只追加（append-only）：已有条目不可修改或删除 - 不可篡改：每条记录包含时间戳和执行者信息 - 高效查询：使用 Map 索引优化按 Mission 和类型的查询 - 内存优先：支持  | AuditTrail — 审计追踪层 Phase 8 / MorPex v8: 不可篡改的治理决策记录。 职责： 1. 记录所有风险分析结果 2. 记录所有审批决策（approve/deny/expire） 3. 记录所有执行状态变更 4. 提供审计报告生成 5. 支持按 Mission/类型/时间范围查询 设计原则： - 只追加（append-only）：已有条目不可修改或删除 - 不可篡改：每条记录包含时间戳和执行者信息 - 高效查询：使用 Map 索引优化按 Mission 和类型的查询 - 内存优先：支持  |
| `governance/ComplianceChecker.ts` | ComplianceChecker — 合规检查引擎 v15: 按领域执行策略规则检查，返回 PASS/WARNING/BLOCK / | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/CostController.ts` | CostController — 成本控制器（基于 EventBus） | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/AnomalyDetector.ts` | AnomalyDetector — 异常告警（v16d P3）：监听 step/装配事件流，检测空参率突升/原语连续失败/装配超时 → observability.anomaly + 冷却去抖 + 历史查询 | 目标级授权；只监测不干预 |
| `governance/GovernanceDashboard.ts` | GovernanceDashboard — 治理看板 v13 VCOS 100: 将 Observability & Governance 从 8→10 提供三个维度的治理视图: - SystemHealth: 系统健康度（模块状态、延迟、错误率） - CostReport: 成本追踪（LLM 调用、token 消耗） - ComplianceReport: 合规状态（PiBridge 隔离、barrel 完整性） 所有数据通过 EventBus 事件驱动采集，无需主动轮询。 / | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/PermissionModel.ts` | PermissionModel — 权限模型 Phase 7 / MorPex v8.5: 细粒度用户权限管理。 职责: 1. 基于用户的权限集控制操作许可 2. 支持按领域（domain）和工具（tool）的细粒度控制 3. 支持最大风险等级控制（高于此等级的操作默认拒绝） 4. 按用户管理：每个用户拥有独立的 PermissionSet 设计原则: - 用户中心: 权限以用户为单位，而非以角色为单位 - 细粒度: 权限、领域、工具、风险四个维度 - 可过期: 临时权限可设置过期时间 使用方式: const pe | PermissionModel — 权限模型 Phase 7 / MorPex v8.5: 细粒度用户权限管理。 职责: 1. 基于用户的权限集控制操作许可 2. 支持按领域（domain）和工具（tool）的细粒度控制 3. 支持最大风险等级控制（高于此等级的操作默认拒绝） 4. 按用户管理：每个用户拥有独立的 PermissionSet 设计原则: - 用户中心: 权限以用户为单位，而非以角色为单位 - 细粒度: 权限、领域、工具、风险四个维度 - 可过期: 临时权限可设置过期时间 使用方式: const pe |
| `governance/PolicyEngine.ts` | PolicyEngine — 策略引擎（P2 收敛：policy/PolicyEngine.ts 已删除，本类为唯一权威实现） PolicyEngine — 策略引擎 Phase 7 / MorPex v8.5: 基于风险等级 + 规则策略的自动化决策引擎。 职责: 1. 根据 ActionProposal 匹配预定义规则 2. 输出 PolicyDecision（auto_approve / notify_and_execute / require_approval / block） 3. 执行决策结果（自动批准 | PolicyEngine — 策略引擎（P2 收敛：policy/PolicyEngine.ts 已删除，本类为唯一权威实现） PolicyEngine — 策略引擎 Phase 7 / MorPex v8.5: 基于风险等级 + 规则策略的自动化决策引擎。 职责: 1. 根据 ActionProposal 匹配预定义规则 2. 输出 PolicyDecision（auto_approve / notify_and_execute / require_approval / block） 3. 执行决策结果（自动批准 |
| `governance/PolicyRuleRegistry.ts` | PolicyRuleRegistry — 合规策略规则注册中心 v15: 按领域注册可扩展的合规检查规则 / | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/RiskAnalyzer.ts` | RiskAnalyzer — 风险分析引擎 Phase 8 / MorPex v8: 在执行前评估 Mission 计划的潜在风险。 职责： 1. 分析 Mission 计划的复杂度风险 2. 检测涉及敏感领域（finance/legal/hr/production）的操作 3. 检测敏感工具（delete/deploy/email/payment）的使用 4. 评估权限范围（run-as / allowed-tools） 5. 生成包含缓解建议的 RiskAssessment 使用方式： const riskAn | RiskAnalyzer — 风险分析引擎 Phase 8 / MorPex v8: 在执行前评估 Mission 计划的潜在风险。 职责： 1. 分析 Mission 计划的复杂度风险 2. 检测涉及敏感领域（finance/legal/hr/production）的操作 3. 检测敏感工具（delete/deploy/email/payment）的使用 4. 评估权限范围（run-as / allowed-tools） 5. 生成包含缓解建议的 RiskAssessment 使用方式： const riskAn |
| `governance/RuntimeManager.ts` | RuntimeManager — 运行时管理器（基于 EventBus） | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/capability/AgentCapabilityRegistry.ts` | AgentCapabilityRegistry — Agent 能力节点（CapabilityNode）注册 | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/capability/CapabilityDiscoverer.ts` | CapabilityDiscoverer — 基于 CapabilityRegistry 的能力发现 | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/capability/CapabilityRegistry.ts` | CapabilityRegistry — 统一能力注册中心 (v16 合并版) 合并自: - capability/CapabilityRegistry.ts (静态注册) - experience/CapabilityStore.ts (动态模式存储) 现在: 一个地方存所有能力数据，包括成功率/步骤/领域/提取来源。 / | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/capability/index.ts` | capability — 能力注册 barrel | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/control-plane/AgentController.ts` | AgentController — Agent 控制器 ═══ v16 重构 ═══ - 整合 AgentCapabilityRegistry + CapabilityRegistry - 提供能力匹配 + Agent 选择 / | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/control-plane/ControlPlane.ts` | ControlPlane — AI System Controller 类似 Kubernetes Controller，系统所有行为经过此层。 ═══ v16 重构 ═══ - 新增 checkAll() 聚合检查方法 - 所有控制器整合真实逻辑（非空壳） - CompanyFacade.executeGoal() 强制经过此层 / | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/control-plane/DepartmentContext.ts` | DepartmentContext — 部门上下文分区工具 Phase 0 / 数据隔离基础设施 提供 departmentId 分区工具，用于 Memory/Knowledge/Artifact 的数据隔离。 分区策略： - 每个部门的数据存储为 "dept:{departmentId}" 分区 - CEO 全局视图为 "global" 分区（只读） - 现有历史数据标记为 "legacy" 分区 使用方式： import { DepartmentContext } from './control-plane/D | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/control-plane/DepartmentManager.ts` | DepartmentManager — 部门管理器 Phase 0 / 组织层核心 职责： 1. 创建/删除/更新部门（工作流=部门） 2. 按名称或 ID 查询部门 3. 发射部门生命周期事件（department.created/updated/deleted） 4. 提供部门统计 设计约束： - 构造时注入 EventBus，所有变更通过事件广播 - 部门 ID 格式：dept_{timestamp}_{random} - 部门数据目前存储于内存，后续可迁移到 SQLite / | DepartmentManager — 部门管理器 Phase 0 / 组织层核心 职责： 1. 创建/删除/更新部门（工作流=部门） 2. 按名称或 ID 查询部门 3. 发射部门生命周期事件（department.created/updated/deleted） 4. 提供部门统计 设计约束： - 构造时注入 EventBus，所有变更通过事件广播 - 部门 ID 格式：dept_{timestamp}_{random} - 部门数据目前存储于内存，后续可迁移到 SQLite / |
| `governance/control-plane/GoalController.ts` | GoalController — 目标控制器 ═══ v16 重构 ═══ - 整合 RiskAnalyzer 风险评估 - 返回完整的风险评估 + 审批建议 / | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/control-plane/PolicyController.ts` | PolicyController — 策略控制器 ═══ v16 重构 ═══ - 整合 ApprovalPolicyRegistry + budget checks - 提供 checkAction/reserveBudget/checkResource 方法 / | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/control-plane/ResourceController.ts` | ResourceController — 资源控制器 ═══ v16 重构 ═══ - 整合 CostController + RuntimeManager + CapabilityRegistry - 提供资源配额跟踪 / | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/control-plane/RoleRegistry.ts` | RoleRegistry — 简化版角色注册中心 Phase 0 / 组织层 相比 AgentRegistry（完整 Agent 生命周期 + 能力匹配 + 排名）， RoleRegistry 只做三件事： 1. 角色定义（岗位） 2. 角色分配（谁在什么部门担任什么角色） 3. 按角色查询 角色事件： - role.defined    — 新角色被定义 - role.assigned   — 角色分配给 Agent - role.unassigned — 角色分配被撤销 / | RoleRegistry — 简化版角色注册中心 Phase 0 / 组织层 相比 AgentRegistry（完整 Agent 生命周期 + 能力匹配 + 排名）， RoleRegistry 只做三件事： 1. 角色定义（岗位） 2. 角色分配（谁在什么部门担任什么角色） 3. 按角色查询 角色事件： - role.defined    — 新角色被定义 - role.assigned   — 角色分配给 Agent - role.unassigned — 角色分配被撤销 / |
| `governance/control-plane/department-types.ts` | Department Types — 部门核心类型定义 Phase 0 / 组织层 虚拟部门 = 一人公司中的"工作流即部门"抽象 / | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/control-plane/index.ts` | control-plane — AI System Controller（理想架构第 1 层） 已取代旧版 control-plane（已废弃）；intent 解析已迁至 goal-intelligence/intent，编排已迁至 control-plane/orchestrator / | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/control-plane/types.ts` | Role Types — 角色核心类型定义 Phase 0 / 组织层 相比 AgentRegistry 的完整生命周期管理，RoleRegistry 只关注： 1. 角色定义（岗位） 2. 角色分配（谁在什么部门担任什么角色） 3. 按角色查询 / | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/index.ts` | （barrel：统一导出，功能以被导出文件为准） | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/types.ts` | Governance Layer — 类型定义 Phase 8 / MorPex v8: 风险分析、审计追踪、治理配置。 设计原则： - RiskAnalyzer 只读不写：分析风险但不修改任何状态 - AuditTrail 只追加不改：审计日志不可篡改 - GovernanceConfig 集中配置：所有治理参数一处在 / | 目标级授权；不推理/不执行/不直接查知识 |


## `knowledge/`（45 文件）

> 层边界规则：权威存储+Tier写规则；不拦截/不推理/不触发演化

| 文件 | 功能 | 职责边界 |
|---|---|---|
| `knowledge/artifact/ArtifactBlueprint.ts` | ArtifactBlueprint — 产物蓝图 Phase 1-5: 在执行之前先定义产物规格，Execution 围绕蓝图进行 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/artifact/ArtifactFacade.ts` | ArtifactFacade — 产物门面（v16 生命周期升级） v16: 全生命周期管理 Created→Validating→Reviewing→Approved→Released→Deployed→Retired + Lineage 追踪 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/artifact/index.ts` | （barrel：统一导出，功能以被导出文件为准） | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/artifact/registry/ArtifactDependencyResolver.ts` | ArtifactDependencyResolver — 产物依赖解析器 解析 Artifact 之间的依赖关系，检测循环依赖，拓扑排序。 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/artifact/registry/ArtifactEmbedding.ts` | ArtifactEmbedding — 产物语义嵌入 为 Artifact 生成和管理语义向量，支持语义搜索和相似度比较。 注意：实际向量生成需要 LLM/Embedding 服务， 本模块提供向量存储、管理和相似度计算。 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/artifact/registry/ArtifactEvaluator.ts` | ArtifactEvaluator — 产物评估引擎 从完整性、一致性、可用性、性能等维度评估 Artifact 质量。 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/artifact/registry/ArtifactGraph.ts` | ArtifactGraph — 产物关系图 以图结构表示 Artifact 之间的依赖/引用关系， 支持血缘追踪和影响分析。 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/artifact/registry/ArtifactLineage.ts` | ArtifactLineage — 产物血缘追踪 追踪 Artifact 的血缘关系：谁生成了它，它基于什么生成，它被谁使用。 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/artifact/registry/ArtifactRegistry.ts` | ArtifactRegistry — Artifact 注册中心 (v2: 支持 URI 引用) Phase 11.3 升级：标准化 URI 格式 - URI 格式: artifact://{domain}/{artifactType}/{artifactId} - resolve(uri) — 通过 URI 解析 ArtifactInstance - listByDomain(domainId) — 列出指定领域的所有产物 管理所有 Artifact 的注册、查找、追踪。 维护 Artifact 图谱（paren | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/artifact/registry/ArtifactVersion.ts` | ArtifactVersion — 版本管理 每次 Artifact 内容变更时创建版本快照。 支持版本回滚和变更追溯。 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/artifact/registry/index.ts` | （barrel：统一导出，功能以被导出文件为准） | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/artifact/registry/types.ts` | Artifact Plugin — 类型定义 Artifact Model: Blueprint 和 Instance 的共同抽象。 Artifact Instance: 实际交付物（由 Agent 产出）。 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/context/ContextAssemblyEngine.ts` | ContextAssemblyEngine — 上下文组装引擎（核心） v9.1 Context Assembly Layer: 统一上下文构建入口。 流程： 1. 选择模板（按 templateId 或标签匹配） 2. 从注册中心收集必需 + 可选片段 3. 将片段注入 Builder 4. 应用模板基础数据 5. 构建 ExecutionContext 6. 运行增强流水线（可选） 7. 版本快照（可选） 8. 返回最终上下文 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/context/ContextBuilder.ts` | ContextBuilder — 上下文构建器 v9.1 Context Assembly Layer: 将多个上下文片段组装为统一的分层 ExecutionContext。 三层结构： - base: 基础层（不变的会话常量，如 schemaVersion、用户身份） - session: 会话层（当前会话数据，如 missionId、当前意图） - ephemeral: 临时层（瞬态计算结果，如风险评分、推荐） / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/context/retrieval/ContextRetriever.ts` | ContextRetriever — 上下文相关性检索器（v16i RAG-lazy · v16k·4 升级 Dense+Sparse+Cross-Encoder）：Dense(bge-m3) + Sparse(BM25) → RRF 融合 → Cross-Encoder 重排 → 领域/新鲜度 → Top-K，输出指针+蒸馏摘要 | 权威存储+Tier写规则；只检索不生成 |
| `knowledge/context/retrieval/SparseRetriever.ts` | SparseRetriever — BM25 稀疏检索器（v16k·4）：中文双字分词 + ASCII 单词，IDF 基于候选集统计，精确词项召回（专有名词/型号/ID） | 权威存储+Tier写规则；纯 JS 无外部依赖 |
| `knowledge/context/retrieval/Reranker.ts` | Reranker — Cross-Encoder 重排序器（v16k·4）：调用 OpenAI 兼容 /rerank（SiliconFlow bge-reranker-v2-m3），(query,doc) 联合打分精排 | 权威存储+Tier写规则；仅适配器层 |
| `knowledge/context/retrieval/ContextDistiller.ts` | ContextDistiller — 摘要蒸馏器（v16i）：历史/任务上下文压缩为 ≤maxLen 摘要（LLM 蒸馏可选 + 确定性关键行提取兑底） | 权威存储+Tier写规则；受控生成点有兑底 |
| `knowledge/context/ContextEnricher.ts` | ContextEnricher — 上下文增强器 v9.1 Context Assembly Layer: 插件式扩展，在上下文组装后添加计算字段。 增强器示例： - RiskScorer: 基于上下文内容计算风险评分 - CapabilityMatcher: 匹配可用 Agent 能力 - CollaboratorSuggestor: 建议协作 Agent - PriorityCalculator: 计算任务优先级 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/context/ContextFragmentRegistry.ts` | ContextFragmentRegistry — 上下文片段提供者注册中心 v9.1 Context Assembly Layer: 统一管理多源上下文片段提供者。 支持的来源： - user_profile: 用户画像 - behavior_twin: 行为孪生 - goal_graph: 目标图 - mission_state: 任务状态 - decision_history: 决策历史 - artifact_lineage: 产物血缘 - agent_status: Agent 状态 - custom: 自 | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/context/ContextPersistence.ts` | ContextPersistence — 上下文快照持久化 v9.1 Stage 1: 将 ExecutionContext 快照持久化到 SQLite。 与 ContextVersioner 配合使用，提供版本化持久化能力。 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/context/ContextTemplateRepository.ts` | ContextTemplateRepository — 上下文模板仓库 v9.1 Context Assembly Layer: 预定义的上下文模板，用于快速匹配任务类型。 每个模板定义： - 需要哪些片段来源（requiredFragments） - 可选哪些片段来源（optionalFragments） - 默认基础层数据（baseData） - JSON Schema（可选，用于校验完整性） - 标签（用于按场景匹配） / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/context/ContextVersioner.ts` | ContextVersioner — 上下文版本管理器 v9.1 Context Assembly Layer: 为 ExecutionContext 提供 Git-like 版本控制。 能力： - 快照（版本递增） - 按版本查询 - 版本历史 - 版本间差异 - 回滚到指定版本 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/context/index.ts` | Context Assembly Layer — Barrel Export v9.1: 统一上下文构建层导出入口。 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/graph/SystemMetadataGraph.ts` | SystemMetadataGraph — 系统元数据图 Phase 2: 记录所有实体关系 + EventStore 事件写入 + 事件重建 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/graph/index.ts` | （barrel：统一导出，功能以被导出文件为准） | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/graph/knowledge/KnowledgeGraph.ts` | KnowledgeGraph — 轻量级知识图谱（实体 + 关系） ★ 记忆统一：存储由 JSONL 文件改为 SQLite（better-sqlite3，实时持久化）。 接口完全不变（addEntity/searchEntities/getNeighborhood/findPath/…）， 消费方（AgentHarness/MetaPlanner/StrategicDeconstructor 等）零感知。 兼容：loadFromDisk 时若 SQLite 为空且存在旧 JSONL，自动迁移一次。 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/graph/knowledge/types.ts` | Knowledge Graph — 类型定义 统一知识图谱：整合 Agent / Task / Artifact / Decision / Memory 为上层提供跨数据源的查询接口。 扩展了 Cognee 风格的实体/关系类型，支持认知图谱（Cognitive Graph）。 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/memory/CompanyKnowledge.ts` | memory/CompanyKnowledge — 公司知识记忆（Gate 接线注册表） 低耦合：模块级注册表 + 可选注入。 - bootstrap 装配时注入 memoryApi（cognee 引擎）；未注入时工具调用返回 QueryMiss，不硬崩。 - ontologyTools 的第 5 个工具 ontology_queryCompanyKnowledge 经此查询。 - QueryMiss → 复用现有事件链（ontology.query.miss / needs_human）。 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/memory/MemoryActivationEngine.ts` | MemoryActivationEngine — 记忆激活引擎 根据当前状态、任务和执行上下文， 主动从 Memory Store 检索最相关的记忆并注入 Agent 上下文。 支持： - state-aware recall  — 根据执行状态检索 - task-aware recall   — 根据任务目标检索 - execution-aware recall — 根据执行历史和模式检索 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/memory/MemoryApiBus.ts` | memory/MemoryApiBus — 记忆总线 → 统一记忆层（MemoryAPI）适配 收敛碎片：把 MemoryHooks / Agent 侧对记忆的读写统一路由到 MemoryAPI（唯一入口）。 - remember（自动写回）→ MemoryApi.rememberEpisode（情景低门槛直写） - recall（上下文注入）→ MemoryApi.query（强制检索 + need_human） 依赖注入：不直接 new，由 bootstrap 装配注入 memoryApi。 / | memory/MemoryApiBus — 记忆总线 → 统一记忆层（MemoryAPI）适配 收敛碎片：把 MemoryHooks / Agent 侧对记忆的读写统一路由到 MemoryAPI（唯一入口）。 - remember（自动写回）→ MemoryApi.rememberEpisode（情景低门槛直写） - recall（上下文注入）→ MemoryApi.query（强制检索 + need_human） 依赖注入：不直接 new，由 bootstrap 装配注入 memoryApi。 / |
| `knowledge/memory/MemoryHooks.ts` | MemoryHooks — 记忆体系钩子 v3.x 重构：pi-agent-core 类型导入集中在 types adapter 中。 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/memory/MemoryMessages.ts` | MemoryMessages — Agentic 模式消息类型扩展 提供工具函数用于在 AgentLoopConfig.convertToLlm 中将自定义消息 (memoryHint, dagNodeStatus) 转为 LLM 可理解的 user 消息格式。 声明合并移到了 ../adapters/pi-augmentations.ts。 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/memory/activationRegistry.ts` | memory/activationRegistry — MemoryActivationEngine 全局注册表（L7 深水区） 装配层（bootstrapUnified）创建引擎并注入统一记忆层数据源后注册到此处， 供 StudioServer（RuntimeAPI / SessionManager）复用同一实例， 避免各处 new 空引擎（旧 RuntimeAPI 行为：永远 No relevant memories）。 与 observability/ExerciseContext 的全局注册表模式一致。 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/memory/types.ts` | memory/types — 记忆记录类型（精简 P0 由 execution/harness/types 迁移）：MemoryRecord（id/content/type['task'|...|'experience']/relevanceScore/timestamp/metadata），MemoryActivationEngine/MemoryApiBus 消费 | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/memory/index.ts` | @morpex/core/memory — Memory hooks and message types / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/ontology/FeedbackService.ts` | FeedbackService — Ontology 反馈服务 迭代3：将用户/评估反馈写入 Ontology - submit：创建 Feedback 对象 + corrects 关系 - listTestCases：列出标记为测试用例的反馈 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/ontology/ObjectTypeRegistry.ts` | ObjectTypeRegistry — 对象类型注册与校验 迭代2：管理所有已知 Object Type Schema，提供属性校验。 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/ontology/OntologyService.ts` | OntologyService — 轻量 Ontology 服务 迭代1：适配层包装现有 SystemMetadataGraph / MetadataGraph， 对外提供统一的查询接口，隐藏底层图实现细节。 底层复用： - SystemMetadataGraph（8 实体 × 10 关系） - 后续可接 EventStore projection / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/ontology/bootstrapFromDocs.ts` | bootstrapFromDocs — 从工作流文档半自动 bootstrap Ontology 迭代3：用 LLM 从工作流文档中抽取 Object Types、Relations、Actions， 然后 upsert 到 Ontology。 使用方式（dryRun 先行）： const result = await bootstrapFromWorkflowDocs({ docs: [workflowDoc1, workflowDoc2], ontology, piBridge, dryRun: true,   | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/ontology/index.ts` | ontology — 轻量本体层（理想架构第 2 层：Ontology Gate ★ MANDATORY） 迭代1： - OntologyService：包装现有 MetadataGraph - ForcedQueryGuard：代码级强制查询守卫 - types：类型定义 迭代2： - ObjectTypeRegistry：类型注册与校验 - objectTypes：核心 Object Types 定义 - projectors：从现有数据投影到 Ontology - runOntologyGroundedRea | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/ontology/objectTypes.ts` | objectTypes — 核心 Object Types 定义与校验 迭代2：定义并落地第一批核心 Object Types Mission / Goal / Artifact / Agent / Capability / SOP / Feedback / Department / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/ontology/projectors/ArtifactProjector.ts` | ArtifactProjector — 将 Artifact 存储投影到 Ontology 迭代2：从 ArtifactFacade / ArtifactStore 投影到 Ontology。 使 LLM 能查询到已创建的 Artifact 对象。 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/ontology/projectors/MissionProjector.ts` | MissionProjector — 将 Mission 存储投影到 Ontology 迭代2：从 MissionStore / Event 投影重建 Ontology 中的 Mission 对象。 使 LLM 查询 ontology_queryObjects({type:'Mission'}) 能看到真实数据。 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/ontology/projectors/index.ts` | projectors — Ontology 投影器 迭代2：将现有数据（Mission / Artifact / Agent 等）投影到 Ontology， 使 LLM 查询 ontology_queryObjects 能看到真实数据。 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/ontology/prompts/expert-prompt.ts`
| `cognition/prompts/orchestrator-prompts.ts` | Orchestrator 提示词资产 — ANALYSIS/AUDIT/REPLAN/SYNTHESIS 四件套（U4 自内联逐字迁入，只改引用不改文案） / | 资产化存储；调优改此文件 |
| `cognition/prompts/artifact-generation-prompt.ts` | 产物生成提示词 — buildArtifactGenerationPrompt（U4 自三元嵌套逐字迁入；knowledgeBlock 由调用方构造） / | 资产化存储；调优改此文件 | | Expert Prompt — Ring 1 领域专家系统提示词 适用对象：由 Leader 动态衍生出的特定脑区专家 （如 hardware_engineering、firmware_execution、business_finance 等领域的 AgentHarness）。 三级分封架构： Leader (Ring 0) → Expert (Ring 1) → Fork (Ring 2) 遵循迁移铁律： 0.2 (类型来源法则): 基于 pi-agent-core 扩展 0.4 (删除优先法则): 提示词驱动行 | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/ontology/prompts/forced-query-system.ts` | forced-query-system — 强制查询系统提示模板 迭代1：用于 LLM 规划阶段，强制先查询 Ontology 再推理。 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/ontology/prompts/index.ts` | Prompts — 提示词系统统一出口 三级分封架构（Leader Ring 0 → Expert Ring 1 → Fork Ring 2） 的提示词模板与编译函数。 使用方式： import { compileLeaderPrompt, compileExpertPrompt, createAstroMTrace } from './prompts/index.js'; / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/ontology/prompts/leader-prompt.ts` | Leader Prompt — Ring 0 中央路由大脑系统提示词 适用对象：控制面主 LLM（如 DeepSeek-R1 等高推理规格模型）， 负责驱动 FSM 状态机与跨领域调度。 三级分封架构： Leader (Ring 0) → Expert (Ring 1) → Fork (Ring 2) 遵循迁移铁律： 0.2 (类型来源法则): 基于 pi-agent-core 扩展 0.4 (删除优先法则): 提示词驱动行为而非代码封装 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
| `knowledge/ontology/prompts/prompt-types.ts` | Prompt Types — 提示词系统类型定义 三级分封架构（Leader → Expert → Fork）的提示词模板类型。 用于驱动 LLM 理解并严格执行 MorPex 系统的特权级约束。 遵循迁移铁律： 0.2 (类型来源法则): 类型基于 pi-agent-core 扩展 / | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |


## `gate/`（6 文件）

> 层边界规则：认识论拦截+信号；只读+不决策/不执行/不改权威知识

| 文件 | 功能 | 职责边界 |
|---|---|---|
| `gate/ForcedQueryGuard.ts` | ForcedQueryGuard — 代码级强制查询守卫 迭代1： - 记录所有 ontology 工具调用 - 断言至少调用了 N 次（代码兜底） - 校验 proposal 引用的 ID 是否确实被查询过 / | 认识论拦截+信号；只读+不决策/不执行/不改权威知识 |
| `gate/index.ts` | L3 Ontology Gate 强制知识防火墙层 | 认识论拦截+信号；只读+不决策/不执行/不改权威知识 |
| `gate/ontologyEvents.ts` | ontologyEvents — Ontology 事件类型定义 迭代2：定义 Ontology 相关事件类型，用于 Event Sourcing 记录。 事件命名空间：ontology.* / | 认识论拦截+信号；只读+不决策/不执行/不改权威知识 |
| `gate/runOntologyGroundedReasoning.ts` | runOntologyGroundedReasoning — 共享的 Ontology Grounded Reasoning 方法 迭代2+补丁： Phase 1 - 强制查询：LLM 输出查询计划 → 执行 → 记录 - JSON 解析失败时执行默认安全查询兜底 - 空结果自动标记 missing_info Phase 2 - 基于事实推理：LLM 基于检索到的事实输出 proposal - 引用校验失败 → emit ReferenceValidationFailed 事件 可被 DeliveryPlanner | 认识论拦截+信号；只读+不决策/不执行/不改权威知识 |
| `gate/types.ts` | Ontology — 轻量本体层类型定义 迭代1：包装现有 MetadataGraph，暴露 4 个 ontology 工具给 LLM / | 认识论拦截+信号；只读+不决策/不执行/不改权威知识 |
| `gate/context.ts` | KnowledgeContextPackage — 运行时 Gate 上下文 + Tier 写入守卫 + 提案状态守卫（Wave 3b）。由 runOntologyGroundedReasoning 签发凭证；Artifact 注册/演化晋升入口硬校验（缺包抛 GateContextRequiredError）；TierWriteGuard：Tier-3 禁覆盖 Tier-0/1、Tier-2 仅 L7 晋升可写；ProposalStatusGuard：未审批只能是 pending | 认识论拦截+信号；只读+不决策/不执行/不改权威知识 |


## `cognition/`（55 文件）

> 层边界规则：理解/推理/规划；禁副作用Primitive/不改知识/不触发演化

| 文件 | 功能 | 职责边界 |
|---|---|---|
| `cognition/BrainFacade.ts` | BrainFacade — 统一大脑门面 Phase 4.5 / 架构打磨 — P1 修复 将 4 套重叠的大脑系统统一为一个入口： - PersonalBrain   (cognition/memory/) — 五层记忆，内存级 - MemoryWiki       (packages/memory/)   — SQLite 持久层（zvec 已废弃移除 S17） - LearningLoop     (learning/)          — 经验提取 + 策略优化 - EvolutionEngine  (e | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/CrossDepartmentKnowledgeSynthesizer.ts` | CrossDepartmentKnowledgeSynthesizer — 跨部门知识融合引擎 v16 Phase 4.7: 一人跨多领域虚拟公司的核心智能引擎。 将不同部门的经验、模式、知识进行对比和融合，自动迁移成功模式。 设计原则： - EventBus 是唯一通信通道 - 部门级数据隔离（所有查询带 deptId） - PiBridge 隔离底层 LLM - 真实执行，无 mock 数据流： BrainFacade.processTask() → CrossDepartmentKnowledgeSynthe | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/ReflectionEngine.ts` | ReflectionEngine — 反思引擎（任务后反思 → 洞察/建议，只读数据） | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/SafetyMonitor.ts` | SafetyMonitor — 安全监控器 Phase 2: 持续观察系统状态，检测异常模式 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/decision/DecisionTwin.ts` | Decision Twin — 用户决策模式分析引擎 P1 架构完善: 从决策历史中学习用户的决策模式、风险偏好、关键因素。 职责: 1. 构建用户决策画像（buildProfile） 2. 分析特定决策场景（analyze） 3. 预测用户选择（predict） 4. 提取常见决策因素（extractCommonFactors） 数据来源: - DecisionMemory: 存储的历史决策记录 - PersonalTwinGraph: 用户孪生图谱中的决策节点（可选） 使用方式: const twin = ne | Decision Twin — 用户决策模式分析引擎 P1 架构完善: 从决策历史中学习用户的决策模式、风险偏好、关键因素。 职责: 1. 构建用户决策画像（buildProfile） 2. 分析特定决策场景（analyze） 3. 预测用户选择（predict） 4. 提取常见决策因素（extractCommonFactors） 数据来源: - DecisionMemory: 存储的历史决策记录 - PersonalTwinGraph: 用户孪生图谱中的决策节点（可选） 使用方式: const twin = ne |
| `cognition/decision/index.ts` | cognition/decision — Decision Twin barrel P1 架构完善: 用户决策模式分析引擎 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/decision/types.ts` | Decision Twin — 类型定义 P1 架构完善: 用户决策模式的数据模型。 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/goal/GoalGraph.ts` | GoalGraph — 目标层级图谱 维护 Goal 的层级树结构: Life → Objective → Project → Milestone 支持: - 树构建 (buildTree) - 路径查询 (getPath) - 后代遍历 (getDescendants) - 进度递归计算 (recalculateProgress) - Mission 关联 (linkMission) / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/goal/GoalManager.ts` | GoalManager — 目标管理器 职责: 1. Goal 的完整生命周期管理 (create → update → archive) 2. OKR-style Objective 追踪 3. Goal → Mission 关联 4. 全局进度汇总 GoalManager 是 GoalPlane 的门面类, 上层 (StudioServer) 通过它操作目标。 使用方式: const gm = new GoalManager(); const goal = gm.createGoa | GoalManager — 目标管理器 职责: 1. Goal 的完整生命周期管理 (create → update → archive) 2. OKR-style Objective 追踪 3. Goal → Mission 关联 4. 全局进度汇总 GoalManager 是 GoalPlane 的门面类, 上层 (StudioServer) 通过它操作目标。 使用方式: const gm = new GoalManager(); const goal = gm.createGoa |
| `cognition/goal/index.ts` | cognition/goal — Goal Plane 统一出口 Phase 1 / MorPex v8.5: 长期目标管理。 导出: GoalManager — 目标管理器 (门面) GoalGraph   — 目标层级图谱 (底层) Goal        — 目标数据类型 all types   — 数据类型 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/goal/types.ts` | Goal Plane — 数据类型定义 Phase 1 / MorPex v8.5: 用户长期目标管理。 Goal 位于 Mission 之上: Life Goal → Objective → Project → Mission → Task GoalManager 管理 Goal 的完整生命周期, GoalGraph 维护层级关系, ObjectiveTracker 追踪关键结果 (OKR-style)。 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/index.ts` | cognition — MorPex Cognitive Layer Barrel Phase 5-6 / MorPex v8: 认知层模块统一入口。 子模块： cognition/twin/    — Personal Twin Graph（用户孪生图谱） cognition/memory/  — Personal Brain（五层记忆体系） 后续 Phase 将在此进一步扩展： cognition/decision/   — Decision Twin（决策孪生） cognition/workflow/   — | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/learning/ExperienceExtractor.ts` | ExperienceExtractor — 经验提取器 从执行记录中提取可复用的经验、模式和教训。 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/learning/LearningLoop.ts` | learning/LearningLoop — L4 单一学习入口（Wave 8c 合并原 MetaLearner）：程序性（ExperienceExtractor→PlanEvaluator→StrategyOptimizer）+ 声明性（learnFromTask→偏好/部门模式/用户反馈）；不直接触发生产变更 | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/learning/PlanEvaluator.ts` | PlanEvaluator — 计划评估器 评估计划的执行效果，生成评估报告和优化建议。 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/learning/StrategyOptimizer.ts` | StrategyOptimizer — 策略优化器 基于历史评估数据优化执行策略。 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/learning/TemplateEvolutionEngine.ts` | TemplateEvolutionEngine — 模板进化引擎 基于经验反馈自动进化计划模板。 追踪模板使用效果，淘汰低效模板，推荐高效模板。 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/learning/agent/CrossAgentLearningEngine.ts` | CrossAgentLearningEngine — 跨 Agent 学习引擎 v9.2: Agent 间共享学习经验的核心编排器。 流程: 1. learnFromOutcome: 从输出中提炼 → 存储 → 传播 → 返回经验 2. queryRelevant: 匹配相关经验 → 返回 3. feedback: 记录经验有用性反馈 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/learning/agent/ExperienceMatcher.ts` | ExperienceMatcher — 经验匹配器 根据问题描述从仓库中检索最相关的经验。 使用标签匹配 + 关键词 Jaccard 相似度 + 可见性过滤。 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/learning/agent/ExperienceRepository.ts` | ExperienceRepository — 经验仓库 存储、查询、管理 GeneralizedExperience。 支持按类别/标签/权重过滤，按权重排序。 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/learning/agent/ExperienceSqliteRepository.ts` | ExperienceSqliteRepository — 跨 Agent 学习经验 SQLite 持久化 v9.2 Stage 2: 共享经验存储的 SQLite 实现。 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/learning/agent/KnowledgeDistiller.ts` | KnowledgeDistiller — 知识提炼器 从 DecisionEvent、Mission 结果、协作结果中提取泛化经验。 支持合并相似经验（相同 problemPattern）。 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/learning/agent/LearningPropagationService.ts` | LearningPropagationService — 学习传播服务 控制经验的可见性与传播范围。 支持按 Agent 类型传播、匿名化。 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/learning/agent/index.ts` | Cross-Agent Learning — 统一导出 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/learning/agent/types.ts` | Cross-Agent Learning — 类型定义 (v9.2) Agent 间经验共享的类型系统。 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/learning/index.ts` | （barrel：统一导出，功能以被导出文件为准） | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/memory/BrainPersistor.ts` | BrainPersistor — PersonalBrain（内存大脑）持久化桥接 记忆统一入口：优先经 MemoryAPI（统一层，SQLite/cognee 保存），回退旧 MemoryWiki 兼容。 - persist  → memoryApi.rememberEpisode（情景低门槛直写统一层） - restore  → 从统一层 query 恢复（按层关键词），或 wiki 兼容 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/memory/DecisionMemory.ts` | DecisionMemory — 决策记忆存储 Phase 6 / MorPex v8: 存储用户的决策模式，用于预测和推荐。 职责: 1. 存储关键决策记录 2. 分析常见决策因素 3. 按上下文搜索相似决策 4. 为 Planner 提供决策依据 与 PersonalTwinGraph 的关系: - PersonalTwinGraph 存储决策节点（图谱视角） - DecisionMemory 存储决策细节（记忆视角） - DecisionMemory.getCommonFactors() → TwinGrap | DecisionMemory — 决策记忆存储 Phase 6 / MorPex v8: 存储用户的决策模式，用于预测和推荐。 职责: 1. 存储关键决策记录 2. 分析常见决策因素 3. 按上下文搜索相似决策 4. 为 Planner 提供决策依据 与 PersonalTwinGraph 的关系: - PersonalTwinGraph 存储决策节点（图谱视角） - DecisionMemory 存储决策细节（记忆视角） - DecisionMemory.getCommonFactors() → TwinGrap |
| `cognition/memory/PersonalBrain.ts` | PersonalBrain — 个人大脑（统一记忆门面） Phase 6 / MorPex v8: 五层记忆体系的统一入口。 记忆分层: working    — 工作记忆（短期、会话级，30 分钟 TTL） episodic   — 情景记忆（事件、经历，7 天 TTL） semantic   — 语义记忆（事实、知识，永久） preference — 偏好记忆（用户喜好，永久） workflow   — 工作流记忆（已学流程，永久，委托给 WorkflowMemory） 设计原则: 1. 统一 API 访问所有 | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/memory/WorkflowMemory.ts` | WorkflowMemory — 工作流记忆存储 Phase 6 / MorPex v8: 从已完成 Mission 中提取和存储工作流模式。 职责: 1. 存储已学习的工作流模式 2. 从 Mission 中自动提取工作流 3. 按名称/领域搜索相似工作流 4. 序列化/反序列化（持久化用） 与 PersonalTwinGraph 的关系: - PersonalTwinGraph 存储工作流节点（图谱视角） - WorkflowMemory 存储工作流的执行细节（记忆视角） - 两者互补: TwinGraph 回 | WorkflowMemory — 工作流记忆存储 Phase 6 / MorPex v8: 从已完成 Mission 中提取和存储工作流模式。 职责: 1. 存储已学习的工作流模式 2. 从 Mission 中自动提取工作流 3. 按名称/领域搜索相似工作流 4. 序列化/反序列化（持久化用） 与 PersonalTwinGraph 的关系: - PersonalTwinGraph 存储工作流节点（图谱视角） - WorkflowMemory 存储工作流的执行细节（记忆视角） - 两者互补: TwinGraph 回 |
| `cognition/memory/index.ts` | cognition/memory — Personal Brain 统一导出 Phase 6 / MorPex v8: 五层记忆体系。 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/memory/types.ts` | Personal Brain — Memory Layer Type Definitions Phase 6 / MorPex v8: 5 层记忆体系的数据模型。 记忆分层: working    — 工作记忆（短期、会话级） episodic   — 情景记忆（事件、经历） semantic   — 语义记忆（事实、知识） preference — 偏好记忆（用户喜好） workflow   — 工作流记忆（已学习的工作流程） 设计原则: - 每层记忆有不同的生命周期和访问模式 - 所有记忆条目共享 Memory | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/planning/CrossDepartmentArbitrationEngine.ts` | CrossDepartmentArbitrationEngine — 跨部门冲突仲裁引擎 v16: 检测并仲裁跨部门计划冲突（资源竞争、循环依赖、时间窗口冲突）。 在 HierarchicalPlanner.createPlan() 之后自动调用。 仲裁策略: - 'priority': 按部门优先级（CEO 设定） - 'cost': 按预估成本最小化 - 'risk': 按风险最低优先 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/planning/DeliveryPlanner.ts` | DeliveryPlanner — 统一规划引擎（Facade） Phase 2 / 交付层 对外提供统一的规划入口，对内委托给: - MetaPlanner（完整 7 引擎规划管线） - SimulationEngine（执行前仿真预测） 设计原则： - Facade 模式：不修改现有模块 - 根据任务复杂度自动选择规划路径 - 支持 "快速规划"（简单任务跳过仿真） - 支持 "完整规划"（复杂任务走全管线） 规划模式： - 'quick': 快速 | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/planning/DeliveryPlannerAdapter.ts` | DeliveryPlannerAdapter — 将 DeliveryPlanner 适配为 MissionPlanner 接口 L3 全功能实现：把理想架构第 3 层（DeliveryPlanner，真实 piBridge + Ontology Gate） 接入 MissionRuntime 的任务 FSM 规划阶段（此前规划层不可达）。 深度接入（vNext+ L3）： - 主规划：DeliveryPlanner.createPlan（Ontology Grounded） - 重规划（replan）：Hiera | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/planning/HierarchicalPlanner.ts` | HierarchicalPlanner — 分层规划器（支持 Ontology grounded reasoning，产出计划供 L5 执行） | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/planning/goal-intelligence/ConstraintAnalyzer.ts` | ConstraintAnalyzer — 约束分析器 从目标文本中提取预算/期限/平台等约束 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/planning/goal-intelligence/GoalIntelligenceFacade.ts` | GoalIntelligenceFacade — 目标理解引擎入口 v14: 用户一句话目标 → 可执行的 GoalContext；v17f 接入 IntentClassifier（闲聊 vs 任务） | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/planning/goal-intelligence/IntentClassifier.ts` | IntentClassifier — 意图判别器（闲聊 chat vs 任务 task）：U1 起主路径全量 LLM 结构化判定（5s 超时），LLM 失败/超时/未注入才降级启发式正则（限流告警可观测）；CompanyFacade.executeGoal 入口分流，闲聊直答不建 Mission | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `execution/orchestration/error-compactor.ts` | error-compactor — 统一错误/结果压缩器（12-Factor U1·G2）：四段结构 {失败了什么/为什么/试过什么/建议下一步}，总长≤800，堆栈只留关键帧；clip 截断带循环引用防护；供 formatResults/replan failuresText 喂 LLM 前调用。注意：这是格式化非触发机制，不违背“触发全 LLM 化”原则 | 理解/推理/规划；纯函数无副作用 |
| `cognition/planning/goal-intelligence/GoalParser.ts` | GoalParser — 目标解析器 将用户原始语句解析为目标+领域+子目标 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/planning/goal-intelligence/GoalValidator.ts` | GoalValidator — 目标验证器 检查目标上下文的完整性和可行性 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/planning/goal-intelligence/RequirementExtractor.ts` | RequirementExtractor — 从目标中提取能力需求 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/planning/goal-intelligence/index.ts` | （barrel：统一导出，功能以被导出文件为准） | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/planning/goal-intelligence/types.ts` | 目标智能解析类型定义（GoalParseResult / 子目标 / 置信度） | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/planning/index.ts` | planner — 统一规划层 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/twin/BehaviorTwin.ts` | BehaviorTwin v2 — 用户行为模式学习引擎（含版本化） MorPex v8.6: 从交互历史中学习用户行为模式， 输出 BehaviorProfile 供 Planner 约束生成风格匹配的方案。 ★ v8.6 新增：版本化支持。每次 buildProfile 调用都会创建一个 版本快照，可通过 getVersion/getVersionHistory/diffVersions 回溯。 学习维度: - planningStyle:       规划风格（自上而下/架构优先/原型优先） - riskTo | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/twin/OrganizationTwin.ts` | OrganizationTwin — 组织孪生 Phase 2: 模拟虚拟公司的组织结构、角色决策、协作策略 复用 BehaviorTwin/DecisionTwin/PreferenceModel 作为个体基础 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/twin/PersonalTwinGraph.ts` | PersonalTwinGraph — 个人孪生图谱 Phase 5 / MorPex v8: 围绕用户长期目标和个性化模式的认知图谱。 职责： 1. 存储用户的知识图谱（目标、项目、偏好、决策、协作关系等） 2. 支持结构化查询（按类型、关系、置信度） 3. 支持学习（从用户交互中提取偏好和模式） 4. 支持序列化（持久化和恢复） 与 KnowledgeGraph（通用知识图谱）的关系： - PersonalTwinGraph 专注于用户个性化维度（认知层） - KnowledgeGraph 专注于通用领域知识（ | PersonalTwinGraph — 个人孪生图谱 Phase 5 / MorPex v8: 围绕用户长期目标和个性化模式的认知图谱。 职责： 1. 存储用户的知识图谱（目标、项目、偏好、决策、协作关系等） 2. 支持结构化查询（按类型、关系、置信度） 3. 支持学习（从用户交互中提取偏好和模式） 4. 支持序列化（持久化和恢复） 与 KnowledgeGraph（通用知识图谱）的关系： - PersonalTwinGraph 专注于用户个性化维度（认知层） - KnowledgeGraph 专注于通用领域知识（ |
| `cognition/twin/PlannerConstraint.ts` | PlannerConstraint — Planner 约束接口 Phase 2 / MorPex v8.5: PersonalTwin 向 Planner 输出约束条件， 确保生成方案符合用户行为风格和决策模式。 使用方式: const profile = behaviorTwin.buildProfile(); const decision = decisionTwin.buildProfile(userId); const preferences = preferenceModel.buildProfile( | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/twin/PreferenceModel.ts` | PreferenceModel — 动态偏好模型 Phase 2 / MorPex v8.5: 从用户交互中持续学习偏好， 支持置信度衰减和强度演化。 偏好分类: - technology:    技术栈偏好 - communication: 沟通方式偏好 - work_style:    工作方式偏好 - tool:          工具偏好 - domain:        领域偏好 学习机制: - 每次观察增强置信度和强度 - 长期未观察的偏好自动衰减 - 冲突偏好通过置信度仲裁 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/twin/index.ts` | cognition/twin — Personal Twin Graph Barrel Phase 5 / MorPex v8: 个人孪生图谱模块统一导出。 导出： - PersonalTwinGraph: 孪生图谱主类 - TwinNode/TwinEdge/TwinNodeType/TwinEdgeType: 核心类型 - 属性类型：UserProperties, GoalProperties, ProjectProperties 等 - 查询/统计类型：TwinQuery, TwinStats, Decisi | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/twin/types.ts` | Personal Twin Graph — 数据类型定义 Phase 5 / MorPex v8: 用户孪生图谱的数据模型。 设计原则： 1. 所有节点类型对应真实世界实体的认知形态 2. 所有边类型对应真实世界关系和决策模式 3. 置信度（confidence）标识系统对每个信息的把握程度 4. 来源（source）标识信息来自显式输入、提取还是推理 节点类型： user       — 用户本体 goal       — 用户目标（长期/短期） project    — 用户项目 person     — 用户 | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/types.ts` | brain/types.ts — Brain 层共享类型定义 集中管理 Brain 模块（CrossDepartmentKnowledgeSynthesizer、ReflectionEngine、LearningLoop 等）的类型定义， 避免循环依赖和分散定义。 @packageDocumentation / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/workflow/WorkflowIntelligence.ts` | WorkflowIntelligence — 工作流智能引擎 Phase 7 / MorPex v8: 从用户行为中学习、优化、自动化的核心引擎。 四大能力： 1. Pattern Detection — 分析完成的 Mission，发现重复行为模式 2. Workflow Extraction — 从相似 Mission 群组中提取标准化工作流 3. Workflow Optimization — 分析工作流并给出优化建议（并行化、合并、排序） 4. Automation Assessment — 评估工作流的自 | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/workflow/index.ts` | cognition/workflow — Workflow Intelligence Barrel Phase 7 / MorPex v8: 工作流智能引擎。 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
| `cognition/workflow/types.ts` | Workflow Intelligence — 类型定义 Phase 7 / MorPex v8: 工作流智能引擎数据类型。 四大能力： 1. Pattern Detection — 重复行为模式检测 2. Workflow Extraction — 从 Mission 历史提取流程 3. Workflow Optimization — 流程优化建议 4. Automation Assessment — 自动化成熟度评估 / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |


## `execution/`（59 文件）

> 层边界规则：有界执行+硬边界；不重规划/不评分/不演化

| 文件 | 功能 | 职责边界 |
|---|---|---|
| `execution/AgentAllocator.ts` | AgentAllocator — 按 TeamSpec 从可用 Agent 池静态分配执行团队 | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/DependencyCoordinator.ts` | DependencyCoordinator — 动态团队依赖图构建与跨团队依赖协调 | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/DynamicTeamOrchestrator.ts` | DynamicTeamOrchestrator — 动态团队编排器 (v16) 能力驱动: Goal → CapabilityDiscovery → WorkflowSelection → TeamFormation → Execution / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/SubAgentFork.ts` | SubAgentFork — 无状态子 Agent 执行肢（Fleet） Phase 2 / 交付层 增强 Phase 0 的 ForkExecuteTool（单次 bash/JS 执行）为完整的 "子 Agent 舰队"管理： 1. 创建临时子 Agent 执行任务（通过 fork） 2. 子 Agent 有独立的 DepartmentContext 分区 3. 执行完成后记忆快照自动写入部门 Memory 4. 通过 EventBus 广播生命周期事件 5. 支持超时、重试、并发控制 对比 ForkExecut | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/TeamBuilder.ts` | TeamBuilder — 按目标/所需能力构建执行团队（TeamSpec） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/UnifiedExecutionEngine.ts` | UnifiedExecutionEngine — 统一执行引擎（Facade） Phase 2 / 交付层 对外提供统一的执行入口，对内委托给三个现有执行模块: - MissionRuntime (24 状态 FSM) - DAGRuntime (DAG 调度) - ExecutionFabric (v11 Agent 能力解析 + Connector 调用) 设计原则： - Facade 模式：不修改现有模块，只在外部包裹统一 API - 根据执行模式（mode）自动路由到正确的引擎 - 聚合状态查询：统一从三个；T0 多轮连续：新增 orchestratorSessionPath 透传/resume（chat 会话复用同一本 orchestrator 账本，历史注入分析 prompt） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/fabric/ExecutionFabric.ts` | ExecutionFabric — v11 Unified Execution Fabric Merges AgentRuntime, Scheduler, and Connector Runtime into a single execution plane. Coordinates the flow: Workflow Node → Capability Resolver → Agent Selection → Action Request → Execution @packageDocumentation / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/fabric/index.ts` | Execution Fabric — v11 Unified Execution Plane @packageDocumentation / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/index.ts` | Execution — v11 Execution Plane + Phase 2 统一引擎 @packageDocumentation / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/ExecutionContext.ts` | ExecutionContext — 执行上下文（GoalContext + MissionState + 运行时快照） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/MorPexRuntime.ts` | MorPexRuntime — L5 主驱动器（FSM/DAG 执行编排；失败路径只读演化分析；发 runtime.* 事件）；T0 多轮连续：新增 orchestratorSessionPath 透传/resume（chat 会话复用同一本 orchestrator 账本，历史注入分析 prompt） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/PersistentArtifactStore.ts` | PersistentArtifactStore — 基于 UnifiedEventStore 的产物持久化（事件溯源） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/PersistentMissionStore.ts` | PersistentMissionStore — Event Sourcing 架构 所有 Mission 状态变化通过事件记录，启动时从事件重放重建状态；U2+U3：新增 step.* 级事件重放（getStepStates/isReady），修复重放顺序 bug（query DESC→反转为时间正序）与静默降级（初始化失败显式横幅+isReady 查询）/ | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/StepEventRecorder.ts` | StepEventRecorder — 订阅总线 workflow.step_* 五类事件落入 PersistentMissionStore（EventBus Only 合规；missionId 归属过滤；attach 幂等守卫）；另订 execution.dag 计划快照与 run.paused/cancelled/resumed 控制态 | 只订阅不发射；不直连 DAGRuntime |
| `execution/runtime/RunRegistry.ts` | RunRegistry — 运行控制注册表（missionId→paused/cancelled 标志）；DAGRuntime 每轮迭代经 shouldPause/shouldCancel 钩子读取；持久化由调用方经 EventBus 发 run.* 事件完成 | core 侧纯内存标志；不含 IO |
| `execution/runtime/PipelineOrchestrator.ts` | PipelineOrchestrator — 执行管线编排（GoalIntelligence 解析 → 执行阶段串联） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/ServiceContainer.ts` | ServiceContainer — 服务容器（构造并注入全部运行时依赖：引擎/治理/知识/演化） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/approval/ApprovalEngine.ts` | ApprovalEngine — 审批引擎 Phase 4 / MorPex v8: 标准化人工审批流程管理。 职责： 1. 创建审批请求（高风险操作需要人工确认） 2. 发射 APPROVAL_REQUIRED 事件让前端展示 3. 支持 approve / deny / 超时自动拒绝 4. 低风险操作可配置自动批准 与 MissionRuntime 的集成： MissionRuntime 在 WAIT_APPROVAL 状态下调用 ApprovalEngine： const request = await ap | ApprovalEngine — 审批引擎 Phase 4 / MorPex v8: 标准化人工审批流程管理。 职责： 1. 创建审批请求（高风险操作需要人工确认） 2. 发射 APPROVAL_REQUIRED 事件让前端展示 3. 支持 approve / deny / 超时自动拒绝 4. 低风险操作可配置自动批准 与 MissionRuntime 的集成： MissionRuntime 在 WAIT_APPROVAL 状态下调用 ApprovalEngine： const request = await ap |
| `execution/runtime/approval/index.ts` | approval — Approval Engine Barrel Phase 4 / MorPex v8: 人工审批流程管理。 导出： - ApprovalEngine   审批引擎（核心类） - ApprovalRequest  审批请求类型 - ApprovalStatus   审批状态类型 - ApprovalEngineConfig  审批引擎配置 - ApprovalEventPayload  审批事件负载 - ApprovalStats    审批统计类型 / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/approval/types.ts` | Approval Engine — 类型定义 Phase 4 / MorPex v8: 人工审批流程的标准数据结构。 设计原则： - 每个审批请求独立追踪（id, status, context） - 审批请求可过期自动拒绝（timeoutMs） - 低风险操作可选自动审批（autoApproveLowRisk） / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/budget/BudgetManager.ts` | BudgetManager — 预算管理器 MorPex v8.8: 防止 Agent 无限消耗 Token/步骤/费用。 每个 Mission 有独立的预算上限，超限时触发告警或阻止执行。 / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/budget/index.ts` | （barrel：统一导出，功能以被导出文件为准） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/checkpoint/CheckpointManager.ts` | CheckpointManager — 检查点管理器 (v9.2 Phase 1 Enhanced) 负责保存和加载执行快照，支持中断继续执行和失败恢复。 支持双后端: 原有 JSONL（默认）+ SQLite（当传入 db） v9.2 Phase 1 增强: - SQLite 后端 (checkpoints 表) - saveMissionCheckpoint: 富检查点 (stage/context/artifacts/team) - loadMissionCheckpoint: 按 mission 恢复最新检 | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/checkpoint/RecoveryManager.ts` | RecoveryManager — 执行恢复管理器 根据检查点快照生成恢复计划。 确定哪些节点需要重试、哪些可以跳过、哪些正在执行中。 / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/checkpoint/ReplayEngine.ts` | ReplayEngine — 重放引擎 从检查点快照重放执行过程，支持 step-by-step 和 full-speed 模式。 / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/checkpoint/index.ts` | （barrel：统一导出，功能以被导出文件为准） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/compensation/CompensationEngine.ts` | CompensationEngine — 补偿引擎（Saga 模式） MorPex v8.8: 任务失败时按逆序回滚已执行的操作。 基于 Saga 模式：每个步骤注册对应的补偿操作，失败时自动回滚。 / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/compensation/index.ts` | （barrel：统一导出，功能以被导出文件为准） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/dag/DAGRuntime.ts` | DAGRuntime — DAG 运行时主引擎 将 MetaPlanner 产生的 ExecutionDAG 转换为真实执行。 流程: 1. 接收 ExecutionDAG → 构建 TaskGraph 2. 循环: 解析依赖 → 调度 → 执行 → 直到完成或失败 3. 返回 DAGResult / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/dag/DependencyResolver.ts` | DependencyResolver — 依赖解析器 管理 DAG 节点间的依赖关系，判断哪些节点可以执行。 / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/dag/ParallelExecutor.ts` | ParallelExecutor — 并行执行器 并发执行多个 TaskNode，处理执行结果和错误。 / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/dag/Scheduler.ts` | Scheduler — DAG 调度器 决定下一批可执行的节点，支持优先级和并发控制。 / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/dag/TaskGraph.ts` | TaskGraph — DAG 图结构 管理节点和边的数据结构和组织。 / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/dag/TaskNode.ts` | TaskNode — DAG 执行节点 包装 DAGNode，添加运行时执行状态。 / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/dag/index.ts` | （barrel：统一导出，功能以被导出文件为准） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/dag/types.ts` | DAG Plugin — 类型定义 DAG 节点、边、验证、状态相关类型。 从 src/core/types.ts 中的 AdaptiveDAGNode 等类型迁移。 / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/manual/YamlManualLoader.ts` | YamlManualLoader — 部门手册（声明式工作流 YAML）解析/校验/匹配（load/validate/match），纯数据层不执行 | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/manual/YamlWorkflowRuntime.ts` | YamlWorkflowRuntime — 部门手册通用解释器（复用 DAGRuntime + 回跳语义 backjump/skip/retry + ask 人审门 + Gate 凭证） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/index.ts` | ── Runtime Kernel (Phase 1 / MorPex v8) ── | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/mission/MissionController.ts` | MissionController — Mission 生命周期控制（状态机推进 + 事件广播） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/mission/MissionRuntime.ts` | MissionRuntime — Mission 运行时主引擎 Phase 3 / MorPex v8: 用户意图 → Mission → Plan → Execution 的核心编排器。 职责： 1. 从 IncomingMessage 创建 Mission 2. 管理 Mission 的完整生命周期（MissionState 流转） 3. 委托 Planner 生成执行计划 4. 委托 Executor 执行计划 5. 通过 EventBus 发射所有状态转换事件 6. 支持 Mission 取消 与现有组件的 | MissionRuntime — Mission 运行时主引擎 Phase 3 / MorPex v8: 用户意图 → Mission → Plan → Execution 的核心编排器。 职责： 1. 从 IncomingMessage 创建 Mission 2. 管理 Mission 的完整生命周期（MissionState 流转） 3. 委托 Planner 生成执行计划 4. 委托 Executor 执行计划 5. 通过 EventBus 发射所有状态转换事件 6. 支持 Mission 取消 与现有组件的 |
| `execution/runtime/mission/MissionTypes.ts` | Mission 状态/阶段类型定义（MissionStatus / MissionPhase） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/mission/adapters/DAGExecutorAdapter.ts` | DAGExecutorAdapter — 将 DAGRuntime 适配为 MissionExecutor 接口 P0 架构完善: 连接 MissionRuntime → DAGRuntime MissionRuntime 通过 MissionExecutor 接口委托执行工作。 此适配器将现有的 DAGRuntime（TaskGraph/Scheduler/ParallelExecutor）包装为 MissionExecutor。 使用方式： const adapter = new DAGExecutorAdap | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/mission/adapters/MetaPlannerAdapter.ts` | MetaPlannerAdapter — 将 MetaPlanner 适配为 MissionPlanner 接口 P0 架构完善: 连接 MissionRuntime → MetaPlanner ★ v8.5 升级: 读取 Twin 约束 (PlannerConstraint) 并注入 MetaPlanner MissionRuntime 通过 MissionPlanner 接口委托规划工作。 此适配器将现有的 MetaPlanner（7-Stage Pipeline）包装为 MissionPlanner。 使用方 | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/mission/adapters/index.ts` | runtime/mission/adapters — Mission Runtime 适配器 barrel P0 架构完善: 将新 v8 模块连接到现有引擎。 适配器清单： MetaPlannerAdapter  — MissionRuntime → MetaPlanner（7-Stage Pipeline） DAGExecutorAdapter  — MissionRuntime → DAGRuntime（TaskGraph/Scheduler） GatewayMissionHandler — deprecate | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/mission/index.ts` | runtime/mission — Mission Runtime 模块统一入口 Phase 3 / MorPex v8: 用户意图 → Mission → Plan → Execution 的核心编排。 导出: - MissionState:          业务级生命周期枚举（8 状态） - MISSION_VALID_TRANSITIONS: 有效转换映射 - MissionRuntime:        运行时主引擎 - MissionPlanner/MissionExecutor: 规划器/执行器接口  | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/mission/types.ts` | Mission Runtime — 任务/使命数据类型定义 Phase 3 / MorPex v8: Mission 是用户意图的顶级抽象。 设计原则： 1. 每个用户意图实例化为一个 Mission 2. Mission 有完整的业务生命周期（MissionState 枚举） 3. Mission 拥有 Plan（策略层）和 Execution（执行层） 4. Mission 携带权限上下文（approval / allowedTools） 与现有 ExecutionFSM（agent-level）的关系： -  | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/sandbox/SandboxManager.ts` | SandboxManager — 沙箱执行管理器 MorPex v8.8 -> v9.2: 从模拟层升级为真实代码执行。 每个任务在沙箱上下文中执行，限制 CPU/内存/网络/文件系统访问。 v9.2 新增: - executeCode() — 真实 child_process 执行代码 - executeCodeFromArtifact() — 从产物自动提取并执行 - detectLanguage() — 自动识别代码语言 - 支持 Python, JavaScript, Go, Bash, TypeScrip | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/sandbox/index.ts` | （barrel：统一导出，功能以被导出文件为准） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/sandbox/types.ts` | Sandbox — 类型定义 MorPex v8.8: 沙箱隔离执行上下文。 / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/simulation/ExecutionSimulator.ts` | ExecutionSimulator — 执行计划模拟器 v16: 在规划后执行前模拟，发现潜在问题 / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/simulation/index.ts` | （barrel：统一导出，功能以被导出文件为准） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/state-machine/ExecutionFSM.ts` | ExecutionFSM — 执行状态机 MorPex Runtime 执行状态管理。 管理 Agent 执行的生命周期状态转换。 States: CREATED → PLANNING → READY → EXECUTING ⇄ WAITING ↓ REVIEWING → COMPLETED ↓ FAILED / CANCELLED Features: - 状态转换验证 - 状态持久化 (JSONL) - 状态恢复 - 事件发射 - 审计日志 / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/state-machine/index.ts` | （barrel：统一导出，功能以被导出文件为准） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/verification/VerificationEngine.ts` | VerificationEngine — 验证引擎 Phase 4 / MorPex v8: 验证 Mission 执行结果的完整性、正确性。 使用场景： MissionRuntime 在 MissionState.VERIFYING 阶段调用 verify() 验证完成后根据结果决定进入 COMPLETED 或 FAILED 标准验证点： 1. step_completion   — 计划中所有步骤是否都完成（weight: 0.4） 2. output_presence   — 是否产生了输出（weight:  | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/verification/index.ts` | runtime/verification — Verification Engine Barrel Phase 4 / MorPex v8: 验证引擎统一导出入口。 / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/verification/types.ts` | Verification Engine — 类型定义 Phase 4 / MorPex v8: 验证 Mission 执行结果的标准数据结构。 设计原则： - 每次验证产生一个 VerificationResult（不可变） - 每个验证点（check）有明确的权重和通过/不通过 - Issue 区分三个严重等级：error / warning / info / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/types.ts` | Organization Types — 组织上下文类型定义 Phase 0 / 组织层 v15: +DynamicTeam 动态团队编排类型 为 Memory/Knowledge/Artifact 操作提供部门感知上下文 / | 有界执行+硬边界；不重规划/不评分/不演化 |


## `evaluation/`（10 文件）

> 层边界规则：评分+血缘+低分信号；不修改行为/不执行业务

| 文件 | 功能 | 职责边界 |
|---|---|---|
| `evaluation/EvaluationEngine.ts` | EvaluationEngine — 系统级评价（Wave 3a 事件桥）：注入 EventBus 后必发 evaluation.scored，低于阈值（默认 0.6）发 evaluation.low_score；纯函数返回值不变；低分只发事件，不直接触发生产变更 | 评分+血缘+低分信号；不修改行为/不执行业务 |
| `evaluation/QualityScorer.ts` | QualityScorer — 质量评分器：scoreSystem(metrics) → {overall, dimensions, suggestions}（overall 0-100），decide(score) → continue/retry/replan/abort | 评分+血缘+低分信号；不修改行为/不执行业务 |
| `evaluation/index.ts` | L6 Evaluation 评价层 | 评分+血缘+低分信号；不修改行为/不执行业务 |
| `evaluation/ontologyCompliance.ts` | ontologyCompliance — Ontology 查询合规评分 迭代1：在现有 EvaluationEngine 基础上增加两维： - queryScore：是否执行了 ontology 查询 - referenceScore：引用的 ID 是否都来自已检索集合 用法： const { queryScore, referenceScore } = scoreOntologyCompliance(guard, executionId, referencedIds); // 将分数注入 evaluation  | 评分+血缘+低分信号；不修改行为/不执行业务 |
| `evaluation/lineageCompliance.ts` | lineageCompliance — L6 血缘健康评分（Wave 3a 新增）：复用 L2 ArtifactLineage 计算批准占比/孤立节点/违规清单 → LineageHealthScore（0-1），不直接触发生产变更 | 评分+血缘+低分信号；不修改行为/不执行业务 |
| `evaluation/verification/VerificationEngine.ts` | VerificationEngine — L6 验证引擎（Wave 8a 自 governance/ 迁入）：组合 QualityRule + ExecutionVerifier + RepairPlanner 对产物做质量验证并生成修复计划 | L6 评价/验证权威；不触发生产变更 |
| `evaluation/verification/QualityRule.ts` | QualityRule — 质量检查规则接口（QualityCheck）与规则注册 | L6 评价/验证权威 |
| `evaluation/verification/ArtifactChecker.ts` | ArtifactChecker — 基于 QualityRule 的产物质量检查 | L6 评价/验证权威 |
| `evaluation/verification/ExecutionVerifier.ts` | ExecutionVerifier — 基于 ArtifactChecker 的执行结果验证 | L6 评价/验证权威 |
| `evaluation/verification/RepairPlanner.ts` | RepairPlanner — 基于 VerificationResult 的修复计划 | L6 评价/验证权威 |


## `evolution/`（24 文件）

> 层边界规则：提案→沙箱→审批→迁移；须过Gate/不绕过Governance/晋升才写Tier-2

| 文件 | 功能 | 职责边界 |
|---|---|---|
| `evolution/EvolutionProposal.ts` | EvolutionProposal — 演化提案数据模型（Wave 3a 自 cognition/ 迁入）。创建后状态必须为 pending（DRAFT→PENDING_REVIEW→APPROVED）；tier-0/1 创建必须持有 KnowledgeContextPackage（Wave 3b Gate 硬拦截） | L7 演化唯一所有者；未审批状态只能是 pending |
| `evolution/ImprovementAnalyzer.ts` | ImprovementAnalyzer — 改进洞察分析（Wave 3a 自 cognition/ 迁入）：成功率/延迟/失败模式 → ImprovementInsight 列表 | L7 演化唯一所有者；只产洞察，不执行 |
| `evolution/SelfImprovementLoop.ts` | SelfImprovementLoop — 自我改进闭环（Wave 3a 自 cognition/ 迁入）。Observation → Analysis → Proposal → Simulation → Evaluation → Approval → Deployment → Monitor；只生成提案，不直接修改代码。Wave 3b：晋升经 EvolutionSandbox.approveAndApply 需 Gate 凭证 | L7 演化唯一所有者；L4 禁止直接触发 |
| `evolution/ActiveEvolutionTrigger.ts` | ActiveEvolutionTrigger — 主动进化触发器 v16 Phase 4.7: 一人跨多领域虚拟公司的主动自我进化能力。 在事件驱动触发之外， 增加基于失败、质量、新部门等条件的主动进化触发器。 设计原则： - EventBus 通信（监听 mission.completed、evolution.active_triggered 等） - 部门隔离（按 deptId 独立追踪失败计数） - 阈值可配置 - 非阻塞：触发检查不干扰主线执行 触发条件： 1.  | 提案→沙箱→审批→迁移；须过Gate/不绕过Governance/晋升才写Tier-2 |
| `evolution/EvolutionSandbox.ts` | EvolutionSandbox — 演化安全沙箱（Verifiable Evolution 最小闭环） L7：禁止「分析完直接改生产行为」。演化产物必须先： 1. 沙箱试跑（dry-run golden tasks，隔离 Runtime） 2. 版本化落地（version ledger，EventStore 持久化） 3. 人工审批（未批准 = proposal 状态 pending） 4. 自动回滚（L7：携带 revert() 的具体变更真正撤销 + verify() 校验； 失败可重试，不产生 | EvolutionSandbox — 演化安全沙箱（Verifiable Evolution 最小闭环） L7：禁止「分析完直接改生产行为」。演化产物必须先： 1. 沙箱试跑（dry-run golden tasks，隔离 Runtime） 2. 版本化落地（version ledger，EventStore 持久化） 3. 人工审批（未批准 = proposal 状态 pending） 4. 自动回滚（L7：携带 revert() 的具体变更真正撤销 + verify() 校验； 失败可重试，不产生 |
| `evolution/ExperienceMiner.ts` | ExperienceMiner — 经验挖掘器 v16: 任务完成后自动挖掘经验，更新 CapabilityRegistry。v16c（3+4）经验沉淀触发条件：消费 failureReport/stepStats → LearningEventDetector 识别可学习事件 → 发射 evolution.experience.mined | L7 演化唯一所有者；只产经验与事件，不执行 |
| `evolution/LearningEventDetector.ts` | LearningEventDetector — 可学习事件识别（v16c 3+4）：空参模式/安全拦截/高重试/部分失败 → LearningEvent 结构化记录 + summarize 聚合（观测/学习数据源，纯函数） | L7 演化唯一所有者；纯函数无副作用 |
| `evolution/ExperienceInjectionService.ts` | ExperienceInjectionService — 任务间经验主动注入（v16d P2）：按 goal/domain 匹配已沉淀可学习事件 → 规避提示注入聚焦上下文（沉淀→注入闭环） | L7 演化唯一所有者；只产提示不执行 |
| `evolution/PromptStrategyRegistry.ts` | PromptStrategyRegistry — 提示词/策略库（v16e 3-3 进化落地目标）：可学习事件 → 版本化策略 hint（setHint 递增版本/removeHint 回滚），装配/执行路径读取影响行为 | L7 演化唯一所有者；纯数据存储 |
| `evolution/EvolutionApplyLoop.ts` | EvolutionApplyLoop — 进化提案落地通道（v16e 3-3 半自动应用）：学习事件 → 沙箱提案（apply/revert 动作）→ 有 Gate 凭证自动应用 / 否则 pending_approval；防抖防重提 | L7 演化唯一所有者；走 EvolutionSandbox，不绕过沙箱 |
| `evolution/FailureAnalyzer.ts` | FailureAnalyzer — v11 Failure Analysis Engine Analyzes workflow execution failures to identify root causes, failure patterns, and recovery recommendations. Flow: Execution History → Failure Detection → Root Cause Analysis → Recommendations @packageDocumentatio | 提案→沙箱→审批→迁移；须过Gate/不绕过Governance/晋升才写Tier-2 |
| `evolution/KnowledgeGapListener.ts` | KnowledgeGapListener — 知识缺失监听器（QueryMiss → Feedback → Evolution） vNext+ 演化安全闭环的一部分： Ontology Gate 无结果（QueryMiss）不能静默失败。 本监听器订阅 EventBus 的 `ontology.query.miss` 事件： 1. 将每次知识缺失写入 FeedbackService（Feedback 对象，source='query_miss'） 2. 聚合缺失统计（按 tier / reason / goal）， | 提案→沙箱→审批→迁移；须过Gate/不绕过Governance/晋升才写Tier-2 |
| `evolution/PatternExtractor.ts` | PatternExtractor — 模式提取器 (v16) 从完成任务提取模式，写入合并后的 CapabilityRegistry / | 提案→沙箱→审批→迁移；须过Gate/不绕过Governance/晋升才写Tier-2 |
| `evolution/index.ts` | evolution — MorPex Evolution Layer Barrel Phase 5 / MorPex v8.5: 系统长期成长引擎。 v11: +ExperienceMiner, +FailureAnalyzer, +PatternExtractor v16 Phase 4.7 新增: ActiveEvolutionTrigger — 主动进化触发器（事件驱动权威入口） 子模块: evolution/workflow/   — Workflow Ev | 提案→沙箱→审批→迁移；须过Gate/不绕过Governance/晋升才写Tier-2 |
| `evolution/workflow/WorkflowExecutor.ts` | WorkflowExecutor — 工作流自动执行器 Phase 5 / MorPex v8.5: 使用 MissionRuntime 自动执行已确认的工作流。 执行流程: 1. 从 Registry 获取工作流定义 2. 构造 Mission (goal = workflow 描述) 3. 为每个步骤创建 MissionPlan 4. 委托 MissionRuntime.executeMission() 执行 5. 记录执行结果到 Registry 与 MissionRuntime 的关系: WorkflowE | 提案→沙箱→审批→迁移；须过Gate/不绕过Governance/晋升才写Tier-2 |
| `evolution/workflow/WorkflowOptimizer.ts` | WorkflowOptimizer — 工作流持续优化器 Phase 5 / MorPex v8.5: 基于执行性能数据持续优化工作流。 职责: 1. 分析工作流执行性能 2. 使用 WorkflowIntelligence 生成优化建议 3. 应用优化 (创建新版本) 4. 检测性能退化并自动触发重新优化 / | WorkflowOptimizer — 工作流持续优化器 Phase 5 / MorPex v8.5: 基于执行性能数据持续优化工作流。 职责: 1. 分析工作流执行性能 2. 使用 WorkflowIntelligence 生成优化建议 3. 应用优化 (创建新版本) 4. 检测性能退化并自动触发重新优化 / |
| `evolution/workflow/WorkflowRegistry.ts` | WorkflowRegistry — 工作流注册表 Phase 5 / MorPex v8.5: 正式工作流生命周期管理。 生命周期: candidate → confirmed → active → deprecated ↓ paused → active 职责: 1. 注册候选工作流 2. 管理状态转换 (confirm / activate / deprecate / pause) 3. 版本管理 (addVersion) 4. 执行追踪 (recordExecution) 5. 查询 (按状态 / 可自动执 | WorkflowRegistry — 工作流注册表 Phase 5 / MorPex v8.5: 正式工作流生命周期管理。 生命周期: candidate → confirmed → active → deprecated ↓ paused → active 职责: 1. 注册候选工作流 2. 管理状态转换 (confirm / activate / deprecate / pause) 3. 版本管理 (addVersion) 4. 执行追踪 (recordExecution) 5. 查询 (按状态 / 可自动执 |
| `evolution/workflow/WorkflowSimulator.ts` | WorkflowSimulator — 工作流仿真引擎 MorPex v8.7: 在 PolicyEngine 决策之前对 WorkflowCandidate 进行离线仿真验证。 职责: 1. 对候选工作流进行历史回放仿真 2. 计算多维度指标 (successRate, failureModes, avgLatency, riskScore, resourceCost) 3. 生成 SimulationResult 供 PolicyEngine 决策 4. 不再自行决策通过/拒绝 — 阈值由 PolicyEngi | WorkflowSimulator — 工作流仿真引擎 MorPex v8.7: 在 PolicyEngine 决策之前对 WorkflowCandidate 进行离线仿真验证。 职责: 1. 对候选工作流进行历史回放仿真 2. 计算多维度指标 (successRate, failureModes, avgLatency, riskScore, resourceCost) 3. 生成 SimulationResult 供 PolicyEngine 决策 4. 不再自行决策通过/拒绝 — 阈值由 PolicyEngi |
| `evolution/workflow/contract/ContractValidator.ts` | WorkflowContract — 工作流契约 MorPex v8.8: 每个工作流必须定义输入/输出/前置条件/成功标准/失败策略。 在执行前验证契约，确保可交付性。 / | 提案→沙箱→审批→迁移；须过Gate/不绕过Governance/晋升才写Tier-2 |
| `evolution/workflow/contract/WorkflowContract.ts` | WorkflowContract — 工作流契约 MorPex v8.8: 每个工作流必须定义输入/输出/前置条件/成功标准/失败策略。 在注册和执行前进行契约验证。 设计原则: 1. 契约即文档：工作流契约是 Workflow 的"类型签名" 2. 先验证后执行：契约验证不通过则不执行 3. 版本化：契约版本随工作流版本递增 / | 提案→沙箱→审批→迁移；须过Gate/不绕过Governance/晋升才写Tier-2 |
| `evolution/workflow/contract/index.ts` | （barrel：统一导出，功能以被导出文件为准） | 提案→沙箱→审批→迁移；须过Gate/不绕过Governance/晋升才写Tier-2 |
| `evolution/workflow/contract/types.ts` | Workflow Contract — 类型定义 MorPex v8.8: 工作流契约的类型定义。 每个工作流在注册前必须定义其契约。 / | 提案→沙箱→审批→迁移；须过Gate/不绕过Governance/晋升才写Tier-2 |
| `evolution/workflow/index.ts` | evolution/workflow — Workflow Evolution Engine Barrel Phase 5 / MorPex v8.5 / | 提案→沙箱→审批→迁移；须过Gate/不绕过Governance/晋升才写Tier-2 |
| `evolution/workflow/types.ts` | Workflow Evolution Engine — 类型定义 Phase 5 / MorPex v8.5: 工作流持续演化系统的数据模型。 与 cognition/workflow/ 的区别: cognition/workflow/ — 工作流智能: 模式检测、提取、优化建议 (一次性分析) evolution/workflow/ — 工作流演化: 持续挖掘、注册管理、版本化、自动执行 (生命周期) 生命周期: candidate (系统发现) → confirmed (用户确认) → active (自动执行 | 提案→沙箱→审批→迁移；须过Gate/不绕过Governance/晋升才写Tier-2 |


## `infrastructure/`（73 文件）

> 层边界规则：底座服务；无领域逻辑/不推理/不规划/不评价/不演化

| 文件 | 功能 | 职责边界 |
|---|---|---|
| `infrastructure/adapters/agent-spawner.ts` | AgentSpawnerAdapter — Agent 创建工厂 通过 PiBridge 隔离 pi-agent-core 依赖。 PiBridge 是唯一直接导入 pi-agent-core 的文件。 / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/adapters/identity.ts` | IdentityAdapter — ID generation utilities Pi-independent implementation using Node 20+ crypto.randomUUID(). Previously used pi-agent-core's uuidv7 — now self-contained. The generated IDs are time-sortable UUID v7-compatible. Format: {prefix}_{YYYYMMDD}_{8hex}  | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/adapters/embedding/EmbeddingProvider.ts` | EmbeddingProvider — 向量化提供器（会话 16k）：调用 OpenAI 兼容 /embeddings（SiliconFlow BAAI/bge-m3），配置全来自 config/embeddingconfig.yaml（非硬编码）；cosine 相似度；RAG-lazy 装配的 similarityScorer 数据源 | 底座服务；仅适配器层；不可用回退关键词检索 |
| `infrastructure/adapters/index.ts` | MorPex Core Adapter Layer — Barrel export All Pi-adjacent types and utilities are re-exported from here. Core business logic may import from this barrel: import { MPAgentTool, Type } from '../../infrastructure/adapters/index.js'; ══════════════════════════════ | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/adapters/memory/index.ts` | Memory Adapter Bridge — 统一 memory 包接入层 ═══════════════════════════════════════════════════════════════════ ARCHITECTURAL BOUNDARY Only files in packages/core/src/infrastructure/adapters/ may directly import from the memory package. All L2/L3/L4 core modules MU | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/adapters/model-registry.ts` | ModelRegistryAdapter — isolates pi-ai model discovery functions. Wraps pi-ai's getModels / getProviders / getModel. Uses type-safe provider validation. 附加模型（llm_* 块）从 config 构建并合并到发现列表（compat 静态目录不含运行时注册的自定义 provider）。 / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/adapters/model-resolver.ts` | ModelResolver — Type-safe wrapper around pi-ai's getModel(). Uses pi-ai/compat for backward compatibility. 附加模型（llm_* 块）从 config 构建等价模型定义（compat 静态目录不含）。 / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/adapters/pi-ai-types.ts` | PiAITypesAdapter — isolates pi-ai TypeBox type exports Re-exports Type, Static, TSchema from pi-ai for use in tool definitions. If pi-ai changes these exports, only this file needs updating. / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/adapters/pi-augmentations.ts` | Pi Augmentations — TypeScript declaration merging for pi-agent-core types. Extends pi-agent-core's AgentMessage to support MorPex custom message roles (memoryHint, dagNodeStatus) used by MemoryMessages.ts. This file is imported as a side-effect by MemoryMessag | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/adapters/pi-bridge/PiBridge.ts` | PiBridge — 稳定的 pi-ai + pi-agent-core 抽象层 隔离 @earendil-works/pi-ai 和 @earendil-works/pi-agent-core 的 API 变更。 当底层包升级时，只需修改此文件。 内部使用 pi-ai 0.81.x 新 API：builtinModels / Models.complete 内部使用 pi-agent-core 0.81.x API：AgentHarness / InMemorySessionRepo / NodeExecutio 附加模型（llm_* 块）：init() 在 builtin 基底上叠加注册 gateway provider（setProvider），默认模型不变。 | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/adapters/pi-bridge/index.ts` | pi-bridge — 稳定的 pi-ai 抽象层 @packageDocumentation / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/adapters/pi-types.ts` | MorPex Pi Type Adapter — Central type-level bridge ═══════════════════════════════════════════════════════════════════ IMPORTANT: THIS IS THE ONLY FILE WHERE Pi TYPES ARE IMPORTED. All other core files MUST import Pi types from here: import { MPAgentTool } fro | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/adapters/pi-utils.ts` | MorPex Pi Utilities Adapter — Central runtime bridge to Pi packages ═══════════════════════════════════════════════════════════════════ ALL pi-agent-core classes go through PiBridge static getters. When pi packages upgrade, only PiBridge needs changing. pi-ai  | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/adapters/thinking-level.ts` | ThinkingLevel — 模型推理深度控制 / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/common/EncryptionService.ts` | EncryptionService — AES-256-GCM 加密/解密 v9.2 Phase 3: 保护敏感字段的静态加密。 使用 Node.js 内置 crypto 模块，AES-256-GCM 认证加密。 环境变量: MORPEX_ENCRYPTION_KEY (32字节 hex) 使用方式: const enc = new EncryptionService(); const encrypted = enc.encrypt('{"apiKey":"sk-..."}'); const decrypted = | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/common/EventBus.ts` | EventBus — 事件总线 (v2: 支持领域作用域) 插件间唯一通信通道。 所有事件必须携带 executionId。 事件类型命名空间：{domain}.{action}（如 runtime.tool.called） Phase 11 新增： - emitToDomain(domainId, event) — 只发送到指定领域 - onDomain(domainId, eventType, handler) — 只监听指定领域 - broadcastCrossDomain(event) — 跨领域广播 设计 | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/common/ExecutionIdentity.ts` | ExecutionIdentity — 全链路 ID 系统 ID 格式：{prefix}_{YYYYMMDD}_{shortUUID} | 类型      | prefix | 示例                        | |-----------|--------|-----------------------------| | executionId | exe  | exe_20260707_a81f92cd       | | traceId   | trc    | trc_20260707_b | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/common/ModelRegistry.ts` | ModelRegistry — pi-ai 模型运行时发现 封装 pi-ai 的 getModels + getProviders + getModel， 提供 MorPexCore 统一的模型查询和发现能力。 所有 pi-ai 直接依赖集中在 ModelRegistryAdapter 中， 更换 pi-ai 版本时仅需修改适配层。 / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/common/PluginSystem.ts` | PluginSystem — 插件注册、生命周期、依赖管理 管理插件的完整生命周期：register → initialize → start → running → stop 设计约束： - 启动顺序按依赖拓扑排序 - 禁止循环依赖 - 插件间禁止直接 import（只能通过 EventBus 通信） - 最后实现（先固化 Kernel Contract，再定义插件生命周期） / | PluginSystem — 插件注册、生命周期、依赖管理 管理插件的完整生命周期：register → initialize → start → running → stop 设计约束： - 启动顺序按依赖拓扑排序 - 禁止循环依赖 - 插件间禁止直接 import（只能通过 EventBus 通信） - 最后实现（先固化 Kernel Contract，再定义插件生命周期） / |
| `infrastructure/common/contracts/eventContractCatalog.ts` | eventContractCatalog — 事件契约目录（G1）-- 为 L1-L8 跨层核心事件注册 EventContract（description/producer/consumers/projected/validatePayload）。bootstrap 经 `registerCoreEventContracts(bus)` 将 24+13 个契约填充进 EventBus 契约表（+13 = 执行链任务卡片事件 mission/execution/step/artifact，块级校验，规格见 docs/EVENT_PAYLOAD_SPEC.md）；observability 暴露 `GET /api/observability/event-contracts`（reconcile 对账：declared/enumTypes/emitted/unregistered/unassertedEnums 双轨漂移检测）。 | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/common/ProgressCallback.ts` | ProgressCallback — 结构化进度回调系统 Phase 4.6 / 架构打磨 — Action/Brain 提升 为所有执行模块提供统一的进度回调接口。 替代原有的 EventBus "广播后祈祷" 模式。 设计原则： - 可选注入：所有模块的 ProgressCallback 均为可选，不传则无回调 - 与 EventBus 共存：回调用于同步编程模式，EventBus 用于异步广播 - 进度 0-100：调用方可以计算百分比 - 线程安全：回调是同步调用，调用方自行决定是否异步 使用方式： con | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/common/ThinkingLevelControl.ts` | ThinkingLevelControl — 推理深度控制（迁移到 contracts 适配层） v3.x 重构完成：所有 pi-ai 直接依赖集中在 adapters/thinking-level.ts。 迁移 contracts 后，可通过 InferencePort.getCapabilities() 替换此模块。 pi-ai 直接依赖已隔离到适配层（adapters/thinking-level.ts）。 / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/common/ToolQualityTracker.ts` | ToolQualityTracker — 工具质量追踪器 Phase 4.6 / 架构打磨 — Tools 提升 追踪每个工具/连接器的调用质量指标： - 调用次数 - 成功率 - 平均延迟 - 最后调用时间 - 错误分布 基于历史数据提供简单的"最佳工具推荐"。 设计原则： - 纯内存运行（不持久化，重启重置） - 线程安全（简单计数器，无锁） - 轻量级（O(1) 记录，O(n) 查询） 使用方式： const tracker = new ToolQualityTracker(); tracker.record | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/common/resilience/CircuitBreaker.ts` | CircuitBreaker — 熔断器 v9.2 Phase 1: 防止级联故障，快速失败。 状态机: CLOSED (正常) → 连续 failureCount >= failureThreshold → OPEN OPEN (熔断) → 等待 openTimeoutMs → HALF_OPEN HALF_OPEN (半开) → 首次成功 → CLOSED HALF_OPEN (半开) → 失败 → OPEN (立即) 使用方式: const cb = new CircuitBreaker('execution | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/common/resilience/ErrorHandlerService.ts` | ErrorHandlerService — 统一错误处理与恢复服务 v9.2 Phase 1: 编排 RetryPolicy + CircuitBreaker + 补偿回调。 所有 Stage / Manager 的关键操作包裹此服务。 流程: 1. CircuitBreaker 快速拒绝 (OPEN 状态) 2. RetryPolicy 控制重试次数 + 退避延迟 3. 所有失败 → 补偿回调 (Saga 模式) 4. 事件广播到 EventBus / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/common/resilience/RetryPolicy.ts` | RetryPolicy — 可配置重试策略 v9.2 Phase 1: 统一重试框架，支持多种退避策略和错误过滤。 使用方式: const policy = RetryPolicy.standard(); for (let i = 0; i <= policy.maxAttempts; i++) { try { return await op(); } catch (e) { if (!policy.shouldRetry(e)) throw e; await delay(policy.getDelay(i));  | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/common/resilience/index.ts` | （barrel：统一导出，功能以被导出文件为准） | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/common/types.ts` | MorPexCore — 核心接口定义 这是整个 MorPexCore 的类型基础。 Event Schema 最先冻结，之后所有插件层的开发都基于它展开。 ═══ MorPex v8 Phase 1 ═══ 事件协议已标准化为 protocol/events/ 模块。 新代码应优先使用以下协议类型： import { EventType } from '../../infrastructure/protocol/events/EventType.js'; import type { BaseEvent } fro | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/observability/CompactionService.ts` | CompactionService — SQLite 数据库压缩维护服务 v9.2 Phase 2: 自动清理旧事件、快照、版本，VACUUM 回收磁盘空间。 使用方式: import Database from 'better-sqlite3'; const db = new Database('./data/morpex-events.db'); const svc = new CompactionService(db); await svc.compact(); svc.startAuto(); // 定时自 | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/observability/HealthCheckService.ts` | HealthCheckService — 健康检查聚合器 v9.2 Phase 4: 注册多个健康检查，并行运行并汇总状态。 支持超时、熔断降级语义 (healthy/degraded/unhealthy)。 / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/observability/MetricsCollector.ts` | MetricsCollector — 指标收集器 MorPex v8.8: 收集运行时指标的时序数据。 支持按名称查询、时间窗口聚合。 / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/observability/ObservabilityBootstrap.ts` | ObservabilityBootstrap — 可观测性快速启动工具 将 PrometheusExporter 和 HealthCheckService 组合为一个统一的启动函数。 应用方只需一次调用即可挂载 /metrics 和 /health 端点。 使用方式: import { bootstrapObservability } from './infrastructure/observability/ObservabilityBootstrap.js'; const obs = bootstrapObser | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/observability/PrometheusExporter.ts` | PrometheusExporter — 轻量 Prometheus 文本格式导出器 v9.2 Phase 4: 将 MetricsCollector 的指标导出为 Prometheus text format。 无外部依赖。同时返回 JSON 格式供内部 HTTP 端点使用。 / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/observability/TraceManager.ts` | TraceManager — 追踪管理器 MorPex v8.8: 记录每个 Mission 的完整执行追踪。 每个 Span 代表一个阶段（Intent/Plan/Task/Verification）， 形成树形追踪结构。 / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/observability/WorkflowMetrics.ts` | WorkflowMetrics — 工作流运行指标 MorPex v8.8: 聚合工作流运行的关键业务指标。 / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/observability/index.ts` | （barrel：统一导出，功能以被导出文件为准） | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/protocol/contracts/artifact-lifecycle.ts` | Artifact 生命周期契约（CREATED→…→RETIRED 状态机 + LineageEntry） | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/protocol/contracts/goal.ts` | Goal Intelligence — 共享类型 / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/protocol/events/BaseEvent.ts` | MorPex Event Protocol — Base Event Interface Phase 1 / MorPex v8: 系统中所有事件的基础接口。 BaseEvent 定义了事件的最小通用结构： - id:         唯一标识（evt_{YYYYMMDD}_{shortUUID}） - type:       标准事件类型（EventType 枚举或扩展字符串） - timestamp:   时间戳（Date.now()） - executionId: 关联执行 ID（始终必填） - source | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/protocol/events/DecisionEvent.ts` | DecisionEvent — 认知决策事件（Cognitive Event Stream） v8.6: 记录 Agent 做出每个决策时的完整上下文。 与 Execution History（MissionRuntime 状态转换）互补，形成完整的认知审计线索。 设计原则: - 只追加（append-only）：决策记录不可篡改 - 完整上下文：记录决策时的输入、推理、证据 - 版本关联：记录决策时使用的 Twin 版本 与 EventStore 的关系: - DecisionEvent 通过 EventStor | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/protocol/events/EventType.ts` | MorPex Event Protocol — Standard Event Types Phase 1 / MorPex v8: 标准化事件类型枚举。 所有事件按架构层分组： Interaction → Cognitive → Mission → Planning → Execution → Agent → Tool → Workflow → Control → System → Artifact → Cross-Domain 使用方式： import { EventType } from './EventTyp | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/protocol/events/EventTypes.ts` | SYSTEM_EVENT_TYPES — 全系统事件类型常量（goal/execution/evaluation/evolution 事件名） | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/protocol/events/Envelope.ts` | EventEnvelope + MessageBox — 任务事件载荷规格（EVENT_PAYLOAD_SPEC v1）的类型投影：稳定信封头（schemaVersion/refs/layer）+ 可扩展分块载荷（task/state/human/artifacts/media/error/extensions），媒体引用优先，未知块忽略（向前兼容） | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/protocol/events/index.ts` | protocol/events — MorPex Event Protocol Barrel Phase 1 / MorPex v8: 事件协议层统一导出入口。 导出： - EventType:         标准事件类型枚举 - EVENT_LAYERS:      事件类型按层分组 - getAllEventTypes:  获取所有标准事件类型 - BaseEvent:         基础事件接口 - isStandardEvent:   判断是否为标准事件类型 - isEventInLayer:    判 | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/protocol/events/store/EventProjection.ts` | EventProjection — 事件投影：从事件流计算当前状态 Phase 4 / MorPex v8.5: 纯函数集合。接受事件流，输出状态视图。 不修改任何状态，无副作用。 核心原则: 状态 = 投影(事件流) 禁止: mission.state = "COMPLETED" 必须: missionState = EventProjection.projectMission(missionId, events).currentState 使用方式: const proj = EventProjection.p | EventProjection — 事件投影：从事件流计算当前状态 Phase 4 / MorPex v8.5: 纯函数集合。接受事件流，输出状态视图。 不修改任何状态，无副作用。 核心原则: 状态 = 投影(事件流) 禁止: mission.state = "COMPLETED" 必须: missionState = EventProjection.projectMission(missionId, events).currentState 使用方式: const proj = EventProjection.p |
| `infrastructure/protocol/events/store/EventRepository.ts` | EventRepository — 事件查询层 Phase 4 / MorPex v8.5: 在 EventStore 基础上提供过滤、聚合、时序查询。 使用方式: const repo = new EventRepository(eventStore); const errors = repo.query({ types: [EventType.SYSTEM_ERROR], since: Date.now() - 3600000 }); const timeline = repo.getTimeline('mis | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/protocol/events/store/IEventStore.ts` | IEventStore — 统一 EventStore 接口 v9.2 Stage 0: 定义统一的 EventStore 契约。 所有模块通过此接口访问事件存储，不依赖具体实现。 设计原则: - 接口最小化：只暴露必要方法 - 异步友好：所有方法返回 Promise - 可替换：内存 / SQLite / PostgreSQL 均可实现 / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/protocol/events/store/SqliteEventStore.ts` | SqliteEventStore — SQLite 后端事件存储 v9.2 Stage 0: 替代 JSONL 事件存储，提供： - WAL 模式（并发读安全） - 事务批量写入 - 时序索引（sequence + timestamp） - aggregateId 索引（领域/聚合溯源） 表结构: events           — 主事件表 (BaseEvent) events_decision  — 决策事件表 (DecisionEvent) schema_migrations — 迁移版本跟踪 使用方式:  | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/protocol/events/store/UnifiedEventStore.ts` | UnifiedEventStore — 统一事件存储实现（IEventStore 契约，基于 SqliteEventStore 后端；Wave 9 已移除全部旧版兼容 API，纯现架构） | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/protocol/events/store/index.ts` | protocol/events/store — Event Sourcing Barrel Phase 4 / MorPex v8.5: 事件溯源存储层。 v9.2 Stage 0: - 新增 IEventStore 接口（统一契约） - 新增 SqliteEventStore（SQLite 实现，取代 JSONL） - UnifiedEventStore（IEventStore 实现，Wave 9 已移除旧版兼容 API） - 旧 EventStore 已删除（Wave 9） / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/protocol/index.ts` | protocol — MorPex Protocol Layer Barrel Phase 1 / MorPex v8: 协议层统一入口。 子模块： protocol/events/   — 事件协议层（EventType, BaseEvent） 设计原则： - 协议层不依赖任何运行时组件 - 任何模块都可以安全引用 protocol/ - 协议层可以引用 contracts/（纯类型） / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/protocol/message-gateway.ts` | MessageGateway — 统一消息网关 Phase 2 / MorPex v8: 所有外部渠道的单一入口。 职责： 1. 注册 ChannelAdapter（Web/WeChat/Feishu/CLI） 2. 将 IncomingMessage 转换为 EventType.USER_MESSAGE 事件 3. 通过 MessageHandler 路由到下游（Mission Runtime / StudioOrchestrator） 4. 维护活跃会话列表 设计约束： - 不与任何 Agent 直接耦合（只知 | MessageGateway — 统一消息网关 Phase 2 / MorPex v8: 所有外部渠道的单一入口。 职责： 1. 注册 ChannelAdapter（Web/WeChat/Feishu/CLI） 2. 将 IncomingMessage 转换为 EventType.USER_MESSAGE 事件 3. 通过 MessageHandler 路由到下游（Mission Runtime / StudioOrchestrator） 4. 维护活跃会话列表 设计约束： - 不与任何 Agent 直接耦合（只知 |
| `infrastructure/protocol/message-types.ts` | MorPex Interaction Layer — 统一消息类型定义 Phase 2 / MorPex v8: 所有渠道的标准化消息格式。 设计原则： - 所有外部消息（Web/WeChat/Feishu/CLI）统一转换为 IncomingMessage - 所有下行消息统一为 OutgoingMessage - ChannelAdapter 接口抽象不同接入渠道 / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/tools/DomainPrimitiveRegistry.ts` | DomainPrimitiveRegistry — 领域原语注册中心 v16 Phase 4.7: 一人跨多领域虚拟公司的领域能力管理。 统一管理所有领域原语（电商、硬件、内容等）， 根据任务描述自动匹配最合适的原语执行。 设计原则： - 热注册：原语可以在运行时动态注册/注销 - 自动匹配：根据任务描述通过 canHandle 匹配 - 部门隔离：原语执行时注入 deptId - 版本追踪：记录每个原语的调用统计 数据流： ToolFactory.generateToolForTask() → DomainPri | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/tools/ForkExecuteTool.ts` | ForkExecuteTool — 派生无状态执行肢（Fork） Expert (Ring 1) 通过此工具将高风险/高耗时任务下放到 Fork (Ring 2) 执行。Fork 运行在隔离的 worker_threads 中，超时/内存超限自动 terminate。 底层调用 ToolExecutionProxy.execute()，使用已有的 worker_threads 隔离机制。 遵循迁移铁律： 0.2 (类型来源法则): 类型基于 pi-agent-core 扩展 0.4 (删除优先法则): 使用已有的  | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/tools/ReadArtifactTool.ts` | ReadArtifactTool — 按需读取 Artifact 工具 (Phase 11: Harness-aware) 优先通过 AgentHarness 读取（权限检查），回退到直接 ArtifactRegistry 访问。 / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/tools/TeamSayTool.ts` | TeamSayTool — 领域间通信工具 向指定 Agent 发送消息（UDP 语义，非阻塞）。 目标 Agent 当前 turn 完成后自动消费消息。 使用 pi-agent-core harness.steer() 实现。 steer() 注入 steering 消息，异步非阻塞。 遵循迁移铁律： 0.2 (类型来源法则): 类型基于 pi-agent-core 扩展 0.4 (删除优先法则): 使用 pi 原生 steer() 而非自定义通信 / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/tools/ToolExecutionProxy.ts` | ToolExecutionProxy — Worker 隔离执行器（含僵尸防御 + 反向熔断） 每个工具调用在独立 worker_threads 中执行。 内核不关心执行细节，只监听三种信号： - progress   → 透传给 harness 的 tool_execution_update - completed  → 返回 ToolResult - timeout/oom → 执行 worker.terminate()，向 FSMEngine 抛出 TOOL_EXECUTION_TIMEOUT / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/tools/ToolFactory.ts` | ToolFactory — 工具工厂（EventBus 注入，创建并注册 LLM 工具） | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/tools/ToolRegistry.ts` | ToolRegistry — LLM 工具注册中心（ToolSchema 登记/查找） | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/tools/index.ts` | tools — 动态工具层 ToolFactory → 动态生成工具 ToolRegistry → 工具注册与统计 DomainPrimitiveRegistry → 通用原语注册与匹配 primitives/ → 5 个领域无关的基础原语 / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/tools/memory-search-tool.ts` | memory-search-tool.ts — 记忆搜索工具 (Phase 11: Harness-aware) 优先通过 AgentHarness 搜索（上下文+记忆激活），回退到直接 MemoryRetriever 访问。 / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/tools/ontologyTools.ts` | ontologyTools — Ontology LLM 工具定义（查询/检索，供 Gate 两阶段推理使用） | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/tools/primitives/APICallPrimitive.ts` | APICallPrimitive — API 调用原语 通用的 HTTP API 调用操作，通过 ConnectorRegistry 执行。 不包含任何领域逻辑——纯粹的基础设施能力。 @packageDocumentation / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/tools/primitives/ArtifactGenerationPrimitive.ts` | ArtifactGenerationPrimitive — 产物生成原语 通用的产物生成操作，始终以知识查询结果为前提： 1. 先查询 KnowledgeQueryPrimitive 获取已有知识 2. 将知识作为上下文注入 LLM 生成 3. 通过 FileOperationPrimitive 写入文件 4. 通过 ArtifactFacade 注册产物生命周期 支持的产物类型： - code: 源代码文件 - doc: 文档（Markdown, HTML 等） - config: 配置文件（JSON, YAML | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/tools/primitives/FileOperationPrimitive.ts` | FileOperationPrimitive — 文件操作原语 通用的文件系统操作，通过 ConnectorRegistry 执行。 不包含任何领域逻辑——纯粹的基础能力。 支持的操���： - read: 读取文件内容 - write: 写入文件内容 - delete: 删除文件 - list: 列出目录文件 - exists: 检查文件/目录是否存在 - mkdir: 创建目录 - copy: 复制文件 - move: 移动文件 - stat: 文件状态信息 @packageDocumentation / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/tools/primitives/KnowledgeQueryPrimitive.ts` | KnowledgeQueryPrimitive — 知识查询原语 核心设计原则：**所有生成/创建操作前，必须先查询知识系统。** 此原语是 MorPex 知识优先架构的基石。 - 任何工作流启动时，首先执行 KnowledgeQueryPrimitive - 查询 MemoryWiki、KnowledgeGraph、ArtifactRegistry 获取已有知识 - 只有当知识不足时才返回 suggestedActions（如"需要搜索"、"需要验证"） - 永远不猜测、不捏造 部门隔离：所有查询携带 depar | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/tools/primitives/ShellExecutionPrimitive.ts` | ShellExecutionPrimitive — Shell 命令执行原语 通用的 shell 命令执行操作，通过 ConnectorRegistry 的 ShellConnector 执行。 不包含任何领域逻辑——纯粹的基础设施能力。 安全约束： - 命令允许列表（仅允许预配置的命令） - 超时保护 - 命令内容日志审计 @packageDocumentation / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/tools/primitives/index.ts` | primitives — 通用基础原语 所有原语都是领域无关的通用操作。 领域特定逻辑必须通过工作流插件（packages/workflows/）提供。 注册方式： DomainPrimitiveRegistry.registerMultiple([ new KnowledgeQueryPrimitive(), new FileOperationPrimitive(), new ArtifactGenerationPrimitive(), new ShellExecutionPrimitive(), new API | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/tools/primitives/types.ts` | MorPex Core — 通用原语类型定义 定义 ActionPrimitive 接口和 ActionResult 类型， 所有通用原语和工作流插件中的领域原语统一实现此接口。 设计原则： - 通用原语：不包含任何领域知识，由 plugins/workflows/ 插件提供领域逻辑 - 知识优先：任何生成/创建操作前必须先查询 MemoryWiki/KnowledgeGraph - 部门隔离：所有 execute() 调用必须携带 departmentId / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/utils/AsyncResourceLocker.ts` | AsyncResourceLocker — per-resource async mutex Same key = serialized writes. Read operations bypass (no lock). Uses Promise chaining (FIFO queue) — no external dependencies. Usage: const locker = new AsyncResourceLocker(); await locker.withLock('artifact-123', | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/utils/extractJson.ts` | extractJson — 从 LLM 响应中提取 JSON 字符串（三级修复） 处理 LLM 可能返回的各种格式： - 纯 JSON - Markdown 代码块中的 JSON（```json ... ```） - 包含额外解释的 JSON - 截断不完整的 JSON（Level 2 补齐） - 格式错误无法修复时（Level 3 LLM 重试） Level 1: 逐字符括号匹配（已有） Level 2: 截断补齐 — 找最后一个合法 key，补齐缺失的 } Level 3: 带错误反馈的 1 次 LLM 重试  | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/utils/jsonl.ts` | readJSONLLines — 流式 JSONL 解析 统一的 JSONL 行解析，内置容错跳过损坏行。 @param content - JSONL 文件内容 @returns 解析后的对象数组 / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/utils/toposort.ts` | topologicalSort — 通用拓扑排序（Kahn 算法） 统一的依赖拓扑排序，用于： - PluginSystem 插件依赖解析 - CrossDomainRouter DAG 节点排序 - DAGEngine 任务排序 @param nodes   - 待排序节点 @param getDeps - 获取节点依赖 ID 列表的函数 @param getId   - 获取节点唯一 ID 的函数 @returns 拓扑排序后的节点列表；存在环时返回原序 / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |

| `infrastructure/adapters/pi-agent-core.d.ts` | pi-agent-core 类型声明（d.ts，适配层编译契约） | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/tools/primitives/gateBinding.ts` | PrimitiveGate — 副作用原语运行时 Gate 绑定（Wave 4：只读缺凭证 WARN 计数放行；破坏性缺凭证抛 GateContextRequiredError 硬拦截） | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |


## `workflow/`（2 文件）

> 层边界规则：插件注册契约；不承载领域实现

| 文件 | 功能 | 职责边界 |
|---|---|---|
| `workflow/WorkflowProvider.ts` | WorkflowProvider — 工作流插件接口 v15: 核心通过此接口发现和加载外部 workflow 包 / | 插件注册契约；不承载领域实现 |
| `workflow/index.ts` | （barrel：统一导出，功能以被导出文件为准） | 插件注册契约；不承载领域实现 |


---

## 补充：S22-S37 新增文件（测试体系 + 架构可观测）

> 本注册表基线为 346 文件（S23 快照）。S22-S37 新增的核心文件：

### 架构可观测（studio/observability，S34-S36）
| 文件 | 功能 |
|------|------|
| `runtime-bridge.ts` | 核心 EventBus → ObservationCollector 桥接：真实执行 → 8 层标注事件链 + 全局运行时锚（消除 /audit 误报） |
| `architecture-contract.ts` | 8 层架构契约（17 可观测模块，required=完整执行必须出现，绕过检测依据） |
| `observability-api.ts` | /api/observability/* 端点（audit/replay/observations/modules-v2/topology/heartbeats） |

### 核心可观测事件（S35 新增，安全增量）
| 文件 | 事件 |
|------|------|
| `execution/runtime/MorPexRuntime.ts` | `runtime.started/completed`（L5 主驱动器）、`evaluation.completed`（L6）、`evolution.completed`（L7） |
| `gate/runOntologyGroundedReasoning.ts` | `ontology.grounded`（L2 gate 成功时发，并修复调用未传 eventBus 的 bug） |

### 测试体系（S22-S37，详见 `docs/TESTING_PLAN.md`）
- 新增 **20+ 测试文件 / 568 用例**（vitest 60 文件），覆盖矩阵 10 层 ❌ 清零
- 统一执行器 `scripts/run-everything.ts`（`npm run test:full` 25 步）+ 覆盖率（c8，阈值防回退）
- 验证测试：`observability-bridge.test.ts`（/audit 绕过检测 + 全链 8 层可观测）
### 去黑盒化（16n，L0/L1/L2 三层记录 + 观测端点）
| 文件 | 功能 |
|------|------|
| `infrastructure/observability/deblackbox/DeblackboxRecorder.ts` | 统一去黑盒记录入口（进程级单例；L0 摘要/L1 决策单永久/L2 详情采样 10%+异常全记；内部 pub-sub 供 llm-tracer 订阅） |
| `infrastructure/observability/deblackbox/RecordPolicy.ts` | 采样率/TTL 配置中心（L0/L1 永久、L2 详情 30 天/异常 365 天；运行时可调） |
| `infrastructure/observability/deblackbox/DeblackboxDetailStore.ts` | L2 详情持久化（共享 SQLite deblackbox_detail 表，隔离主事件流；无 DB 内存回退） |
| `infrastructure/observability/deblackbox/RecordCleaner.ts` | L2 详情 TTL 清理（24h unref 定时，不拖住进程退出） |
| `infrastructure/observability/deblackbox/index.ts` | （barrel：统一导出） |
| `studio/server/observability/llm-tracer.ts` | LLM 交互追踪（订阅 llm.call，调用链内存缓冲 + 查询/统计；/llm-trace 端点） |
| `__tests__/deblackbox-smoke.test.ts` | 去黑盒记录器冒烟测试（L1/L2/L0、采样、TTL 清理、on 订阅、策略） |
| `__tests__/pi-bridge-extra-provider.test.ts` | 附加模型（llm_* 块）接入测试：yamlConfig 解析 extraLlms + ${VAR}；PiBridge builtin 基底 + 附加 gateway provider 并存注册；enabled=false/缺字段跳过 |

> **16n 埋点分布（16 处黑盒）**：`PiBridge.ts`(llm.call ①②) / `gateBinding.ts`+`runOntologyGroundedReasoning.ts`(gate.decision ④⑯) / `ContextAssemblyEngine.ts`(context.retrieval ③) / `HierarchicalPlanner.ts`+`DeliveryPlanner.ts`(planner.decision ⑤) / `UnifiedExecutionEngine.ts`(execution.path ⑥) / `BrainFacade.ts`(brain.background ⑦) / `DynamicTeamOrchestrator.ts`+`ExecutionFabric.ts`+`OrchestratorAgent.ts`(memory.state.snapshot ⑨) / `OrganizationTwin.ts`(approval.decision ⑪) / `MorPexConfig.ts`(config.change ⑫) / `EvolutionSandbox.ts`+`EvolutionApplyLoop.ts`(evolution.proposal ⑭) / `OntologyService.ts`+`MemoryApiBus.ts`(knowledge.write ⑮) / `MorPexRuntime.ts`+`ServiceContainer.ts`(cost.llm.call 双写 ⑧) / `observability-api.ts`(/llm-trace /memory-state 端点 ⑬⑨)。方案 `docs/archive/DEBLACKBOX_PLAN.md`

> **T0 多轮连续（2026-08-23）**：`orchestration/OrchestratorAgent.ts`（run 新增 orchestratorSessionPath：resume 既有账本 + 历史注入分析 prompt + goal/交付物以 message 条目入账）与 `orchestration/AgentSessionStore.ts`（新增 openHandle/appendMessage）——职责边界不变，仅会话复用能力。详见 `docs/SINGLE_TRANSCRIPT_DESIGN.md`。

---

## `studio/web/`（前端渲染层，独立包，S38）

> 层边界规则：纯前端客户端；仅经 HTTP/SSE 消费 StudioServer API；不承载后端逻辑。独立于 AICOS-Core 8 层（不属于 core 包）。浏览器模式与桌面壳（studio/desktop，后续）共用此渲染层。

| 文件 | 功能 | 职责边界 |
|---|---|---|
| `package.json` | 前端独立包清单（devDeps: typescript/vite/@types/node；零 runtime 依赖） | 纯前端客户端；仅经 HTTP/SSE 消费 StudioServer API |
| `tsconfig.json` | 前端独立 TS 配置（lib ES2022+DOM、moduleResolution bundler、strict、noEmit），与根 tsconfig 隔离 | 纯前端客户端；仅经 HTTP/SSE 消费 StudioServer API |
| `vite.config.ts` | Vite 配置：dev proxy /api→5473 + build 纯静态 dist（base './'） | 纯前端客户端；仅经 HTTP/SSE 消费 StudioServer API |
| `.env.example` | 声明 VITE_API_BASE（唯一后端入口环境变量） | 纯前端客户端；仅经 HTTP/SSE 消费 StudioServer API |
| `index.html` | 单页壳：内联 CSS + 顶部 4 tab 导航 + 挂载 #app | 纯前端客户端；仅经 HTTP/SSE 消费 StudioServer API |
| `src/main.ts` | 入口：装配 ApiClient + hash 路由 + tab 高亮 + 挂载 4 视图 | 纯前端客户端；仅经 HTTP/SSE 消费 StudioServer API |
| `src/env.ts` | 读取 VITE_API_BASE，默认 http://localhost:5473（唯一后端地址来源） | 纯前端客户端；仅经 HTTP/SSE 消费 StudioServer API |
| `src/api/types.ts` | 手写 REST 响应类型（镜像 api-contract.test.ts，权威源注释于文件头） | 纯前端客户端；仅经 HTTP/SSE 消费 StudioServer API |
| `src/api/http.ts` | fetch 封装：统一 API_BASE 前缀、JSON、非 2xx 抛 ApiError | 纯前端客户端；仅经 HTTP/SSE 消费 StudioServer API |
| `src/api/client.ts` | 26 个 REST 端点 → 类型化函数（全项目唯一拼 '/api/...' 的地方） | 纯前端客户端；仅经 HTTP/SSE 消费 StudioServer API |
| `src/api/sse.ts` | EventSource 封装：/api/stream/global + 自动重连 + JSON 解析兜底（跳过心跳注释帧） | 纯前端客户端；仅经 HTTP/SSE 消费 StudioServer API |
| `src/ui/dom.ts` | 轻量 DOM 构造工具 el()/mount()/clear()（无框架） | 纯前端客户端；仅经 HTTP/SSE 消费 StudioServer API |
| `src/ui/router.ts` | hash 路由（#/dashboard 等）+ 视图卸载 cleanup（停轮询/关 SSE） | 纯前端客户端；仅经 HTTP/SSE 消费 StudioServer API |
| `src/ui/widgets.ts` | 卡片/徽章/键值行/错误框/表格/按钮/加载中等最小部件 | 纯前端客户端；仅经 HTTP/SSE 消费 StudioServer API |
| `src/views/dashboard.ts` | 仪表盘：health/status/execution-stats/governance/ontology 5 卡片 + 5s 轮询 | 纯前端客户端；仅经 HTTP/SSE 消费 StudioServer API |
| `src/views/console.ts` | 会话视图（浅色聊天应用，会话 17h）：左侧会话侧栏（新对话/删除）+ 右侧聊天区（模型切换/附件上传/消息气泡/输入条），删除会话/上传文件/模型切换，首页默认 | 纯前端客户端；仅经 HTTP/SSE 消费 StudioServer API |
| `src/views/events.ts` | 事件流：SSE /api/stream/global 实时日志 + filter 前缀过滤 + 连接状态 | 纯前端客户端；仅经 HTTP/SSE 消费 StudioServer API |
| `src/views/artifacts.ts` | 产物记忆：产物列表/详情/谱系 + 记忆召回/写入 | 纯前端客户端；仅经 HTTP/SSE 消费 StudioServer API |
| `README.md` | 前端上手文档（起后端 → npm install → npm run dev） | 纯前端客户端；仅经 HTTP/SSE 消费 StudioServer API |

## `studio/desktop/`（桌面壳，Tauri 2，S39）

> 层边界规则：桌面壳；仅开窗加载渲染层并经 HTTP/SSE 消费 StudioServer API；不承载后端逻辑。独立于 AICOS-Core 8 层。渲染层与壳完全解耦（壳 Rust 零 @morpex 引用，渲染层零 tauri 依赖）。

| 文件 | 功能 | 职责边界 |
|---|---|---|
| `package.json` | 桌面包清单（devDeps: @tauri-apps/cli + concurrently；scripts: dev/dev:all/build/check） | 桌面壳；仅开窗加载渲染层并经 HTTP/SSE 消费 StudioServer API |
| `src-tauri/Cargo.toml` | Rust 依赖（tauri 2 + serde；无业务依赖） | 桌面壳；仅开窗加载渲染层并经 HTTP/SSE 消费 StudioServer API |
| `src-tauri/build.rs` | tauri-build 构建脚本 | 桌面壳；仅开窗加载渲染层并经 HTTP/SSE 消费 StudioServer API |
| `scripts/bundle-server.mjs` | esbuild 单文件打包：入口 studio/server/index.ts → portable/repo-dist/server.mjs（--platform=node --format=esm --target=node20 --minify）+ better-sqlite3 闭包 node_modules（better-sqlite3/bindings/file-uri-to-path prebuilt）+ config 模板复制；external=better-sqlite3/jiti；banner shim=createRequire+__filename+__dirname；导出 buildRuntime(outDir) 供 bundle-backend 复用，可独立执行 | 桌面壳；打包工具，不承载后端逻辑 |
| `scripts/bundle-backend.mjs` | 打包可移植后端运行时 → desktop/portable：默认新布局 = node.exe + runtime/{server.mjs, node_modules/, config/}（调 buildRuntime()）+ bsdtar 打 repo.zip（zip 根即 server.mjs）；`--legacy` 保留旧 tsx 流程（源码树 + npm install --omit=dev）作 fallback | 桌面壳；打包工具，不承载后端逻辑 |
| `src-tauri/tauri.conf.json` | 壳配置：frontendDist=../../web/dist、devUrl=:5173、窗口 1280x800、NSIS 安装包（currentUser + SimpChinese）、resources=portable/node.exe+repo.zip | 桌面壳；仅开窗加载渲染层并经 HTTP/SSE 消费 StudioServer API |
| `src-tauri/capabilities/default.json` | v1 空权限集（core:default，无 IPC command） | 桌面壳；仅开窗加载渲染层并经 HTTP/SSE 消费 StudioServer API |
| `src-tauri/src/main.rs` | 壳入口（Windows 子系统，调 lib run） | 桌面壳；仅开窗加载渲染层并经 HTTP/SSE 消费 StudioServer API |
| `src-tauri/src/lib.rs` | 壳 Builder + 后端生命周期：优先解压安装包内置运行时（%LOCALAPPDATA%/MorPex/runtime，tar 解压 repo.zip + 版本 marker；解压校验 = server.mjs 存在 或 旧版 tsx+entry 存在）→ RuntimeLayout 探测（SingleFile=`node server.mjs` / LegacyTsx=旧 tsx 命令，SingleFile 优先）→ spawn_backend(node, args, cwd=runtime 目录)；无资源则回退开发模式（仓库 tsx）；用户 API Key 读 %APPDATA%/MorPex/config.env 注入环境；退出 taskkill 由壳拉起的后端；无任何 command | 桌面壳；仅开窗加载渲染层并经 HTTP/SSE 消费 StudioServer API；不承载后端逻辑 |
| `src-tauri/icons/` | 占位图标集（tauri icon 生成，后续换正式 Logo） | 桌面壳；仅开窗加载渲染层并经 HTTP/SSE 消费 StudioServer API |
| `README.md` | 桌面壳上手文档（前置条件/启动/构建/镜像降级） | 桌面壳；仅开窗加载渲染层并经 HTTP/SSE 消费 StudioServer API |

---
## `connectors/src/`（8 文件 · 后端）

> 层边界规则：Action 基础设施平面（独立包，@morpex/connectors 零依赖，由 core 依赖它）；提供对外部系统"安全的物理之手"；不承载领域逻辑；不属于 AICOS-Core 8 层核心（core 包外）。

| 文件 | 功能 | 职责边界 |
|---|---|---|
| `packages/connectors/src/BaseConnector.ts` | 所有 connector 的抽象基类：能力元数据管理 / 输入 schema 生成 / 校验分发 / 执行计时 | 只提供公共底座；不承载具体执行 |
| `packages/connectors/src/ConnectorRegistry.ts` | 中央连接器注册表：统一管理所有 action connector 的生命周期、发现与权限检查 | 只做注册/分发；不实现具体连接器 |
| `packages/connectors/src/FileSystemConnector.ts` | 安全文件系统访问：路径相对于允许根目录校验，防路径穿越（fs.read/write 等） | 只做文件系统；路径必须落在允许根内 |
| `packages/connectors/src/IActionConnector.ts` | Action Connector 标准契约接口（Action Infrastructure Plane） | 只定义契约；不实现 |
| `packages/connectors/src/index.ts` | Connector 基础设施 barrel 导出 | barrel；功能以被导出文件为准 |
| `packages/connectors/src/secureExec.ts` | 安全子进程执行工具（防御性模式·参考 deepseek-harness）：scrubEnv 凭据清洗 / ExecOutcome 正交因子 / 私有临时路径；**与 core `infrastructure/common/secureExec.ts` 同源内联**（connectors 零依赖、反向 import core 会成环，要求改一处须同步另一处） | 只做子进程与临时文件安全；禁止与 core 版漂移 |
| `packages/connectors/src/ShellConnector.ts` | Shell 连接器（G3 已升级接入 secureExec）：`spawn(shell:false)` 逐参数传递防 shell 注入 + 命令白名单 + 超时上限；execScript 落私有临时目录（0700/随机名/0600-wx）后执行并清理 | 只做 shell 执行；命令必须过白名单；禁止把脚本内联拼入命令串 |
| `packages/connectors/src/types.ts` | Connector 类型定义（ActionRequest / ConnectorCapability 等） | 只定义类型；不实现 |

## `memory/src/`（26 文件 · 后端）

> 层边界规则：记忆/知识持久化独立包（@morpex/memory）；MemoryWiki（SQLite-only）+ 历史存储 + 统一记忆层（MemoryAPI/cognee）；供 Ontology Gate/工作流插件通过契约消费；不属于 AICOS-Core 8 层核心？核心经 gate 间接使用（L2 知识层组件），包本身位于 core 外。

| 文件 | 功能 | 职责边界 |
|---|---|---|
| `packages/memory/src/api/factory.ts` | MemoryApi 工厂：`createMemoryApi()` 便捷入口，引擎按 env 配置实例化 | 只做装配；不承载语义 |
| `packages/memory/src/api/MemoryApi.ts` | 统一 MemoryAPI 唯一入口：组装 gate(强制检索)+ontology(白名单)+engine(cognee/mock)+confirmation(SQLite)；upsert 分流到权威图/确认队列 | 组装与路由；低耦合，各组件只经接口/类型交互 |
| `packages/memory/src/confirmation/queue.ts` | 人工在环确认队列（SQLite）：低置信/冲突/新实体候选先进队列，Agent 询问用户→accept 写权威/reject 丢弃 | 只做确认；依赖 better-sqlite3 与 memory-types 契约 |
| `packages/memory/src/engines/cognee/client.ts` | cognee 本地引擎 TS HTTP 客户端（remember/recall/search/forget） | 只做 HTTP 客户端；不解析语义 |
| `packages/memory/src/engines/cognee/CogneeEngine.ts` | MemoryEngine 适配器（cognee 实现）：把 remember/recall/search 映射到统一 EngineHit 契约；图优先走 GRAPH_COMPLETION | 只做适配；产出统一契约 |
| `packages/memory/src/engines/factory.ts` | 引擎工厂：默认 cognee；engineKind='mock' 或未配 COGNEE_URL 时 mock 降级 | 只做选择/降级 |
| `packages/memory/src/engines/mock/MockEngine.ts` | 测试用内存引擎：无外部依赖，实现同构语义（remember/recall/searchGraph/searchHybrid/available） | 只做测试/降级；不入生产 |
| `packages/memory/src/gate/domain.ts` | 公司知识域判定：缺省一律视为公司知识域（强制检索），仅 'general' 放行 | 只做路由判定 |
| `packages/memory/src/gate/ForceRetrieve.ts` | 强制检索 + need_human + L2 上下文隔离：QueryMiss/LowConfidence→need_human 禁自由补全；生成 prompt 只含命中证据 | 只做检索闸门与隔离；禁止夹带 LLM 自身知识 |
| `packages/memory/src/index.ts` | @morpex/memory 入口 barrel（v2） | barrel |
| `packages/memory/src/memory-types.ts` | 统一记忆层契约：插件/Ontology Gate 只依赖此契约，不直接依赖 cognee/SQLite | 只定义契约 |
| `packages/memory/src/ontology/schema.ts` | 公司本体白名单（薄约定层）：约束 LLM 自动抽取/写入落到统一词表；与 SystemMetadataGraph 的 EntityType 职责不同、并存 | 只做白名单约定；不人工维护 |
| `packages/memory/src/ontology/validate.ts` | 写入校验（白名单闸门）：实体/关系类型 ∈ 白名单、facts 非空、confidence∈[0,1]；不满足→rejected/进确认队列 | 只做校验；不改写数据 |
| `packages/memory/src/storage/Compactor.ts` | JSONL 状态压缩（类 Redis AOF 重写）："状态/血统类"文件只留最终态/完整链 | 只处理状态类 JSONL |
| `packages/memory/src/storage/HistoryStore.ts` | 执行历史持久化：创业循环/任务执行/会话消息/执行元数据 | 只做历史存取 |
| `packages/memory/src/storage/JSONLWriter.ts` | 微批 JSONL 追加写入器：消除密集调用下的同步 fs.appendFileSync 阻塞 | 只做异步落盘 |
| `packages/memory/src/storage/LogRotator.ts` | JSONL 日志轮转器：超 maxSizeBytes 时关闭当前文件并轮转，防无限增长 | 只做轮转；不解析内容 |
| `packages/memory/src/types.ts` | @morpex/memory 类型（v2）：MemType/记忆门控/阶段预绑定/压缩结果 | 只定义类型 |
| `packages/memory/src/wiki/DocTopology.ts` | 文档关系拓扑：解析 docs/ 内 md 交叉引用，建 kg_relations 知识拓扑 | 只做引用图构建 |
| `packages/memory/src/wiki/DocWatcher.ts` | 文档自维护：监听 docs/ md 变更自动索引到 MemoryWiki（StudioServer 闲时启动） | 只做监听/索引 |
| `packages/memory/src/wiki/index.ts` | wiki barrel 导出 | barrel |
| `packages/memory/src/wiki/MemoryRetriever.ts` | Agent 记忆优先检索层：MemoryWiki 优先 → LLM 回退 | 只做检索路由 |
| `packages/memory/src/wiki/MemoryWiki.ts` | SQLite 统一记忆后端（SQLite-only，v1 替代 31 个 JSONL；v2 移除本地 ZVec/embedding 由 cognee 接管）：图拓扑+元数据+领域表+事件日志，WAL 模式 | 只做持久层 |
| `packages/memory/src/wiki/migrate.ts` | JSONL → SQLite 单向迁移脚本（JSONL 保留不删） | 只做一次性迁移 |
| `packages/memory/src/wiki/schema.ts` | MemoryWiki SQLite Schema：按领域分表 | 只做 DDL |
| `packages/memory/src/wiki/types.ts` | MemoryWiki 类型契约 | 只定义类型 |

## `studio/server/`（29 文件 · 后端 API 服务器）

> 层边界规则：后端 HTTP/SSE 服务器（默认 5473 端口）+ 可观测/模拟/验证子系统；消费 core 的 bootstrapUnified 装配；仅经 HTTP/SSE 暴露 core 能力；不含领域逻辑；位于 core 包之外（不属于 AICOS-Core 8 层核心分层）。

| 文件 | 功能 | 职责边界 |
|---|---|---|
| `packages/studio/server/index.ts` | Studio Server 入口：启动 bootstrapUnified 装配 | 只做启动 |
| `packages/studio/server/StudioServer.ts` | 理想架构对齐版服务器：只消费 10 层组件（CompanyFacade/ControlPlane/Gate/Ontology 等），暴露 REST + SSE；T0: chat/send 按会话绑定 orchestrator 账本 + 并发排队 + chat 直答历史注入；T1: 绑定持久化迁至 transcript_windows 表（ChatTranscriptService 替代 chat-orch-map.json，回合收尾触发增量索引）；T4: POST /api/session/:id/reset（重开会话）/compact（上下文压缩，摘要经共享 PiBridge LLM）路由 | 只做编排/路由；不改引擎 |
| `packages/core/src/execution/orchestration/AgentSessionStore.ts` | 子会话仓库：createSession/openHandle/fork/appendMessage/readEntries；T4 compactViaSession（读全部条目→尾部保留段→注入 summarize 回调生成摘要→pi 原生 appendCompaction 落账，后续 buildContext 默认压缩变换自动生效） | 子会话生命周期；压缩摘要由调用方注入 LLM |
| `scripts/maintenance.mjs` | T4 存储维护：archived 超 N 天(默 30) gzip 归档至 _archive/ 并改写 file_path（幂等标记：.gz 跳过）+ 孤儿检测报告（空 windows/游离 events，只报告不自动修）；--apply 执行否则 dry-run | 手动或每周计划任务；不改活跃窗口 |
| `packages/studio/server/transcript/TranscriptStore.ts` | 单一 Transcript SQLite 读模型：transcript_windows（窗口目录，file_path 定位账本）/ transcript_events（指针式 byte_offset+kind+role+preview，不存正文）/ chat_index / index_watermark 四表，WAL 幂等建表；存储总原则=正文唯一存 jsonl，库只存坐标（约 0.05×开销） | 只做读模型存取；不 import @earendil-works/* |
| `packages/studio/server/transcript/Indexer.ts` | 抄写员：jsonl→指针索引。水位线增量（index_watermark.indexed_bytes）；只认完整行（换行结尾+parse 通过）；主键幂等 upsert；文件回缩自动全量重建；classifyEntryLine 做 kind 分类（chat/approval/internal）与 preview 提取 | 纯索引器；失败静默不影响主流程 |
| `packages/studio/server/transcript/readAt.ts` | T2 字节域契约唯一直读入口：readEntryAt(path,byteOffset,byteLength)=fd.read→Buffer.subarray→JSON.parse。坐标是字节不是字符（UTF-8 中文 3 字节/字符），禁止任何 string.slice(offset) 消费（契约写在文件头，reviewer 强制项） | 坐标消费唯一入口；坏行返回 null 不抛 |
| `packages/studio/server/transcript/projection.ts` | T2 翻译官：projectEntry/projectEvents——账本条目→UI 消息。默认只放行 morpex.turn 回合记录（对话面）；thinkingSignature 必删；thinking 默认不下发（?thinking=1 显式开启截断 2000）；redacted/内部信封/display=false/toolResult(默认) 过滤；morpex.approval* 投影为可读审批卡片（请求/决议分开，前端 kind='approval' 渲染） | 纯函数无 IO；readFn 注入（生产传 readEntryAt） |
| `packages/studio/server/transcript/ChatTranscriptService.ts` | 档案管理员：resolve(chatSessionId) 查/建窗口复用同一本 orchestrator 账本（经注入回调隔离 pi）；indexNow 回合收尾触发；T2+appendDisplayTurn（morpex.turn 回合记录，custom 条目不进 LLM 上下文）+listChatSessions（chat_index 速查）；T4 resetSession（旧窗口 archived + 新窗口 reason:'reset' 链 previous_session_id，LLM 上下文断裂审计链保留）。旧 chat-orch-map 迁移路径已随 T4 清空重建移除 | 会话绑定/reset/回合记录；pi 细节留在调用方 |
| `packages/studio/server/transcript/AgentMessageStore.ts` | T3 跨 agent 留言表（公司层，独立连接打开同一 transcript.db）：agent_messages 表 + 未读查询/已读标记；留言本体唯一存储，双方账本只写存根 | 纯表存取；不碰窗口/事件索引 |
| `packages/studio/server/transcript/session-tools.ts` | T3 组织通信原语①②服务端实现：权限矩阵（上司全文/同树兄弟摘要/经理对 message-only/跨树 deny，沿 parent_session_id 链判定）+ sessionRead（整文件逐行解析+最小 sanitize：删 signature/截断 thinking）+ sendMessage（写表+双账本存根）；TODO(T2) 换统一投影 projection.ts | 权限与脱敏决策点；不 import @earendil-works/* |
| `packages/studio/server/transcript/approval-routes.ts` | T3 审批/留言 HTTP 路由（registerApprovalRoutes(app,deps) 导出式接线）：POST /api/approval/:id/decision、GET /api/approval/pending、GET /api/messages/unread/:sessionId、POST /api/messages/mark-read；审计查询=eventsBySession(kind='approval') 两步查；挂载前缀 /api/tool-approval/* 与 L5 approvalGate 区分 | 由 StudioServer getTranscripts 懒初始化点接线（Express 监听后追加路由合法） |
| `packages/studio/server/transcript/memory-extractor.ts` | T5/T7 跨会话记忆·提取器：订阅 chat.turn.completed（EventBus Only）→ 每回合必调共享 PiBridge LLM 提取（无预筛短路，触发判断全 LLM 化——isExplicit/isForget/sensitive/scope 标志位单次调用输出）→ 四路分流：sensitive 丢弃｜isForget invalidate｜scope=session 跳过（账本即真相源）｜isExplicit 免工单直写(confidence=1.0)｜默认确认工单；写入后 weightStore.ensure 建权重档 | 只订阅不被调用；写入只走 MemoryApi 正规入口；不 import @earendil-works/* |
| `packages/memory/src/storage/MemoryWeightStore.ts` | T7 记忆权重簿（SQLite data/sessions/memory-weights.db）：tier/weight/mentionCount/lastSeen；纯函数 computePromotion(30 天提及≥3 或 weight≥0.95→permanent)/computeDecay(闲置 30 天减半，<0.2 归档)；recordMentionsFromContents 召回命中记账 | 元数据专用库，不存事实正文；可降级依赖（失败不影响记忆主功能） |
| `packages/core/src/execution/ToolCallApprovalService.ts` | T3 工具级审批门（beforeToolCall 钩子工厂，与 UserAskService 同构 request→wait→decide）：高危判定（shell/file写/api非GET）、request/decision 双 custom_message 存根、超时=拒绝；resolveToolApproval/listPendingToolApprovals 供路由调用 | 钩子参数用最小结构类型不 import pi；模块级队列 |
| `packages/core/src/execution/TranscriptToolBridge.ts` | T3 会话工具桥单例（getMailbox 同款模式）：sessionRead/sendMessage 接口 + set/get；server 启动时注入实现，未注入则 primitiveAgentTools 不注册会话工具 | core 哑工具模式；依赖方向 server→core 注入 |
| `packages/studio/server/RuntimeAPI.ts` | 运行时引擎能力 REST 路由：暴露后端引擎能力给前端，零修改现有后端业务代码 | 只加路由；不改引擎 |
| `packages/studio/server/security-middleware.ts` | 生产安全加固中间件：API Key 验证（可选）/请求体大小限制/内容校验 | 只做安全；不承载业务 |
| `packages/studio/server/SessionStore.ts` | 会话持久化管理：聊天历史/节点执行历史 JSONL 读写 | 只做会话存取 |
| `.../observability/event-bus.ts` | TraceBus 全局事件总线（单例）：所有模块统一 traceBus.emit() 上报 TraceEvent | 只做总线 |
| `.../observability/types.ts` | Trace Plane 统一 Trace Schema | 只定义类型 |
| `.../observability/observation.ts` | 统一遥测数据模型 Observation（替代 TraceEvent+Span+Heartbeat 三模型） | 只定义模型 |
| `.../observability/observable-module.ts` | 自动遥测模块基类：继承后 execute() 自动产生遥测 | 只做基类注入 |
| `.../observability/observation-adapter.ts` | 旧 traceBus/TraceEvent → 新 Observation 桥接（双写期保留旧路径） | 只做桥接 |
| `.../observability/runtime-invoker.ts` | 统一模块调用拦截器：为不继承 ObservableModule 的模块补遥测 | 只做遥测注入 |
| `.../observability/runtime-bridge.ts` | 核心运行时→可观测面桥接：把真实执行（/api/execute、/api/chat/send、MorPexRuntime.run 等）路由进可观测面，解"架构黑盒" | 只做桥接；不改核心 |
| `.../observability/execution-tracer.ts` | 运行时追踪中心：为任务创建追踪上下文，经 DAG/FSM/Agent/Tool 传播 | 只做追踪 |
| `.../observability/agent-tracer.ts` | Agent 调度/协作自动追踪（包裹 selectAgent/CollaborationManager） | 只做追踪 |
| `.../observability/dag-tracer.ts` | DAG 调度自动追踪（劫持 onNodeStart/Complete/Fail） | 只做追踪 |
| `.../observability/fsm-tracer.ts` | 状态机自动追踪（劫持 onTransition） | 只做追踪 |
| `.../observability/tool-tracer.ts` | 工具执行自动追踪（包裹 SandboxManager.execute/VerificationEngine.verify） | 只做追踪 |
| `.../observability/llm-tracer.ts` | LLM 交互追踪（订阅 DeblackboxRecorder 的 llm.call 事件） | 只做追踪 |
| `.../observability/graph-builder.ts` | 从 TraceEvent 流重建每个 Task 的执行图 | 只做建图 |
| `.../observability/trace-store.ts` | Trace 事件持久化（开发阶段 SQLite better-sqlite3） | 只做存储 |
| `.../observability/replay-engine.ts` | 执行追踪回放：归档 TraceSpan、回放时间线、对比两次执行差异 | 只做回放/对比 |
| `.../observability/architecture-contract.ts` | ARCHITECTURE.md 的机器可读版本：定义每个模块期望行为（必须调用/谁调它/它调谁/激活条件） | 只做契约定义 |
| `.../observability/architecture-auditor.ts` | 架构合规审计器：对比 ARCHITECTURE_CONTRACT 与运行时 ExecutionTracer 数据 | 只做审计比对 |
| `.../observability/coverage-engine.ts` | 基于 Observation 的覆盖率引擎（v2）：计算模块被实际调用的覆盖 | 只做统计 |
| `.../observability/exercise-all.ts` | 全面模块演练引擎：把 modules 从 exercised 提升到更高覆盖 | 只做演练触发 |
| `.../observability/task-generator.ts` | 合成任务运行器：42 真实模块+10 条执行路径，覆盖 6 层级 | 只做任务生成/运行 |
| `.../observability/observability-api.ts` | Observability REST API：为前端/debug 提供数据（含 G1 事件契约对账端点 /api/observability/event-contracts） | 只做路由 |
| `.../observability/ws-handler.ts` | WebSocket 实时推送 TraceEvent + Observation 给前端 | 只做推送 |
| `.../observability/index.ts` | Observability Plane 统一导出 | barrel |

## `workflows/`（29 文件 · 领域插件 · 后端）

> 层边界规则：理想架构第 9 层领域插件（非 AICOS-Core 8 层核心分层）；领域逻辑完全隔离在 packages/workflows/<domain>/；仅经 DomainPrimitiveRegistry/WorkflowProvider 挂载、经 EventBus 通信；禁止领域逻辑进 core。

| 文件 | 功能 | 职责边界 |
|---|---|---|
| `packages/workflows/ecommerce/actions/amazon.ts` | 电商 Amazon 旧版 ActionHandler（createListing/uploadImage/updatePrice） | legacy 兼容层 |
| `packages/workflows/ecommerce/src/actions/amazon-primitives.ts` | Amazon ActionPrimitive 标准实现（第 9 层）：包装 legacy ActionHandler | 适配层 |
| `packages/workflows/ecommerce/src/bootstrap.ts` | 电商插件 Bootstrap：注册 ActionPrimitive（幂等） | 只做注册 |
| `packages/workflows/ecommerce/src/rules/amazon-rules.ts` | 电商领域合规规则（从 core QualityRule/PolicyRuleRegistry 迁出） | 领域规则 |
| `packages/workflows/ecommerce/src/rules/rule-register.ts` | 电商领域规则中断示例（bootstrap 注册进 core） | 领域规则注册 |
| `packages/workflows/ecommerce/validators/amazon-policy.ts` | Amazon 政策校验（ValidationResult） | 领域校验 |
| `packages/workflows/ecommerce/workflow-provider.ts` | 电商 WorkflowProvider（旧接口兼容层） | legacy 兼容 |
| `packages/workflows/hardware/firmware/actions/generate.ts` | 固件源码生成（从 MorPex YAML 知识库生成 C 源码） | 领域动作 |
| `packages/workflows/hardware/firmware/actions/compile.ts` | 固件编译（AstroMcu buildcli 编译 C → 固件 bin） | 领域动作 |
| `packages/workflows/hardware/firmware/actions/build_project.ts` | 固件全流程构建（generate→compile→binaries） | 领域动作 |
| `packages/workflows/hardware/simulation/actions/flash.ts` | MCU 仿真烧录（AstroMcu astrocli flash .xbin） | 领域动作 |
| `packages/workflows/hardware/simulation/actions/debug.ts` | 仿真调试（debug/run/read 寄存器/RAM） | 领域动作 |
| `packages/workflows/hardware/src/actions/hardware-actions.ts` | 硬件 ActionPrimitive 标准实现：包装 firmware+simulation 真实实现 | 适配层 |
| `packages/workflows/hardware/src/bootstrap.ts` | 硬件插件 Bootstrap：注册 ActionPrimitive（幂等） | 只做注册 |
| `packages/workflows/hardware/src/rules/hardware-rules.ts` | 硬件领域合规规则（从 core 迁出） | 领域规则 |
| `packages/workflows/hardware/workflow-provider.ts` | 硬件 WorkflowProvider（旧接口兼容层） | legacy 兼容 |
| `packages/workflows/software/src/actions/software-actions.ts` | 软件开发插件：GitHub/Docker/Cloud 部署 ActionPrimitive（mock 实现可替换） | 领域动作 |
| `packages/workflows/software/src/bootstrap.ts` | 软件插件 Bootstrap：注册 ActionPrimitive（幂等） | 只做注册 |
| `packages/workflows/software/src/rules/ast-utils.ts` | TypeScript Compiler API 工具：对生成代码做 AST 级检测 + tsc 类型校验 | 领域规则工具 |
| `packages/workflows/software/src/rules/custom-detectors.ts` | 软件领域自定义检测器示例（DetectorRegistry 领域注入链路） | 领域规则 |
| `packages/workflows/software/src/rules/structural-ast-tsc.ts` | 结构修正 AST/tsc 适配器（eslint 之上补语义层） | 领域规则 |
| `packages/workflows/software/src/rules/structural-eslint.ts` | 软件领域结构修正器示例（修正管线②结构层） | 领域规则 |
| `packages/workflows/software/workflow-provider.ts` | 软件 WorkflowProvider（旧接口兼容层） | legacy 兼容 |
| `packages/workflows/xjmcu/src/actions/generate.ts` | XJMCU 生成动作：生成固件源码骨架（ActionPrimitive） | 领域动作 |
| `packages/workflows/xjmcu/src/actions/compile.ts` | XJMCU 编译动作：buildcli 编译固件（ActionPrimitive） | 领域动作 |
| `packages/workflows/xjmcu/src/actions/simulate.ts` | XJMCU 仿真动作：astrocli 仿真固件（ActionPrimitive，与 pipeline 共用实现） | 领域动作 |
| `packages/workflows/xjmcu/src/actions/pipeline.ts` | XJMCU 全流程动作：生成→编译→仿真（ActionPrimitive） | 领域动作 |
| `packages/workflows/xjmcu/src/bootstrap.ts` | XJMCU 插件 Bootstrap：注册 ActionPrimitive（幂等） | 只做注册 |
| `packages/workflows/xjmcu/src/rules/platform-rule.ts` | XJMCU 平台 API 白名单规则（防误用 STM32 HAL/LL 等） | 领域规则 |
| `packages/workflows/xjmcu/workflow-provider.ts` | XJMCU WorkflowProvider（旧接口兼容层） | legacy 兼容 |
| `packages/workflows/xjmcu/department/manual.yaml` | XJMCU 部门手册（7 步声明式工作流，deps/on_failure/ask），部门 Space 数据源 | 领域数据 |
| `packages/workflows/xjmcu/src/mcp/server.ts` | XJMCU MCP Server（stdio JSON-RPC，暴露 xjmcu_compile/simulate，内部复用 ActionPrimitive） | MCP 桥接 |

## `workflow-sdk/src/`（8 文件 · 后端 SDK）

> 层边界规则：工作流插件开发 SDK（供领域插件作者使用）；封装 v11 WorkflowSDK 生命周期/适配/模型注册；不承载运行时业务逻辑。

| 文件 | 功能 | 职责边界 |
|---|---|---|
| `packages/workflow-sdk/src/index.ts` | MorPex v11 Workflow SDK 入口 | barrel |
| `packages/workflow-sdk/src/WorkflowSDK.ts` | SDK 主 API：工作流生命周期管理 | 只做编排入口 |
| `packages/workflow-sdk/src/WorkflowRuntime.ts` | v11 Adaptive Workflow Runtime：核心执行引擎 | 只做执行 |
| `packages/workflow-sdk/src/WorkflowContext.ts` | WorkflowContext / WorkflowExecutionResult 工厂帮助函数 | 只做上下文构造 |
| `packages/workflow-sdk/src/IWorkflowAdapter.ts` | 工作流包适配器标准契约 | 只定义接口 |
| `packages/workflow-sdk/src/PiModelRegistry.ts` | LLM 模型注册表：经 PiBridge 抽象层调 pi-ai，隔离版本变更 | 只做桥接 |
| `packages/workflow-sdk/src/bootstrap.ts` | 把 v10 运行时实例接入 v11 WorkflowSDK | 只做接入 |
| `packages/workflow-sdk/src/types.ts` | Workflow SDK 核心类型定义 | 只定义类型 |

## `contracts/`（7 文件 · 后端跨包契约）

> 层边界规则：跨包共享稳定类型契约（Pi 无关）；供 agent-runtime/inference/tool/capability/events/errors 使用；不承载实现。

| 文件 | 功能 | 职责边界 |
|---|---|---|
| `packages/contracts/index.ts` | barrel：所有稳定契约统一出口 | barrel |
| `packages/contracts/agent-runtime.ts` | Agent 完整执行运行的稳定接口（Port） | 只定义契约 |
| `packages/contracts/inference.ts` | 单轮模型推理（非 agent）稳定接口（Port） | 只定义契约 |
| `packages/contracts/tool.ts` | 稳定、Pi 无关的工具契约 | 只定义契约 |
| `packages/contracts/capabilities.ts` | 运行时能力描述符（后端声明的能力） | 只定义契约 |
| `packages/contracts/runtime-events.ts` | MorPexCore EventBus 上的高层事件（bus-level） | 只定义契约 |
| `packages/contracts/errors.ts` | 稳定、Pi 无关的错误模型 | 只定义契约 |

## `scripts/`（后端 · 构建/门禁/运维）

> 层边界规则：构建/门禁/运维/诊断脚本（非运行时模块；可存在于 core 之外）；多数为 npm script 或 CI 调用。

| 文件 | 功能 | 职责边界 |
|---|---|---|
| `scripts/start.ts` | MorPex 开发服务器启动器（tsx） | 只做启动 |
| `scripts/dev-fast.mjs` | 开发快启后端（MORPEX_DEV_FAST=1 + Node 原生 watch）：跳过 EventStore 状态重建，重启秒级 | 只做开发期快启；查产物图谱时用完整后端 |
| `scripts/run-everything.ts` | 统一测试执行器：一条命令测全部（tsc/架构/vitest/生产/CLI） | 只做测试编排 |
| `scripts/run-all-tests.ts` | 全量测试启动器（委托统一 Runner） | 只做测试编排 |
| `scripts/run-all-production-tests.ts` | 一键运行所有生产相关测试 | 只做测试编排 |
| `scripts/production-check.cjs` | 生产就绪检查（8/8 门禁） | 只做门禁 |
| `scripts/validate-architecture.js` | 理想架构对齐校验器（负向合规校验 8 层路径） | 只做门禁 |
| `scripts/check-doc-sync.ts` | 文档-代码一致性校验器（从代码出发：FILE_REGISTRY 登记路径与 CAPABILITY_INDEX 锚点必须可解析到真实文件；`npm run check:docs`） | 只做文档门禁 |
| `scripts/check-boundaries.sh` | 依赖/目录边界检查 | 只做门禁 |
| `scripts/check-no-old-bootstrap.sh` | 检查旧 bootstrap 残留 | 只做门禁 |
| `scripts/check-ontology-bypass.sh` | 检查 Ontology 绕过 | 只做门禁 |
| `scripts/check-llm.ts` | LLM 配置检查脚本（用 MorPex 配置链路解析，不依赖 shell export） | 只做诊断 |
| `scripts/ops-validate.ts` | 运营验证：真实目标跑完整链路，观测四类信号 | 只做验证 |
| `scripts/verify-e2e.ts` | 全链路验证脚本（端到端） | 只做验证 |
| `scripts/batch-run.ts` | 50 个真实任务批量闭环测试 + 数据流函数调用报告 | 只做批量回归 |
| `scripts/batch-tasks.ts` | 50 个真实任务集（多行业多场景） | 只做任务定义 |
| `scripts/analyze-trace-reports.ts` | 分析数据流报告，统计函数调用频次 | 只做分析 |
| `scripts/_backend-code-analyze.ts` | 后端代码函数/关系链分析器（TS compiler API，只读）：扫描后端 .ts，提取每文件函数清单+import 依赖+调用表达式，生成 `docs/BACKEND_CODE_MAP.md` 与 `data/backend-code-map.json`（用法：`npx tsx scripts/_backend-code-analyze.ts [--roots <层>] [--json-only]`） | 只做静态分析；纯只读，不改代码 |
| `scripts/_mission-session.ts` | 生成类任务 Mission 会话诊断：打印各阶段状态/事件/耗时 | 只做诊断 |
| `scripts/workflow-cli.ts` | v11 Workflow CLI（create/install/run/list/optimize/versions/rollback/status/metrics） | 只做 CLI |
| `scripts/compact-entity-events.cjs` | 一次性数据治理：压缩实体事件（Entity 去重） | 只做运维 |
| `scripts/run-k6-test.sh` / `scripts/k6-load-test.js` / `scripts/k6-smoke.js` | k6 压测门槛/负载/冒烟（针对 StudioServer 端点） | 只做压测 |
| `scripts/start-cognee.sh` / `scripts/run-all.sh` | 启动 cognee / 全栈（cognee+后端） | 只做启动 |
| `scripts/query-morpex.bat` / `scripts/setup-cbm.bat` / `scripts/setup-codebase-memory.bat` | Windows 运维批处理（查询/初始化 codebase memory） | 只做运维 |
| `scripts/tracing/` | 追踪辅助脚本（若有） | 只做诊断 |

**当前文件数：后端 483 文件 / 2768 函数（其中 core/src 346，独立包 connectors 8 + memory 26 + studio/server 29 + workflows 39 + workflow-sdk 8 + contracts 7 + scripts 20，以 `docs/BACKEND_CODE_MAP.md` 为准）。精简 P0 已移除可选子系统（studio simulation/verification 17 文件）与废弃 harness（5 文件）。**

**设计契约文档：`docs/EVENT_PAYLOAD_SPEC.md`（任务事件载荷 Envelope+MessageBox 可扩展规格，执行链事件契约见 eventContractCatalog +13）。**
| `packages/studio/server/schedule-manager.ts` | 定时触发调度器（12-Factor F11 补完） | 简化版 5 段 cron 解析（* , - /）+ data/schedules.json 真相源（tmp+rename 原子写）+ 分钟级 tick（异常吞掉不拖垮主进程）；触发经合成请求委派 chatSendHandler 全链路；宕机错过不补跑（lastFiredKey 审计）。路由 POST/GET/DELETE /api/schedules 在 StudioServer |
