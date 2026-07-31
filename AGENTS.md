# AGENTS.md — MorPex 项目规则（开发铁律）

> **本文件是 MorPex 的项目规则主文档**（主流 Agent 工具自动发现的标准入口）。所有 Agent、所有任务必须遵守；违反任一条视为任务失败。
> **会话进度**（历史摘要 / 待办 / 关键路径）在 `SESSION_LOG.md`——两者分工：本文件=规则，SESSION_LOG=进度。

---

## 0. 会话交接约定（铁律）

- **发现机制**：本文件（AGENTS.md）是主流 Agent 工具（Cursor/Codex/Claude Code/pi-coding-agent）自动发现的标准入口；项目级 `.pi/SYSTEM.md` 是 pi-coding-agent 专属系统入口。均指向 `SESSION_LOG.md`。
- **会话开始**：必须先读 `SESSION_LOG.md`（项目状态 / 上轮摘要 / 待办 / 关键路径），禁止对项目一无所知地开始。工具不自动读文件时，显式执行 `cat SESSION_LOG.md AGENTS.md`。
- **会话结束**：必须更新 `SESSION_LOG.md` 的「会话历史」（追加摘要+提交）与「当前待办」（勾选/新增），确保下个会话零上下文丢失。
- 待办有「推送提交」未做时，会话结束提醒。

## 1. 修改前必读文档

```
0. 读 SESSION_LOG.md → 项目状态 / 上轮摘要 / 待办（会话记忆入口）
1. 读本文件 → 项目规则
2. 读 morpex_ARCHITECTURE.md → 架构唯一真相源（10 层 + 约束）
3. grep 搜索相关代码 → 确认影响范围
4. 再动手改
```

## 2. 项目速览

**MorPex v16** — 一人公司 AI 工作助理（TypeScript / Node.js / pi-ai 0.81.1）
- **10 层 vNext+ 理想架构**（详见 morpex_ARCHITECTURE.md）：
  Entry/Governance · Ontology Gate ★ · Planning · Cognition/Brain · Execution · Tools/Primitives · Knowledge/Memory · Evolution · Workflow Plugin · Infrastructure
- **统一运行时**：`packages/core/src/bootstrap-unified.ts`（`bootstrapUnified()` 全 10 层装配）
- **核心执行链**：`CompanyFacade.executeGoal` → ControlPlane 门禁 → 编排 → 仿真 → Ontology Gate(真实 LLM) → UnifiedExecutionEngine（auto：原语兜底 → fabric/dag/mission）
- **原语注册中心**：`DomainPrimitiveRegistry`（19 原语 = 5 通用 + 14 插件），`executeAuto` 消费 + NL→参数提取

## 3. 架构铁律

### 3.1 理想架构对齐（10 层 vNext+）
所有迭代、升级、重构必须严格对齐 `morpex_ARCHITECTURE.md` 的 10 层模型。

**禁止**：
- 在 `planes/` 下新增任何代码（已废弃，仅剩 DEPRECATED.md）
- 在 `brain/` 下新增新模块（已合并到 `cognition/`，brain/index 仅兼容）
- 在 `control-plane/` 之外创建重复 Controller 层
- 领域逻辑进入 core（必须放 `packages/workflows/<domain>/`）

**必须**：
- 新模块必须对应理想架构某一层
- Ontology Gate（第 2 层）是所有知识检索/生成的强制前置
- 所有通用原语必须先调用 Ontology Gate
- Brain 能力统一通过 `cognition/BrainFacade` 暴露

### 3.2 真实状态优先级
```
Runtime 执行路径 > 代码调用关系 > 测试结果 > 架构文档 > 设计计划
```
禁止根据旧文档假设系统状态，先验证再动手。

### 3.3 数据流闭环
```
Input → Process → Output → Consumer → Storage
```
禁止创建无人消费的对象（幽灵模块）。

### 3.4 Planning 与 Execution 分离
- Planning 只产出 Plan，不执行、不调 Agent、不写外部系统
- Execution 只执行 Plan，不修改 Plan
- 通过 EventBus 反馈结果

### 3.5 核心管道与 EventBus Only
```
CompanyFacade → ControlPlane → Runtime(FSM/DAG) → EventBus → Knowledge/Memory
```
EventBus 是唯一通信通道；禁止模块间直接调用。

### 3.6 PiBridge 隔离铁律
- **唯一入口**：`packages/core/src/adapters/pi-bridge/PiBridge.ts` 是唯一允许运行时 `import ... from '@earendil-works/pi-ai'` / `pi-agent-core` 的文件
- **类型桥接**：`pi-types.ts` 允许 `import type`
- **升级隔离**：pi 包升级只需改 PiBridge.ts，业务代码零修改
- 检查：`grep -rn "from '@earendil-works/pi-ai'" --include="*.ts" packages/ | grep -v pi-bridge | grep -v pi-types | grep -v compat`

### 3.7 vNext+ 生产级约束（分级闸门 / 有界执行 / 缺失即信号）
1. **Graded Ontology Gate**：tier-0（资金/发布/架构/演化）强制两阶段禁缓存；tier-1（默认）短 TTL 缓存；tier-2（草稿）受控探索。禁止一刀切。
2. **Bounded Autonomy**：每个 SubAgent/Mission 必须有迭代/成本上限（`maxAttempts`/`maxIterations`/`maxCostTokens`），超限终止并产生 Failure 事件，禁止空转。
3. **QueryMiss is Signal**：知识缺失必须 emit `ontology.query.miss`（EventStore + EventBus）→ KnowledgeGapListener → Feedback，禁止静默。
4. **Verifiable Evolution**：演化产物必须 Ontology Gate(Tier-0) → 评估 → 沙箱试跑 → 人工审批 → 版本化落地 + 可回滚（`EvolutionSandbox`），禁止「分析完直接改生产行为」。
5. **Plan 可追溯**：规划输出必须携带 `ontologyRefs[]`。

## 4. 文件操作

| 规则 | 说明 |
|------|------|
| **搜索优先** | 新建前 `grep -r "关键词"` 确认同类文件不存在 |
| **修改优于新建** | 能扩展现有文件绝不新建 |
| **行数限制** | >800 行考虑拆分，>2000 行强制拆分 |
| **.js 后缀** | `import { X } from './X.js'`（非 `.ts`） |
| **变更传播** | 移动/重命名 → grep 更新所有 import → tsc；删除 → 清引用 + barrel 残留 |

## 5. 新模块硬性要求

**创建前**：是否已有类似能力？影响范围（caller/consumer/runtime/storage/events）？
**创建后集成检查**：谁实例化它（有 `new Xxx()`）？谁调用它（非仅测试）？在 barrel 链（index.ts 导出）？对接 EventBus？旧代码删除？
**完成标准（全部满足才算 DONE）**：文件存在 + 类型完整 + export 完整；Runtime 接入 + 真实调用路径；输入/输出/错误处理完整；文档同步。

## 6. 代码质量

| 规则 | 说明 |
|------|------|
| **禁止裸 `any`** | 仅允许：外部依赖无类型、动态 LLM provider |
| **null 安全** | 访问可空属性前必须检查或使用 `!` |
| **禁止吞异常** | `catch {}` 至少加 `console.warn` |
| **Promise 不等待** | 必须 `.catch(err => console.warn(...))` |

## 7. Bug 修复流程

```
1. 追溯完整数据流 → 找到最上游分岔点
2. 在分岔点修复 → 不在下游加 if/guard
3. 修复应降低系统复杂度 → 复杂度增加说明方向错了
```
禁止：下游 filter、setTimeout hack、单一边缘 case 的全局状态、绕过 EventBus。

## 8. 新功能生命周期

```
需求 → 架构定位 → 搜索已有能力 → 影响分析 → 设计方案
  → 实现 → Runtime 接入 → 数据流验证 → 文档同步 → 验收
```
禁止：需求 → 新建文件 → 宣布完成。

## 9. 任务结束自检

```
□ tsc --noEmit → 零错误
□ node scripts/production-check.cjs → 8/8 通过
□ node scripts/validate-architecture.js → 0 ERROR
□ 无残留旧路径引用
□ 新文件在 barrel 链中 + 有实例化 + 调用者
□ 无重复文件 / 无幽灵模块
□ 文档已更新
```

## 10. 反模式速查

| 反模式 | 修复 |
|--------|------|
| 幽灵模块（存在但无运行时引用） | 接入 Runtime 或删除 |
| 别名壳文件 `export { X as Y }` | 删除，更新 import 到规范名 |
| try-catch 吞异常 | 至少 `console.warn` |
| `any` 类型 | 改为具体类型或 `unknown` |
| 条件永不触发（未实例化） | 构造函数中实例化 |
| 直接创建文件宣布完成 | 走完整生命周期 |
| 用目录豁免掩盖违规 | 如实修复（领域规则/校验器豁免曾发生并修复） |

## 11. 模块分层速查

```
CEO 层:       CompanyFacade (统一入口)
治理层:       ControlPlane (Goal/Policy/Resource/Agent/Evolution 5 控制器)
大脑层:       cognition/BrainFacade (Reflection/MetaLearner/SelfImprovementLoop)
规划层:       planner/DeliveryPlanner + HierarchicalPlanner + Arbitration
执行层:       execution/UnifiedExecutionEngine (mission/dag/fabric/auto) + SubAgentFork
原语层:       tools/DomainPrimitiveRegistry + tools/primitives (5 通用原语)
知识层:       ontology/(Gate) + metadata/SystemMetadataGraph + memory/MemoryWiki + EventStore
演化层:       evolution/(ExperienceMiner/FailureAnalyzer/ActiveEvolutionTrigger/EvolutionSandbox/KnowledgeGapListener)
插件层:       packages/workflows/<domain>/ (xjmcu/ecommerce/hardware/software — 14 领域原语)
基础设施:     common/EventBus(唯一通道) + connectors/ + governance/(Dashboard/CostController/AlertEngine)
```

**Facade 模式**：Facade 不替代被包裹模块、零破坏、优雅降级、通过接口依赖（`Like` 后缀）。

**部门隔离**：`DepartmentContext.partitionKey(deptId)` → `dept:{id}`；CEO 全局视图不传 departmentId。

**学习闭环**：任务完成 → BrainFacade.learn → remember(内存/持久化) → SOPEngine → LearningLoop → 广播 → 影响下次规划。

## 12. 验证门禁（任何改动后必须跑）

```bash
npx tsc --noEmit -p tsconfig.json          # 编译 0 错误
node scripts/validate-architecture.js      # 架构对齐（当前 100%，0/0）
node scripts/production-check.cjs          # 生产就绪（8/8）
npx vitest run packages/core/__tests__/ontology-gate-tiering.test.ts \
  packages/core/__tests__/bounded-autonomy.test.ts \
  packages/core/__tests__/feature-regression.test.ts   # 核心测试（16 用例）
```

## 13. 开发流水线

```
advisor → fork/worker（可并行）→ optimizer → reviewer
 决策      实现                去冗余      审查
```
- 架构决策 → advisor；大型实现 → fork；独立小任务 → worker
- 实现完成 → optimizer（必须）→ reviewer（必须）

## 14. 提交约定

- 按功能分逻辑提交：`feat:` / `fix:` / `refactor:` / `docs:` / `chore:` / `test:`
- 中文信息说明意图；避免大杂烩提交；改动后必须过门禁
