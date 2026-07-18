# MorPex → 跨领域多 Agent 协同系统升级计划

> **核心理念**：在 pi 迁移完成的基础上，将 MorPex 从"单领域多 Agent 编排系统"升级为"跨领域多 Agent 协同系统"。
> 引入四层解耦架构，通过**领域清单（Domain Manifest）** 实现零重构扩行业。

---

## 🎯 完成状态：全部完成 ✅

|  Phase   | 名称                                   | 状态  |
| :------: | :----------------------------------- | :-: |
|  **8**   | 领域清单协议 (Domain Manifest Protocol)    |  ✅  |
|  **9**   | 动态领域空间 (Dynamic Domain Clusters)     |  ✅  |
|  **10**  | 跨领域路由器 (Cross-Domain Router)         |  ✅  |
|  **11**  | 跨领域事件总线与资产传递                         |  ✅  |
| **11.5** | 智能体协商协议 (Agent Negotiation Protocol) |  ✅  |
|  **12**  | 跨领域知识图谱                              |  ✅  |
|  **13**  | Web UI 跨领域协同面板                       |  ✅  |
|  **14**  | 领域 SDK 与热加载                          |  ✅  |

**最后更新**: 2026-07-09

---

---

## 0. 设计架构：四层解耦模型

```
┌──────────────────────────────────────────────────────────────┐
│ 🟢 第一层：用户感知与统一路由层 (UI & Router Layer)              │
│    CrossDomainRouter + IntentResolver + 强推理 LLM            │
│    职责：领域拆解与指派，生成高级任务 DAG                        │
├──────────────────────────────────────────────────────────────┤
│ 🔵 第二层：中枢事件总线 (Core Event Bus)                        │
│    跨领域异步通信 + 资产引用传递 (ArtifactRef)                   │
│    领域间互不干扰，只认事件和产物                                │
├──────────────────────────────────────────────────────────────┤
│ 🟡 第三层：动态领域空间 (Dynamic Domain Clusters)               │
│    每领域独立 pi-agent 集群：Master + Skill Pool               │
│    按需动态拉起/休眠，按 DomainManifest 配置                    │
├──────────────────────────────────────────────────────────────┤
│ 🔴 第四层：全局共享底座 (Shared Substrate)                     │
│    跨领域知识图谱 + 全局资产登记处 (URI 格式标准化)              │
└──────────────────────────────────────────────────────────────┘
```

### 0.0 核心协议：领域清单 (Domain Manifest)

定义一个新领域，只需编写一个 JSON 配置文件，零代码改动：

```json
{
  "domain_id": "legal_compliance",
  "domain_name": "法律合规领域",
  "version": "1.0.0",
  "master_agent_config": {
    "system_prompt": "你是一名资深的跨国企业合规官...",
    "model": "deepseek-r1",
    "temperature": 0.3
  },
  "subscribed_events": ["ContractReviewRequestedEvent"],
  "skills": [
    "legal_database_search",
    "contract_diff_generator"
  ],
  "output_artifacts": [
    { "type": "legal_report", "format": "markdown" },
    { "type": "modified_contract", "format": "docx" }
  ],
  "wake_conditions": {
    "intent_patterns": ["法律", "合规", "合同", "法规"],
    "events": ["ContractReviewRequestedEvent"],
    "artifact_triggers": ["contract_draft"]
  }
}
```

---

## 1. 分阶段计划

### Phase 8：领域清单协议 (Domain Manifest Protocol)

**目标**：定义 `DomainManifest` 类型和加载/验证机制。

- [x] **8.1** 定义 `DomainManifest` TypeScript 接口
  ```typescript
  // packages/core/domains/types.ts
  interface DomainManifest {
    domain_id: string;
    domain_name: string;
    version: string;
    master_agent_config: MasterAgentConfig;
    subscribed_events: string[];
    skills: string[];
    output_artifacts: ArtifactSpec[];
    wake_conditions: WakeConditions;
  }
  interface MasterAgentConfig {
    system_prompt: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  }
  interface ArtifactSpec {
    type: string;
    format: string;
    description?: string;
  }
  interface WakeConditions {
    intent_patterns: string[];
    events: string[];
    artifact_triggers: string[];
  }
  ```

- [x] **8.2** 创建 `DomainManifestLoader` — 从 `data/domains/*.json` 加载和验证
  ```typescript
  // packages/core/domains/DomainManifestLoader.ts
  class DomainManifestLoader {
    async loadAll(): Promise<DomainManifest[]> { ... }
    async load(domainId: string): Promise<DomainManifest> { ... }
    validate(manifest: DomainManifest): ValidationResult { ... }
  }
  ```

- [x] **8.3** 创建示例领域清单文件
  - `data/domains/software-engineering.json` — 软件工程（默认领域）
  - `data/domains/business-finance.json` — 商业金融
  - `data/domains/legal-compliance.json` — 法律合规

- [x] **8.4** 验证：`DomainManifestLoader.loadAll()` 成功加载所有清单

---

### Phase 9：动态领域空间 (Dynamic Domain Clusters)

**目标**：实现 `DomainCluster` 类，管理每个领域的独立 pi-agent 集群。

- [x] **9.1** 创建 `DomainCluster` 类
  ```typescript
  // packages/core/domains/DomainCluster.ts
  class DomainCluster {
    manifest: DomainManifest;
    master: AgentHarness | null;    // Master agent
    skillPool: Map<string, AgentTool>;
    status: 'sleeping' | 'waking' | 'active' | 'draining';
    
    async wake(): Promise<void>;    // 动态拉起
    async sleep(): Promise<void>;   // 休眠释放
    async execute(message: string): Promise<AgentMessage[]>;
    getStatus(): ClusterStatus;
  }
  ```

- [x] **9.2** 创建 `DomainClusterManager` — 管理所有 DomainCluster 生命周期
  ```typescript
  // packages/core/domains/DomainClusterManager.ts
  class DomainClusterManager {
    clusters: Map<string, DomainCluster>;
    
    register(manifest: DomainManifest): void;
    wake(domainId: string): Promise<void>;
    sleep(domainId: string): Promise<void>;
    getActiveClusters(): DomainCluster[];
    findDomainByIntent(intent: string): DomainManifest | null;
  }
  ```

- [x] **9.3** 集成 `AgentService` 到 `DomainCluster`
  - 每个 DomainCluster 内部使用 AgentService 创建 Master AgentHarness
  - Skill Pool 从 Skill 文件加载 + 注册为 AgentTool

- [x] **9.4** 验证：创建 2 个领域，分别发送消息，确认独立运行

---

### Phase 10：跨领域路由器 (Cross-Domain Router)

**目标**：使用强推理 LLM 拆解复杂任务为跨领域 DAG。

- [x] **10.1** 创建 `CrossDomainRouter`
  ```typescript
  // packages/core/router/CrossDomainRouter.ts
  class CrossDomainRouter {
    /**
     * 使用强推理 LLM 分析用户输入，拆解为子任务 DAG
     * 
     * 输入: "帮我设计一款智能农业监控硬件，并写一份商业推广计划书"
     * 输出: {
     *   tasks: [
     *     { domain: 'hardware-engineering', goal: '设计智能农业监控硬件', deps: [] },
     *     { domain: 'business-marketing', goal: '撰写商业推广计划书', deps: ['task_0'] }
     *   ],
     *   reasoning: '...'
     * }
     */
    async decompose(input: string, availableDomains: DomainManifest[]): Promise<TaskDecomposition>;
    
    /** 将分解结果构建为 DAG */
    buildDAG(decomposition: TaskDecomposition): DAGNode[];
  }
  ```

- [x] **10.2** 升级 `IntentResolver` → 增加多领域拆解能力
  - 保留单意图分类（向后兼容）
  - 新增 `decomposeComplexIntent()` 方法
  - 使用 DeepSeek-R1 级别的推理能力做领域分组

- [x] **10.3** 创建 `DomainDispatcher` — 接收 DAG，逐节点分发到对应 DomainCluster
  ```typescript
  // packages/core/router/DomainDispatcher.ts
  class DomainDispatcher {
    async executeDAG(dag: DAGNode[], clusters: DomainClusterManager): Promise<ExecutionResult>;
    async executeNode(node: DAGNode, cluster: DomainCluster): Promise<NodeResult>;
  }
  ```

- [x] **10.4** 验证：输入跨领域指令，验证 LLM 拆解正确，DAG 构建成功

---

### Phase 11：跨领域事件总线与资产传递

**目标**：领域间通过事件总线异步通信，产物通过 URI 引用传递。

- [x] **11.1** 定义跨领域事件类型
  ```typescript
  // packages/core/events/CrossDomainEvents.ts
  interface DomainTaskCompletedEvent {
    type: 'domain.task_completed';
    domainId: string;
    taskId: string;
    artifacts: ArtifactRef[];  // URI 列表，非内容传输
    timestamp: number;
  }
  interface ArtifactRef {
    uri: string;        // artifact://{domain}/{type}/{id}
    type: string;
    name: string;
  }
  ```

- [x] **11.2** 升级 EventBus — 支持领域作用域事件
  - `bus.emitToDomain(domainId, event)` — 只发送到指定领域
  - `bus.onDomain(domainId, eventType, handler)` — 只监听指定领域
  - `bus.broadcastCrossDomain(event)` — 跨领域广播

- [x] **11.3** 升级 `ArtifactRegistry` — 标准化 URI 格式
  - 格式：`artifact://{domain}/{artifactType}/{artifactId}`
  - `registry.resolve(uri: string): ArtifactInstance`
  - `registry.listByDomain(domainId: string): ArtifactInstance[]`

- [x] **11.4** 验证：领域 A 完成产物 → 发布事件 → 领域 B 自动捡起产物

---

### Phase 11.5：智能体协商协议 (Agent Negotiation Protocol)

**目标**：领域 Master Agent 之间通过结构化"质询工单"进行跨域质量审查、冲突检测与协商闭环。

> **核心理念**：领域间不能是无序的口水战。通过 `InterrogationTicket`（质询工单）实现结构化协商，
> 通过 FSM Hook 实现目标 Agent 的中断挂起与上下文注入，通过深度限制和资产哈希防止死循环。

---

#### 11.5.1 质询工单数据结构 (InterrogationTicket)

- [x] **11.5.1a** 定义 `InterrogationTicket` 类型
  ```typescript
  // packages/core/negotiation/types.ts
  interface InterrogationTicket {
    ticket_id: string;              // tk_{timestamp}_{random}
    status: TicketStatus;           // PENDING | ACCEPTED | REJECTED | ARGUING | ESCALATED
    source_domain: string;          // 发起质询的领域
    target_domain: string;          // 被质询的领域
    trigger_artifact_id: string;    // 触发质询的产物 ID
    conflict_type: ConflictType;    // COST_OVERRUN | TECH_INFEASIBLE | COMPLIANCE_RISK | QUALITY_GATE | SECURITY_VULN
    reason: string;                 // 人类可读的质询理由
    suggestion: string;             // 建议的修正方向
    context_snapshot: Record<string, any>;  // 关键数据快照（如 max_allowed_cost / current_calculated_cost）
    depth_count: number;            // 防死循环计数器（从 1 开始）
    artifact_hash: string;          // 质询时产物的 SHA256 哈希（防重复质询）
    history: TicketRound[];         // 协商历史
    created_at: number;
    updated_at: number;
  }

  type TicketStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'ARGUING' | 'ESCALATED';
  type ConflictType = 'COST_OVERRUN' | 'TECH_INFEASIBLE' | 'COMPLIANCE_RISK' | 'QUALITY_GATE' | 'SECURITY_VULN' | 'DEPENDENCY_CONFLICT';

  interface TicketRound {
    round: number;
    from_domain: string;
    action: 'initiate' | 'accept' | 'reject' | 'argue' | 'escalate';
    message: string;
    artifact_hash?: string;
    timestamp: number;
  }
  ```

- [x] **11.5.1b** 创建 `NegotiationEngine` — 质询工单生命周期管理
  ```typescript
  // packages/core/negotiation/NegotiationEngine.ts
  class NegotiationEngine {
    private tickets: Map<string, InterrogationTicket>;
    private readonly MAX_DEPTH = 3;  // 深度硬限制
    private artifactHashHistory: Map<string, Set<string>>; // artifactId → hashes seen

    /** 发起质询 */
    createTicket(params: CreateTicketParams): InterrogationTicket;
    /** 目标领域响应 */
    respond(ticketId: string, action: TicketRound['action'], message: string): InterrogationTicket;
    /** 检查是否需要熔断 */
    shouldEscalate(ticket: InterrogationTicket): boolean;
    /** 检查是否重复质询（相同 artifact + hash） */
    isDuplicateChallenge(artifactId: string, hash: string): boolean;
  }
  ```

#### 11.5.2 FSM 中断与挂起机制 (FSM Hook)

- [x] **11.5.2a** 升级 `FSMEngine` — 新增 `INTERROGATING` 状态
  ```typescript
  // 状态转换新增：
  // EXECUTING/RUNNING → INTERROGATING  (收到质询工单)
  // INTERROGATING → EXECUTING/RUNNING  (质询解决)
  // INTERROGATING → ESCALATED          (熔断升级)
  ```

- [x] **11.5.2b** 实现 `FSMEngine.suspendForInterrogation(ticket)`
  - 保存当前 FSM 状态（用于恢复）
  - 切换到 `INTERROGATING` 状态
  - 调用 `DomainCluster.interrogate(ticket)` 注入上下文

- [x] **11.5.2c** 在 `DomainCluster` 中实现 `interrogate(ticket)`
  ```typescript
  // packages/core/domains/DomainCluster.ts
  async interrogate(ticket: InterrogationTicket): Promise<void> {
    // 1. 如果 master harness 正在执行，不需要 abort，而是 steer 注入
    // 2. 将 ticket 格式化为系统提示注入
    const injection = `
  [系统中断 - 跨领域质询]
  来自「${ticket.source_domain}」领域的 Agent 对你的产出提出了质询：
  
  冲突类型: ${ticket.conflict_type}
  质询理由: ${ticket.reason}
  修正建议: ${ticket.suggestion}
  
  关键数据:
  ${JSON.stringify(ticket.context_snapshot, null, 2)}
  
  请优先回应此质询，决定：接受修改 / 反驳论证 / 请求仲裁。
  回应后将自动恢复原任务。
    `;
    // 3. 使用 harness.steer() 注入（不中断当前执行，作为下一轮处理的上下文）
    await this.master!.steer(injection);
  }
  ```

#### 11.5.3 协商闭环流转 (Negotiation Loop)

- [x] **11.5.3a** 实现三种走向的处理器：

  **走向 A：接受 (ACCEPT)**
  - 被质询者调用 `NegotiationEngine.respond(ticketId, 'accept', message)`
  - FSM 状态恢复 → 触发自身更新流程
  - 发布 `DomainTaskCompletedEvent`（附带修改后的产物）
  - 质询发起者收到事件，验证修改

  **走向 B：反驳 (ARGUING)**
  - 被质询者调用 `NegotiationEngine.respond(ticketId, 'argue', counterArgument)`
  - `depth_count++`
  - 工单返回发起者 → 发起者收到后决定：让步 / 继续反驳 / 升级
  - 如果 `depth_count > MAX_DEPTH` → 自动触发走向 C

  **走向 C：仲裁 (ESCALATE)**
  - 触发条件：`depth_count > 3` 或 `isDuplicateChallenge() === true`
  - 工单状态 → `ESCALATED`
  - 通过 SSE 推送到前端 UI → 人类用户介入
  - 所有相关领域的工作流挂起，等待裁决

- [x] **11.5.3b** 在 `CrossDomainRouter` 中实现仲裁逻辑
  - 收到 `ESCALATED` 工单 → 停止 DAG 执行
  - 向前端推送 `human.interrogation_escalated` 事件
  - 前端展示双方论点和关键数据 → 人类裁决 → 结果回注

#### 11.5.4 防死循环双闸门

- [x] **11.5.4a** 深度硬限制 (Depth Limit)
  ```typescript
  // NegotiationEngine 中硬编码
  if (ticket.depth_count > 3) {
    ticket.status = 'ESCALATED';
    this.eventBus.emit({ type: 'negotiation.escalated', ticket });
    return ticket; // 禁止继续协商
  }
  ```

- [x] **11.5.4b** 资产快照比对 (Context Hash Check)
  ```typescript
  // 每次质询记录 artifact_hash
  // 同一 artifact 出现相同 hash 的质询 → 死循环检测
  isDuplicateChallenge(artifactId: string, hash: string): boolean {
    const seen = this.artifactHashHistory.get(artifactId);
    if (seen?.has(hash)) return true; // 已经为同样的内容质询过了
    if (!seen) this.artifactHashHistory.set(artifactId, new Set());
    this.artifactHashHistory.get(artifactId)!.add(hash);
    return false;
  }
  ```

- [x] **11.5.4c** 全局限流
  - 同一对领域之间，同时最多只有 1 个活跃工单
  - 如果已有 PENDING/ARGUING 工单，拒绝创建新工单

#### 11.5.5 验证

- [x] **11.5.5** 端到端验证：
  1. 领域 A 产出 BOM 表 → 领域 B 发起质询 (COST_OVERRUN)
  2. 领域 A 收到 → FSM 状态变为 INTERROGATING → steer 注入
  3. 领域 A 回应 ACCEPT → 更新 BOM → 领域 B 验证
  4. 模拟死循环：depth_count 超过 3 → ESCALATED → 前端弹窗

---

### Phase 12：跨领域知识图谱

**目标**：KnowledgeGraph 支持领域命名空间和跨领域实体解析。

- [x] **12.1** 升级 KnowledgeEntity — 增加 `domainId` 字段
  ```typescript
  interface KnowledgeEntity {
    id: string;
    domainId: string;          // 所属领域
    name: string;
    type: EntityType;
    // ... 其他字段不变
  }
  ```

- [x] **12.2** 新增跨领域查询方法
  - `kg.searchCrossDomain(query, domains[])` — 跨领域搜索
  - `kg.findCrossDomainLinks(entityId)` — 查找跨领域关联
  - `kg.getDomainSubgraph(domainId)` — 提取领域子图

- [x] **12.3** 自动构建跨领域关联
  - 当两个不同领域的实体共享相似名称/描述 → 自动建议关联
  - 当 ArtifactRef 从一个领域传递到另一个领域 → 自动创建 `links_to` 关系

- [x] **12.4** 验证：跨领域查询返回正确结果

---

### Phase 13：Web UI 跨领域协同面板

**目标**：前端展示多领域协同进度和产物。

- [x] **13.1** 升级 SSE 事件 — 新增跨领域事件类型
  ```typescript
  // 前端 SSEEventMap 新增
  'domain.waking': (data) => void;
  'domain.active': (data) => void;
  'domain.sleeping': (data) => void;
  'domain.task_completed': (data) => void;
  'cross_domain.dag_created': (data) => void;
  'cross_domain.artifact_shared': (data) => void;
  ```

- [x] **13.2** 前端新增"领域面板"组件
  - 显示活跃领域列表（带状态指示器）
  - 每个领域的进度条
  - 领域间产物流转可视化

- [x] **13.3** 升级聊天面板 — 多领域消息分区
  - 每个领域有独立的聊天流
  - 跨领域消息标注来源领域

- [x] **13.4** 验证：前端正确展示多领域协同

---

### Phase 14：领域 SDK 与热加载

**目标**：新领域可热加载，无需重启系统。

- [x] **14.1** 文件监听器 — 监听 `data/domains/` 目录变化
  - 新增 JSON → 自动注册 DomainCluster
  - 修改 JSON → 自动重载（不影响正在执行的任务）
  - 删除 JSON → 优雅休眠该领域

- [x] **14.2** `POST /api/domains/reload` — 手动热加载端点
- [x] **14.3** `GET /api/domains` — 列出所有已注册领域及状态
- [x] **14.4** 验证：新增领域 JSON 文件 → 自动加载 → 立即可用

---

## 2. 文件影响清单

| 文件 | 动作 | Phase |
|------|------|-------|
| `packages/core/domains/types.ts` | 🆕 新建 | 8 |
| `packages/core/domains/DomainManifestLoader.ts` | 🆕 新建 | 8 |
| `packages/core/domains/DomainCluster.ts` | 🆕 新建 | 9 |
| `packages/core/domains/DomainClusterManager.ts` | 🆕 新建 | 9 |
| `packages/core/router/CrossDomainRouter.ts` | 🆕 新建 | 10 |
| `packages/core/router/DomainDispatcher.ts` | 🆕 新建 | 10 |
| `packages/core/events/CrossDomainEvents.ts` | 🆕 新建 | 11 |
| `packages/core/negotiation/types.ts` | 🆕 新建 | 11.5 |
| `packages/core/negotiation/NegotiationEngine.ts` | 🆕 新建 | 11.5 |
| `packages/core/router/ArbitrationHandler.ts` | 🆕 新建 | 11.5 |
| `packages/core/planes/control-plane/intent/IntentResolver.ts` | 🟡 改造 | 10 |
| `packages/core/planes/agent-plane/orchestrator/AgentOrchestrator.ts` | 🟡 改造 | 9,10 |
| `packages/core/core/EventBus.ts` | 🟡 改造 | 11,11.5 |
| `packages/core/planes/runtime-kernel/fsm/FSMEngine.ts` | 🟡 改造（新增 INTERROGATING 状态） | 11.5 |
| `packages/core/planes/knowledge-plane/knowledge/KnowledgeGraph.ts` | 🟡 改造 | 12 |
| `packages/core/planes/knowledge-plane/artifacts/ArtifactRegistry.ts` | 🟡 改造 | 11 |
| `packages/core/index.ts` | 🟡 修改 | 8-12 |
| `packages/studio/server/StudioServer.ts` | 🟡 改造 | 13,14 |
| `packages/studio/ui/ts/api.ts` | 🟡 改造 | 13 |
| `packages/studio/ui/ts/chat.ts` | 🟡 改造 | 13 |
| `data/domains/*.json` | 🆕 新建 | 8 |
| `docs/plans/cross-domain-upgrade-todo.md` | 🆕 本文档 | - |

---

## 3. 迁移铁律（继承自 pi-migration-todo.md）

| # | 铁律 | 跨领域升级中的含义 |
|---|------|-------------------|
| 0.1 | 字段名法则 | DomainManifest 字段 = JSON 配置名 = 代码字段名，禁止翻译 |
| 0.2 | 类型来源法则 | 所有新类型基于 pi-ai/pi-agent-core 已有类型扩展 |
| 0.3 | API 契约法则 | REST API 返回格式 = DomainCluster/DomainManifest 原生字段 |
| 0.4 | 删除优先法则 | 不对已有 pi 功能做二次封装 |
| 0.5 | SSE 透传契约 | 新增领域事件直接 broadcastToSSE，不经过 mapEventToSSE |

---

## 4. 验证门禁

每个 Phase 完成后必须通过：

```bash
# Domain Manifest 加载
npx tsx packages/core/e2e-domains.ts

# 跨领域 DAG 拆解
npx tsx packages/core/e2e-cross-domain.ts

# 全栈启动 + 多领域测试
npm start
# → 检查 /api/domains 返回已注册领域列表

# 跨领域指令测试
curl -X POST http://localhost:8080/api/chat/cross-domain \
  -d '{"message":"帮我设计一款智能农业监控硬件，并写一份商业推广计划书"}'
```

---

## 5. 执行顺序建议

```
Phase 8  (Domain Manifest Protocol)     ← 基础：定义领域协议
    ↓
Phase 9  (Dynamic Domain Clusters)      ← 核心：领域空间实现
    ↓
Phase 10 (Cross-Domain Router)          ← 智能：LLM 任务拆解
    ↓
Phase 11 (Cross-Domain Event Bus)       ← 连接：领域间通信
    ↓
Phase 11.5 (Agent Negotiation Protocol) ← 质控：跨域质询与冲突解决
    ↓
Phase 12 (Cross-Domain Knowledge Graph) ← 增值：跨领域知识
    ↓
Phase 13 (Web UI Panel)                 ← 展示：前端协同面板
    ↓
Phase 14 (Domain SDK & Hot Reload)      ← 体验：热加载
```
