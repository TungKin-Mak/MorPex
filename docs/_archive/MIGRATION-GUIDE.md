# MorPex v4.0 迁移指南 (MIGRATION-GUIDE)

> 从旧架构（直接依赖 Pi 包）迁移到 v4.0（Contracts + Adapter 隔离）
> 最后更新: 2026-07-18

---

## 1. 变更概述

v4.0 引入了 Contracts 层和 Adapter 层，将 Pi 包依赖从 Core 业务模块中完全移除。

### 之前 (v3.x)

```typescript
// Core 业务模块直接 import Pi 包
import { AgentHarness, InMemorySessionRepo } from '@earendil-works/pi-agent-core';
import { getModel, Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
```

### 之后 (v4.0)

```typescript
// Core 业务模块通过 adapters 层间接使用
import type { AgentTool } from '../adapters/pi-types.js';
import { Type } from '../adapters/pi-ai-types.js';
import { agentSpawner } from '../adapters/agent-spawner.js';
```

---

## 2. 公共 API 兼容性

### 不变的部分 ✅

以下公共 API 签名和行为**完全不变**：

| API | 位置 | 说明 |
|-----|------|------|
| `bootstrapMorPexCore(runtime)` | `packages/core/bootstrap.ts` | 启动入口 |
| `MorPexKernel` | `packages/core/src/common/Kernel.ts` | 内核 |
| `EventBus` | `packages/core/src/common/EventBus.ts` | 事件总线 |
| `ExecutionIdentity` | `packages/core/src/common/ExecutionIdentity.ts` | ID 生成 |
| `DomainCluster` | `packages/core/src/domains/DomainCluster.ts` | 领域集群 |
| `AgentFactory` | `packages/core/src/services/AgentFactory.ts` | Agent 工厂 |
| 所有 Tool 文件 | `packages/core/src/tool/*.ts` | 工具定义 |
| 所有 Plane 文件 | `packages/core/src/planes/` | 业务平面 |

### 新增的部分 🆕

| API | 位置 | 说明 |
|-----|------|------|
| `ContractGateway` | `gateway/ContractGateway.ts` | 基于 contracts 的新网关 |
| `PiAdapterBridge` | `gateway/PiAdapterBridge.ts` | 旧 PiAdapter → AgentRuntimePort 桥接 |
| Contracts 类型 | `@morpex/contracts` | 稳定端口类型（可独立使用） |
| Adapter 实现 | `@morpex/adapters` | PiAIAdapter, PiAgentCoreAdapter, MockRuntimeAdapter |

### 移除的部分 ❌

无公共 API 被移除。旧 `ExecutionGateway` 和 `PiAdapter` 保留共存。

---

## 3. 类型映射表

如果外部代码引用了 Pi 类型，迁移到 MorPex 类型：

| 旧类型 (Pi) | 新类型 (MorPex) | 位置 |
|-------------|----------------|------|
| `AgentTool` | `AgentTool` (重导出) | `adapters/pi-types.ts` |
| `AgentToolResult` | `AgentToolResult` (重导出) | `adapters/pi-types.ts` |
| `AgentMessage` | `AgentMessage` (重导出) | `adapters/pi-types.ts` |
| `AgentEvent` | `AgentEvent` (重导出) | `adapters/pi-types.ts` |
| `ThinkingLevel` | `ThinkingLevel` (重导出) | `adapters/thinking-level.ts` |
| `Type` (TypeBox) | `Type` (重导出) | `adapters/pi-ai-types.ts` |
| `Model` | `ModelInfo` | `adapters/model-registry.ts` |
| `Usage` | `TokenUsage` | `@morpex/contracts/inference` |
| `AgentHarness` | 不对外暴露 | 通过 AgentFactory.spawn() |

---

## 4. 迁移步骤（外部消费者）

如果外部包依赖了 MorPex 的旧 API：

### 步骤 1: 替换 import 路径

```typescript
// 旧
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { getModel } from '@earendil-works/pi-ai';

// 新
import type { AgentTool } from '@morpex/core';
import { findModel } from '@morpex/core';
```

### 步骤 2: 替换类型引用

```typescript
// 旧
const model: Model<Api> = getModel('deepseek', 'deepseek-v4-flash');

// 新
const model: ModelInfo = findModel('deepseek-v4-flash');
```

### 步骤 3: 使用 Contracts 类型（推荐）

```typescript
import type {
  AgentRuntimePort,
  AgentRunRequest,
  AgentRuntimeEvent,
} from '@morpex/contracts';

// 实现自定义 Adapter
class MyAdapter implements AgentRuntimePort {
  async *execute(request: AgentRunRequest): AsyncIterable<AgentRuntimeEvent> {
    // ...
  }
}
```

---

## 5. 内部架构变更（对 MorPex 开发者）

### 新增文件规则

1. Core 业务模块**禁止**直接 import `@earendil-works/*`
2. 如需使用 Pi 类型，从 `../adapters/pi-types.js` 导入
3. 如需使用 Pi 运行时，从 `../adapters/pi-utils.js` 或专用 adapter 导入
4. Adapter 层文件（`core/src/adapters/` 和 `packages/adapters/`）可以 import Pi 包

### 修改文件时检查

```bash
# 验证不会引入新的 Pi 依赖
npx dependency-cruiser packages/ --config .dependency-cruiser.js

# 验证类型正确
npx tsc --noEmit

# 验证契约不被破坏
npx tsx packages/adapters/__tests__/contract-tests.ts
```

---

## 6. 已知限制

| 限制 | 说明 | 计划 |
|------|------|------|
| `as never` 在 model-resolver | pi-ai 泛型约束过于严格 | 上游 API 限制，已最小化 |
| `as any` 在 PiAIAdapter | `streamSimple()` 参数类型复杂 | 上游 API 限制，仅 1 处 |
| Studio 层仍有直接 Pi import | SessionManager, StudioServer | 后续迁移（Phase D） |
| pi-agent-core TS 解析 artifact | `.d.ts` 使用 `.ts` 扩展名 | `skipLibCheck: true` |
