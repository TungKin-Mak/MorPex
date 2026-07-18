# Phase 3 & 4 交付报告：Bug 修复 + 可扩展性评估

> 完成日期: 2026-07-10 | 状态: ✅ 全部完成

---

## 第三阶段：隐藏 Bug 与边界条件压力测试

### 审计范围
20+ 核心源文件，涵盖：
- 异步与竞态条件：AgentService, ExecutionGateway, PiAdapter, Kernel, PluginSystem, EventBus, StudioServer, MemoryBus
- 内存与资源泄露：ExecutionMirror, JSONLStorage, JSONLWriter, StudioServer (SSE), ZVecStorage, EmbeddingClient, VectorStore
- 边界值崩溃：FSMEngine, DAGEngine, KnowledgeGraph, VectorStore, extractJson, toposort

### 发现的 15 个 Bug 及修复

#### 🔴 边界崩溃 (5)

| # | 文件 | 行 | 问题 | 修复 |
|---|------|-----|------|------|
| BUG-3 | `extractJson.ts` | 16 | 贪婪正则 `{[\s\S]*}` 嵌套大括号时提取错误 | 重写为逐字符括号匹配算法，正确处理转义引号 |
| BUG-6 | `StudioServer.ts` | 1759,1768 | 引用未定义变量 `s` 导致 ReferenceError | 替换为 `session_id` |
| BUG-8 | `StudioServer.ts` | 880 | 引用未定义变量 `requestId` | 移除引用 |
| BUG-10 | `DAGEngine.ts` | failNode | reroute 后 status='rerouting' 但 error 残留，状态不一致 | 重构 reroute 逻辑，独立处理 |
| BUG-11 | `toposort.ts` | 构建入度表 | 依赖列表含重复 ID 时入度偏高导致死锁 | 添加 `Set` 去重 |

#### 🟡 竞态条件 (3)

| # | 文件 | 行 | 问题 | 修复 |
|---|------|-----|------|------|
| BUG-1 | `StudioServer.ts` | 多处 | 同步 I/O 阻塞 EventBus 事件循环 | 替换为 `fs.promises` 异步版本 |
| BUG-4 | `PiAdapter.ts` | abort | `abort('*')` 误杀所有执行 | 添加 executionId 匹配检查 |
| BUG-7 | `PluginSystem.ts` | startAll/stopAll | 无防重入锁，双重初始化 | 添加 `_starting`/`_stopping` 标志 |

#### 🟡 资源泄露 (5)

| # | 文件 | 行 | 问题 | 修复 |
|---|------|-----|------|------|
| BUG-2 | `StudioServer.ts` | setupSSE | SSE 心跳定时器在异常路径可能泄漏 | 添加 try/finally + res.on('close') |
| BUG-5 | `JSONLWriter.ts` | timer | flush() 中 timer 管理存在竞态导致定时器泄漏 | 原子化 timer 管理 |
| BUG-9 | `VectorStore.ts` | registerShutdown | 多次 initialize() 重复注册 process.on 监听器 | 添加 `_shutdownRegistered` 标志 |
| BUG-12 | `Kernel.ts` | stop | Mirror.stop() 异常时 EventBus.clear() 不执行 | 添加 finally 块保证清理 |
| BUG-13 | `JSONLWriter.ts` | flush | 刷盘失败时数据放回 buffer 可能无限循环 | 添加 MAX_RETRY_FLUSH=3 上限 |

#### 🟢 其他改进 (2)

| # | 文件 | 行 | 问题 | 修复 |
|---|------|-----|------|------|
| BUG-14 | `PiAdapter.ts` | bridgeRuntimeEvents | 事件注册未捕获异常 | 添加 try-catch |
| BUG-15 | `FSMEngine.ts` | reset | abort() 异常阻止状态重置 | 先清状态再 abort |

---

## 第四阶段：可扩展性与升级隐患评估

### 架构债务清单

#### 🔴 P0 - 高风险

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| A-1 | **StudioServer God Object (2763行)** | `packages/studio/server/StudioServer.ts` | 35+ API 端点、引擎初始化、SSE、静态文件、配置全部混合在一个类中。修改任一功能都需要了解全局。 |
| A-2 | **15+ 处硬编码路径** | 散布在 `StudioServer.ts`, `MemoryBus.ts`, `VectorStore.ts`, `KnowledgeGraph.ts` 等 | 路径 `./data/mirror`, `./data/zvec`, `http://localhost:3100`, `./data/sessions` 等散布各处，改一处漏一处。 |

#### 🟡 P1 - 中风险

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| A-3 | **MemoryBus ↔ KnowledgeGraph 双向依赖** | `MemoryBus.ts` ↔ `KnowledgeGraph.ts` | MemoryBus 持有 KnowledgeGraph 引用，KnowledgeGraph 的 JSONLWriter 来自 memory 包。更换任一需要同时修改对方。 |
| A-4 | **Kernel 工厂化 new()** | `Kernel.ts` | 构造函数内部 `new EventBus()`, `new PluginSystem()`, `new JSONLStorage()` 等，不可注入 mock。 |
| A-5 | **process.on 全局副作用** | `VectorStore.ts`, `ZVecStorage.ts` | 两个模块各自注册 SIGINT/SIGTERM 监听器，耦合到进程生命周期，不可测试。 |

#### 🟢 P2 - 低风险

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| A-6 | **EventBus 类型安全不足** | `EventBus.ts` | `emit(payload: any)` 类型丢失，消费者需手动断言。 |
| A-7 | **CrossDomainRouter 接口未抽象** | `CrossDomainRouter.ts` | 直接引用 `DomainClusterManager` 具体类，不可替换实现。 |
| A-8 | **AgentService 不可注入** | `AgentService.ts` | 内部 `new InMemorySessionRepo()`，测试时无法 mock。 |

### 重构建议

```
Phase 4.1 (P0): StudioServer 拆分
  StudioServer.ts (2763行)
    ├── ApiRouter.ts          ← 35+ API 端点
    ├── SSEManager.ts         ← SSE 连接管理
    ├── EngineBootstrapper.ts ← 引擎组件初始化
    └── StudioServer.ts       ← 仅编排启动

Phase 4.2 (P0): 集中配置管理
  config/ → 所有路径/URL 集中管理，通过 KernelConfig 下发

Phase 4.3 (P1): 依赖注入改造
  - Kernel 接受 DI 容器或工厂函数
  - MemoryBus ↔ KG 通过接口解耦
  - process.on 集中在一个 LifeycleManager

Phase 4.4 (P2): 接口抽象
  - EventBus 类型泛型
  - CrossDomainRouterInterface
  - AgentService 接受 SessionRepo 工厂
```

---

## 验证结果

- ✅ **Core e2e 测试**: 通过 (`packages/core/e2e-test.ts`)
- ✅ **extractJson 单元测试**: 10/10 通过（嵌套 JSON、转义引号、代码块等边界场景）
- ✅ **TypeScript 编译**: 无新增错误（全部为预存错误）
- ✅ **文档**: `ARCHITECTURE.md` + `README.md` 已同步更新

## 变更文件清单

### 修改的源文件 (10个)
| 文件 | 修改内容 |
|------|----------|
| `packages/core/utils/extractJson.ts` | 括号匹配算法重写，支持转义引号嵌套 |
| `packages/core/gateway/adapters/PiAdapter.ts` | abort 只中止匹配 executionId；事件注册添加 try-catch |
| `packages/core/core/Kernel.ts` | stop() 添加 finally 保证 EventBus 清理 |
| `packages/core/core/PluginSystem.ts` | startAll/stopAll 添加防重入锁 |
| `packages/core/utils/toposort.ts` | 依赖去重，避免入度偏高导致死锁 |
| `packages/core/planes/runtime-kernel/dag/DAGEngine.ts` | reroute 逻辑重构，状态一致性修复 |
| `packages/core/planes/runtime-kernel/fsm/FSMEngine.ts` | reset() 先清状态再 abort，避免异常阻止重置 |
| `packages/core/planes/knowledge-plane/memory/VectorStore.ts` | registerShutdown 去重防止重复注册 |
| `packages/memory/src/storage/JSONLWriter.ts` | 原子化 timer 管理 + 刷盘重试上限 |
| `packages/studio/server/StudioServer.ts` | BUG-2/6/8 修复；同步 I/O 替换为异步 |

### 新增文档 (2个)
| 文件 | 内容 |
|------|------|
| `docs/assessments/phase3-4-delivery.md` | 本交付报告 |
| `docs/assessments/phase4-extensibility-assessment.md` | 可扩展性详细评估 |

### 更新文档 (2个)
| 文件 | 更新内容 |
|------|----------|
| `README.md` | 版本号更新为 v2.3.0 |
| `docs/ARCHITECTURE.md` | 新增第12节质量审计与可扩展性评估 |
