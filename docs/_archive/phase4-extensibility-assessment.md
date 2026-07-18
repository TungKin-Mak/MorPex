# Phase 4: 可扩展性与升级隐患评估报告

## 1. 核心问题：StudioServer 是 God Object（违反单一职责）

**文件**: `packages/studio/server/StudioServer.ts` (2763 行)
**严重度**: 🔴 高

**问题**: 单个文件同时承担了以下完全不相关的职责：
- HTTP 服务器启动 (Express + CORS + middleware)
- 35+ REST API 路由处理
- SSE 客户端管理（心跳、过滤、广播）
- MorPexCore Kernel 初始化（调用 `createKernel()`）
- 全部引擎组件的实例化（FSM, DAG, Scheduler, Orchestrator, Swarm, KnowledgeGraph, MemoryBus, ArtifactRegistry, IntentResolver...）
- 跨领域模块初始化（DomainClusterManager, CrossDomainRouter, NegotiationEngine...）
- 会话管理（session names 加载/保存/LLM 生成）
- 文件系统 I/O（工作区文件写入、索引创建）
- LLM 调用逻辑（chat/send 的意图解析、规划、执行循环）
- 生成会话摘要名（LLM Prompt）

**升级阻碍**: 替换数据库（JSONL→SQLite）需要修改此文件 10+ 处；替换 LLM 提供商需要修改此文件 5+ 处；修改 SSE 协议需要重写 setupSSE()。任何功能变更都触及此文件。

**建议**: 
- 提取 `ApiRouter` 类：将所有 API 路由处理移至独立文件（如 `api/chat.ts`, `api/memory.ts`, `api/knowledge.ts`）
- 提取 `EngineBootstrapper` 类：将引擎初始化逻辑封装为独立的 `EngineBootstrap()` 函数
- 提取 `SSEManager` 类：将 SSE 客户端管理、心跳、过滤逻辑封装为独立模块
- 目标：将 StudioServer 缩减到 ~300 行（仅 orchestration + 生命周期）

---

## 2. MemoryBus ↔ KnowledgeGraph 循环依赖风险

**文件**: `packages/memory/src/core/MemoryBus.ts`
**严重度**: 🟡 中

**问题**: MemoryBus 需要 KnowledgeGraph 实例（`setGraph()` 注入），但同时 KnowledgeGraph 又引用 MemoryBus 的 JSONLWriter。更关键的是，MemoryBus.remember() 在写入后立即调用 `this.graph.addEntity()`，而 `addEntity()` 又通过 JSONLWriter 异步写入文件。这种双向依赖在 shutdown 时可能引发竞态：MemoryBus 先关闭 JSONLWriter，然后 KnowledgeGraph 尝试写入已关闭的 writer。

**升级阻碍**: 替换 KnowledgeGraph 为其他图数据库（Neo4j/ArangoDB）需要修改 MemoryBus 中的 `addEntity()`, `searchEntities()`, `getNeighborhood()` 等多个方法。

**建议**: 
- 引入 `GraphStorageAdapter` 接口，MemoryBus 通过该接口操作图数据，KnowledgeGraph 实现此接口
- 或者：MemoryBus 不直接依赖 KnowledgeGraph，改为发射事件，由外部 coordinator 监听事件并同步到图数据库

---

## 3. Kernel 工厂模式不彻底

**文件**: `packages/core/core/Kernel.ts` (180 行)
**严重度**: 🟡 中

**问题**: Kernel 构造函数中直接 `new` 出所有核心组件：
```typescript
this._eventBus = new EventBus();
this._executionIdentity = new ExecutionIdentity();
this._pluginSystem = new PluginSystem(this._eventBus, this._executionIdentity);
this._storage = new JSONLStorage(config?.mirrorBasePath);
this._mirror = new ExecutionMirror(this._storage);
this._gateway = new ExecutionGateway(this._eventBus);
```

这导致：
- 无法替换 EventBus 实现（如分布式 EventBus）
- 无法 mock 组件进行单元测试
- PluginSystem 需要的 EventBus 在 Kernel 构造函数中硬编码创建

**建议**: 
- 使用依赖注入容器或至少构造函数参数注入
- Kernel 构造函数接受 `{ eventBus?, executionIdentity?, storage?, ... }` 选项
- 允许测试时注入 mock EventBus

---

## 4. VectorStore/ZVecStorage 的 `process.on('SIGINT')` 注册是反模式

**文件**: 
- `packages/core/planes/knowledge-plane/memory/VectorStore.ts`
- `packages/memory/src/storage/ZVecStorage.ts`
**严重度**: 🟡 中

**问题**: 这两个类都在 `initialize()` 中注册 `process.on('SIGINT', shutdown)` 监听器，且没有提供移除机制。这是全局副作用：
- 多次初始化会导致多个 listener 注册（虽然 BUG-9 已用 `_shutdownRegistered` 缓解，但设计仍不妥）
- 单元测试中会导致 SIGINT 信号被处理多次
- 如果类在 worker 线程中使用，`process.on` 会影响主进程

**建议**: 
- 移至 `Kernel.stop()` 或 `StudioServer.shutdown()` 集中处理进程信号
- 类只提供 `close()` 方法，不接触 `process.on`

---

## 5. 硬编码路径遍布代码库

**严重度**: 🟡 中

| 文件 | 硬编码路径 | 行号 |
|------|-----------|------|
| StudioServer.ts | `./data/mirror`, `./data/sessions` | 构造函数参数默认值 |
| StudioServer.ts | `./data/workspace` (cycle/run 中) | ~870 |
| StudioServer.ts | `./data/memory-bus` (传给 MemoryBus) | initMemoryStorage |
| StudioServer.ts | `./data/artifacts` (传给 ArtifactRegistry) | initMemoryStorage |
| StudioServer.ts | `/api/...` (所有路由字符串) | 全部 setupApiRoutes |
| MemoryBus.ts | `./data/memory-bus` (config 默认值) | constructor |
| KnowledgeGraph.ts | `./data/knowledge` (config 默认值) | DEFAULT_CONFIG |
| VectorStore.ts | `./data/zvec` (config 默认值) | constructor |
| VectorStore.ts | `http://localhost:3100` (embedUrl) | constructor config 默认值 |
| EmbeddingClient.ts | `http://localhost:3100` (baseUrl) | constructor 默认值 |

**升级阻碍**: 更改数据路径需要修改 8+ 个文件；更改 embedding 服务地址需要修改 4+ 个文件。

**建议**: 
- 所有路径通过配置文件（`.env` 或 `config.json`）设置
- 引入 `PathsConfig` 对象统一管理
- Embedding URL 通过 `LLMProvider` 或全局配置传递，不要在多个类中各自默认

---

## 6. 事件总线是唯一通信通道 — 但缺少类型安全

**文件**: `packages/core/core/EventBus.ts`
**严重度**: 🟢 低

**问题**: EventBus 使用 `any` 类型的事件 payload，没有事件类型到 payload 类型的映射。订阅者需要手动解析 payload 类型，容易出错。

**建议**: 
- 使用 TypeScript 泛型参数：`emit<T>(event: MorPexEvent<T>)`, `on<T>(type: string, handler: (event: MorPexEvent<T>) => void)`
- 或维护事件类型注册表：`EventBus.registerType('fsm.transition', FSMTransitionPayload)`

---

## 7. CrossDomainRouter 依赖 DomainClusterManager 的具体实现

**文件**: `packages/core/router/CrossDomainRouter.ts`
**严重度**: 🟢 低

**问题**: CrossDomainRouter 在构造函数中接收 `DomainClusterManager` 的具体实例，而不是接口。这使得替换为不同的领域管理策略时困难。

**建议**: 
- 定义 `DomainManager` 接口
- CrossDomainRouter 通过接口依赖而非具体类

---

## 8. AgentService 的 `new InMemorySessionRepo()` 是硬编码

**文件**: `packages/core/services/AgentService.ts` (第 19 行)
**严重度**: 🟢 低

**问题**: 构造函数中直接 `new InMemorySessionRepo()` 创建内存会话仓库，无法替换为持久化仓库。

**建议**: 
- 构造函数接受 `sessionRepo` 参数，默认使用 InMemorySessionRepo

---

## 重构优先级建议

| 优先级 | 风险 | 项目 | 工作量 | 影响 |
|--------|------|------|--------|------|
| 🔴 P0 | 高 | StudioServer 拆分 (God Object 分解) | 3-5 天 | 替换 LLM/数据库/SSE 协议时只需修改对应模块 |
| 🔴 P0 | 高 | 硬编码路径集中管理 | 1-2 天 | 环境迁移 (dev→staging→prod) 只需改一处 |
| 🟡 P1 | 中 | MemoryBus ↔ KnowledgeGraph 解耦 | 2-3 天 | 可替换图数据库，改善 shutdown 竞态 |
| 🟡 P1 | 中 | Kernel 依赖注入 | 1-2 天 | 可 mock 测试，可替换 EventBus 实现 |
| 🟡 P1 | 中 | process.on 集中管理 | 0.5 天 | Worker 线程安全，测试不产生副作用 |
| 🟢 P2 | 低 | EventBus 泛型类型安全 | 1 天 | 编译时类型检查 payload 结构 |
| 🟢 P2 | 低 | CrossDomainRouter 接口依赖 | 0.5 天 | 可替换领域管理策略 |
| 🟢 P2 | 低 | AgentService SessionRepo 可注入 | 0.5 天 | 可替换为持久化仓库 |

---

## 总结

最大的架构债务是 **StudioServer God Object**（2763 行），它阻碍了几乎所有的功能扩展。其次是硬编码路径遍布代码库（15+ 处）。这两个问题的修复将显著降低后续功能开发的成本。
