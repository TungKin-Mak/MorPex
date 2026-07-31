# CLAUDE.md — MorPex 开发铁律

> 所有 Agent、所有任务必须遵守。违反任一条视为任务失败。

---

## 一、修改前必读文档

```
0. 读 SESSION_LOG.md → 项目状态 / 上轮摘要 / 待办（会话记忆入口，每次会话必读）
1. 读 docs/README.md → 定位模块文档
2. 读模块文档 → 理解数据流和架构
3. grep 搜索相关代码 → 确认影响范围
4. 再动手改
```

### 会话交接约定（铁律）

- **会话开始时**：必须先读 `SESSION_LOG.md`（含项目概览、会话历史、当前待办、关键路径），禁止对项目一无所知地开始。
- **会话结束时**：必须更新 `SESSION_LOG.md` 的「会话历史」表（追加本轮摘要 + 提交）与「当前待办」（勾选完成项 / 新增项），确保下个会话零上下文丢失。
- 若待办中有「推送提交」未做，请在会话结束时提醒。

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

---

## 十一、v12 架构铁律（一人公司 AI 工作助理）

### 模块分层

```
CEO 层:       CompanyFacade (统一入口)
组织层:       DepartmentManager / ManagementHub / RoleRegistry
群聊层:       GroupChatManager
大脑层:       BrainFacade (PersonalBrain + MemoryWiki + LearningLoop + EvolutionEngine)
规划层:       DeliveryPlanner (quick/full/auto)
执行层:       UnifiedExecutionEngine (mission/dag/fabric/auto)
子Agent层:    SubAgentFork (舰队管理)
记忆层:       DepartmentMemoryAdapter (部门分区)
SOP层:        SOPEngine (LLM分类 + 经验→标准流程)
KPI层:        DepartmentKPITracker (部门绩效)
```

### Facade 模式铁律

| 规则 | 说明 |
|------|------|
| **Facade 不替代** | UnifiedExecutionEngine/DeliveryPlanner/BrainFacade 是门面，委托给现有模块 |
| **零破坏** | Facade 模块永远不修改被包裹模块的内部代码 |
| **优雅降级** | 被包裹模块不可用时 Facade 自动降级（如 PiBridge→模拟执行） |
| **松耦合** | Facade 通过接口依赖（Like 后缀），不直接 import 具体类 |

### 学习闭环

```
任务完成 → BrainFacade.learn()
  → PersonalBrain.remember()     (内存级)
  → MemoryWiki.remember()        (持久化)
  → SOPEngine.extractSOP()       (LLM分类 → 模式检测 → 生成SOP)
  → LearningLoop + EvolutionEngine
  → 广播 brain.learning.completed
    → DeliveryPlanner 读取历史经验 → 影响下次规划
```

### 部门数据隔离

- DepartmentContext.partitionKey(deptId) → `dept:{departmentId}`
- DepartmentMemoryAdapter 在 MemoryWiki 之上加 tags 分区
- CEO 全局视图 = 不传 departmentId

### 引导入口

```typescript
import { bootstrapV12 } from './core/src/bootstrap-v12.js';
const v12 = await bootstrapV12(eventBus);
// v12.companyFacade.createDepartment("编程部");
// v12.managementHub.handleCommand("@编程部 写爬虫");
// v12.brainFacade.learn({ ... });
// v12.kpiTracker.generateCEOReport();
```

### 工作流插件

`packages/workflows/` 下存放热插拔工作流插件。当前已注册：

| ID | 路径 | 功能 |
|----|------|------|
| `xjmcu` | `workflows/xjmcu/` | 矽杰微 MCU 固件开发（生成→编译→烧录→仿真） |

插件通过 `manifest.json` 声明 actions，引擎自动发现。
插件不持有独立记忆库，查询共享 `memory.db`。
详情见 `docs/guides/workflow-xjmcu.md`。

---

### 通用基础原语（v16+，第 6 层 — 领域无关）

`packages/core/src/tools/primitives/` 只存放**领域无关**的通用原语（领域逻辑必须在 `packages/workflows/<domain>/`）：

| 原语 | 文件 | 职责 |
|------|------|------|
| `KnowledgeQueryPrimitive` | `KnowledgeQueryPrimitive.ts` | 知识查询（MUST 先过 Ontology Gate） |
| `ArtifactGenerationPrimitive` | `ArtifactGenerationPrimitive.ts` | 产物生成（MUST 携带知识上下文；写文件前有 Pre-Side-Effect Verify 钩子） |
| `FileOperationPrimitive` | `FileOperationPrimitive.ts` | 文件读写 |
| `ShellExecutionPrimitive` | `ShellExecutionPrimitive.ts` | Shell 执行 |
| `APICallPrimitive` | `APICallPrimitive.ts` | 外部 API 调用 |

原语通过 `DomainPrimitiveRegistry.match(taskDesc)` 自动匹配，
再经由 `ExecutionFabric` 或 `UnifiedExecutionEngine` 执行。
领域原语（如 xjmcu 生成）请放在 `packages/workflows/<domain>/`。

### 跨部门融合模块（v16+）

| 模块 | 路径 | 职责 |
|------|------|------|
| `CrossDepartmentKnowledgeSynthesizer` | `brain/` | 跨部门知识融合 + 模式迁移 |
| `CrossDepartmentArbitrationEngine` | `planner/` | 跨部门计划冲突检测与仲裁 |
| `ActiveEvolutionTrigger` | `evolution/` | 主动进化触发（失败/质量下降时） |
| `PatternMigrationEngine` | `evolution/` | 跨部门工作流模式迁移适配 |

### 理想架构对齐铁律（vNext 最终模型）

**所有迭代、升级、重构必须严格对齐 `README.md` 中的 Ideal Target Architecture（10 层模型）。**

**禁止**：
- 在 `planes/` 目录下新增任何代码（已废弃）
- 在 `brain/` 目录下新增新模块（已合并到 `cognition/`）
- 在 `control-plane/` 之外创建重复的 Controller 层
- 领域逻辑进入 core（必须放在 `packages/workflows/<domain>/`）

**必须**：
- 新模块必须对应理想架构的某一层
- Ontology Gate（第 2 层）是所有知识检索和生成的强制前置
- 所有通用原语必须先调用 Ontology Gate
- Brain 能力统一通过 `cognition/BrainFacade` 暴露

### vNext+ 生产级约束（分级闸门 / 有界执行 / 缺失即信号）

在 10 层模型之上，生产级升级必须遵守：

1. **Graded Ontology Gate** — 按风险分级，禁止一刀切全量两阶段：
   - `tier-0` Critical（资金/对外发布/架构变更/演化提案）→ 强制两阶段 + 引用校验 + 同步验证，禁止缓存
   - `tier-1` Standard（默认）→ 两阶段；允许短 TTL 缓存
   - `tier-2` Draft → 尽力查询；无结果进入 ControlledExploration
   - 所有生成/查询必须显式或按场景默认声明 `riskTier`
2. **Bounded Autonomy** — 每个 SubAgent / Mission 必须有迭代与成本上限：
   - `maxAttempts`（迭代上限，SubAgentFork）/ `maxIterations`、`maxCostTokens`（UnifiedExecutionEngine）
   - 超限 → 终止并产生 `* .budget.exceeded` / `*.iteration_limit` 事件进入 FailureAnalyzer，禁止空转
3. **QueryMiss is Signal** — 知识缺失不能静默失败：
   - 无结果必须产生 `ontology.query.miss` 事件（EventStore 持久化 + EventBus 广播）
   - `KnowledgeGapListener` 将缺失写入 Feedback（source='query_miss'）驱动演化
4. **Verifiable Evolution** — 演化提案必须：Ontology Gate（Tier-0）→ 评估 → 沙箱试跑 → 人工审批 → 版本化落地 + 可回滚；禁止「分析完直接改生产行为」
5. **Plan 可追溯** — 规划输出必须携带 `ontologyRefs[]`（引用了哪些事实），供审计与评估

**禁止**（vNext+ 追加）：
- 将知识缺失静默吞掉（必须 emit QueryMiss 信号）
- 让 Agent 无上限空转（必须配置迭代/成本上限）
- 绕过分级 Gate 做「一刀切」或「全部降级」

**检查命令**：
```bash
# 检查是否违反理想架构
grep -rn "from ['\"].*planes/" packages/core/src --include="*.ts" | grep -v DEPRECATED

# 运行架构对齐验证脚本
node scripts/validate-architecture.js
```
