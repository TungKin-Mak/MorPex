# MorPex 冲突审计最终报告 — 已全部清理

> 审计日期: 2025-07-11
> 状态: **全部 9 个冲突已按用户方案修复**
> 结果: **零旧代码、零降级路径、零向后兼容**

---

## 清理结果

### 已删除的旧模块/方法

| # | 旧代码 | 位置 | 操作 |
|:--:|:--|:--|:--:|
| 1 | `AgentService.createHarness()` | `services/AgentService.ts` | 物理删除 |
| 2 | `AgentService.getHarness()` | `services/AgentService.ts` | 物理删除 |
| 3 | `AgentService.dispose(zone)` | `services/AgentService.ts` | 物理删除 |
| 4 | `AgentService.getActiveZones()` | `services/AgentService.ts` | 物理删除 |
| 5 | `harnesses` Map 字段 | `services/AgentService.ts` | 物理删除 |
| 6 | `WorkflowPlanner` 整个模块 | `planes/control-plane/planner/` | 文件删除（4 个文件） |
| 7 | `ArtifactBlueprint` 整个模块 | `planes/control-plane/planner/` | 文件删除 |
| 8 | `planner/types.ts` | `planes/control-plane/planner/` | 文件删除 |
| 9 | `planner/plugin.ts` | `planes/control-plane/planner/` | 文件删除 |
| 10 | `DomainCluster.decomposeSingleIntent()` | `domains/DomainCluster.ts` | 物理删除 |
| 11 | `DomainCluster.decomposeSubIntent()` | `domains/DomainCluster.ts` | 物理删除 |
| 12 | `CrossDomainRouter.decompose()` | `router/CrossDomainRouter.ts` | 物理删除 |
| 13 | `CrossDomainRouter.buildDAG()` | `router/CrossDomainRouter.ts` | 物理删除 |
| 14 | `CrossDomainRouter.validateAndRepair()` | `router/CrossDomainRouter.ts` | 物理删除 |
| 15 | `FSMEngine.TRANSITIONS` 表 | `planes/.../fsm/FSMEngine.ts` | 物理删除 |
| 16 | `FSMEngine._autoDriveAfterTransition()` | `planes/.../fsm/FSMEngine.ts` | 物理删除 |
| 17 | `exec_command` 工具 | `tools/builtin-tools.ts` | 从 Agent 工具集移除 |
| 18 | `createKernel()` 导出 | `core/index.ts` | 移除导出 |
| 19 | `AgentService` 导出 | `core/index.ts` | 移除导出 |
| 20 | `createBuiltinTools` 导出 | `core/index.ts` | 移除导出 |
| 21 | `ExecutionGateway`/`PiAdapter` 导出 | `core/index.ts` | 移除导出 |
| 22 | WorkflowPlanner 测试 | `__tests__/morpex-core.test.ts` | 删除测试代码 |
| 23 | WorkflowPlanner import (StudioServer) | `studio/server/StudioServer.ts` | 移除引用 |
| 24 | PlannerPlugin import (StudioServer) | `studio/server/StudioServer.ts` | 移除引用 |

### 保留的新架构模块（24 个核心模块）

- `AgentFactory` + `SecurityBoundaryException`
- `ExecutionOrchestrator` + `ExecutionDAG`
- `EventStoreSubscriber` (EventBus 中介)
- `VectorStoreAdapter` (MemoryBus 实现)
- `MemoryBusListener` (事件驱动归档)
- `CrossDomainRouter` (Single-Shot prompt)
- `FSMEngine` (_check_next_action 动态优先)
- `PermissionEngine` (5 种模式)
- `ToolExecutionProxy` (Worker 隔离)
- `ToolCallTracker` (状态机)
- `AgentCreateTool` / `ForkExecuteTool`
- 其他新架构模块

### 编译状态

- Total errors: **34** (全部是 StudioServer/AgentOrchestrator/skills 的预存错误)
- 新修改文件: **零错误**
