# 06 — Mermaid Dependency Diagram

> **Phase 4**: Visual dependency graph in Mermaid format
> **Date**: 2026-07-18

---

## Diagram 1: Package-Level Dependencies

```mermaid
graph TD
    subgraph "User Facing"
        UI["packages/studio/ui<br/>(React + Three.js)"]
    end

    subgraph "Server"
        SS["packages/studio/server<br/>(StudioServer)"]
        SM["SessionManager"]
        SO["StudioOrchestrator"]
        SS --> SM
        SS --> SO
    end

    subgraph "Core Engine"
        K["MorPexKernel"]
        EB["EventBus"]
        PS["PluginSystem"]
        EG["ExecutionGateway"]
        CG["ContractGateway"]
        PA["PiAdapter"]
        MIR["ExecutionMirror"]
        ES["EventStore"]
    end

    subgraph "Planning"
        MP["MetaPlanner"]
        PE["PipelineExecutor"]
        ST1["Stage 1:"]
        ST2["Stage 2:"]
        ST3["Stage 3:"]
        ST4["Stage 4:"]
        ST5["Stage 5:"]
        ST6["Stage 6:"]
        ST7["Stage 7:"]
        PES["PlanExperienceStore"]
        PE --> ST1
        PE --> ST2
        PE --> ST3
        PE --> ST4
        PE --> ST5
        PE --> ST6
        PE --> ST7
        MP --> PE
        MP --> PES
    end

    subgraph "Routing"
        CR["CrossDomainRouter"]
        DD["DomainDispatcher"]
        NE["NegotiationEngine"]
        AH["ArbitrationHandler"]
    end

    subgraph "Domains"
        DCM["DomainClusterManager"]
        DC["DomainCluster"]
        AF["AgentFactory"]
        DCM --> DC
        DC --> AF
    end

    subgraph "Memory & Knowledge"
        MB["MemoryBus"]
        MW["MemoryWiki"]
        KG["KnowledgeGraph"]
        ZV["ZVecStorage"]
        HS["HistoryStore"]
        MR["MemoryRetriever"]
        MB --> ZV
        MW --> ZV
    end

    subgraph "LLM"
        PI_AI["@earendil-works/pi-ai"]
        PI_AC["@earendil-works/pi-agent-core"]
        LLP["LLMProvider"]
    end

    subgraph "Adapters (Disconnected)"
        PIA["PiAIAdapter"]
        PACA["PiAgentCoreAdapter"]
        MRA["MockRuntimeAdapter"]
    end

    subgraph "Contracts"
        CT["@morpex/contracts"]
    end

    subgraph "Ghost Modules"
        FSM["FSMEngine"]
        DAG_E["DAGEngine"]
        SCH["SchedulerEngine"]
        SW["SwarmEngine"]
        EXG["ExecutionGraphEngine"]
        AO["AgentOrchestrator"]
        MCP["McpRuntimeManager"]
        CP["CheckpointManager"]
        LT["LineageTracker"]
        CTP["ContextPruner"]
    end

    %% Dependencies
    UI --> SS
    SS --> K
    SS --> SM
    SS --> SO
    SS --> MB
    SS --> MW
    SS --> HS
    SS --> MR
    SS --> PI_AI
    SS --> PI_AC
    SS --> FSM
    SS --> DAG_E
    SS --> SCH
    SS --> SW
    SS --> EXG
    SS --> AO

    SO --> CR
    SO --> DD

    K --> EB
    K --> PS
    K --> EG
    K --> CG
    K --> PA
    K --> MIR
    K --> ES

    CR --> DCM
    DD --> DCM
    DD --> NE
    DD --> AH

    DC --> AF
    AF --> PI_AC

    MB --> KG
    MW ..->|"reverse dep"| KG

    PA --> PI_AI
    LLP --> PI_AI

    %% Dead connections
    PIA -.->|"never wired"| CG
    PACA -.->|"never wired"| CG

    MCP -.->|"ghost"| CTP

    style PIA fill:#ff9999,stroke:#ff0000
    style PACA fill:#ff9999,stroke:#ff0000
    style MRA fill:#ff9999,stroke:#ff0000
    style FSM fill:#ffcccc,stroke:#ff0000,stroke-dasharray: 5 5
    style DAG_E fill:#ffcccc,stroke:#ff0000,stroke-dasharray: 5 5
    style SCH fill:#ffcccc,stroke:#ff0000,stroke-dasharray: 5 5
    style SW fill:#ffcccc,stroke:#ff0000,stroke-dasharray: 5 5
    style EXG fill:#ffcccc,stroke:#ff0000,stroke-dasharray: 5 5
    style AO fill:#ffcccc,stroke:#ff0000,stroke-dasharray: 5 5
    style MCP fill:#ffcccc,stroke:#ff0000,stroke-dasharray: 5 5
    style CP fill:#ffcccc,stroke:#ff0000,stroke-dasharray: 5 5
    style LT fill:#ffcccc,stroke:#ff0000,stroke-dasharray: 5 5
    style CTP fill:#ffcccc,stroke:#ff0000,stroke-dasharray: 5 5
```

---

## Diagram 2: Runtime Request Flow

```mermaid
sequenceDiagram
    participant User
    participant Frontend as Studio UI
    participant API as StudioServer (REST/SSE)
    participant SM as SessionManager
    participant SO as StudioOrchestrator
    participant CR as CrossDomainRouter
    participant MP as MetaPlanner (optional)
    participant DD as DomainDispatcher
    participant DC as DomainCluster
    participant AF as AgentFactory
    participant AH as AgentHarness (pi-agent-core)
    participant LLM as pi-ai → DeepSeek
    participant MEM as Memory Systems
    participant EVT as EventBus

    User->>Frontend: Send message
    Frontend->>API: POST /api/chat/message
    API->>SM: SessionManager.send()
    SM->>SO: StudioOrchestrator.routeMessage()

    SO->>SO: Intent classification (inline LLM)

    alt Chat Mode
        SO->>LLM: Direct chat reply
        LLM-->>SO: Response
        SO-->>API: Chat response
        API-->>Frontend: JSON response
    else Task Mode
        SO->>CR: CrossDomainRouter.decompose()
        CR->>LLM: Decompose user intent
        LLM-->>CR: ExecutionDAG

        opt MetaPlanner Enabled
            CR-->>MP: Pass to MetaPlanner
            MP->>MP: 7-Stage Pipeline
            MP-->>CR: Optimized plan
        end

        CR-->>SO: DAG plan
        SO->>DD: DomainDispatcher.dispatch()

        loop For each DAG node
            DD->>DC: DomainCluster.execute()
            DC->>AF: AgentFactory.spawn()
            AF->>AH: new AgentHarness()
            AH->>LLM: Execute with domain tools
            LLM-->>AH: Response
            AH-->>DC: Result
            DC-->>DD: Node result
        end

        DD-->>SO: DAGExecutionResult
        SO-->>SM: Store result
        SM-->>API: JSON response
    end

    EVT-->>EVT: Event Bus emits events throughout
    API-->>Frontend: SSE event stream (real-time)
```

---

## Diagram 3: Event Bus Wiring

```mermaid
graph LR
    subgraph "Event Producers"
        P1["PiAdapter"]
        P2["DomainDispatcher"]
        P3["MetaPlanner"]
        P4["ArtifactRegistry"]
        P5["ToolCallTracker"]
        P6["PermissionEngine"]
    end

    subgraph "EventBus"
        EB["EventBus"]
    end

    subgraph "Event Consumers"
        C1["ExecutionMirror"]
        C2["EventStore"]
        C3["MemoryBusListener"]
        C4["SessionProjection"]
        C5["StudioServer SSE"]
    end

    P1 -->|"runtime events"| EB
    P2 -->|"task.start/complete/fail"| EB
    P3 -->|"planning events"| EB
    P4 -->|"artifact.created"| EB
    P5 -->|"tool.call events"| EB
    P6 -->|"permission events"| EB

    EB -->|"all events"| C1
    EB -->|"all events"| C2
    EB -->|"all events"| C3
    EB -->|"projected events"| C4
    EB -->|"projected events"| C5
```

---

## Diagram 4: Ghost Module Graph (Dead Code)

```mermaid
graph TD
    subgraph "Ghost Modules"
        FSM["FSMEngine"]
        DAG_E["DAGEngine"]
        SCH["SchedulerEngine"]
        SW["SwarmEngine"]
        EXG["ExecutionGraphEngine"]
        AO["AgentOrchestrator"]
        MCP["McpRuntimeManager"]
        MJR["McpJsonRpcHandler"]
        CP["CheckpointManager"]
        LT["LineageTracker"]
        CTP["ContextPruner"]
        MCPG["McpProcessGuard"]
    end

    subgraph "Instantiated by StudioServer.initAIEngines()"
        INIT["StudioServer.initAIEngines()"]
        INIT --> FSM
        INIT --> DAG_E
        INIT --> SCH
        INIT --> SW
        INIT --> EXG
        INIT --> AO
    end

    subgraph "Instantiated by StudioServer.initComponents()"
        INIT2["StudioServer.initComponents()"]
        INIT2 --> LT
        INIT2 --> CTP
        INIT2 --> MCPG
        INIT2 --> CP
    end

    MCPG -.->|"depends on"| MCP
    MCP --> MJR

    style FSM fill:#ffcccc
    style DAG_E fill:#ffcccc
    style SCH fill:#ffcccc
    style SW fill:#ffcccc
    style EXG fill:#ffcccc
    style AO fill:#ffcccc
    style MCP fill:#ffcccc
    style MJR fill:#ffcccc
    style CP fill:#ffcccc
    style LT fill:#ffcccc
    style CTP fill:#ffcccc
    style MCPG fill:#ffcccc
```
