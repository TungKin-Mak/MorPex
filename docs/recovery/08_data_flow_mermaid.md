# 08 — Data Flow Mermaid Diagram

> **Phase 5**: Visual data flow diagram
> **Date**: 2026-07-18

---

## Data Flow Diagram 1: End-to-End Request Flow

```mermaid
flowchart TD
    %% Input
    USER[("👤 User")] -->|"HTTP POST"| API["StudioServer<br/>REST API (port 8080)"]
    
    %% Session Layer
    API -->|"1. routeMessage()"| SO["StudioOrchestrator"]
    API -->|"2. SessionManager.send()"| SM["SessionManager"]
    SO <--> SM
    
    %% Intent Classification (Inline)
    SO -->|"3. Classify intent (LLM)"| LLM1{"Chat or Task?"}
    LLM1 -->|"Chat"| CHAT["4a. Direct LLM Reply"]
    CHAT -->|"streamSimple()"| PI_AI["@earendil-works/pi-ai"]
    PI_AI -->|"DeepSeek API"| DEEPSEEK["DeepSeek LLM"]
    DEEPSEEK -->|"Response"| CHAT
    CHAT -->|"5. JSON Response"| API

    %% Task Mode
    LLM1 -->|"Task"| CR["CrossDomainRouter<br/>decompose()"]
    CR -->|"LLM Call"| PI_AI
    PI_AI --> DEEPSEEK
    
    %% Optional MetaPlanner
    CR -->|"ExecutionDAG"| MP{"MetaPlanner<br/>Enabled?"}
    MP -->|"Yes"| MPP["MetaPlanner.process()"]
    MPP -->|"7-Stage Pipeline"| PE["PipelineExecutor"]
    PE -->|"Stage 1-7"| PI_AI
    MPP -->|"Optimized Plan"| DD
    
    MP -->|"No / Skip"| DD
    
    %% DAG Execution
    DD["DomainDispatcher<br/>dispatch()"] -->|"Topological sort"| DAG{"Execute DAG Nodes"}
    DAG -->|"For each node"| DC["DomainCluster<br/>execute()"]
    DC -->|"wake()"| AF["AgentFactory<br/>spawnAgent()"]
    AF -->|"new"| AH["AgentHarness<br/>(pi-agent-core)"]
    AH -->|"run() with tools"| PI_AI
    PI_AI --> DEEPSEEK
    
    %% Results
    DEEPSEEK -->|"Node result"| AH
    AH -->|"Result"| DC
    DC -->|"Node result"| DD
    DD -->|"Aggregated result"| SO
    SO -->|"6. Store + Response"| SM
    SM -->|"7. SSE Events"| SSE["EventBus → SSE Stream"]
    SM -->|"8. JSON Response"| API
    API -->|"Response"| USER
    
    %% Event Flow (parallel)
    AH -.->|"Events"| EB["EventBus"]
    DD -.->|"task.start/complete"| EB
    EB -->|"Mirror"| MIR["ExecutionMirror"]
    EB -->|"Store"| EDS["EventStore"]
    EB -->|"Memory"| MB["MemoryBus"]
    EB -->|"SSE"| SSE
    
    %% Styling
    style MP fill:#ffffcc,stroke:#ffaa00
    style CHAT fill:#ccffcc,stroke:#00aa00
    style CR fill:#cce5ff,stroke:#0066cc
    style DD fill:#cce5ff,stroke:#0066cc
    style DC fill:#cce5ff,stroke:#0066cc
    style AH fill:#ffcccc,stroke:#cc0000
    style EB fill:#e6ccff,stroke:#6600cc
```

---

## Data Flow Diagram 2: Memory Write Paths (Broken)

```mermaid
flowchart TD
    subgraph "Write Path 1: MemoryBus"
        PROD1["EventBus Events"] -->|"MemoryBusListener"| MB["MemoryBus"]
        PROD2["MetaPlanner"] -->|"remember()"| MB
        MB -->|"WriteGate.evaluate()"| WG{"Score >= Threshold?"}
        WG -->|"Yes"| ZV1["ZVecStorage.store()"]
        WG -->|"Archive"| ARC["Archive Pool"]
        WG -->|"No"| REJ["❌ Rejected"]
        ZV1 --> HS1["HistoryStore (JSONL)"]
    end

    subgraph "Write Path 2: MemoryWiki"
        PROD3["DocWatcher"] -->|"File changes"| MW["MemoryWiki"]
        PROD4["Manual insert"] -->|"SQL INSERT"| MW
        MW -->|"SQLite + ZVec"| SQL["SQLite DB"]
        MW --> ZV2["ZVecStorage"]
    end

    subgraph "✂️ NO SYNC"
        SYNC{"Synchronization?"}
        MB -.->|"⚠️ Not connected"| SYNC
        MW -.->|"⚠️ Not connected"| SYNC
    end

    style SYNC fill:#ff6666,color:#fff
```

---

## Data Flow Diagram 3: Gateway Bypass

```mermaid
flowchart LR
    subgraph "DOCUMENTED PATH"
        A["User Request"] --> EG["ExecutionGateway"]
        EG --> PA["PiAdapter"]
        PA --> PI["pi-agent-core"]
        PI --> LLM["DeepSeek"]
    end

    subgraph "ACTUAL PATH"
        B["User Request"] --> SO["StudioOrchestrator"]
        SO --> CR["CrossDomainRouter"]
        CR --> DD["DomainDispatcher"]
        DD --> DC["DomainCluster"]
        DC --> AF["AgentFactory"]
        AF --> AH["AgentHarness"]
        AH --> LLM
    end

    subgraph "What Gateway Actually Does"
        PA -.->|"Events only"| EB["EventBus"]
    end

    style EG fill:#ffcccc
    style PA fill:#ffcccc
    style AH fill:#ffcccc,stroke:#cc0000
```

---

## Data Flow Diagram 4: Duplicate Planning Types

```mermaid
flowchart LR
    subgraph "planning-types/ (DEAD)"
        PT1["autonomous.ts"]
        PT2["config.ts"]
        PT3["dag-patch.ts"]
        PT4["evaluation.ts"]
        PT5["execution-records.ts"]
        PT6["extension-context.ts"]
        PT7["index.ts"]
        PT8["matching.ts"]
        PT9["pipeline-types.ts"]
        PT10["plan-templates.ts"]
        PT11["simulation.ts"]
    end

    subgraph "types/ (ACTIVE)"
        T1["config.ts"]
        T2["engines.ts"]
        T3["evaluation.ts"]
        T4["extension-lifecycle.ts"]
        T5["index.ts"]
        T6["pipeline-types.ts"]
        T7["plan-templates.ts"]
        T8["simulation.ts"]
    end

    subgraph "Consumers"
        META["MetaPlanner.ts"]
        PE_P["PipelineExecutor.ts"]
        PES["PlanExperienceStore.ts"]
    end

    PT1 -.->|"ZERO IMPORTS"| EMPTY
    T1 -->|"USED BY"| META
    T3 -->|"USED BY"| PE_P
    T7 -->|"USED BY"| PES

    style PT1 fill:#ffcccc
    style PT2 fill:#ffcccc
    style PT3 fill:#ffcccc
    style PT4 fill:#ffcccc
    style PT5 fill:#ffcccc
    style PT6 fill:#ffcccc
    style PT7 fill:#ffcccc
    style PT8 fill:#ffcccc
    style PT9 fill:#ffcccc
    style PT10 fill:#ffcccc
    style PT11 fill:#ffcccc
    style EMPTY fill:#ff6666,color:#fff
```
