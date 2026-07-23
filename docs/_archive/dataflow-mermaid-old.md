# MORPEX 后端数据流全链路

## 1. 系统组件总览

```mermaid
graph TB
    subgraph 入口层
        UI[Studio UI]
        API[REST API / SSE]
    end

    subgraph 传输层["studio/server"]
        SS[StudioServer]
        SM[SessionManager]
        AW[ArtifactWriter]
        SO[StudioOrchestrator]
    end

    subgraph 内核层["core"]
        KERNEL[MorPexKernel]
        EB[EventBus]
        EI[ExecutionIdentity]
        EG[ExecutionGateway]
        EM[ExecutionMirror]
        ES[EventStore]
        ESUB[EngineSubscriber]
        PS[PluginSystem]
    end

    subgraph 路由层["core/router"]
        CDR[CrossDomainRouter]
        DD[DomainDispatcher]
        NE[NegotiationEngine]
        AH[ArbitrationHandler]
    end

    subgraph 领域层["core/domains"]
        DML[DomainManifestLoader]
        DCM[DomainClusterManager]
        DC[DomainCluster × N]
    end

    subgraph 记忆层["memory"]
        MB[MemoryBus]
        MW[MemoryWiki]
        ZVEC[ZVecStorage]
        KG[KnowledgeGraph]
        AR[ArtifactRegistry]
        ECL[ECLCognifyEngine]
    end

    subgraph 引擎层["core/planes"]
        FSM[FSMEngine]
        DAG[DAGEngine]
        SCH[SchedulerEngine]
        SWARM[SwarmEngine]
        EXG[ExecutionGraphEngine]
        AO[AgentOrchestrator]
        IP[IntentPlugin]
        IND[IndustryPlugin]
    end

    subgraph 扩展层["core/extensions"]
        MP[MetaPlanner]
        PES[PlanExperienceStore]
        PE[PipelineExecutor]
    end

    subgraph 外部
        LLM[deepseek-v4-flash]
        PISDK[pi-agent-core]
    end

    UI -->|POST / SSE| API
    API --> SS
    SS --> SO
    SS --> SM
    SS --> AW
    SS --> KERNEL
    KERNEL --> EB
    KERNEL --> EG
    KERNEL --> EM
    EB --> ES
    EB --> ESUB
    SO --> CDR
    SO --> MB
    CDR --> LLM
    CDR --> DCM
    DD --> DCM
    DD --> NE
    NE --> AH
    DCM --> DC
    DCM --> DML
    DC --> PISDK
    PISDK --> LLM
    MB --> ZVEC
    MB --> KG
    MB --> MW
    MB --> ECL
    EB -->|onProjected| API
```

## 2. 主执行链路: 用户任务 → DAG → 领域执行

```mermaid
sequenceDiagram
    actor U as 用户
    participant SS as StudioServer
    participant SO as StudioOrchestrator
    participant CDR as CrossDomainRouter
    participant LLM as deepseek
    participant EB as EventBus
    participant DD as DomainDispatcher
    participant DCM as DomainClusterManager
    participant DC as DomainCluster
    participant PI as AgentHarness
    participant MB as MemoryBus

    U->>SS: POST /api/chat/message
    SS->>SO: routeMessage(content, execId, sessionId, "鲁班")
    SO->>SO: agentDispatchMap.get('鲁班')

    SO->>CDR: dispatch(content)
    CDR->>LLM: Single-Shot: 领域判定+任务拆解+DAG拓扑
    LLM-->>CDR: JSON { tasks[{id,domain,goal,deps}] }
    CDR->>CDR: buildNodes() → DAGNode[]
    CDR-->>SO: { nodes, isMultiDomain, involvedDomains }

    SO->>EB: emit('cross_domain.dag_created')
    SO->>SO: registerExecution(execId, content, dag)
    SO->>DD: executeDAG(nodes, sessionCtx) [异步]

    loop while hasPendingNodes
        DD->>DD: getReadyNodes()
        DD->>DD: resolveBatchConflicts()
        Note over DD: groupByArtifactKey → 仅冲突组串行

        par 并行批次 (maxParallel=3)
            DD->>EB: emit('runtime.task.started')
            DD->>DCM: execute(domainId, goal, sessionCtx)
            DCM->>DC: wake() + prompt(goal)
            DC->>PI: AgentHarness.prompt()
            PI->>LLM: streamSimple()
            LLM-->>PI: text_delta
            PI-->>DC: result
            DC-->>DD: result
            DD->>EB: emit('runtime.task.completed')
            DD->>MB: remember()
        end
    end

    DD-->>SO: DAGExecutionResult
    SO->>SO: finalizeExecution()
    EB-->>U: SSE → DAG完成
```

## 3. 直接对话链路

```mermaid
sequenceDiagram
    actor U as 用户
    participant SS as StudioServer
    participant SO as StudioOrchestrator
    participant LLMP as LLMProvider
    participant LLM as deepseek
    participant EB as EventBus
    participant MB as MemoryBus

    U->>SS: POST /api/chat/message { content }
    SS->>SO: routeMessage(content, execId, sessionId)
    SO->>SO: 无 @Agent → classifyIntent()
    Note over SO: 问候语→direct_chat<br/>否则 LLM 判定 chat|task

    SO->>LLMP: get()
    SO->>LLM: streamSimple()

    loop 流式 text_delta
        LLM-->>SO: delta
        SO->>EB: emit('message_update')
        EB-->>U: SSE → 打字机效果
    end

    SO->>MB: remember({ source:'chat' })
    SO-->>SS: { type:'direct_chat', output }
```

## 4. 记忆写入链路 (ECL 流水线)

```mermaid
sequenceDiagram
    participant C as 调用方
    participant MB as MemoryBus
    participant ZV as ZVecStorage
    participant K as KnowledgeGraph
    participant MW as MemoryWiki

    C->>MB: remember(payload)

    rect rgb(230,240,255)
        Note over MB: E: Extract
        MB->>MB: MD5 → contentHash
        MB->>MB: hashIndex.get(hash) → O(1)去重
        MB->>MB: evaluateImportance → 1-5
    end

    rect rgb(255,240,230)
        Note over MB: Gate
        alt importance≥2 → store
        else importance=1∧tags≥2 → promote
        else → reject → return null
        end
    end

    rect rgb(230,255,230)
        Note over MB: L: Load 三层写入
        MB->>MB: IndexEntry → index.jsonl
        MB->>ZV: write() → 向量嵌入
        MB->>K: addEntity() → 图谱实体
    end

    rect rgb(255,230,255)
        Note over MB: Pool 竞争
        MB->>MB: score = recency×0.25+freq×0.30<br/>+relation×0.25+importance×0.20
        MB->>MB: mainPool>1000 → 最低分→archive
    end

    opt wiki可用
        MB->>MW: remember() → SQLite
    end

    MB-->>C: IndexEntry
```

## 5. 记忆召回链路

```mermaid
sequenceDiagram
    participant C as 调用方
    participant MB as MemoryBus
    participant ZV as ZVecStorage
    participant K as KnowledgeGraph
    participant ARC as Archive

    C->>MB: recall({ text, strategy, topK })

    alt vector-first
        MB->>ZV: query({ text, limit })
        ZV-->>MB: results
        alt 失败 → K.searchEntities() 降级
        end
    else graph-walk
        MB->>K: searchEntities → getNeighborhood(depth=2)
    else hybrid-rag
        MB->>MB: vector + graph → 合并去重
    end

    opt includeArchive
        MB->>ARC: searchArchive(text)
    end

    MB->>MB: accessCount++ / score重算
    MB-->>C: { items[], source, entities[] }
```

## 6. 事件传播链路

```mermaid
sequenceDiagram
    participant SRC as 事件源
    participant EB as EventBus
    participant INT as 内部监听器
    participant SSE as onProjected
    participant UI as 前端
    participant ESUB as EngineSubscriber
    participant ES as EventStore
    participant MB as MemoryBus

    SRC->>EB: emit(event)

    par 分发
        EB->>INT: on(type) / on('*') / wildcard
        EB->>SSE: isProjectedEvent? → projectedListeners
        SSE-->>UI: res.write(event)
        Note over SSE: ❌ workflow.step_* agent.* gateway.*
    end

    par 领域
        EB->>EB: emitToDomain / broadcastCrossDomain
    end

    par 溯源
        ESUB->>ES: workflow.step_* → append()
        ESUB->>MB: workflow.completed/failed → upsert()
        ESUB->>MB: agent.result → upsert()
    end
```

## 7. 领域生命周期

```mermaid
stateDiagram-v2
    [*] --> sleeping: register()
    sleeping --> waking: wake()
    waking --> active: AgentHarness 就绪
    waking --> sleeping: 创建失败
    active --> draining: sleep()
    draining --> sleeping: 资源释放

    state active {
        就绪 --> 执行中: prompt(goal)
        执行中 --> 等待输入: askUserTool
        等待输入 --> 执行中: steerHarness
        执行中 --> 就绪: 返回 result
    }
```

## 8. 跨领域协商

```mermaid
sequenceDiagram
    participant DD as DomainDispatcher
    participant NE as NegotiationEngine
    participant AH as ArbitrationHandler
    participant LLM as deepseek

    DD->>DD: groupByArtifactKey(batch)
    alt 无冲突
        DD->>DD: 全部并行
    else 冲突组存在
        DD->>NE: createTicket()
        NE->>NE: 全局限流 + 重复检测
        alt depth ≤ 3
            NE->>NE: respond(accept/argue)
        else depth > 3
            NE->>AH: escalateToArbitration()
            AH->>LLM: 生成2-3个仲裁方案
            LLM-->>AH: JSON方案
        end
        DD->>DD: 仅冲突组串行
    end
```

## 9. 启动流程

```mermaid
sequenceDiagram
    participant SS as StudioServer
    participant K as MorPexKernel
    participant EB as EventBus
    participant COMP as 全部组件

    SS->>K: new MorPexKernel()
    K->>EB: new EventBus()
    K->>K: ExecutionIdentity + Gateway + Mirror + EventStore + EngineSubscriber

    SS->>COMP: initBaseServices → HistoryStore, AgentService
    SS->>COMP: initAIEngines → FSM, DAG, Scheduler, Swarm, ExecutionGraph
    SS->>COMP: initMemoryStorage → KG, Artifacts, ZVec, Wiki, MemoryBus
    SS->>COMP: initControlPlane → IntentPlugin, IndustryPlugin, LLMProvider.set()
    SS->>COMP: initCrossDomainModules → DomainLoader, DomainManager, Router, Dispatcher
    SS->>COMP: 接线: cluster.onUserInputNeeded, dispatcher回调 → EventBus
    SS->>COMP: initMetaPlanner

    SS->>K: start()
    K->>EB: emit('kernel.started')
```

## 10. 数据持久化全景

```mermaid
graph TB
    subgraph 文件系统
        direction LR
        F1[index.jsonl]
        F2[archive.jsonl]
        F3[gate-log.jsonl]
        F4[compaction-log.jsonl]
        F5[chat-history/{sid}.jsonl]
        F6[task-history/{eid}/{tid}.jsonl]
        F7[session-names.json]
        F8[workspace/projects/{eid}/]
        F9[domains/*.json]
        F10[plan-experience/]
        F11[mirror/]
    end

    subgraph 向量
        V1[data/zvec/]
    end

    subgraph SQLite
        S1[data/wiki/]
    end

    MB[MemoryBus] --> F1
    MB --> F2
    MB --> F3
    MB --> F4
    MB --> V1
    MB --> S1

    SM[SessionManager] --> F5
    SM --> F6
    SM --> F7

    AW[ArtifactWriter] --> F8

    DML[DomainManifestLoader] --> F9

    MP[MetaPlanner] --> F10

    EM[ExecutionMirror] --> F11
```

## 数据流速查表

| 链路 | 入口 | 核心调用链 | 出口 |
|------|------|-----------|------|
| 任务执行 | `POST /api/chat/message` | `SO→CDR.dispatch→LLM→DD.executeDAG→DCM.execute→DC→PI.prompt→LLM` | SSE + JSONL |
| 直接对话 | `POST /api/chat/message` | `SO.routeMessage→classifyIntent→LLM.streamSimple` | SSE + JSONL |
| 记忆检索 | `POST /api/chat/message` | `SO→MB.recall→ZV.query+K.searchEntities` | HTTP JSON |
| 记忆写入 | 任意组件 | `MB.remember→ECL→index.jsonl+ZVec+KG` | JSONL |
| 记忆压缩 | 定时/显式 | `MB.compactMemories→类型遗忘+Pool淘汰+score重算` | JSONL |
| 事件传播 | 任意组件 | `EB.emit→on+onProjected+EngineSubscriber` | SSE + EventStore |
| 领域唤醒 | `DCM.execute` | `DC.wake→loadSkills→new AgentHarness` | 内存 |
| 协商仲裁 | `DD.resolveBatchConflicts` | `NE.createTicket→respond→AH.escalate` | 内存 |
| 任务恢复 | `POST /api/task/resume` | `DD.executeNode→历史上下文注入→DC.execute` | SSE |
| 执行查询 | `GET /api/execution/:id` | `SO.getExecution→executionStore.get` | HTTP JSON |
