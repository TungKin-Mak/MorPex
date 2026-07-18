# MorPexCore 架构文档

> 版本: 3.0.0 — 微内核引擎重构完成 (2026-07-11)
> 架构风格: 微内核 + 纯函数 DAG + MCP 边车隔离 + 三段 Agent
> 旧 OOP 引擎 (WorkflowEngine/WorkflowRegistry/FSMEngine) 已删除

---

## 1. 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    MorPexCore                               │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Control  │  │ Runtime  │  │ Agent    │  │ Knowledge│   │
│  │ Plane    │  │ Kernel   │  │ Plane    │  │ Plane    │   │
│  │          │  │          │  │          │  │          │   │
│  │ Intent   │  │ FSM      │  │ Orchest. │  │ Artifact │   │
│  │ Planner  │  │ DAG      │  │ Swarm    │  │ Memory   │   │
│  │          │  │ Sched.   │  │          │  │ Know.Graph│  │
│  │          │  │ HIL      │  │          │  │          │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │             │             │             │          │
│       └─────────────┴─────────────┴─────────────┘          │
│                            │                                │
│                    ┌───────▼───────┐                        │
│                    │   EventBus   │ ← 唯一通信通道          │
│                    └───────┬───────┘                        │
│                            │                                │
│              ┌─────────────┼─────────────┐                  │
│              ▼             ▼             ▼                  │
│        ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│        │ Gateway  │ │  Mirror  │ │  Plugin  │              │
│        │(PiAdapter)│ │(Observer)│ │ System   │              │
│        └────┬─────┘ └────┬─────┘ └────┬─────┘              │
│             │            │            │                      │
│             └──────┬─────┴─────┬──────┘                      │
│                    │           │                              │
│              ┌─────▼─────┐ ┌───▼────────┐                    │
│              │  Pi/pi-ai │ │ Pi/pi-agent│ ← 底层引擎         │
│              │ (13导出)  │ │ -core(20导)│    (本地化)         │
│              └───────────┘ └────────────┘                    │
└─────────────────────────────────────────────────────────────┘
```

### 底层引擎层

MorPexCore 的 LLM 调用 + Agent 生命周期 + Session 管理 委托给本地化的 `Pi/` 模块：

| MorPexCore 模块 | 底层引擎 | Pi 导出 |
|----------------|---------|--------|
| LLMBridge | `Pi/pi-ai` | `stream()`, `getModel()` |
| FSMEngine | `Pi/pi-agent-core` | `runAgentLoop()`, `AgentTool` |
| MemoryEngine | `Pi/pi-agent-core` | `generateSummary()`, `estimateTokens()` |
| AgentOrchestrator | `Pi/pi-agent-core` | `Agent` 类 |
| ExecutionIdentity | `Pi/pi-agent-core` | `uuidv7()` |
| IntentResolver | `Pi/pi-ai` | `parseJsonWithRepair()` |
| ThinkingLevelControl | `Pi/pi-ai` | `clampThinkingLevel()` |
| ModelRegistry | `Pi/pi-ai` | `getModels()`, `getProviders()` |
| PromptTemplateEngine | `Pi/pi-agent-core` | `loadPromptTemplates()` |
| SkillLoader | `Pi/pi-agent-core` | `loadSkills()` |

## 2. 核心协议（已冻结）

### 2.1 Event Schema

```typescript
interface MorPexEvent {
  id: string;            // evt_{YYYYMMDD}_{shortUUID}
  type: string;          // {domain}.{action}
  timestamp: number;
  executionId: string;   // 必带
  source: string;
  payload: any;
}
```

### 2.2 Plugin API

```typescript
interface MorPexPlugin {
  name: string;
  version: string;
  dependencies?: string[];
  initialize(context: PluginContext): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

### 2.3 Execution Gateway API

```typescript
interface AgentRuntimeAdapter {
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
  abort(executionId: string): Promise<void>;
  subscribe(handler: (event: MorPexEvent) => void): () => void;
  health(): RuntimeHealth;
}
```

## 3. 数据流

### 3.1 主请求流

```
User Input (IntentResolver)
  → LLMProvider.get()
    → intent.resolved
  → WorkflowPlanner.plan()
    → plan.generated
  → DAGEngine.buildFromTasks()
    → dag.built
  → AgentOrchestrator / FSMEngine
    → 任务分配 → Worker 执行
  → ArtifactRegistry / MemoryBus
    → 产物保存 / 记忆存储
```

### 3.2 事件命名空间

| 命名空间 | 说明 | 示例 |
|---------|------|------|
| `intent.*` | 意图解析 | `intent.resolved`, `intent.needs_clarification` |
| `plan.*` | 规划 | `plan.generated`, `plan.failed` |
| `dag.*` | DAG | `dag.built`, `dag.node.completed` |
| `runtime.fsm.*` | FSM 状态机 | `runtime.fsm.transition`, `runtime.fsm.done` |
| `scheduler.*` | 调度 | `scheduler.task_ready`, `scheduler.backpressure` |
| `graph.*` | 执行图 | `graph.node.created`, `graph.completed` |
| `human.*` | 人机协作 | `human.pause.created`, `human.pause.resolved` |
| `orchestrator.*` | 编排 | `orchestrator.task_assigned` |
| `swarm.*` | 拍卖 | `swarm.auction_created`, `swarm.auction_awarded` |
| `artifact.*` | 交付物 | `artifact.created`, `artifact.updated` |
| `memory.*` | 记忆 | `memory.stored`, `memory.recalled` |
| `knowledge.*` | 知识图谱 | `knowledge.search_results`, `knowledge.path_result` |
| `industry.*` | 行业 | `industry.guess_result`, `industry.workflows` |
| `gateway.*` | 网关 | `gateway.adapter.registered` |
| `kernel.*` | 内核 | `kernel.started` |

## 4. 插件依赖图

```
intent-plugin (无依赖)
  ├─ (intent.resolved →)
  │
planner-plugin (依赖: intent-plugin)
  ├─ (plan.generated →)
  │
dag-plugin (依赖: planner-plugin)
  ├─ (dag.* 事件)
  │
fsm-plugin (无依赖, 独立执行引擎)
  │
scheduler-plugin (无依赖, 独立调度)
  │
exec-graph-plugin (依赖: dag-plugin)
  │
human-in-loop-plugin (无依赖)
  │
orchestrator-plugin (无依赖)
  │
swarm-plugin (无依赖)
  │
artifact-plugin (无依赖)
  │
memory-plugin (无依赖)
  │
knowledge-graph-plugin (依赖: artifact-plugin, memory-plugin)
```

## 5. 设计原则

### 5.1 绞杀者模式
- 新功能通过 MorPexCore 实现
- RouterPlugin 已完成使命并删除（全流量走 MorPexCore）

### 5.2 插件间通信
- 只能通过 EventBus
- 禁止直接 import 其他插件
- 事件类型使用命名空间 `{domain}.{action}`

### 5.3 可观测性
- Mirror 是 observer，不是 controller
- 所有事件经过 EventBus → Mirror 自动记录
- JSONL 存储，不阻塞主路径

### 5.4 生命周期
- Kernel.start() → 初始化所有组件
- PluginSystem 按依赖拓扑排序启动
- 停止时逆序

## 6. 存储架构

```
data/
├── mirror/              ← Mirror 原始数据（JSONL）
│   ├── events.jsonl
│   ├── executions.jsonl
│   └── snapshots.jsonl
├── artifacts/           ← Artifact 持久化（JSONL）🆕 Phase 3 / Wave 3 统一入口
│   ├── artifacts.jsonl
│   └── relations.jsonl
├── knowledge/           ← 统一 KnowledgeGraph 持久化
│   ├── entities.jsonl
│   └── relations.jsonl
├── memory-bus/          ← MemoryBus v2 持久化
│   ├── index.jsonl
│   ├── archive.jsonl
│   └── gate-log.jsonl
```

> **Phase 3 变更**: ArtifactRegistry 增加 `saveToDisk()` / `loadFromDisk()` JSONL 持久化，重启不丢失。KnowledgeGraph 通过 `MemoryBus.setGraph()` 统一注入单例，共享 `data/knowledge/`。

## 7. 部署检查清单

- [ ] Node.js ≥ 20
- [ ] TypeScript 5.x
- [ ] 现有 AgentRuntime 可用
- [ ] `data/mirror/` 目录可写
- [ ] RouterPlugin 已删除（绞杀者模式完成）
- [ ] 监控 Mirror 事件量
- [ ] 各插件状态正常 (`kernel.getStatus()`)
