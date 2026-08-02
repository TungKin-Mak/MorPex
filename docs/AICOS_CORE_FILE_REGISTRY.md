# AICOS-Core 逐文件注册表（功能 + 职责边界）

> 版本: 2.1 | 单一真相源: `docs/AICOS_CORE_ARCHITECTURE.md`

> **目的**：逐文件登记「功能」与「职责边界」，防止功能碎片化、重复实现、职责边界模糊。

> **维护规则**：新增/修改文件必须同步本表；同一职责只允许一个文件拥有；跨层访问必须经 L3 Gate。

> **列说明**：功能 = 文件顶部声明；职责边界 = 文件自身声明中的边界条款（含"职责/不做/只做/禁止"者直接引用），否则用层边界规则。


## `facade/`（4 文件）

> 层边界规则：编排与协议适配；不承载业务/认知/存储逻辑

| 文件                                     | 功能                                                                                                                                                                                                                                                                   | 职责边界                                                                                                                                                                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `facade/CompanyFacade.ts`              | CompanyFacade — CEO 高层操作入口（v16 Unified） ═══ 硬管道 ═══ - Runtime 与 ControlPlane 构造时强制（NODE_ENV=production 旧签名抛错） - executeGoal: ControlPlane.checkAll() + RunOptions 透传 - sendTask: 委托 executeGoal（不跳过门禁） /                                                             | 编排与协议适配；不承载业务/认知/存储逻辑                                                                                                                                                                                                                                                |
| `facade/gateway/ExecutionGateway.ts`   | ExecutionGateway — 统一执行网关 职责： - 管理多个运行时适配器（PiAdapter 等） - 根据 agentRole 路由到对应 adapter - 确保 executionId 已设置 - 调用 adapter.execute() 并标准化返回结果 - 通过 EventBus 广播 runtime.* 事件 设计约束： - Gateway 不缓存状态（薄桥转发） - 所有事件通过 EventBus 广播 - 所有事件 ID 必须通过 ExecutionIdentity.createEven | ExecutionGateway — 统一执行网关 职责： - 管理多个运行时适配器（PiAdapter 等） - 根据 agentRole 路由到对应 adapter - 确保 executionId 已设置 - 调用 adapter.execute() 并标准化返回结果 - 通过 EventBus 广播 runtime.* 事件 设计约束： - Gateway 不缓存状态（薄桥转发） - 所有事件通过 EventBus 广播 - 所有事件 ID 必须通过 ExecutionIdentity.createEven |
| `facade/gateway/adapters/PiAdapter.ts` | PiAdapter — pi AgentRuntime → AgentRuntimeAdapter 适配器 将现有 AgentRuntime（src/core/runtime.ts）包装为标准的 AgentRuntimeAdapter。 包装对象：AgentRuntime（src/core/runtime.ts） 不包装：Orchestrator、MentionRouter、FSMAgentRuntime 内部逻辑： execute(request) ├── ExecutionRequest.input → pi  | 编排与协议适配；不承载业务/认知/存储逻辑                                                                                                                                                                                                                                                |
| `facade/index.ts`                      | facade — CEO 高层操作入口模块 Phase 0 / 基础设施层 CompanyFacade = 一人虚拟公司的"CEO 控制台" /                                                                                                                                                                                             | 编排与协议适配；不承载业务/认知/存储逻辑                                                                                                                                                                                                                                                |


## `governance/`（28 文件）

> 层边界规则：目标级授权；不推理/不执行/不直接查知识

| 文件 | 功能 | 职责边界 |
|---|---|---|
| `governance/AlertEngine.ts` | AlertEngine — 告警引擎（基于 EventBus） | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/ApprovalGate.ts` | ApprovalGate — 审批门 v16: Compliance → RiskAssessment → ApprovalGate → Release Stabilization: 增加 ApprovalPolicyRegistry 商业级策略引擎 / | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/AuditTrail.ts` | AuditTrail — 审计追踪层 Phase 8 / MorPex v8: 不可篡改的治理决策记录。 职责： 1. 记录所有风险分析结果 2. 记录所有审批决策（approve/deny/expire） 3. 记录所有执行状态变更 4. 提供审计报告生成 5. 支持按 Mission/类型/时间范围查询 设计原则： - 只追加（append-only）：已有条目不可修改或删除 - 不可篡改：每条记录包含时间戳和执行者信息 - 高效查询：使用 Map 索引优化按 Mission 和类型的查询 - 内存优先：支持  | AuditTrail — 审计追踪层 Phase 8 / MorPex v8: 不可篡改的治理决策记录。 职责： 1. 记录所有风险分析结果 2. 记录所有审批决策（approve/deny/expire） 3. 记录所有执行状态变更 4. 提供审计报告生成 5. 支持按 Mission/类型/时间范围查询 设计原则： - 只追加（append-only）：已有条目不可修改或删除 - 不可篡改：每条记录包含时间戳和执行者信息 - 高效查询：使用 Map 索引优化按 Mission 和类型的查询 - 内存优先：支持  |
| `governance/ComplianceChecker.ts` | ComplianceChecker — 合规检查引擎 v15: 按领域执行策略规则检查，返回 PASS/WARNING/BLOCK / | 目标级授权；不推理/不执行/不直接查知识 |
| `governance/CostController.ts` | CostController — 成本控制器（基于 EventBus） | 目标级授权；不推理/不执行/不直接查知识 |
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
| `knowledge/ontology/prompts/expert-prompt.ts` | Expert Prompt — Ring 1 领域专家系统提示词 适用对象：由 Leader 动态衍生出的特定脑区专家 （如 hardware_engineering、firmware_execution、business_finance 等领域的 AgentHarness）。 三级分封架构： Leader (Ring 0) → Expert (Ring 1) → Fork (Ring 2) 遵循迁移铁律： 0.2 (类型来源法则): 基于 pi-agent-core 扩展 0.4 (删除优先法则): 提示词驱动行 | 权威存储+Tier写规则；不拦截/不推理/不触发演化 |
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
| `cognition/planning/goal-intelligence/GoalIntelligenceFacade.ts` | GoalIntelligenceFacade — 目标理解引擎入口 v14: 用户一句话目标 → 可执行的 GoalContext / | 理解/推理/规划；禁副作用Primitive/不改知识/不触发演化 |
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
| `execution/UnifiedExecutionEngine.ts` | UnifiedExecutionEngine — 统一执行引擎（Facade） Phase 2 / 交付层 对外提供统一的执行入口，对内委托给三个现有执行模块: - MissionRuntime (24 状态 FSM) - DAGRuntime (DAG 调度) - ExecutionFabric (v11 Agent 能力解析 + Connector 调用) 设计原则： - Facade 模式：不修改现有模块，只在外部包裹统一 API - 根据执行模式（mode）自动路由到正确的引擎 - 聚合状态查询：统一从三个 | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/fabric/ExecutionFabric.ts` | ExecutionFabric — v11 Unified Execution Fabric Merges AgentRuntime, Scheduler, and Connector Runtime into a single execution plane. Coordinates the flow: Workflow Node → Capability Resolver → Agent Selection → Action Request → Execution @packageDocumentation / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/fabric/index.ts` | Execution Fabric — v11 Unified Execution Plane @packageDocumentation / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/harness/AgentHarness.ts` | AgentHarness — Agent 执行封装（记忆读写/产物引用/事件回调） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/harness/ContextBuilder.ts` | ContextBuilder — 从记忆/产物/经验构建 Harness 执行上下文（意图/计划/记忆） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/harness/HarnessContext.ts` | Harness 上下文类型定义（IntentContext / PlanContext / MemoryContext 结构化） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/harness/index.ts` | （barrel：统一导出，功能以被导出文件为准） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/harness/types.ts` | Memory record retrieved from memory store */ | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/index.ts` | Execution — v11 Execution Plane + Phase 2 统一引擎 @packageDocumentation / | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/ExecutionContext.ts` | ExecutionContext — 执行上下文（GoalContext + MissionState + 运行时快照） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/MorPexRuntime.ts` | MorPexRuntime — L5 主驱动器（FSM/DAG 执行编排；失败路径只读演化分析；发 runtime.* 事件） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/PersistentArtifactStore.ts` | PersistentArtifactStore — 基于 UnifiedEventStore 的产物持久化（事件溯源） | 有界执行+硬边界；不重规划/不评分/不演化 |
| `execution/runtime/PersistentMissionStore.ts` | PersistentMissionStore — Event Sourcing 架构 所有 Mission 状态变化通过事件记录，启动时从事件重放重建状态 / | 有界执行+硬边界；不重规划/不评分/不演化 |
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


## `evolution/`（20 文件）

> 层边界规则：提案→沙箱→审批→迁移；须过Gate/不绕过Governance/晋升才写Tier-2

| 文件 | 功能 | 职责边界 |
|---|---|---|
| `evolution/EvolutionProposal.ts` | EvolutionProposal — 演化提案数据模型（Wave 3a 自 cognition/ 迁入）。创建后状态必须为 pending（DRAFT→PENDING_REVIEW→APPROVED）；tier-0/1 创建必须持有 KnowledgeContextPackage（Wave 3b Gate 硬拦截） | L7 演化唯一所有者；未审批状态只能是 pending |
| `evolution/ImprovementAnalyzer.ts` | ImprovementAnalyzer — 改进洞察分析（Wave 3a 自 cognition/ 迁入）：成功率/延迟/失败模式 → ImprovementInsight 列表 | L7 演化唯一所有者；只产洞察，不执行 |
| `evolution/SelfImprovementLoop.ts` | SelfImprovementLoop — 自我改进闭环（Wave 3a 自 cognition/ 迁入）。Observation → Analysis → Proposal → Simulation → Evaluation → Approval → Deployment → Monitor；只生成提案，不直接修改代码。Wave 3b：晋升经 EvolutionSandbox.approveAndApply 需 Gate 凭证 | L7 演化唯一所有者；L4 禁止直接触发 |
| `evolution/ActiveEvolutionTrigger.ts` | ActiveEvolutionTrigger — 主动进化触发器 v16 Phase 4.7: 一人跨多领域虚拟公司的主动自我进化能力。 在事件驱动触发之外， 增加基于失败、质量、新部门等条件的主动进化触发器。 设计原则： - EventBus 通信（监听 mission.completed、evolution.active_triggered 等） - 部门隔离（按 deptId 独立追踪失败计数） - 阈值可配置 - 非阻塞：触发检查不干扰主线执行 触发条件： 1.  | 提案→沙箱→审批→迁移；须过Gate/不绕过Governance/晋升才写Tier-2 |
| `evolution/EvolutionSandbox.ts` | EvolutionSandbox — 演化安全沙箱（Verifiable Evolution 最小闭环） L7：禁止「分析完直接改生产行为」。演化产物必须先： 1. 沙箱试跑（dry-run golden tasks，隔离 Runtime） 2. 版本化落地（version ledger，EventStore 持久化） 3. 人工审批（未批准 = proposal 状态 pending） 4. 自动回滚（L7：携带 revert() 的具体变更真正撤销 + verify() 校验； 失败可重试，不产生 | EvolutionSandbox — 演化安全沙箱（Verifiable Evolution 最小闭环） L7：禁止「分析完直接改生产行为」。演化产物必须先： 1. 沙箱试跑（dry-run golden tasks，隔离 Runtime） 2. 版本化落地（version ledger，EventStore 持久化） 3. 人工审批（未批准 = proposal 状态 pending） 4. 自动回滚（L7：携带 revert() 的具体变更真正撤销 + verify() 校验； 失败可重试，不产生 |
| `evolution/ExperienceMiner.ts` | ExperienceMiner — 经验挖掘器 v16: 任务完成后自动挖掘经验，更新 CapabilityRegistry / | 提案→沙箱→审批→迁移；须过Gate/不绕过Governance/晋升才写Tier-2 |
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
| `infrastructure/adapters/index.ts` | MorPex Core Adapter Layer — Barrel export All Pi-adjacent types and utilities are re-exported from here. Core business logic may import from this barrel: import { MPAgentTool, Type } from '../../infrastructure/adapters/index.js'; ══════════════════════════════ | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/adapters/memory/index.ts` | Memory Adapter Bridge — 统一 memory 包接入层 ═══════════════════════════════════════════════════════════════════ ARCHITECTURAL BOUNDARY Only files in packages/core/src/infrastructure/adapters/ may directly import from the memory package. All L2/L3/L4 core modules MU | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/adapters/model-registry.ts` | ModelRegistryAdapter — isolates pi-ai model discovery functions. Wraps pi-ai's getModels / getProviders / getModel. Uses type-safe provider validation. / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/adapters/model-resolver.ts` | ModelResolver — Type-safe wrapper around pi-ai's getModel(). Uses pi-ai/compat for backward compatibility. / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/adapters/pi-ai-types.ts` | PiAITypesAdapter — isolates pi-ai TypeBox type exports Re-exports Type, Static, TSchema from pi-ai for use in tool definitions. If pi-ai changes these exports, only this file needs updating. / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/adapters/pi-augmentations.ts` | Pi Augmentations — TypeScript declaration merging for pi-agent-core types. Extends pi-agent-core's AgentMessage to support MorPex custom message roles (memoryHint, dagNodeStatus) used by MemoryMessages.ts. This file is imported as a side-effect by MemoryMessag | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/adapters/pi-bridge/PiBridge.ts` | PiBridge — 稳定的 pi-ai + pi-agent-core 抽象层 隔离 @earendil-works/pi-ai 和 @earendil-works/pi-agent-core 的 API 变更。 当底层包升级时，只需修改此文件。 内部使用 pi-ai 0.81.x 新 API：builtinModels / Models.complete 内部使用 pi-agent-core 0.81.x API：AgentHarness / InMemorySessionRepo / NodeExecutio | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/adapters/pi-bridge/index.ts` | pi-bridge — 稳定的 pi-ai 抽象层 @packageDocumentation / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/adapters/pi-types.ts` | MorPex Pi Type Adapter — Central type-level bridge ═══════════════════════════════════════════════════════════════════ IMPORTANT: THIS IS THE ONLY FILE WHERE Pi TYPES ARE IMPORTED. All other core files MUST import Pi types from here: import { MPAgentTool } fro | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/adapters/pi-utils.ts` | MorPex Pi Utilities Adapter — Central runtime bridge to Pi packages ═══════════════════════════════════════════════════════════════════ ALL pi-agent-core classes go through PiBridge static getters. When pi packages upgrade, only PiBridge needs changing. pi-ai  | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/adapters/thinking-level.ts` | ThinkingLevel — 模型推理深度控制 / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/common/EncryptionService.ts` | EncryptionService — AES-256-GCM 加密/解密 v9.2 Phase 3: 保护敏感字段的静态加密。 使用 Node.js 内置 crypto 模块，AES-256-GCM 认证加密。 环境变量: MORPEX_ENCRYPTION_KEY (32字节 hex) 使用方式: const enc = new EncryptionService(); const encrypted = enc.encrypt('{"apiKey":"sk-..."}'); const decrypted = | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/common/EventBus.ts` | EventBus — 事件总线 (v2: 支持领域作用域) 插件间唯一通信通道。 所有事件必须携带 executionId。 事件类型命名空间：{domain}.{action}（如 runtime.tool.called） Phase 11 新增： - emitToDomain(domainId, event) — 只发送到指定领域 - onDomain(domainId, eventType, handler) — 只监听指定领域 - broadcastCrossDomain(event) — 跨领域广播 设计 | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/common/ExecutionIdentity.ts` | ExecutionIdentity — 全链路 ID 系统 ID 格式：{prefix}_{YYYYMMDD}_{shortUUID} | 类型      | prefix | 示例                        | |-----------|--------|-----------------------------| | executionId | exe  | exe_20260707_a81f92cd       | | traceId   | trc    | trc_20260707_b | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/common/ModelRegistry.ts` | ModelRegistry — pi-ai 模型运行时发现 封装 pi-ai 的 getModels + getProviders + getModel， 提供 MorPexCore 统一的模型查询和发现能力。 所有 pi-ai 直接依赖集中在 ModelRegistryAdapter 中， 更换 pi-ai 版本时仅需修改适配层。 / | 底座服务；无领域逻辑/不推理/不规划/不评价/不演化 |
| `infrastructure/common/PluginSystem.ts` | PluginSystem — 插件注册、生命周期、依赖管理 管理插件的完整生命周期：register → initialize → start → running → stop 设计约束： - 启动顺序按依赖拓扑排序 - 禁止循环依赖 - 插件间禁止直接 import（只能通过 EventBus 通信） - 最后实现（先固化 Kernel Contract，再定义插件生命周期） / | PluginSystem — 插件注册、生命周期、依赖管理 管理插件的完整生命周期：register → initialize → start → running → stop 设计约束： - 启动顺序按依赖拓扑排序 - 禁止循环依赖 - 插件间禁止直接 import（只能通过 EventBus 通信） - 最后实现（先固化 Kernel Contract，再定义插件生命周期） / |
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

---
**当前文件数：约 370+（346 基线 + S22-S37 新增，以 `git ls-files | wc -l` 为准）。**
