# MorPex v2.4 后端功能说明

> ⚠️ **本文档为 v2.4 快照。v3.0 OpenSpace Fusion 已于 2025-07-12 交付** — 新增 ToolQualityManager / TemplateEvolutionEngine / TemplateFileSystem / ExecutionRecordingEngine。最新架构详见 `ARCHITECTURE.md` 和 `backend-complete.md`
>
> 基于 `packages/core/` 代码库的完整功能参考
> 最后更新: 2025-07-10 | 共 **83 个源文件**，**~15,000 行 TypeScript**

---

## 目录

1. [项目总览](#一项目总览)
2. [核心层 Core](#二核心层-core)
3. [服务层 Services](#三服务层-services)
4. [网关层 Gateway](#四网关层-gateway)
5. [镜像系统 Mirror](#五镜像系统-mirror)
6. [领域系统 Domains](#六领域系统-domains)
7. [路由系统 Router](#七路由系统-router)
8. [事件系统 Events](#八事件系统-events)
9. [协商系统 Negotiation](#九协商系统-negotiation)
10. [安全与防御 (v2.4)](#十安全与防御-v24)
11. [执行流升级 (v2.4)](#十一执行流升级-v24)
12. [多领域协同 (v2.4)](#十二多领域协同-v24)
13. [记忆体系 (v2.4)](#十三记忆体系-v24)
14. [运行时平面 Runtime Kernel](#十四运行时平面-runtime-kernel)
15. [控制平面 Control Plane](#十五控制平面-control-plane)
16. [知识平面 Knowledge Plane](#十六知识平面-knowledge-plane)
17. [智能体平面 Agent Plane](#十七智能体平面-agent-plane)
18. [行业系统 Industry](#十八行业系统-industry)
19. [内置工具 Builtin Tools](#十九内置工具-builtin-tools)
20. [工具函数 Utils](#二十工具函数-utils)
21. [入口与导出](#二十一入口与导出)

---

## 一、项目总览

### 1.1 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent Plane (智能体平面)                    │
│  SwarmEngine · AgentOrchestrator · AgentService              │
├─────────────────────────────────────────────────────────────┤
│                 Control Plane (控制平面)                       │
│  IntentResolver · WorkflowPlanner · ArtifactBlueprint         │
├─────────────────────────────────────────────────────────────┤
│              Knowledge Plane (知识平面)                        │
│  ArtifactRegistry · KnowledgeGraph · VectorStore              │
├─────────────────────────────────────────────────────────────┤
│              Runtime Kernel (运行时平面)                       │
│  FSMEngine · DAGEngine · ExecutionGraph · SchedulerEngine     │
├─────────────────────────────────────────────────────────────┤
│                    Core (核心层)                              │
│  Kernel · EventBus · PluginSystem · ExecutionIdentity         │
│  ModelRegistry · ThinkingLevelControl · types                 │
├─────────────────────────────────────────────────────────────┤
│                  Infrastructure (基础设施)                    │
│  Domain系统 · Router · Gateway · Mirror · Permission · Event  │
│  Memory · Tool · Compaction · Collaboration · Projection      │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 设计原则

| 原则 | 说明 |
|:--|:--|
| **0.1 字段名法则** | 代码字段名 = JSON 配置名，禁止翻译 |
| **0.2 类型来源法则** | 所有类型基于 pi-ai / pi-agent-core 扩展 |
| **0.4 删除优先法则** | 不对已有 pi 功能做二次封装 |
| **0.5 迁移铁律** | 新模块以 Strangler Pattern 逐步替换旧模块 |
| **事件驱动** | 所有组件通过 EventBus 通信，禁止直接 import |
| **Observer 模式** | Mirror 只记录不控制 |

---

## 二、核心层 (Core)

### 2.1 Kernel

- **文件**: `packages/core/core/Kernel.ts`
- **导出**: `MorPexKernel`, `KernelConfig`
- **职责**: MorPexCore 生命周期管理，系统唯一入口

```typescript
class MorPexKernel {
  constructor(config?: KernelConfig)
  start(): Promise<void>                     // 启动完整初始化流程
  stop(): Promise<void>                      // 逆序停止
  registerPiRuntime(runtime: any): void      // 延迟注册 pi AgentRuntime
  registerPlugin(plugin: MorPexPlugin): void // 注册插件
  getStatus(): KernelStatus                  // 获取内核状态
  // 只读属性
  eventBus: EventBus
  executionIdentity: ExecutionIdentity
  pluginSystem: PluginSystem
  gateway: ExecutionGateway
  mirror: ExecutionMirror
  storage: JSONLStorage
}
```

**启动流程**: EventBus → ExecutionIdentity → ExecutionGateway → PiAdapter → JSONLStorage → ExecutionMirror → PluginSystem

### 2.2 EventBus

- **文件**: `packages/core/core/EventBus.ts`
- **导出**: `EventBus`
- **职责**: 插件间唯一通信通道，支持领域作用域与 Zone 注入

```typescript
class EventBus {
  constructor(maxHistory?: number)
  emit(event: MorPexEvent): void
  on(type: string, handler: EventHandler): () => void  // 返回取消函数
  once(type: string, handler: EventHandler): () => void
  off(type: string, handler: EventHandler): void
  getHistory(type?: string): MorPexEvent[]
  listenerCount(type?: string): number
  clear(): void

  // Phase 11: 领域作用域
  emitToDomain(domainId: string, event: MorPexEvent): void       // v2.4: 自动注入 sourceZone/targetZone
  onDomain(domainId: string, type: string, handler: EventHandler): () => void
  broadcastCrossDomain(event: MorPexEvent): void                  // v2.4: 自动注入 zone 元数据

  // Phase 5.1: Zone 注入
  setCurrentDomain(domainId: string | undefined): void

  // 查询
  getDomainEventTypes(domainId: string): string[]
  getRegisteredDomains(): string[]
  getEventTypes(): string[]
}
```

**Zone 注入 (v2.4)**: `emitToDomain` 和 `broadcastCrossDomain` 自动设置 `event.sourceZone` （来自 AsyncLocalStorage）和 `event.targetZone`。

### 2.3 PluginSystem

- **文件**: `packages/core/core/PluginSystem.ts`
- **导出**: `PluginSystem`
- **职责**: 插件注册、依赖拓扑排序、生命周期管理 (register → initialize → start → stop)

```typescript
class PluginSystem {
  constructor(eventBus: EventBus, executionIdentity: ExecutionIdentity)
  register(plugin: MorPexPlugin): void
  get(name: string): MorPexPlugin | undefined
  getAll(): MorPexPlugin[]
  startAll(): Promise<void>       // 按依赖拓扑排序启动
  stopAll(): Promise<void>        // 逆序停止
  checkDependencies(name: string): boolean
  getStatus(): Array<{ name, status, version, error? }>
  count: number
}
```

### 2.4 ExecutionIdentity

- **文件**: `packages/core/core/ExecutionIdentity.ts`
- **导出**: `ExecutionIdentity`
- **职责**: 全链路 ID 系统（executionId / traceId / sessionId / eventId / artifactId）

```typescript
class ExecutionIdentity {
  static generate(prefix: string): string      // {prefix}_{YYYYMMDD}_{shortUUID}
  createExecutionId(): string                  // exe_20260707_a81f92cd
  createTraceId(): string                      // trc_20260707_b72e83df
  createSessionId(): string                    // ses_20260707_c63f94e1
  createEventId(): string                      // evt_20260707_d54fa5b2
  createArtifactId(): string                   // art_20260707_e43fb6c3
  create(options?): ExecutionIdentityType      // 完整 Identity 对象
  link(parentId: string, childId: string): void // 记录父子执行关系
  getChain(childId: string): string[]          // 回溯全路径 [root, ..., child]
  parse(id: string): ParsedId | null           // 解析 ID 结构
  isValid(id: string): boolean
  getType(id: string): string | null
  getDate(id: string): string | null
  clearChains(): void
}
```

### 2.5 ModelRegistry

- **文件**: `packages/core/core/ModelRegistry.ts`
- **导出**: `listProviders`, `listModels`, `listAllProviders`, `findModel`, `getDefaultModel`
- **职责**: pi-ai 模型运行时发现

```typescript
listProviders(): string[]
listModels(provider: string): ModelInfo[]
listAllProviders(): ProviderInfo[]
findModel(modelId: string): ModelInfo | undefined
getDefaultModel(): ModelInfo   // 默认 deepseek-v4-flash
```

### 2.6 ThinkingLevelControl

- **文件**: `packages/core/core/ThinkingLevelControl.ts`
- **导出**: `THINKING_LEVELS`, `THINKING_LEVEL_LABELS`, `DEFAULT_THINKING_LEVEL`, `getSupportedLevels`, `clampLevel`, `parseThinkingLevel`, `clearModelCache`
- **职责**: pi-ai 推理深度控制 (minimal → low → medium → high → xhigh)

### 2.7 Types

- **文件**: `packages/core/core/types.ts`
- **导出接口**: `MorPexEvent`, `ExecutionIdentity`, `ExecutionRequest`, `ExecutionResult`, `ExecutionContext`, `Constraints`, `RuntimeHealth`, `KernelStatus`, `AgentRuntimeAdapter`, `ExecutionTrace`, `ContextSnapshot`, `SnapshotType`, `MirrorStats`, `MirrorRecord`, `MirrorStorage`, `EventHandler`, `MorPexPlugin`, `PluginContext`, `EventBus`, `KernelConfig`

---

## 三、服务层 (Services)

### 3.1 AgentService

- **文件**: `packages/core/services/AgentService.ts`
- **导出**: `AgentService`, `AgentServiceOptions`
- **职责**: AgentHarness 实例生命周期管理（按 zone 区分）

```typescript
class AgentService {
  constructor(options?: AgentServiceOptions)
  createHarness(zone: string, tools?: AgentTool[], systemPrompt?: string): Promise<AgentHarness>
  getHarness(zone: string): AgentHarness | undefined
  dispose(zone: string): Promise<void>
  disposeAll(): Promise<void>
  getEnv(): NodeExecutionEnv
  getModel(): Model<any>
  getActiveZones(): string[]
}
```

### 3.2 LLMProvider

- **文件**: `packages/core/services/LLMProvider.ts`
- **导出**: `LLMProvider`, `LLMCaller`
- **职责**: LLM 调用函数注册中心（v2: AsyncLocalStorage 上下文隔离）

```typescript
LLMProvider = {
  set(caller: LLMCaller): void                      // 全局注册
  get(): LLMCaller                                  // 从上下文获取
  run<T>(caller: LLMCaller, fn: () => T): T         // 在上下文中执行
  isRegistered(): boolean
  reset(): void
}
```

**优先级**: AsyncLocalStorage 上下文 > 全局降级单例

---

## 四、网关层 (Gateway)

### 4.1 ExecutionGateway

- **文件**: `packages/core/gateway/ExecutionGateway.ts`
- **导出**: `ExecutionGateway`
- **职责**: 统一执行网关，管理运行时适配器，路由 agentRole → adapter

```typescript
class ExecutionGateway {
  constructor(eventBus: EventBus, identity?: ExecutionIdentity)
  registerAdapter(name: string, adapter: AgentRuntimeAdapter, setAsDefault?: boolean): void
  unregisterAdapter(name: string): boolean
  getAdapterNames(): string[]
  execute(agentRole: string, request: ExecutionRequest): Promise<ExecutionResult>
  abort(executionId: string): Promise<void>
  health(): Record<string, RuntimeHealth>
  getDefaultAdapter(): string | null
}
```

### 4.2 PiAdapter

- **文件**: `packages/core/gateway/adapters/PiAdapter.ts`
- **导出**: `PiAdapter`, `PiAdapterConfig`
- **职责**: pi AgentRuntime → AgentRuntimeAdapter 适配器，桥接 pi 事件到 EventBus

```typescript
class PiAdapter implements AgentRuntimeAdapter {
  constructor(runtime: PiAgentRuntime, eventBus: EventBus, config?: PiAdapterConfig, identity?: ExecutionIdentity)
  execute(request: ExecutionRequest): Promise<ExecutionResult>
  abort(executionId: string): Promise<void>
  subscribe(handler: EventHandler): () => void
  health(): RuntimeHealth
  dispose(): void
}
```

**事件桥接**: 监听 pi 的 tool.started/completed/failed, agent.start/end/error, plan.created, dag.created, task.started/completed，映射为 MorPexEvent 后重发射到 EventBus。

---

## 五、镜像系统 (Mirror)

### 5.1 ExecutionMirror

- **文件**: `packages/core/mirror/ExecutionMirror.ts`
- **导出**: `ExecutionMirror`
- **职责**: 订阅 EventBus 的 runtime.* 事件，写入 MirrorStorage（observer 模式）

```typescript
class ExecutionMirror {
  constructor(storage: MirrorStorage)
  start(subscribeFn: (type: string, handler: (event: MorPexEvent) => void) => () => void): void
  stop(): void
  getStats(): MirrorStats
  query(executionId: string): Promise<MirrorRecord[]>
  isRunning(): boolean
}
```

### 5.2 JSONLStorage

- **文件**: `packages/core/mirror/storage/JSONLStorage.ts`
- **导出**: `JSONLStorage`
- **职责**: JSONL 文件存储实现（executions.jsonl / events.jsonl / snapshots.jsonl）

```typescript
class JSONLStorage implements MirrorStorage {
  constructor(basePath?: string)                    // 默认 ./data/mirror
  initialize(): Promise<void>
  append(record: MirrorRecord): Promise<void>
  query(executionId: string): Promise<MirrorRecord[]>
  getStats(): MirrorStats
  close(): Promise<void>
}
```

### 5.3 MirrorStorage 接口

- **文件**: `packages/core/mirror/storage/types.ts`
- **职责**: 存储后端接口定义

---

## 六、领域系统 (Domains)

### 6.1 DomainManifest (类型)

- **文件**: `packages/core/domains/types.ts`
- **导出**: `DomainManifest`, `MasterAgentConfig`, `ArtifactSpec`, `WakeConditions`, `ClusterStatusReport`, `ClusterStatus`, `DAGNode`, `TaskDecomposition`, `DecomposedTask`, `ArtifactRef`, `DomainTaskCompletedEvent`, `InterrogationTicket`, `TicketRound`, `TicketStatus`, `ConflictType`, `ValidationResult`, `ValidationError`

```typescript
interface DomainManifest {
  domain_id: string                  // 唯一标识
  domain_name: string                // 显示名称
  version: string                    // semver
  master_agent_config: MasterAgentConfig
  subscribed_events: string[]
  skills: string[]
  output_artifacts: ArtifactSpec[]
  wake_conditions: WakeConditions
}
```

### 6.2 DomainCluster

- **文件**: `packages/core/domains/DomainCluster.ts`
- **导出**: `DomainCluster`
- **职责**: 单个领域集群管理（Master Agent + Skill 工具池），支持 sleeping → waking → active → draining 生命周期

```typescript
class DomainCluster {
  constructor(manifest: DomainManifest, deps?)
  wake(): Promise<void>                              // 创建 AgentHarness + 加载 Skills
  sleep(): Promise<void>                             // 中止并释放资源
  execute(message: string): Promise<any>             // 向 Master Agent 发送消息
  decomposeSingleIntent(userInput: string, globalIntent: string): Promise<any[]>
  decomposeSubIntent(userInput: string): Promise<any[]>

  // v2.4: Cgroup
  spawnSubAgent(params: { name, description, prompt, harness }): AgentHarness
  setTokenQuota(quota: number): void
  consumeTokens(amount: number): boolean
  resetTokens(): void
  hasAvailableTokens(estimatedTokens: number): boolean

  // 查询
  getStatusReport(): ClusterStatusReport
  getSkillNames(): string[]
  manifest: DomainManifest
  status: ClusterStatus
  master: AgentHarness | null
  skillPool: Map<string, AgentTool>
  taskCount: number
  uptime: number
  tokenQuota: number
  usedTokens: number
}
```

**Cgroup (v2.4)**: `tokenQuota` + `usedTokens` 配额管理，`spawnSubAgent()` 做配额检查 + 工具继承。

### 6.3 DomainClusterManager

- **文件**: `packages/core/domains/DomainClusterManager.ts`
- **导出**: `DomainClusterManager`, `LLMCaller`
- **职责**: 管理所有 DomainCluster 的注册、唤醒、休眠、查询、意图匹配

```typescript
class DomainClusterManager {
  constructor(config?)
  register(manifest: DomainManifest): DomainCluster
  unregister(domainId: string): Promise<boolean>
  registerMultiple(manifests: DomainManifest[]): DomainCluster[]
  wake(domainId: string): Promise<void>
  sleep(domainId: string): Promise<void>
  sleepAll(): Promise<void>
  execute(domainId: string, message: string): Promise<any>
  findDomainByIntent(intent: string): Promise<DomainManifest | null>
  findDomainsByIntent(intent: string, threshold?: number): Promise<Array<{ manifest, score }>>
  getDomainContextText(): string
  getCluster(domainId: string): DomainCluster | undefined
  getActiveClusters(): DomainCluster[]
  getSleepingClusters(): DomainCluster[]
  getAllClusters(): DomainCluster[]
  getStatusReports(): ClusterStatusReport[]
  getRegisteredDomainIds(): string[]
  hasDomain(domainId: string): boolean
  activeCount: number
  registeredCount: number
}
```

**意图匹配**: 优先 LLM 语义匹配，回退关键词匹配。

### 6.4 DomainManifestLoader

- **文件**: `packages/core/domains/DomainManifestLoader.ts`
- **导出**: `DomainManifestLoader`
- **职责**: 从 `data/domains/*.json` 加载和验证领域清单

```typescript
class DomainManifestLoader {
  constructor(manifestsDir?: string)
  loadAll(): Promise<DomainManifest[]>
  load(domainId: string): Promise<DomainManifest | null>
  validate(manifest: DomainManifest): ValidationResult
  reloadAll(): Promise<DomainManifest[]>
  clearCache(): void
  loadedCount: number
  getCachedDomainIds(): string[]
  getManifestsDir(): string
}
```

---

## 七、路由系统 (Router)

### 7.1 CrossDomainRouter

- **文件**: `packages/core/router/CrossDomainRouter.ts`
- **导出**: `CrossDomainRouter`
- **职责**: 跨领域路由器 — 单次 LLM 调用进行领域识别 + 依赖拓扑分析

```typescript
class CrossDomainRouter {
  constructor(clusterManager: DomainClusterManager, systemPrompt?: string)
  dispatch(userInput: string): Promise<{ analysis, dag?, result?, needsClarification? }>
  decompose(input: string): Promise<TaskDecomposition>
  buildDAG(decomposition: TaskDecomposition): DAGNode[]
  validateAndRepair(decomposition: TaskDecomposition, availableDomains: DomainManifest[]): TaskDecomposition
}
```

**路由逻辑**: 单领域直通车 → 多领域 DAG 编排（拓扑排序）→ 需要澄清时返回追问问题。

### 7.2 DomainDispatcher

- **文件**: `packages/core/router/DomainDispatcher.ts`
- **导出**: `DomainDispatcher`, `NodeResult`, `DAGExecutionResult`
- **职责**: 跨领域 DAG 执行调度器（依赖管理 + 并行执行 + 结果汇总）

```typescript
class DomainDispatcher {
  constructor(clusterManager: DomainClusterManager, maxParallel?: number)
  executeDAG(dag: DAGNode[]): Promise<DAGExecutionResult>
  executeNode(node: DAGNode): Promise<NodeResult>

  // 事件回调
  onNodeStart: ((node: DAGNode) => void) | null
  onNodeComplete: ((result: NodeResult) => void) | null
  onNodeFail: ((node: DAGNode, error: string) => void) | null
  onComplete: ((result: DAGExecutionResult) => void) | null
}
```

**执行策略**: 按就绪状态逐批执行节点，最大并行数控制，失败依赖自动阻塞，提前终止。

### 7.3 ArbitrationHandler

- **文件**: `packages/core/router/ArbitrationHandler.ts`
- **导出**: `ArbitrationHandler`, `ArbitrationVerdict`, `ArbitrationCallbacks`
- **职责**: 仲裁处理器 — 质询升级后等待人类裁决

```typescript
class ArbitrationHandler {
  constructor(callbacks?: ArbitrationCallbacks)
  escalate(ticket: InterrogationTicket): Promise<ArbitrationVerdict>
  resolve(ticketId: string, verdict): boolean
  autoResolve(ticketId: string, verdict): boolean
  getPendingArbitrations(): Array<{ ticket }>
  pendingCount: number
}
```

---

## 八、事件系统 (Events)

### 8.1 CrossDomainEvents

- **文件**: `packages/core/events/CrossDomainEvents.ts`
- **导出**: `CrossDomainEventTypes`, 9 种事件接口
- **职责**: 跨领域事件类型定义

**事件类型**:
| 类型 | 用途 |
|:--|:--|
| `domain.waking` | 领域正在唤醒 |
| `domain.active` | 领域已活跃 |
| `domain.sleeping` | 领域已休眠 |
| `domain.task_completed` | 领域任务完成 |
| `domain.error` | 领域错误 |
| `cross_domain.dag_created` | DAG 已创建 |
| `cross_domain.artifact_shared` | 领域间产物流转 |
| `artifact.created` | 产物创建 |
| `artifact.updated` | 产物更新 |

### 8.2 EventStore (v2.4)

- **文件**: `packages/core/event/EventStore.ts`
- **导出**: `EventStore`, `SourcingEvent`, `ReplayState`
- **职责**: Event Sourcing 持久化 — 每次状态变迁追加 JSONL，重启时可重放重建状态

```typescript
class EventStore {
  constructor(logPath?: string)                           // 默认 ./data/events/event-store.jsonl
  append(event: SourcingEvent): Promise<void>
  appendSync(event: SourcingEvent): void                 // 同步版本
  replay(executionId?: string): Promise<ReplayState>
  query(executionId: string): Promise<SourcingEvent[]>
  queryByType(type: SourcingEvent['type'], limit?: number): Promise<SourcingEvent[]>
  getStats(): Promise<{ totalEvents, fileSizeBytes, eventTypeCounts }>
  clear(): Promise<void>
}
```

**事件类型 (8 种)**: `tool_call_state_change`, `fsm_transition`, `artifact_created`, `artifact_updated`, `negotiation_ticket_created`, `negotiation_ticket_resolved`, `worker_spawned`, `worker_terminated`, `dag_node_status_change`

---

## 九、协商系统 (Negotiation)

### 9.1 NegotiationEngine

- **文件**: `packages/core/negotiation/NegotiationEngine.ts`
- **导出**: `NegotiationEngine`, `CreateTicketParams`, `NegotiationEngineConfig`, `NegotiationCallbacks`
- **职责**: 质询工单生命周期管理 — 领域间结构化协商

```typescript
class NegotiationEngine {
  static readonly MAX_DEPTH = 3

  constructor(config?: NegotiationEngineConfig, callbacks?: NegotiationCallbacks)
  createTicket(params: CreateTicketParams): InterrogationTicket
  respond(ticketId: string, action: TicketRound['action'], message: string): InterrogationTicket
  getTicket(ticketId: string): InterrogationTicket | undefined
  getActiveTickets(): InterrogationTicket[]
  getTicketsByDomain(domainId: string): InterrogationTicket[]
  shouldEscalate(ticket: InterrogationTicket): boolean
  isDuplicateChallenge(artifactId: string, hash: string): boolean
  getStats(): { totalTickets, activeTickets, escalatedTickets, resolvedTickets, activePairs }

  // v2.4: 震荡熔断
  escalateToArbitration(ticket: InterrogationTicket): Promise<ArbitrationPrompt>
}
```

**防死循环四闸门**:
1. 深度硬限制 (MAX_ALIGN_ROUNDS = 3)
2. 资产快照比对 (Context Hash Check)
3. 全局限流（每对领域最多 1 个活跃工单）
4. 语义震荡熔断 → 自动升级为中央仲裁 (REQUIRE_USER_CONFIRM)

**协商流程**: 发起质询 → 目标回应 → 接受/反驳/升级 ↺（depth_count ≤ MAX_DEPTH）

---

## 十、安全与防御 (v2.4)

### 10.1 PermissionEngine

- **文件**: `packages/core/permission/PermissionEngine.ts`
- **导出**: `PermissionEngine`, `PermissionMode`, `PermissionRule`
- **职责**: 5 种权限模式，在工具调用前按 deny → ask → allow → mode 优先级裁决

```typescript
type PermissionMode = 'default' | 'explore' | 'accept_edits' | 'bypass' | 'dont_ask'

interface PermissionRule {
  toolName: string
  pattern?: string            // glob 模式匹配
  behavior: 'allow' | 'deny' | 'ask'
}

class PermissionEngine {
  constructor(mode?: PermissionMode, rules?: PermissionRule[], workingDirs?: string[])
  setMode(mode: PermissionMode): void
  addRule(rule: PermissionRule): void
  setWorkingDirs(dirs: string[]): void
  check = async (ctx: BeforeToolCallContext, signal?: AbortSignal): Promise<BeforeToolCallResult | undefined>
}
```

**模式行为**:

| 模式 | 行为 |
|:--|:--|
| `default` | 所有操作需用户确认 |
| `explore` | 只读工具放行，写操作阻止 |
| `accept_edits` | 工作区内放行，工作区外阻止 |
| `bypass` | 全自动放行 |
| `dont_ask` | 全自动阻止 |

### 10.2 ToolExecutionProxy

- **文件**: `packages/core/tool/ToolExecutionProxy.ts`
- **导出**: `ToolExecutionProxy`, `ToolExecutionTimeoutError`
- **职责**: Worker 隔离执行器 — 超时/内存超限自动 terminate

```typescript
class ToolExecutionProxy {
  constructor(config?: Partial<WorkerConfig>)
  execute(toolCallId: string, toolName: string, args: unknown, workingDir: string, onProgress?): Promise<AgentToolResult>
  abortAll(): Promise<void>
}
```

**防护**: 硬超时 (默认 120s) → terminate, 内存上限 (512MB) → terminate, 降级重试一次。

### 10.3 extractJson 三级修复

- **文件**: `packages/core/utils/extractJson.ts`
- **导出**: `extractJson`, `extractJsonAsync`, `extractBraceJson`, `repairTruncatedJson`
- **职责**: 从 LLM 响应提取 JSON，三级修复策略

```typescript
extractJson(raw: string, options?: {
  repair?: boolean                // 默认 true，启用 Level 2
  retryWithLLM?: boolean          // 默认 false
  llmCaller?: (prompt: string) => Promise<string>
}): string | null

extractJsonAsync(raw: string, options?): Promise<string | null>  // 异步版支持 Level 3
```

**三级修复**:
- **Level 1**: 逐字符括号匹配（已有，提取完整 JSON）
- **Level 2**: `repairTruncatedJson()` — 截断补齐，找最后一个合法 key 补 }
- **Level 3**: `retryWithLLM()` — 带错误反馈的 1 次 LLM 重试

---

## 十一、执行流升级 (v2.4)

### 11.1 ToolCallTracker

- **文件**: `packages/core/tool/ToolCallTracker.ts`
- **导出**: `ToolCallTracker`, `ToolCallState`
- **职责**: 工具调用状态机 PENDING → ASKING → ALLOWED → EXECUTING → FINISHED

```typescript
type ToolCallState = 'PENDING' | 'ASKING' | 'ALLOWED' | 'EXECUTING' | 'FINISHED'

class ToolCallTracker {
  constructor(executionId: string, eventStore?: EventStore)
  transition(toolCallId: string, to: ToolCallState): void
  register(toolCallId: string, toolName: string): void
  onAgentEvent(event: AgentEvent): void                          // 自动从 AgentEvent 转换
  getState(toolCallId: string): ToolCallState
  getToolName(toolCallId: string): string | undefined
  getAll(): Map<string, ToolCallState>
  getExecutable(): Array<{ toolCallId, toolName }>               // ALLOWED 状态
  getAwaiting(): Array<{ toolCallId, toolName }>                 // PENDING | ASKING 状态
  hasExecutable(): boolean
  hasAwaiting(): boolean
  hasPending(): boolean
  hasExecuting(): boolean
  markAllowed(toolCallId: string): void
  getByState(state: ToolCallState): Array<{ toolCallId, toolName }>
  clear(): void
  size: number
}
```

### 11.2 CompactionPolicy

- **文件**: `packages/core/compaction/CompactionPolicy.ts`
- **导出**: `CompactionPolicy`, `estimateContextTokens`
- **职责**: 每次 LLM 调用前估算 token 数，超阈值自动触发 harness.compact()

```typescript
class CompactionPolicy {
  constructor(harness: AgentHarness, threshold?: number, keepRecent?: number)
  maybeCompact(messages: AgentMessage[]): Promise<void>
  hook = async (event: { messages }): Promise<{ messages }>     // 注册到 harness.on('context')
  getEstimate(messages: AgentMessage[]): number
}
```

**默认阈值**: 80K token 触发压缩，保留最近 16K token。

### 11.3 ToolResultOffloader

- **文件**: `packages/core/tool/ToolResultOffloader.ts`
- **导出**: `createOffloader`, `inlineOffloader`, `OffloaderConfig`
- **职责**: 超大 tool_result 存文件，上下文只留引用

```typescript
createOffloader(config?: Partial<OffloaderConfig>):
  (ctx: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>
```

**默认阈值**: >10,000 字符自动卸载到 `./data/offloaded/`。

### 11.4 FSMEngine SUSPENDED

- **文件**: `packages/core/planes/runtime-kernel/fsm/FSMEngine.ts`
- **导出**: `FSMEngine`, `SuspendedTask`
- **职责**: v2.4 新增 SUSPENDED 状态 + suspend/resume

新增方法:
```typescript
class FSMEngine {
  // SUSPENDED 状态管理
  suspend(taskId: string, sessionId: string, replyId: string, toolCalls: Array<{ id, name, args? }>): void
  resume(taskId: string, confirmResults: Array<{ toolCallId, confirmed }>): Promise<void>
  getSuspendedTask(taskId: string): SuspendedTask | undefined
  getAllSuspendedTasks(): SuspendedTask[]
  isSuspended: boolean

  // ToolCallTracker 集成
  setToolCallTracker(tracker: ToolCallTracker): void
  getToolCallTracker(): ToolCallTracker | null
  private _check_next_action(): 'acting' | 'exit' | 'reasoning' | 'unknown'

  // 新增回调
  onSuspended: ((task: SuspendedTask, ctx: FSMContext) => void) | null
  onResume: ((ctx: FSMContext) => void) | null
}
```

---

## 十二、多领域协同 (v2.4)

### 12.1 TeamSayTool

- **文件**: `packages/core/tool/TeamSayTool.ts`
- **导出**: `TeamSayTool`, `createTeamSayTool`, `AgentRegistry`
- **职责**: 领域间通信工具（UDP 语义，非阻塞），通过 harness.steer() 实现

```typescript
class TeamSayTool implements AgentTool {
  name = 'TeamSay'
  description = '向指定 Agent 发送消息'
  parameters = { to: string, message: string }
  constructor(registry: AgentRegistry, senderName: string)
  execute(toolCallId: string, params: { to, message }): Promise<AgentToolResult>
}
```

### 12.2 ReadArtifactTool

- **文件**: `packages/core/tool/ReadArtifactTool.ts`
- **导出**: `ReadArtifactTool`, `createReadArtifactTool`
- **职责**: 按需读取上游产物的指定章节（Lazy VFS）

```typescript
class ReadArtifactTool implements AgentTool {
  name = 'ReadArtifact'
  description = '按需读取上游产物的指定章节'
  parameters = { uri: string (artifact://{domain}/{type}/{id}), section?: string }
  constructor(registry: ArtifactRegistry)
  execute(toolCallId: string, params: { uri, section? }): Promise<AgentToolResult>
}
```

### 12.3 CollaborationHub

- **文件**: `packages/core/collaboration/CollaborationHub.ts`
- **导出**: `CollaborationHub`, `AlignmentResult`
- **职责**: 预对齐沙盒 — CrossDomainRouter 检测模糊双向依赖时的临时沙盒

```typescript
class CollaborationHub {
  constructor(participantIds: string[], maxRounds?: number, goal: string)
  registerParticipant(id: string, harness: any): void
  align(): Promise<AlignmentResult>
  extractConsensus(result: AlignmentResult): string
}
```

**对齐流程**: 每轮各参与方通过 harness.steer() 互发立场，检测收敛后结束。默认最多 3 轮。

### 12.4 SessionProjection

- **文件**: `packages/core/projection/SessionProjection.ts`
- **导出**: `SessionProjection`, `ProjectionParams`, `ProjectionRecord`, `ProjectionKind`
- **职责**: 跨域状态投影 — 子领域等待用户确认时，状态投影到父领域 SSE

```typescript
type ProjectionKind = 'subagent_hitl' | 'negotiation' | 'task_progress' | 'artifact_update' | 'error_notification'

class SessionProjection {
  constructor(eventBus: EventBus)
  project(params: ProjectionParams): Promise<ProjectionRecord>
  acknowledge(projectionId: string): void
  getProjection(projectionId: string): ProjectionRecord | undefined
  getProjectionsBySession(sessionId: string): ProjectionRecord[]
  getPendingProjections(targetSessionId?: string): ProjectionRecord[]
  getStats(): { total, acknowledged, pending }
  clear(): void
}
```

---

## 十三、记忆体系 (v2.4)

### 13.1 MemoryHooks

- **文件**: `packages/core/memory/MemoryHooks.ts`
- **导出**: `createAutoMemoryHook`, `createReasoningMemoryHook`, `MemoryBus`
- **职责**: 自动写回 + 推理时记忆注入

```typescript
interface MemoryBus {
  remember(params: { content, source, sourceId, tags, importance }): Promise<void>
  recall(params: { text, topK }): Promise<string[]>
}

// 4.1 自动写回 — harness.subscribe → agent_end
createAutoMemoryHook(memoryBus: MemoryBus, executionId?: string, domainId?: string):
  (event: AgentEvent) => void

// 4.2 推理注入 — harness.on('context') 检索记忆
createReasoningMemoryHook(memoryBus: MemoryBus, topK?: number):
  (event: { messages }) => Promise<{ messages }>
```

### 13.2 MemoryMessages

- **文件**: `packages/core/memory/MemoryMessages.ts`
- **导出**: `convertMemoryHintToLlm`, `convertDagNodeStatusToLlm`, `createCustomConvertToLlm`, `isMemoryHintMessage`, `isDagNodeStatusMessage`
- **职责**: 声明合并扩展 CustomAgentMessages + convertToLlm 工具函数

**扩展的消息类型**:
- `memoryHint`: 记忆注入提示 (role: 'memoryHint')
- `dagNodeStatus`: DAG 节点状态更新 (role: 'dagNodeStatus')

---

## 十四、运行时平面 (Runtime Kernel)

### 14.1 FSMEngine

- **文件**: `packages/core/planes/runtime-kernel/fsm/FSMEngine.ts`
- **类型**: `packages/core/planes/runtime-kernel/fsm/types.ts`
- **导出**: `FSMEngine`, `SuspendedTask`, `FSMState`, `FSMEvent`, `FSMContext`, `ExternalEvent`, `FSMEngineConfig`, `FSMPiStage`
- **职责**: 任务生命周期状态机（集成 pi-agent-core AgentHarness）

**状态**: IDLE → PLANNING → RUNNING → WAITING_TOOL/WAITING_USER/SUSPENDED/VERIFYING → COMPLETED/FAILED/CANCELLED

**v2.4 新增**: SUSPENDED 状态 + suspend/resume + ToolCallTracker 集成 + `_check_next_action()` 动态调度

### 14.2 DAGEngine

- **文件**: `packages/core/planes/runtime-kernel/dag/DAGEngine.ts`
- **类型**: `packages/core/planes/runtime-kernel/dag/types.ts`
- **导出**: `DAGEngine`
- **职责**: DAG 构建、验证、执行，支持重路由、重试、变更历史

```typescript
class DAGEngine {
  constructor(config?: DAGEngineConfig)
  addNode(node: DAGNode): boolean
  addNodes(nodes: DAGNode[]): void
  insertAfter(afterNodeId: string, newNode: DAGNode): boolean
  removeNode(nodeId: string): boolean
  rerouteNode(nodeId: string, alternateId?: string): boolean
  getReadyNodes(): DAGNode[]
  getNextBatch(): DAGNode[]
  startNode(nodeId: string): boolean
  completeNode(nodeId: string, result?): boolean
  failNode(nodeId: string, error: string): boolean
  isComplete(): boolean
  getNode(nodeId: string): DAGNode | undefined
  getAllNodes(): DAGNode[]
  validate(): ValidationResult
  hasCycle(): boolean
  topologicalSort(): DAGNode[]
  getStatus(): DAGStatus
  buildFromTasks(tasks): void
  reset(): void
  clear(): void
}
```

### 14.3 ExecutionGraph

- **文件**: `packages/core/planes/runtime-kernel/execution-graph/ExecutionGraph.ts`
- **类型**: `packages/core/planes/runtime-kernel/execution-graph/types.ts`
- **导出**: `ExecutionGraphEngine`
- **职责**: DAG 的运行时对偶 —— DAG 是计划，Execution Graph 是实际

```typescript
class ExecutionGraphEngine {
  constructor(config?)
  startExecution(executionId: string, dagId: string, goal: string): ExecutionGraph
  completeExecution(executionId: string, success: boolean): void
  createNode(executionId: string, overrides): ExecGraphNode
  updateNodeStatus(executionId: string, nodeId: string, newStatus, data?): void
  recordRetry(executionId: string, dagNodeId, name, attempt, error): ExecGraphNode
  recordHumanReview(executionId: string, dagNodeId, name, approved): ExecGraphNode
  createEdge(executionId: string, from, to, reason): ExecGraphEdge
  getGraph(executionId: string): ExecutionGraph | undefined
  getNodeInstances(executionId: string, dagNodeId): ExecGraphNode[]
  getActiveGraphs(): ExecutionGraph[]
  getAllGraphs(): ExecutionGraph[]
  getStats(): ExecGraphStats
  clear(): void
}
```

### 14.4 SchedulerEngine

- **文件**: `packages/core/planes/runtime-kernel/scheduler/SchedulerEngine.ts`
- **类型**: `packages/core/planes/runtime-kernel/scheduler/types.ts`
- **导出**: `SchedulerEngine`
- **职责**: 全局任务调度（优先级队列 + 并发控制 + 背压检测）

```typescript
class SchedulerEngine {
  constructor(config?: SchedulerEngineConfig)
  enqueue(task: Omit<SchedulerTask, 'state' | 'createdAt'>): 'enqueued' | 'rejected'
  startTask(taskId: string): boolean
  completeTask(taskId: string, result?): boolean
  failTask(taskId: string, error: string): boolean
  cancelTask(taskId: string): boolean
  getStats(): SchedulerStats
  getQueuedTasks(): SchedulerTask[]
  getRunningTasks(): SchedulerTask[]
  getCompletedTasks(): SchedulerTask[]
  getTask(taskId: string): SchedulerTask | undefined
  clear(): void
  queueDepth: number
  runningCount: number
  isIdle: boolean
}
```

**优先级算法**: `score = roi * w_roi + (1-cost) * w_cost + latency * w_latency`

---

## 十五、控制平面 (Control Plane)

### 15.1 IntentResolver

- **文件**: `packages/core/planes/control-plane/intent/IntentResolver.ts`
- **类型**: `packages/core/planes/control-plane/intent/types.ts`
- **导出**: `IntentResolver`
- **职责**: 意图分类 + 置信度评估（directive / query / ambiguous / chat）

```typescript
class IntentResolver {
  constructor(config?: { model?, systemPrompt? })
  resolve(input: string): Promise<IntentResult>
}
```

**决策逻辑**: ≥0.85 直接执行, 0.6–0.85 需澄清, <0.6 拒绝

### 15.2 WorkflowPlanner

- **文件**: `packages/core/planes/control-plane/planner/WorkflowPlanner.ts`
- **类型**: `packages/core/planes/control-plane/planner/types.ts`
- **导出**: `WorkflowPlanner`
- **职责**: 规划器 — 从 IntentResult 生成 Plan + ArtifactBlueprint[] + Task[]

```typescript
class WorkflowPlanner {
  constructor(config?)
  plan(intent: IntentResult): Promise<Plan>
}
```

### 15.3 ArtifactBlueprint

- **文件**: `packages/core/planes/control-plane/planner/ArtifactBlueprint.ts`
- **导出**: `createBlueprint`, `BlueprintTemplates`, `sortBlueprintsByDeps`
- **职责**: 产物蓝图工厂（计划阶段的产物声明）

---

## 十六、知识平面 (Knowledge Plane)

### 16.1 ArtifactRegistry

- **文件**: `packages/core/planes/knowledge-plane/artifacts/ArtifactRegistry.ts`
- **类型**: `packages/core/planes/knowledge-plane/artifacts/types.ts`
- **导出**: `ArtifactRegistry`, `ArtifactURIResult`
- **职责**: Artifact 注册中心（v2: 支持 URI 引用）

```typescript
class ArtifactRegistry {
  static readonly URI_SCHEME = 'artifact://'

  constructor(config?: ArtifactPluginConfig)
  register(artifact: ArtifactInstance, domainId?: string): void
  update(artifact: ArtifactInstance, changeLog?: string): void
  get(id: string): ArtifactInstance | undefined
  search(query: ArtifactQuery): ArtifactInstance[]
  getAll(): ArtifactInstance[]
  getVersions(artifactId: string): ArtifactVersion[]
  createRelation(from: string, to: string, type: ArtifactRelation): void
  getRelations(artifactId: string): ArtifactRelationRecord[]
  getGraph(artifactId: string): { parents, children, supersedes }
  static buildURI(domain: string, artifactType: string, artifactId: string): string
  static parseURI(uri: string): ArtifactURIResult | null
  resolve(uri: string): ArtifactInstance | undefined
  listByDomain(domainId: string): ArtifactInstance[]
  saveToDisk(): Promise<void>
  loadFromDisk(): Promise<{ artifacts, relations }>
  clear(): void
  getStatsByType(): Record<string, number>
  count: number

  // 静态工厂
  static createArtifact(overrides): ArtifactInstance
  static updateContent(artifact, newContent): ArtifactInstance
  static changeStatus(artifact, newStatus): ArtifactInstance
}
```

**URI 格式**: `artifact://{domain}/{artifactType}/{artifactId}`

### 16.2 KnowledgeGraph

- **文件**: `packages/core/planes/knowledge-plane/knowledge/KnowledgeGraph.ts`
- **类型**: `packages/core/planes/knowledge-plane/knowledge/types.ts`
- **职责**: 知识图谱引擎 — 整合 Agent/Task/Artifact/Decision/Memory 统一视图

### 16.3 VectorStore

- **文件**: `packages/core/planes/knowledge-plane/memory/VectorStore.ts`
- **类型**: `packages/core/planes/knowledge-plane/memory/types.ts`
- **职责**: zvec 向量存储集成（Embedding Server + zvec upsert/query）

---

## 十七、智能体平面 (Agent Plane)

### 17.1 SwarmEngine

- **文件**: `packages/core/planes/agent-plane/swarm/SwarmEngine.ts`
- **类型**: `packages/core/planes/agent-plane/swarm/types.ts`
- **导出**: `SwarmEngine`
- **职责**: 基于拍卖的多 Agent 调度引擎

```typescript
class SwarmEngine {
  constructor(config?: SwarmConfig)
  publishTask(task: { title, description, skills, budget? }): string  // 返回 auctionId
  submitBid(auctionId: string, agentId: string, bid: { confidence, price, duration }): boolean
  award(auctionId: string, agentId?: string): void                   // 授标
  getAuction(auctionId: string): TaskAuction | undefined
  getActiveAuctions(): TaskAuction[]
}
```

**评分算法**: `score = confidence * 0.4 + (1 - price/budget) * 0.3 + (1 - duration/maxDuration) * 0.3`

### 17.2 AgentOrchestrator

- **文件**: `packages/core/planes/agent-plane/orchestrator/AgentOrchestrator.ts`
- **类型**: `packages/core/planes/agent-plane/orchestrator/types.ts`
- **导出**: `AgentOrchestrator`
- **职责**: 多 Agent 编排引擎（CEO → Manager → Worker 层级结构）

---

## 十八、行业系统 (Industry)

### 18.1 IndustryRegistry

- **文件**: `packages/core/industry/IndustryRegistry.ts`
- **类型**: `packages/core/industry/types.ts`
- **导出**: `IndustryRegistry`
- **职责**: 行业适配器注册中心

**内置行业**: software / video / content / ecommerce（每个含 workflows + intentHints + suggestedTools + keywords）

```typescript
class IndustryRegistry {
  constructor(enabledIndustries?: IndustryType[])
  get(type: IndustryType): IndustryAdapter | undefined
  getAll(): IndustryAdapter[]
  getWorkflows(type: IndustryType): WorkflowTemplate[]
  getIntentHints(type: IndustryType): string[]
  getSuggestedTools(type: IndustryType): string[]
  getKeywords(type: IndustryType): string[]
  guessIndustry(input: string): { industry, confidence }
  getAllIntentHints(): string[]
}
```

---

## 十九、内置工具 (Builtin Tools)

### 19.1 createBuiltinTools

- **文件**: `packages/core/tools/builtin-tools.ts`
- **导出**: `createBuiltinTools`
- **职责**: 创建标准内置工具集（基于 ExecutionEnv）

| 工具名 | 参数 | 说明 |
|:--|:--|:--|
| `write_file` | `path`, `content` | 写入/覆盖文件 |
| `exec_command` | `command` | 执行 shell 命令 |
| `read_file` | `path` | 读取文件内容 |
| `list_dir` | `path` | 列出目录内容 |
| `search_code` | `pattern`, `path?` | 搜索代码文件 |
| `glob` | `pattern` | 文件 glob 匹配 |

### 19.2 artifact-registry-skill

- **文件**: `packages/core/tools/artifact-registry-skill.ts`
- **导出**: `createArtifactRegistrySkill`
- **职责**: Artifact 注册与查询的 AgentTool 封装

### 19.3 knowledge-graph-skill

- **文件**: `packages/core/tools/knowledge-graph-skill.ts`
- **导出**: `createKnowledgeGraphSkill`
- **职责**: 知识图谱查询的 AgentTool 封装

---

## 二十、工具函数 (Utils)

### 20.1 extractJson

- **文件**: `packages/core/utils/extractJson.ts`
- **导出**: `extractJson`, `extractJsonAsync`, `extractBraceJson`, `repairTruncatedJson`
- **职责**: 三级修复 JSON 提取（详见 10.3）

### 20.2 jsonl

- **文件**: `packages/core/utils/jsonl.ts`
- **导出**: `readJSONLLines`
- **职责**: 流式 JSONL 解析（容错跳过损坏行）

### 20.3 toposort

- **文件**: `packages/core/utils/toposort.ts`
- **导出**: `topologicalSort`
- **职责**: 通用拓扑排序（Kahn 算法），被 PluginSystem / CrossDomainRouter / DAGEngine / WorkflowPlanner / ArtifactBlueprint 复用

---

## 二十一、入口与导出

### 21.1 index.ts

- **文件**: `packages/core/index.ts`
- **导出**: 所有公开 API 的集中出口

```typescript
// 核心
export { MorPexKernel, createKernel } from './core/Kernel.js'
export { EventBus } from './core/EventBus.js'
export { PluginSystem } from './core/PluginSystem.js'
export { ExecutionIdentity } from './core/ExecutionIdentity.js'

// 网关
export { ExecutionGateway } from './gateway/ExecutionGateway.js'
export { PiAdapter } from './gateway/adapters/PiAdapter.js'

// 镜像
export { ExecutionMirror } from './mirror/ExecutionMirror.js'
export { JSONLStorage } from './mirror/storage/JSONLStorage.js'

// 模型与推理
export { listProviders, listModels, listAllProviders, findModel, getDefaultModel } from './core/ModelRegistry.js'
export { THINKING_LEVELS, THINKING_LEVEL_LABELS, DEFAULT_THINKING_LEVEL, ... } from './core/ThinkingLevelControl.js'

// 服务
export { AgentService } from './services/AgentService.js'

// 领域系统
export { DomainManifestLoader, DomainCluster, DomainClusterManager } from './domains/index.js'
export type { DomainManifest, MasterAgentConfig, ArtifactSpec, WakeConditions, ... } from './domains/types.js'

// 路由器
export { CrossDomainRouter } from './router/CrossDomainRouter.js'
export { DomainDispatcher } from './router/DomainDispatcher.js'
export { ArbitrationHandler } from './router/ArbitrationHandler.js'

// 事件
export { CrossDomainEventTypes } from './events/CrossDomainEvents.js'

// v2.4 新模块
export { PermissionEngine } from './permission/PermissionEngine.js'
export { EventStore } from './event/EventStore.js'
export { ToolCallTracker } from './tool/ToolCallTracker.js'
export { CompactionPolicy } from './compaction/CompactionPolicy.js'
export { createOffloader } from './tool/ToolResultOffloader.js'
export { TeamSayTool, createTeamSayTool } from './tool/TeamSayTool.js'
export { createReadArtifactTool } from './tool/ReadArtifactTool.js'
export { CollaborationHub } from './collaboration/CollaborationHub.js'
export { SessionProjection } from './projection/SessionProjection.js'
export { createAutoMemoryHook, createReasoningMemoryHook } from './memory/MemoryHooks.js'
export { convertMemoryHintToLlm, createCustomConvertToLlm, ... } from './memory/MemoryMessages.js'

// 协商
export { NegotiationEngine } from './negotiation/NegotiationEngine.js'

// 内置工具
export { createBuiltinTools } from './tools/builtin-tools.js'
export { createKnowledgeGraphSkill } from './tools/knowledge-graph-skill.js'
export { createArtifactRegistrySkill } from './tools/artifact-registry-skill.js'
```

### 21.2 bootstrap.ts

- **文件**: `packages/core/bootstrap.ts`
- **导出**: `bootstrapMorPexCore`
- **职责**: 端到端集成引导 — 挂载到现有 AgentRuntime 旁

```typescript
bootstrapMorPexCore(runtime: AgentRuntime, config?: BootstrapConfig): Promise<MorPexKernel>
```

---

## 模块关系图

```
用户输入
    │
    ▼
PiAdapter ───→ EventBus ←─── ExecutionMirror → JSONLStorage
    │               │
    ▼               ▼
ExecutionGateway  PluginSystem
    │               │
    ▼               ▼
IntentResolver ← IndustryRegistry
    │
    ▼
WorkflowPlanner → ArtifactBlueprint
    │
    ├── CrossDomainRouter → DomainClusterManager → DomainCluster
    │        │                    │
    │        ▼                    ▼
    │   DomainDispatcher     AgentHarness (pi-agent-core)
    │        │
    ▼        ▼
DAGEngine ←──┘  ←── FSMEngine
    │
    ▼
ExecutionGraph ←── SchedulerEngine
    │
    ▼
SwarmEngine / AgentOrchestrator → AgentService
    │
    ▼
ToolExecutionProxy → PermissionEngine → ToolCallTracker
    │
    ▼
ToolResultOffloader / CompactionPolicy / EventStore
```

---

*此文档由 MorPex v2.4 升级后自动生成，覆盖 `packages/core/` 全部 83 个源文件。*
