# MorPex v9.2 — Data Flow Reference

> **453 源文件 | 26 SQLite 表 | tsc 0 errors | 25/32 测试通过**
>
> 本文档记录所有核心数据流，涵盖 Cognitive Pipeline、Agent 协作、持久化、容错等路径。

---

## 1. Cognitive Pipeline 主流程

```
USER_MESSAGE_RECEIVED Event
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ CognitivePipeline.process(message)                                      │
│                                                                         │
│  [ErrorHandlerService.executeWithRecovery] — 可选熔断+重试保护            │
│                                                                         │
│  ├── Stage 0: ContextStage                                              │
│  │   └─ ContextAssemblyEngine.assemble({missionId, userId, tags})       │
│  │      ├─ 1. selectTemplate() — default | quick-task | deep-research    │
│  │      ├─ 2. collectFragmentsWithTimeout() — 从注册 Provider 采集       │
│  │      │  └─ fallback: generateFallbackFragment() — 自动创建默认值      │
│  │      ├─ 3. ContextBuilder — 三层: base + session + ephemeral         │
│  │      ├─ 4. ContextEnricherPipeline — 插件式增强                       │
│  │      ├─ 5. ContextVersioner.snapshot() — 版本快照                     │
│  │      └─ 6. ContextPersistence.save() — 写入 context_snapshots 表     │
│  │   └─ emit(CONTEXT_ASSEMBLED)                                        │
│  │                                                                      │
│  ├── Stage 1: IntentStage                                              │
│  │   └─ detectIntent() → {goal:'', keywords:[], confidence:0.0}        │
│  │   └─ emit(INTENT_DETECTED)                                          │
│  │                                                                      │
│  ├── Stage 2: GoalStage                                                │
│  │   └─ GoalManager.match(Jaccard) → matchedGoals[]                     │
│  │   └─ emit(GOAL_MATCHED)                                             │
│  │                                                                      │
│  ├── Stage 3: TwinStage                                                │
│  │   └─ BehaviorTwin.getLatest() + DecisionTwin.analyze()              │
│  │   └─ emit(TWIN_RETRIEVED)                                           │
│  │                                                                      │
│  ├── Stage 4: PlanningStage                                            │
│  │   └─ MetaPlannerAdapter.createMission() → MissionRuntime            │
│  │   └─ emit(PLAN_CREATED)                                             │
│  │                                                                      │
│  ├── Stage 5: ExecutionStage                                           │
│  │   └─ MissionRuntime.executeMission()                                │
│  │      ├─ ContractValidator.validate() — 契约验证                      │
│  │      ├─ PermissionModel.canExecute() — 权限检查                      │
│  │      ├─ BudgetManager.reserve() — 预算预留                           │
│  │      ├─ SandboxManager.execute() — 沙箱隔离执行                      │
│  │      ├─ AgentScheduler.selectAgent() — Agent 分配                    │
│  │      ├─ VerificationEngine.verify() — 产物验证                       │
│  │      ├─ ArtifactLineage.track() — 两阶段提交血缘追踪                  │
│  │      ├─ CompensationEngine — Saga 补偿 (失败时逆序回滚)               │
│  │      ├─ TraceManager — 全链路追踪                                    │
│  │      └─ MetricsCollector.record() — 指标收集                         │
│  │   └─ emit(EXECUTION_COMPLETED)                                      │
│  │   └─ SqliteEventStore.append(event) → events 表                     │
│  │                                                                      │
│  ├── Stage 6: LearningStage                                            │
│  │   └─ EvidenceAggregator — 从 Mission result 收集 RawObservation      │
│  │   │  ├─ record('riskTolerance', level, sourceEvent)                 │
│  │   │  └─ record('taskDecomposition', level, sourceEvent)             │
│  │   ├─ aggregate(currentProfile) → TwinCandidate[] (consensus>0.7)    │
│  │   │  └─ pendingCandidates.push() 等待人工审批                         │
│  │   ├─ 可选: EventStore.appendDecision() → events_decision 表         │
│  │   └─ emit(MEMORY_UPDATED)                                           │
│  │   ⚠️ CrossAgentLearningEngine 未接入本流程                            │
│  │                                                                      │
│  ├── Stage 7: EvolutionStage                                           │
│  │   ├─ WorkflowMiner.mine() — 挖掘候选工作流                           │
│  │   ├─ WorkflowSimulator.dryRun() — 仿真质量评分                       │
│  │   ├─ PolicyEngine.evaluateWorkflow() — 策略判断                      │
│  │   └─ WorkflowRegistry.register()                                     │
│  │   └─ emit(WORKFLOW_CREATED)                                         │
│  │                                                                      │
│  └── Stage 8: PersistenceStage                                         │
│      └─ BrainPersistor.persist() → MemoryWiki(SQLite)                  │
│      └─ emit(MEMORY_PERSISTED)                                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
    │
    ▼
OutgoingMessage → User
```

---

## 2. Agent 调度与协作流

```
Mission DAG Task
    │
    ▼
┌─────────────────────────────────────────────────┐
│ AgentScheduler.selectAgent(task)                 │
│  ├─ CapabilityGraph.match(capabilities)          │
│  ├─ AgentRanking.score(profiles)                 │
│  │  score = capabilityScore × reliability × price│
│  ├─ AssignmentStrategy.select()                  │
│  │  ⚠️ OrganizationPolicyEngine.evaluate() 未接入  │
│  └─ → AgentAssignment {agentId, score, reason}    │
└─────────────────────┬───────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│ AgentMessageBus.request(to, payload, timeout)    │
│  ├─ subscribe(response handler)                  │
│  ├─ send(REQUEST message)                        │
│  └─ wait: Promise.race(timeout, response)        │
└─────────────────────┬───────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│ AgentWorker.execute(taskContext)                  │
│  ├─ AgentMemoryIsolation.readPrivate()            │
│  ├─ SandboxManager.execute() — 隔离执行           │
│  ├─ ⚠️ SharedMemoryManager.acquireLock() 未接入   │
│  └─ → Result + duration                          │
└─────────────────────┬───────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│ Post-execution (AgentBootstrap loop)              │
│  ├─ AgentProfileManager.recordSuccess/Failure     │
│  ├─ AgentCapabilityEvolution.update()             │
│  ├─ AgentAutoOptimizer.optimize()                 │
│  ├─ ⚠️ AgentGovernanceRepository 未注入           │
│  └─ AgentLifecycle.evaluate() → status change?   │
└─────────────────────────────────────────────────┘
```

---

## 3. 多 Agent 协作流

```
Mission (需要多 Agent 协作)
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│ CollaborationManager.execute(plan)                        │
│  ├─ mode: sequential | parallel | voting | pipeline      │
│  ├─ ⚠️ TeamFormationEngine.formTeam() 未接入 — 手动组队   │
│  ├─ for each task:                                       │
│  │   ├─ AgentScheduler.selectAgent()                     │
│  │   ├─ AgentMessageBus.request(to, payload, timeout)    │
│  │   └─ fail → handleAgentFailure → replaceAgent         │
│  ├─ ⚠️ SharedMemoryManager 未接入 — 无协调内存            │
│  └─ ResultAggregator.aggregate() — 合并输出               │
└──────────────────────────────────────────────────────────┘
```

### 团队组建 (理想流, 代码存在但未接入)

```
TeamFormationEngine.formTeam(spec)
  ├─ CapabilityGraph.match(requiredCapabilities)
  ├─ AgentRanking.score(candidates)
  ├─ RoleAssignmentStrategy.assign()
  ├─ TeamCompositionOptimizer.optimize()
  ├─ TeamLifecycleManager.create()
  └─ TeamSqliteRepository.createTeam() → agent_teams 表
```

---

## 4. Marketplace 竞价流 (代码存在，无运行时消费者)

```
Task 需要外部能力
    │
    ▼
MarketplaceRegistry.search(capability)
    ├─ 匹配 marketplace_listings 表
    └─ TrustVerifier.verify(thirdPartyAgent)
        │
        ▼
BidEngine.requestBids(request, listings)
    ├─ 策略: cheapest | fastest | most_reliable | balanced
    ├─ 候选 Agent 投标 → marketplace_bids 表
    └─ selectBest(bids) → 中标者
        │
        ▼
MarketplaceContract.create(provider, consumer, terms)
    ├─ 写入 marketplace_contracts 表
    ├─ ThirdPartyAgentAdapter.sandbox()
    └─ 执行 → 结算
```

---

## 5. 分布式运行时流 (代码存在，需配置启用)

```
Node A (本地)                    Node B (远程)
    │                                │
DistributedRuntimeManager            │
    ├─ 本地调度不足                    │
    ├─ DistributedScheduler           │
    │  .queryRemoteNodes()            │
    │        │                        │
    ▼        ▼                        │
AgentTransport.send() ───────────────► AgentTransport.receive()
    │   (gRPC 或 WebSocket)           │
    │                                 ▼
    │                           RemoteAgentProxy
    │                               ├─ AgentWorker.execute()
    │                               └─ AgentTransport.response()
    │                                    │
    ◄────────── receive() ───────────────┘
    │
    ▼
AgentMessageBus → CollaborationManager
```

---

## 6. 学习闭环流

### 当前: EvidenceAggregator (v8.7, CognitivePipeline 内建)

```
Mission Result
    │
    ▼
LearningStage.execute()
    ├─ 收集观察: riskTolerance, taskDecomposition
    ├─ EvidenceAggregator.aggregate() → TwinCandidate[]
    │  └─ 条件: consensusRatio>0.7 && totalObservations>=10
    ├─ pendingCandidates[] (待人工审批)
    └─ approveTwinCandidate() → BehaviorTwin 更新
```

### 未来: CrossAgentLearningEngine (v9.2, 待接入)

```
Mission/Decision/Collaboration Result
    │
    ▼ (待接入点: LearningStage)
CrossAgentLearningEngine.learnFromOutcome()
    ├─ KnowledgeDistiller.distillFromDecision/Mission/Collaboration()
    │  └─ → GeneralizedExperience[]
    ├─ mergeDuplicate() → 合并相似经验
    ├─ ExperienceRepository.store()
    ├─ LearningPropagationService.propagateToAll()
    └─ 后续注入: ExperienceMatcher.match() → PlanningStage/TwinStage
```

---

## 7. 持久化流 (所有写操作 → 同一 SQLite 库)

```
┌──────────────────────────────────────────────────────────────────────┐
│  SqliteEventStore (data/morpex-events.db, WAL mode, 26 tables)      │
│                                                                      │
│  Write paths:                                                        │
│                                                                      │
│  CognitivePipeline Stage 5                                           │
│  └─ ExecutionStage → EventStore.append(event) → events 表            │
│     ├─ ex: mission.created, mission.updated, mission.completed       │
│     └─ ex: agent.message.sent, tool.started, dag.node.completed     │
│                                                                      │
│  CognitivePipeline Stage 6                                           │
│  └─ LearningStage → EventStore.appendDecision() → events_decision 表 │
│                                                                      │
│  ContextStage                                                        │
│  └─ ContextAssemblyEngine → ContextPersistence.save()                │
│     → context_snapshots 表                                           │
│                                                                      │
│  ArtifactPlane                                                       │
│  └─ ArtifactManager.create/commit/archive → ArtifactSqliteRepository│
│     → artifacts_v2, artifact_versions_v2                             │
│     → artifact_dependencies_v2, artifact_staging_v2                  │
│                                                                      │
│  AgentBootstrap (AgentLifecycle loop)                                │
│  └─ ⚠️ AgentGovernanceRepository 未注入                              │
│     → agents, agent_capabilities, agent_governance_log 表 (空)       │
│                                                                      │
│  ⚠️ All other SqliteRepositories (Experience/Gov/Market/Dist/Team/   │
│     SharedMemory) — 代码存在但从未被任何管理器调用 → 对应表为空        │
│                                                                      │
│  Read paths:                                                         │
│  └─ EventStore.query({executionId, type, since, until})              │
│     — 参数化 SELECT + 复合索引 (5 个复合索引已创建)                   │
│                                                                      │
│  Maintenance:                                                        │
│  └─ CompactionService.compact()                                      │
│     — ⚠️ 未定时执行，需手动调用或 startAuto()                          │
│     ├─ pruneOldEvents() — 删除>30天事件                               │
│     ├─ pruneSnapshots() — 每 mission 保留 latest 20                  │
│     └─ VACUUM — 回收磁盘空间                                          │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 8. 容错流 (Resilience Layer)

```
operation()
    │
    ▼
┌────────────────────────────────────────────────────┐
│ ErrorHandlerService.executeWithRecovery<T>()        │
│                                                     │
│  CircuitBreaker.execute(fn)                         │
│  ├─ state = CLOSED? → 通过                          │
│  ├─ state = OPEN? → throw CircuitOpenError 立即拒绝  │
│  └─ state = HALF_OPEN? → 限制 N=1 个请求通过         │
│       │                                              │
│       ▼                                              │
│  Retry loop (0..maxAttempts)                         │
│  ├─ attempt=0: fn()                                  │
│  ├─ succeed? → CircuitBreaker.recordSuccess()       │
│  │  └─ CLOSED 累积成功                               │
│  ├─ fail? → CircuitBreaker.recordFailure()           │
│  │  ├─ failureCount >= threshold → OPEN             │
│  │  ├─ emit(ERROR_OCCURRED) via EventBus            │
│  │  └─ RetryPolicy.shouldRetry(error)?               │
│  │     ├─ yes → backoff(getDelay(attempt))          │
│  │     │  └─ 固定/线性/指数/抖动 退避策略             │
│  │     └─ no → 跳出循环                              │
│  └─ all attempts exhausted?                          │
│     └─ compensator(error)? → Saga 补偿               │
│        └─ CompensationEngine 逆序回滚                 │
│                                                     │
│  Final:                                              │
│  ├─ 成功 → return T                                  │
│  ├─ 失败 + 无补偿 → throw 原始 Error                  │
│  └─ 失败 + 补偿 → throw 新 Error (补偿已执行)          │
└────────────────────────────────────────────────────┘
```

### Backoff Strategies

| Strategy | Formula | Typical total (3 attempts, base=1s) |
|----------|---------|-------------------------------------|
| `fixed` | `baseDelay` | 3s |
| `linear` | `baseDelay * (attempt + 1)` | 6s |
| `exponential` | `baseDelay * 2^attempt` | 7s |
| `jitter` | `exponential + random(0, base)` | ~7.5s |

---

## 9. Observability 流

```
┌──────────────────────────────────────────────────────────────────┐
│  MetricsCollector (singleton)                                     │
│                                                                  │
│  record(name, value, tags)                                       │
│  ├─ task.latency / task.completed / task.failed                  │
│  ├─ team_formation.latency / team_formation.size                  │
│  ├─ shared_memory.conflict / shared_memory.writes                 │
│  ├─ marketplace.bid / marketplace.bid_won                         │
│  ├─ distributed.message_sent / distributed.latency                │
│  ├─ resilience.circuit_breaker_trip / resilience.retry            │
│  └─ context.missing_fragments                                     │
│                                                                  │
│  getV9Metrics() → V9Metrics                                      │
│  ├─ teamFormations {count, avgDurationMs, avgTeamSize}            │
│  ├─ sharedMemory {conflicts, conflictRate}                        │
│  ├─ marketplace {winRate}                                         │
│  ├─ distributed {avgLatencyMs}                                    │
│  └─ resilience {circuitBreakerTrips, compensationsRun}            │
│                                                                  │
│  ⚠️ PrometheusExporter — 已创建但 HTTP 端点未挂载                 │
│  ⚠️ HealthCheckService — 已创建但 HTTP 端点未挂载                 │
└──────────────────────────────────────────────────────────────────┘
```

---

## 10. 配置加载流

```
process.env
    │
    ▼
MorPexConfig (Zod v4 schema, 单例)
    │
    ├─ 14 个 legacy 参数 (modelProvider, eventLogPath 等)
    ├─ 6 个 v9 分组:
    │   ├─ persistence (dbPath, walMode, batchFlushSize, ...)
    │   ├─ agent (defaultTTL, maxConcurrentTasks, ...)
    │   ├─ context (enableVersioning, maxFragments, ...)
    │   ├─ artifact (enableAutoVerify, maxContentSize, ...)
    │   ├─ distributed (enabled, transportMode, heartbeatInterval, ...)
    │   └─ marketplace (enabled, bidTimeout, trustThreshold, ...)
    │
    ├─ 热重载: onChange(listener) → update(partial)
    │   ├─ listener(newConfig, oldConfig)
    │   └─ 返回 unsubscribe() 函数
    │
    └─ 便捷访问: config.persistence.dbPath, config.distributed.enabled
```

---

## Appendix: Orphaned Module Checklist

| 模块 | 接入需修改 | 优先级 |
|------|-----------|--------|
| `CrossAgentLearningEngine` | `LearningStage.execute()` — 末尾调用 `learnFromOutcome()` | P1 |
| `TeamFormationEngine` | `CollaborationManager.createPlan()` — 替换现有平面逻辑 | P2 |
| `OrganizationPolicyEngine` | `AgentScheduler.selectAgent()` — 投票前加 policy check | P2 |
| `SharedMemoryManager` | `CollaborationManager.execute()` — 写前锁、读后写 | P2 |
| `CompactionService` | `SqliteEventStore` 初始化后调用 `startAuto()` | P1 |
| `PrometheusExporter` | `StudioServer` 或 bootstrap 挂载 `/metrics` 路由 | P3 |
| `HealthCheckService` | `StudioServer` 挂载 `/health` 路由 | P3 |
| `SqliteRepositories` | 各 Manager 构造函数传入 `db` 参数 | P1 |
