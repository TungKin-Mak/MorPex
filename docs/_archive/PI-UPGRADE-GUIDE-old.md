# Pi 升级手册 (PI-UPGRADE-GUIDE)

> 标准操作流程：升级 pi-ai / pi-agent-core
> 最后更新: 2026-07-18 | 适配器版本: v1 | 契约测试: 31/31

---

## 1. 概述

MorPex v4.0 使用适配器模式隔离 Pi 包。大多数升级只需要修改适配层，**不需要修改 Core 代码**。

```
pi-ai / pi-agent-core 升级
         │
         ▼
  修改 adapters/pi-ai/ 或 adapters/pi-agent-core/ 的 mapper
         │
         ▼
  类型检查 → 契约测试 → 边界检查 → 合并
```

### 关键文件

| 层级 | 文件 | 作用 |
|------|------|------|
| Contracts | `packages/contracts/` | 稳定端口定义（零 Pi 依赖） |
| Adapter | `packages/adapters/pi-ai/` | InferencePort 实现 |
| Adapter | `packages/adapters/pi-agent-core/` | AgentRuntimePort 实现 |
| Adapter | `packages/adapters/mock-runtime/` | 测试 Mock（零 Pi 依赖） |
| Core 隔离 | `packages/core/src/adapters/` | Core 内 Pi 类型/工具封装 |

---

## 2. 标准升级步骤（18 步）

### 阶段 1：准备

**步骤 1** — 查看上游 Release Notes / Changelog
```bash
cat node_modules/@earendil-works/pi-ai/CHANGELOG.md 2>/dev/null || echo "无 CHANGELOG"
cat node_modules/@earendil-works/pi-agent-core/CHANGELOG.md 2>/dev/null || echo "无 CHANGELOG"
```
→ 记录破坏性变更、新增功能、已移除 API

**步骤 2** — 确认 pi-ai 与 pi-agent-core 兼容关系
```bash
npm ls @earendil-works/pi-ai @earendil-works/pi-agent-core
```
→ 检查 peerDependency 警告；参考 `docs/PI-COMPAT-MATRIX.md`

**步骤 3** — 创建独立升级分支
```bash
git checkout -b upgrade/pi-0.80.0
```

### 阶段 2：依赖更新

**步骤 4** — 更新固定版本
```json
// package.json — 使用精确版本，不要 ^ ~ latest
{
  "dependencies": {
    "@earendil-works/pi-ai": "0.80.0",
    "@earendil-works/pi-agent-core": "0.80.0"
  }
}
```

**步骤 5** — 更新 lockfile
```bash
npm install
git add package.json package-lock.json
```

### 阶段 3：类型与静态检查

**步骤 6** — TypeScript 类型检查
```bash
npx tsc --noEmit
```
→ 关注 `packages/adapters/` 和 `packages/core/src/adapters/` 中的错误
→ Core 业务模块不应有新增错误

**步骤 7** — Lint
```bash
npx eslint packages/ --ext .ts 2>/dev/null || echo "ESLint not configured, skipping"
```

**步骤 8** — 依赖边界检查
```bash
npx dependency-cruiser packages/ --config .dependency-cruiser.js
```
→ 确保没有 Core 直接 import Pi 包的新违规

### 阶段 4：适配器测试

**步骤 9** — Adapter 单元测试
```bash
npx tsx packages/adapters/__tests__/contract-tests.ts
```
→ 31 项契约测试必须全部通过

**步骤 10** — Port 契约测试（同上，已包含）
→ 覆盖：流式输出、工具调用、错误、超时、取消、usage、reasoning、并发

**步骤 11** — 流式输出集成测试
```bash
# 需要真实 Pi 后端 + API key
MORPEX_API_KEY=xxx npx tsx scripts/test-streaming.ts 2>/dev/null || echo "跳过（无 Pi 后端）"
```

**步骤 12** — 工具调用集成测试
```bash
# 需要真实 Pi 后端
MORPEX_API_KEY=xxx npx tsx scripts/test-tool-calls.ts 2>/dev/null || echo "跳过（无 Pi 后端）"
```

### 阶段 5：语义验证

**步骤 13** — 检查错误映射变化
→ 比对 `pi-ai-error-mapper.ts` / `pi-agent-error-mapper.ts` 中的错误码映射
→ 是否有新的上游错误码需要映射

**步骤 14** — 检查 usage、reasoning 和 finish reason 变化
→ 比对 `pi-ai-event-mapper.ts` / `pi-agent-event-mapper.ts` 中的字段映射
→ usage 结构是否变化？reasoning 是否有新格式？

**步骤 15** — 检查 cancel、timeout、retry 语义
→ AbortSignal 传播路径是否正常
→ timeout 错误码是否一致
→ 是否存在双重重试（MorPex + Pi 同时重试）

**步骤 16** — 检查 session / checkpoint 兼容性
→ `InMemorySessionRepo` API 是否变化
→ checkpoint 能力是否有新增支持

### 阶段 6：发布

**步骤 17** — 在测试/灰度环境验证
```bash
# 灰度启用新 Adapter
# config: { agentAdapter: "pi-agent-core-v2" }
npm start
# 观察日志、指标
```

**步骤 18** — 记录兼容矩阵 + 合并或回滚
```bash
# 更新兼容矩阵
vim docs/PI-COMPAT-MATRIX.md

# 合并
git add docs/
git commit -m "upgrade: pi-ai → 0.80.0, pi-agent-core → 0.80.0"
git push

# 或回滚
git checkout package.json package-lock.json
npm install
```

---

## 3. 受影响的 Adapter 文件

升级时需要检查的文件清单：

### pi-ai 升级时检查

```
packages/adapters/pi-ai/
  ├─ PiAIAdapter.ts              ← 主适配器
  ├─ pi-ai-request-mapper.ts     ← 请求映射
  ├─ pi-ai-event-mapper.ts       ← 事件映射
  ├─ pi-ai-error-mapper.ts       ← 错误映射
  └─ model-resolver.ts           ← 模型解析

packages/core/src/adapters/
  ├─ pi-ai-types.ts              ← TypeBox 重导出
  ├─ model-registry.ts           ← 模型发现
  ├─ thinking-level.ts           ← 推理深度
  ├─ model-resolver.ts           ← 模型解析
  └─ pi-utils.ts                 ← 运行时工具
```

### pi-agent-core 升级时检查

```
packages/adapters/pi-agent-core/
  ├─ PiAgentCoreAdapter.ts       ← 主适配器
  ├─ pi-agent-request-mapper.ts  ← 请求映射
  ├─ pi-agent-event-mapper.ts    ← 事件映射
  ├─ pi-agent-error-mapper.ts    ← 错误映射
  └─ model-resolver.ts           ← 模型解析

packages/core/src/adapters/
  ├─ pi-types.ts                 ← 类型重导出
  ├─ pi-utils.ts                 ← 运行时工具
  ├─ pi-augmentations.ts         ← 类型声明合并
  ├─ agent-spawner.ts            ← Agent 创建
  └─ domain-cluster.ts           ← 领域 Agent 创建
```

---

## 4. 常见 API 变更及适配方法

### 4.1 Export 名称变更
```typescript
// 旧 → 新
import { streamSimple } from '@earendil-works/pi-ai';
import { streamText } from '@earendil-works/pi-ai';
```

### 4.2 函数签名变更
```typescript
// 旧
const result = await streamSimple(model, messages, options);
// 新
const result = await streamText({ model, messages, ...options });
```

### 4.3 函数移除
```typescript
// 如果 completeSimple 被移除，替换为 streamSimple + 收集
async function completeFallback(model, messages) {
  let full = '';
  for await (const chunk of streamSimple(model, messages)) {
    if (chunk.type === 'text_delta') full += chunk.text;
  }
  return full;
}
```

### 4.4 新增事件类型
```typescript
// 在 pi-ai-event-mapper.ts 中添加
case 'new_event_type':
  return { type: 'unknown', runId, raw: event, timestamp: Date.now() };
```

### 4.5 TypeScript 类型名称变更
```typescript
// 更新 pi-types.ts 中的 import type
import type { Tool } from '@earendil-works/pi-agent-core';
// 并更新重导出别名
export type MPAgentTool = Tool;
```

---

## 5. 灰度与切换

通过 bootstrap 配置切换 Adapter，不在 Core 中添加版本判断：

```typescript
// bootstrap 或 config
const adapter = new PiAgentCoreAdapter({
  defaultProvider: 'deepseek',
  defaultModelId: 'deepseek-v4-flash',
});

// 灰度：新旧并存
const adapterV1 = new PiAgentCoreAdapter({ ... });      // 当前
const adapterV2 = new PiAgentCoreAdapterV2({ ... });    // 新版
```

### 切换命令
```bash
# 环境变量切换
MORPEX_ADAPTER_VERSION=v2 npm start

# 或配置文件
vim configs/production.config.json
# { "runtime": { "adapterVersion": "v2" } }
```

---

## 6. 回滚流程

### 快速回滚（推荐）
```bash
git checkout package.json package-lock.json
npm install
npx tsx packages/adapters/__tests__/contract-tests.ts  # 验证
```

### Git 回滚
```bash
git revert <upgrade-commit-hash>
git push
```

### 配置切换回滚
```bash
MORPEX_ADAPTER_VERSION=v1 npm start
```

---

## 7. 禁止操作

| 操作 | 原因 |
|------|------|
| 在 Core 中直接修改 Pi import | 破坏隔离层 |
| 使用 `latest` / `^` / `~` 版本 | 不可复现构建 |
| 引用 GitHub main/master/HEAD | 未固定引用 |
| 复制 Pi 源码到项目 | 许可证 + 维护困难 |
| 引用 Pi 未公开内部 API | 无兼容性保证 |
| 在 Core 中添加版本判断 | 逻辑泄漏 |
| 强制 pi-ai 和 pi-agent-core 同版本 | 应独立升级 |

---

## 8. 故障排除

| 症状 | 可能原因 | 检查 |
|------|---------|------|
| `TS2305: no exported member` | Export 名称变更 | 检查 Pi 包的 `exports` 字段 |
| `TypeError: is not a function` | 函数签名变更 | 检查 Pi CHANGELOG |
| 未知事件类型警告 | 新增事件类型 | 在 event-mapper 中添加映射 |
| usage 字段缺失 | usage 结构变更 | 更新 `mapUsage()` |
| 流式延迟增加 | transport 变更 | 检查 `StreamOptions.transport` |
| 双重重试 | Pi 新增内部重试 | 在 Adapter 中禁用 Pi 重试 |
