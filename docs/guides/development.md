# 开发指南

> 面向贡献者的编码规范、测试流程、PR 指南

---

## 1. 项目结构

```
MorPex/
├── packages/               # 所有源码
│   ├── core/               # MorPexCore 引擎
│   ├── ai/                 # AI 推理引擎
│   └── studio/             # 前端 + 桥接
├── data/                   # 运行时数据 (gitignored)
├── docs/                   # 文档
├── scripts/                # 工具脚本
└── configs/                # 配置文件副本
```

## 2. 开发流程

### 2.1 新增功能

1. **确定所属模块**: `core/` (引擎) / `ai/` (推理) / `studio/` (前端)
2. **如果修改引擎**:
   - 在 `packages/core/planes/` 下对应平面添加/修改
   - 通过 EventBus 通信 (禁止直接 import 其他插件)
   - 注册到 Kernel PluginSystem
3. **如果修改前端**:
   - 视图在 `packages/studio/ui/ts/views/`
   - 组件在 `packages/studio/ui/ts/components/`
   - 状态在 `state.ts` / `dag-store.ts`
4. **写测试**: `packages/core/__tests__/` 或 `packages/studio/ui/ts/__tests__/`
5. **更新文档**: 对应 `docs/modules/` 下的文档

### 2.2 编码规范

```typescript
// 文件头
/**
 * 文件名 — 一句话说明
 * 
 * 详细说明职责和用法
 */

// 类型优先
interface SomeConfig {
  option1: string;
  option2?: number;
}

// 函数导出
export function doSomething(config: SomeConfig): Result {
  // 实现
}

// EventBus 事件统一格式
eventBus.emit({
  id: executionIdentity.createEventId(),  // 用 createEventId()
  type: 'domain.action',                   // {domain}.{action}
  timestamp: Date.now(),
  executionId: '相关的执行 ID',            // 必填
  source: '模块名',                        // 来源标识
  payload: { /* 数据 */ },
});
```

### 2.3 事件命名规范

```
格式: {domain}.{action}
示例: runtime.fsm.transition, intent.resolved, memory.stored

domain 列表:
  kernel      — 内核生命周期
  gateway     — 网关事件
  runtime     — 运行时 (fsm, dag, tool, task, execution)
  intent      — 意图识别
  plan        — 工作流规划
  llm         — LLM 调用
  orchestrator — Agent 编排
  human       — 人机协作
  memory      — 记忆
  knowledge   — 知识图谱
  artifact    — 产物
  swarm       — 多 Agent 拍卖
  industry    — 行业适配
  user        — 用户输入
```

## 3. 测试

### 3.1 引擎测试

```bash
# 端到端测试 (调真实 LLM)
npm run core:test

# API GateWay 测试
npm run test:api

# E2E 测试
npm run test:e2e
```

### 3.2 前端测试

```bash
cd packages/studio/ui

# 运行所有测试
npx vitest run

# Watch 模式
npx vitest

# UI 模式
npx vitest --ui
```

### 3.3 端到端测试 (Playwright)

```bash
cd packages/studio/ui

# 运行 E2E 测试
npx playwright test

# 有 UI 模式
npx playwright test --ui
```

## 4. 构建

```bash
# 构建前端
npm run studio:build

# TypeScript 类型检查
npx tsc --noEmit
```

## 5. PR 流程

1. 从 `main` 创建分支: `feature/your-feature-name`
2. 实现代码 + 测试
3. 更新文档
4. 确保所有测试通过
5. 提交 PR 到 `main`

### 提交信息格式

```
feat(core): 添加新的 FSM 状态转换
fix(studio): 修复 SSE 重连超时
docs(api): 更新 API_REFERENCE 事件类型表
refactor(ai): 重构 LLM 降级策略
test(core): 添加 Gateway 单元测试
```

## 6. 调试技巧

### 6.1 引擎调试

```typescript
// 打开 EventBus 所有事件监听
kernel.eventBus.on('*', (event) => {
  console.log(`[${event.type}]`, event.payload);
});

// 获取 EventBus 历史
const history = kernel.eventBus.getHistory();
console.table(history.slice(-10));

// 查看插件状态
console.log(kernel.getStatus());
console.log(kernel.pluginSystem.count);
```

### 6.2 前端调试

```typescript
// 浏览器控制台
window.__studio.manualRefresh();  // 手动刷新数据

// 查看 SSE 事件流
// 浏览器打开: http://localhost:8080/api/stream/global

// 查看状态
import { getState } from './state';
console.log(getState());
```

### 6.3 API 调试

```bash
# 查看所有 API 端点
curl http://localhost:8080/api/engine/check

# 测试 LLM 调用
curl -X POST http://localhost:8080/api/prompt \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}'

# SSE 流查看
curl -N http://localhost:8080/api/stream/global
```

## 7. 发布

```bash
# 1. 版本号更新
# 2. 构建前端
npm run studio:build

# 3. 构建引擎 (TypeScript)
npx tsc

# 4. 运行测试
npm run core:test
cd packages/studio/ui && npx vitest run

# 5. 生产启动
npm run start:prod
```
