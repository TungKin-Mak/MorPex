# CLAUDE.md — MorPex 开发铁律

> 所有 Agent、所有任务必须遵守。违反任一条视为任务失败。

---

## 一、修改前必读文档

```
1. 读 docs/README.md → 定位模块文档
2. 读模块文档 → 理解数据流和架构
3. grep 搜索相关代码 → 确认影响范围
4. 再动手改
```

---

## 二、文件操作

| 规则 | 说明 |
|------|------|
| **搜索优先** | 新建前 `grep -r "关键词"` 确认同类文件不存在 |
| **修改优于新建** | 能扩展现有文件绝不新建 |
| **行数限制** | >800 行考虑拆分，>2000 行强制拆分 |
| **.js 后缀** | `import { X } from './X.js'`（非 `.ts`） |

---

## 三、新模块硬性要求

### 创建前 — 能力分析
```
是否已有类似能力？ YES → 为什么不能扩展？
                  NO  → 为什么必须新建？
影响范围: caller / consumer / runtime / storage / events
```

### 创建后 — 集成检查
```
□ 谁实例化它？       — 有 new Xxx() 调用
□ 谁调用它？         — 不只是测试引用
□ 在 barrel 链中？   — index.ts 已导出
□ 对接 EventBus？    — 如需要
□ 旧替代代码删除？   — 如适用
```

### 完成标准（全部满足才算 DONE）
```
□ 文件存在 + 类型完整 + export 完整
□ Runtime 接入 + 至少一个真实调用路径
□ 输入/输出明确 + 错误处理完整
□ 文档同步
```

---

## 四、代码质量

| 规则 | 说明 |
|------|------|
| **禁止裸 `any`** | 仅允许：外部依赖无类型、动态 LLM provider |
| **null 安全** | 访问可空属性前必须检查或使用 `!` |
| **禁止吞异常** | `catch {}` 至少加 `console.warn` |
| **Promise 不等待** | 必须 `.catch(err => console.warn(...))` |

---

## 五、变更传播

- **移动/重命名** → `grep -r "旧路径"` 更新所有 import → `tsc --noEmit`
- **删除文件** → 移除所有引用 → 检查 barrel export 残留
- **修改接口** → grep 所有消费者 → 逐一更新
- **代码变更** → 同步 `docs/ARCHITECTURE.md` + 对应模块文档

---

## 六、架构铁律

### 真实状态优先级
```
Runtime 执行路径 > 代码调用关系 > 测试结果 > 架构文档 > 设计计划
```
禁止根据旧文档假设系统状态。先验证再动手。

### 数据流闭环
```
Input → Process → Output → Consumer → Storage
```
禁止创建无人消费的对象。

### Planning 与 Execution 分离
- Planning 只产出 Plan，不执行、不调 Agent、不写外部系统
- Execution 只执行 Plan，不修改 Plan
- 通过 EventBus 反馈结果

### 核心管道
```
Kernel → Gateway → Runtime(FSM/DAG) → EventBus → Mirror → Knowledge/Memory
```
所有核心能力必须经过此管道，禁止绕过 EventBus 直接通信。

### 架构漂移检测
大型升级后检查：新模块是否入架构图、数据模型、EventBus、Runtime。

### PiBridge 隔离铁律（v11+）

```
┌─────────────────────────────────────────────────────┐
│  PiBridge.ts — 唯一直接导入 pi-ai / pi-agent-core  │
│  packages/core/src/adapters/pi-bridge/PiBridge.ts   │
└────────────────────────┬────────────────────────────┘
                         │ 对外暴露稳定接口
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
    pi-utils.ts    pi-types.ts    domain-cluster.ts
    agent-spawner.ts  SessionManager.ts  ...
```

| 规则 | 说明 |
|------|------|
| **唯一入口** | `PiBridge.ts` 是唯一允许 `import ... from '@earendil-works/pi-ai'` 和 `import ... from '@earendil-works/pi-agent-core'` 运行时导入的文件 |
| **类型桥接** | `pi-types.ts` 允许 `import type` 从 pi 包导入类型（编译后消失） |
| **升级隔离** | pi-ai 或 pi-agent-core 升级时，**只需改 PiBridge.ts**，业务代码零修改 |
| **禁止绕过** | 任何其他文件禁止直接导入 `@earendil-works/pi-ai` 或 `@earendil-works/pi-agent-core`（类型导入除外） |
| **新增能力** | 需要新的 pi 包能力时，先在 PiBridge 封装，再暴露给业务层 |

**检查方法：**
```bash
# 查找违规直接导入（PiBridge 和 pi-types 除外）
grep -rn "from '@earendil-works/pi-ai'" --include="*.ts" packages/ | grep -v pi-bridge | grep -v pi-types | grep -v compat
grep -rn "from '@earendil-works/pi-agent-core'" --include="*.ts" packages/ | grep -v pi-bridge | grep -v pi-types
```

---

## 七、Bug 修复流程

```
1. 追溯完整数据流 → 找到最上游分岔点
2. 在分岔点修复 → 不在下游加 if/guard
3. 修复应降低系统复杂度 → 复杂度增加说明方向错了
```

禁止：下游 filter、setTimeout hack、单一边缘 case 的全局状态、绕过 EventBus。

---

## 八、任务结束自检

```
□ tsc --noEmit → 零错误
□ node scripts/production-check.cjs → 8/8 通过
□ 无残留旧路径引用
□ 新文件在 barrel 链中
□ 新模块有实例化 + 调用者
□ 无重复文件
□ 文档已更新
□ 无幽灵模块（存在但无运行时引用）
```

### 生产就绪检查清单
```bash
node scripts/production-check.cjs   # 8项全量检查
npx tsx tests/run-all.ts            # 系统测试 20/20
npx vitest run packages/studio/server/event-mesh/__tests__/  # EventMesh 31/31
bash scripts/run-k6-test.sh --smoke # 负载冒烟测试
```

### 新增测试文件
| 文件 | 覆盖 |
|------|------|
| `packages/core/__tests__/security-prompt-injection.test.ts` | 10类注入攻击 38/38 |
| `packages/core/__tests__/production-llm-mock.test.ts` | LLM Mock 37/37 |
| `packages/core/__tests__/production-pipeline.test.ts` | Pipeline 40/40 |
| `packages/core/__tests__/production-sandbox.test.ts` | Sandbox 38/38 |
| `packages/core/__tests__/production-memory.test.ts` | Memory 32/32 |
| `packages/core/__tests__/critical-llm-mock.test.ts` | LLM 隔离 17/17 |
| `packages/core/__tests__/critical-cognitive-pipeline.test.ts` | 9阶段管线 26/26 |
| `packages/core/__tests__/critical-sandbox-security.test.ts` | 沙箱安全 52/52 |
| `packages/core/__tests__/critical-memory-knowledge.test.ts` | 记忆知识 26/26 |
| `scripts/k6-load-test.js` | k6 阶梯负载测试 |
| `scripts/run-k6-test.sh` | k6 一键运行器 |

---

## 九、反模式速查

| 反模式 | 修复 |
|--------|------|
| 幽灵模块（存在但无运行时引用） | 接入 Runtime 或删除 |
| 别名壳文件 `export { X as Y }` | 删除，更新 import 到规范名 |
| try-catch 吞异常 | 至少 `console.warn` |
| `any` 类型 | 改为具体类型或 `unknown` |
| 条件永不触发（未实例化） | 构造函数中实例化 |
| 直接创建文件宣布完成 | 走完整生命周期 |

---

## 十、新功能生命周期

```
需求 → 架构定位 → 搜索已有能力 → 影响分析 → 设计方案
  → 实现 → Runtime 接入 → 数据流验证 → 文档同步 → 验收
```

禁止：需求 → 新建文件 → 宣布完成。
