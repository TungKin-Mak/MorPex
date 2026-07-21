# CLAUDE.md — MorPex 永久开发铁律

> **适用**: 所有对话、所有 Agent、所有任务  
> **优先级**: 最高 — 违反任一条视为任务失败  
> **版本**: v1.4 | MorPex v7 — 99/100 Architecture Health | 0 Dead | 100% Runtime

---

## 📊 当前架构健康度（MorPex v7 — Autonomous Runtime）

```
Architecture Score: 99/100

Runtime Connectivity  ██████████ 100%  (6/6 paths, 179/190 active)
Event Connectivity    ██████████ 100%  (33/33 complete chains)
Dependency Health     ██████████ 100%  (190/190 connected, 0 dead)
Plugin/DI Coverage    ██████████ 100%  (9/9 recognized)
Public API Coverage   ██████████ 100%  (29/29 resolved)
Test Coverage         █████████░  90%  (28 test files, 20 test suites)
```

| 指标 | 值 |
|------|----|
| Architecture Score | **99/100** |
| System Health | **100%** (20/20 suites, 169 assertions) |
| Real Data Test | **56/56** assertions, 9 module groups |
| Dead Modules | **0** (was 33, false positive reduction 100%) |
| Critical Issues | **0** |
| Validation Health | **100/100** (6 validators, 95 assertions) |
| Module Classification | 150 ACTIVE_RUNTIME, 29 PUBLIC_API, 8 EVENT_LISTENER, 2 DORMANT |
| Test Coverage | **90%** (28 tests / 155 impl files, 1:5 ratio) |

---

## 🔴 零、先读文档再改代码（最高铁律）

**修改任何代码前，必须先阅读相关文档。** `docs/README.md` 是文档索引，指向所有模块文档。

```
改代码前强制流程:
  1. 读 docs/README.md → 找到对应模块文档
  2. 读模块文档 → 理解数据流、架构、接口
  3. grep 搜索相关代码 → 确认影响范围
  4. 再动手改

❌ 错误: 看到报错 → 直接猜原因 → 改代码 → 引入新问题
✅ 正确: 看到报错 → 读文档理解数据流 → 定位根因 → 精准修改
```

**参考今天的问题**：自行拆解 `planOnly` 假函数破坏了 MetaPlanner 的 7-Stage Pipeline，因为没先读 `docs/modules/studio-server.md §3.2` 中的原始数据流。

---

## 🔴 一、文件创建铁律（防重复、防垃圾）

### 1.1 创建前必须先搜索
```
❌ 错误: 直接 write 新文件
✅ 正确: grep -r "关键词" → 确认不存在 → 再创建
```
**任何时候新建文件，必须先证明同类文件不存在。**

### 1.2 修改优于新建
```
❌ 创建 PipelineExecutorV2.ts（重复）
✅ 修改 PipelineExecutor.ts（扩展现有文件）
```
**如果一个功能可以放到已有文件中，绝不新建文件。**

### 1.3 一个文件一个职责
```
❌ 一个 3000 行的 MetaPlanner.ts 包含 7 个 Stage + 扩展 + 事件
✅ MetaPlanner.ts(~700行) + PipelineExecutor.ts(~1800行) 各司其职
```
**文件超过 800 行 → 拆分。文件超过 2000 行 → 强制拆分。**

---

## 🔴 二、集成铁律（防"创建不接入"）

### 2.1 新建模块必须回答 6 个问题
```
创建 Foo.ts 后，必须验证：
  ✅ 1. 谁实例化它？（new Foo() 在哪里？）
  ✅ 2. 谁调用它？（方法被谁引用？）
  ✅ 3. 它依赖什么？（构造函数参数是否都已注入？）
  ✅ 4. 它在 barrel 链中吗？（index.ts 是否导出？）
  ✅ 5. 它对接 EventBus 了吗？（如果需要的话）
  ✅ 6. 旧代码删除了吗？（如果它是替代品）
```

### 2.2 禁止"幽灵模块"
```
❌ 文件存在、测试通过、但没有任何运行时 import 它
✅ 创建后立即在 MetaPlanner / Kernel / StudioServer 中接入
```

### 2.3 接入点检查清单
| 模块类型 | 必须接入的位置 |
|---------|--------------|
| 规划引擎 | MetaPlanner 构造函数 → `extensions.push()` 或 PipelineDeps |
| 扩展模块 | ExtensionRegistry 或 MetaPlanner.extensions |
| 拦截器 | ExecutionGateway 或 AgentReasoningInterceptor |
| 录制/观测 | Kernel.start() 或 StudioServer.initComponents() |
| 公共 API | 三级 barrel 链: `planning/index.ts` → `extensions/index.ts` → `src/index.ts` |

---

## 🔴 三、类型安全铁律（防 any、防 null、防隐式）

### 3.1 禁止裸 any
```
❌ private dagEngine: any;
✅ private dagEngine: DAGEngine | null;
```
**`any` 只允许在以下情况: 外部依赖无类型定义、动态注入的 LLM provider。其他一律禁止。**

### 3.2 null 安全
```
❌ this.pipeline.execute(...)  // this.pipeline 可能是 null
✅ this.pipeline!.execute(...) // 已在上文检查过
✅ if (this.pipeline) { this.pipeline.execute(...) }
```

### 3.3 导入路径强制 .js 后缀
```
❌ import { Foo } from './Foo'
✅ import { Foo } from './Foo.js'
```

---

## 🔴 四、变更传播铁律（防路径腐烂）

### 4.1 文件移动/重命名 → 三步走
```
1. 移动文件
2. grep -r "旧路径" → 更新所有 import
3. tsc --noEmit → 零新增错误
```

### 4.2 删除文件 → 两步走
```
1. grep -r "from.*DeletedFile" → 移除所有引用
2. 检查 barrel export 是否残留
```

### 4.3 修改接口/类型 → 全量搜索
```
修改 types.ts 中的接口字段 → grep 所有消费者 → 逐一更新
```

---

## 🔴 五、文档同步铁律（防"计划书说已完成但实际未接入"）

### 5.1 计划书状态必须验证
```
看到 "✅ 已交付" → 不要信任 → 实际检查:
  1. 文件是否存在
  2. 是否有 new ClassName() 调用
  3. 方法是否被运行时调用（不只是测试脚本）
```

### 5.2 代码变更 → 文档同步
| 变更类型 | 同步目标 |
|---------|---------|
| 新增模块 | `docsARCHITECTURE-v3.1-optimized.md` + `features-and-architecture.md` |
| 修改架构 | `ARCHITECTURE.md` 状态横幅 |
| 新增 API | `modules/studio-server.md` |
| 拆分文件 | `docsARCHITECTURE-v3.1-optimized.md` 文件树 |

---

## 🔴 六、自检清单（每次任务结束前必须执行）

```
□ 1. tsc --noEmit → 规划层文件零新增错误
□ 2. grep -r "from.*旧路径" → 零残留
□ 3. 新文件在 barrel 链中 → planning/index.ts → extensions/index.ts → src/index.ts
□ 4. 新模块有 new 语句 → MetaPlanner/Kernel/StudioServer 中至少一处
□ 5. 新模块有调用者 → 不只是测试脚本引用
□ 6. 没有重复文件 → grep 同类功能确认唯一
□ 7. 文件行数合理 → ≤ 800（普通）/ ≤ 2000（管道类）
□ 8. 文档已更新 → 至少 ARCHITECTURE.md 状态横幅
```

---

## 🔴 七、常见反模式速查

| 反模式 | 表现 | 修复 |
|--------|------|------|
| **幽灵模块** | 文件存在、测试通过、无运行时引用 | 接入 MetaPlanner 或删除 |
| **别名模块** | `PlanEvaluator.ts` / `TemplateEvolutionEngine.ts` 等 `export { X as Y }` 壳文件 | 直接删除，更新所有 import 到规范名。不在 barrel 中保留向后兼容别名 |
| **try-catch 吞异常** | `catch { /* non-critical */ }` 无日志 | 至少加 `console.warn` |
| **硬编码路径** | `kernel-extensions/planning/` | 全部改为 `extensions/planning/` |
| **Promise 不等待** | `mp.planningIntelligence.evolveTemplates()` 无 `.catch()` | 加 `.catch(err => console.warn(...))` |
| **条件永远不触发** | `if (this.topologyExplorer)` 但未实例化 | 构造函数中实例化 |
| **类型断言过多** | `as unknown as [T,T,T]` | 重构接口为 `T[]` |

---

## 📋 适用范围

本铁律适用于所有以下场景:
- 架构升级（如 v3.0 → v3.1）
- 模块拆分/合并
- 新功能开发
- Bug 修复
- 重构

**违反任一条 → 任务不通过。零例外。**

---

# 🔴 八、架构事实优先铁律（Architecture Reality First）

系统真实状态优先级：

1.  Runtime 实际执行路径
2.  代码调用关系
3.  测试验证结果
4.  架构文档
5.  设计计划

禁止根据旧文档、计划书或历史描述假设系统状态。

任何 Agent 开始任务前必须确认：

-   当前是否已有类似功能
-   当前入口在哪里
-   当前数据流如何流动
-   当前调用链是什么
-   当前 Runtime 注册位置
-   当前存储位置

无法回答以上问题时，禁止修改代码。

---

# 🔴 九、新功能开发生命周期铁律（Feature Lifecycle）

任何新增功能必须经过：

需求定义

↓

架构定位

↓

搜索已有能力

↓

影响分析

↓

设计方案

↓

实现

↓

Runtime 接入

↓

数据流验证

↓

文档同步

↓

验收

禁止：

需求 → 直接创建新文件 → 宣布完成

---

# 🔴 十、新模块创建前强制分析

创建新的 Class / Service / Agent / Manager 前必须输出：

    Existing Capability Analysis:

    是否已有类似能力:
    YES / NO

    如果 YES:
    为什么不能扩展已有模块?

    如果 NO:
    为什么必须创建新模块?

    影响范围:
    - caller:
    - consumer:
    - runtime:
    - storage:
    - events:

没有分析结果，不允许创建。

---

# 🔴 十一、禁止 AI 架构膨胀

禁止默认创建：

-   PlannerV2
-   MemoryServiceNew
-   RuntimeEnhanced
-   AgentManager2

规则：

扩展 \> 新建

合并 \> 分裂

删除废弃代码 \> 保留旧实现

只有满足以下条件才允许新版本模块：

-   旧模块无法承担新职责
-   新旧迁移方案明确
-   旧模块最终删除计划明确

---

# 🔴 十二、模块完成标准（Definition of Done）

模块只有满足：

    [ ] 文件存在

    [ ] 类型定义完成

    [ ] Export 完成

    [ ] 注册完成

    [ ] Runtime 接入完成

    [ ] 至少一个真实调用路径

    [ ] 输入数据明确

    [ ] 输出数据明确

    [ ] 错误处理完成

    [ ] 文档同步完成

才允许标记 DONE。

否则状态：

-   PARTIAL
-   EXPERIMENTAL
-   UNUSED

---

# 🔴 十三、数据流闭环铁律

任何 Feature / Pipeline / Agent 必须证明：

Input

↓

Process

↓

Output

↓

Consumer

↓

Storage / Side Effect

禁止：

创建对象但无人消费。

例如：

错误：

Planner → 生成 Plan → 无 Runtime 执行

错误：

Memory Encoder → 生成 Memory → 无 Storage

错误：

Artifact Builder → 创建 Artifact → 无 Repository

---

# 🔴 十四、核心模块修改影响分析

以下模块属于核心：

-   MetaPlanner
-   RuntimeKernel
-   ExecutionEngine
-   Memory
-   Knowledge
-   Artifact
-   AgentRegistry
-   EventBus
-   Storage

修改前必须输出：

    Impact Analysis:

    Affected Files:

    Affected Classes:

    Affected Functions:

    Runtime Flow Change:

    Data Flow Change:

    Backward Compatibility:

---

# 🔴 十五、架构漂移检测

大型升级必须比较：

设计架构

VS

实际代码架构

检查：

-   新模块是否进入架构图
-   新数据是否进入数据模型
-   新事件是否进入 EventBus
-   新能力是否进入 Runtime

---

# 🔴 十六、任务结束强制报告

任何代码修改完成后必须输出：

    Change Summary:

    1. 修改文件:

    2. 新增文件:

    3. 删除文件:

    4. 数据流变化:

    5. Runtime变化:

    6. 架构影响:

    7. 是否产生重复能力:
    YES / NO

    8. 是否需要文档更新:
    YES / NO

---

# 🔴 十七、禁止"看起来完成"

以下不代表完成：

-   文件创建成功
-   TypeScript 编译通过
-   单元测试通过
-   Export 完成

必须验证真实运行路径：

User Request

↓

API

↓

Planner

↓

Runtime

↓

Agent

↓

Artifact

↓

Memory

---

# 🔴 十八、Architecture Recovery 文档规则

以下目录作为架构事实参考：

    docs/recovery/

包含：

-   repository_inventory.md
-   architecture.md
-   runtime.md
-   data_flow.md
-   dependency_graph.md
-   integration.md

代码修改前：

1.  阅读相关 recovery 文档
2.  检查真实代码
3.  修改后同步更新

如果文档和 Runtime 冲突：

Runtime + Code 优先。

然后修正文档。

---

# 🔴 十九、Runtime Owner 接入规则

新增模块必须进入对应真实 Owner：

Planning: MetaPlanner

Execution: RuntimeKernel

Agent: AgentRegistry

Memory: MemoryManager

Knowledge: KnowledgePlane

UI: StudioServer

Tool: ToolRegistry

禁止将所有功能强行塞入单一模块。

---

# 🔴 二十、架构约束规则（Architecture Repair TODO v1 Phase 8）

## Rule 1 — 模块必须闭环

任何新增模块必须满足：

```
✅ 有输入（谁调用它 / 哪个事件触发它）
✅ 有输出（产生什么结果 / 触发什么事件）
✅ 有调用链（从入口到出口的完整路径）
✅ 有 Runtime 路径（在 Kernel.start() / StudioServer / MetaPlanner 中至少一处被实例化或注册）
```

## Rule 2 — 禁止幽灵模块

```
❌ Create File + Export + Never Used
```

即：
- 创建文件后立刻搜索是否有 `import` 调用（不只是 barrel chain）
- 搜索是否有 `new ClassName()` 实例化（不只是测试文件）
- 搜索是否有 `register()` 注册（如果需要注册的话）
- 三项缺一不可

## Rule 3 — 核心能力必须经过完整管道

所有核心能力必须经过以下路径：

```
Kernel
  ↓
Gateway（ExecutionGateway / ContractGateway）
  ↓
Runtime（ExecutionFSM → DAGRuntime / Dispatcher）
  ↓
EventBus（事件广播）
  ↓
Mirror（ExecutionMirror 录制）
  ↓
Knowledge/Memory（持久化 + 上下文注入）
```

违反示例：
- ❌ Planner → 直接写入文件，没有经过 EventBus
- ❌ Agent → 直接存数据，没有经过 Memory Layer
- ❌ Tool → 调用外部 API 但不记录到 Mirror

## Rule 4 — Planning 与 Execution 严格分离

```
Planning（MetaPlanner / CrossDomainRouter）
  ↓
  只产生 Plan Blueprint（ExecutionDAG）
  ↓
Execution（Runtime Kernel / DAGRuntime / Dispatcher）
  ↓
  负责真实执行
```

- Planning 不执行任务
- Planning 不调用 Agent
- Planning 不写入外部系统
- Execution 不修改 Plan（只执行）
- Execution 通过 EventBus 反馈结果给 Planning

违反示例：
- ❌ MetaPlanner 内部直接调用 Agent
- ❌ Pipeline Stage 直接执行工具调用
- ❌ Router 直接修改外部状态

---

# 🔴 二十一、Architecture Auditor v3（架构审计 v3）

MorPex v7 使用 Architecture Auditor v3 进行架构健康度评估。

## 评分模型

| 维度 | 权重 | 当前得分 |
|------|------|---------|
| Runtime Connectivity | 30% | 100% — 6/6 运行时路径完整 |
| Event Connectivity | 20% | 100% — 33/33 事件完整闭环 |
| Dependency Health | 15% | 100% — 190/190 模块已连接 |
| Plugin/DI Coverage | 15% | 100% — 9/9 插件/DI 已识别 |
| Public API Coverage | 10% | 100% — 29/29 公开 API 可解析 |
| Test Coverage | 10% | 90% — 28 测试 / 155 实现 |

**总分: 99/100**

## 8 级模块分类系统

不再使用简单的 "Dead/Alive" 二分法：

| 分类 | 含义 | 数量 |
|------|------|------|
| `ACTIVE_RUNTIME` | 有真实调用链 | 150 |
| `ACTIVE_PUBLIC_API` | 从 barrel 导出给外部消费者 | 29 |
| `EVENT_LISTENER` | 通过 EventBus 监听事件 | 8 |
| `TEST_ONLY` | 测试/验证脚本 | 7 |
| `DORMANT_CAPABILITY` | 有意保留的未来能力 | 2 |
| `PLUGIN_CAPABILITY` | 通过 PluginSystem 注册 | 1 |
| `DEAD` | 真正无用 | **0** |

## 误报消除

| 检测能力 | v2 (旧) | v3 (新) |
|---------|--------|--------|
| Pipeline 动态加载 | ❌ 误判 DEAD | ✅ 识别为 DI_CREATED |
| EventBus 订阅者 | ❌ 误判 DEAD | ✅ 识别为 EVENT_LISTENER |
| DI `new ClassName()` | ❌ 误判 DEAD | ✅ 从 bootstrap/Kernel 检测 |
| Plugin 注册 | ❌ 误判 DEAD | ✅ 从 bootstrap 检测 |
| Public API barrel 导出 | ❌ 误判 DEAD | ✅ 解析 index.ts export 链 |
| 副作用导入 `import '...'` | ❌ 漏检 | ✅ ModuleScanner 增加检测 |

**误报减少: 33 → 0（100%）**

## 运行

```bash
npx tsx scripts/run-audit.ts
```

输出保存至 `data/architecture-report.json`。

---

# 🔴 二十二、System Test Suite（系统测试套件）

## 目录结构

```
tests/
├── run-all.ts                    # 运行器：加载全部测试，生成 System Health Report
├── framework.ts                  # AssertionContext + TraceBuilder + ReportGenerator
├── architecture/                 # 模块图 / Runtime 图 / Event 图 / Harness 边界
│   ├── module-graph.test.ts      # Auditor v3 扫描，验证 190 模块分类
│   ├── runtime-graph.test.ts     # FSM→DAG→Checkpoint→Recovery→Replay 全链路
│   ├── event-graph.test.ts       # 33 事件类型全部闭环
│   └── harness-boundary.test.ts  # 7 上下文 + 权限 + 资源代理
├── unit/                         # Runtime Kernel 单元
│   ├── fsm.test.ts               # 10 状态生命周期
│   ├── dag.test.ts               # 时序/并行/超时/重试/循环检测
│   ├── checkpoint.test.ts        # 保存/加载/列出/删除/清理
│   └── recovery.test.ts          # Crash/Tool 失败/LLM 耗尽/Replay
├── integration/                  # 架构层间链路
│   ├── intent-to-planning.test.ts
│   ├── planning-to-runtime.test.ts
│   ├── runtime-to-harness.test.ts
│   ├── harness-to-memory.test.ts
│   ├── artifact-to-knowledge.test.ts
│   └── execution-to-learning.test.ts
├── scenarios/                    # 端到端场景
│   ├── simple-task.test.ts
│   ├── multi-step-task.test.ts
│   ├── failure-recovery.test.ts
│   └── learning-improvement.test.ts
├── chaos/                        # 故障注入
│   ├── agent-crash.test.ts
│   └── tool-failure.test.ts
├── performance/                  # DAG 规模 / Agent 数量 / Event 吞吐
└── real-data-full-system.test.ts # 真实数据全功能测试
```

## 运行

```bash
# 完整测试套件（20 个测试，20+ 秒）
npx tsx tests/run-all.ts

# 真实数据全功能测试（56 断言，9 模块组）
npx tsx tests/real-data-full-system.test.ts
```

## System Health Report

运行后输出至 `data/system-health-report.json`（机器可读）和 `data/system-health-report.txt`（人类可读）。

报告维度：
- Architecture Coverage — 模块图/运行时图/事件图/插件图
- Runtime Coverage — FSM/DAG/Checkpoint/Recovery/Replay
- Scenario Success Rate — 4 个端到端场景
- Recovery Rate — Agent Crash + Tool Failure
- Replay Accuracy — 确定性重放
- Learning Effectiveness — 经验去重 + 模板演化

---

# 🔴 二十三、Real Data Testing（真实数据测试）

测试系统行为，不是测试文件存在。

`tests/real-data-full-system.test.ts` 不使用任何 mock 对象。

## 9 个模块组全部用真实数据

| 模块 | 真实输入 | 断言 |
|------|---------|------|
| Intent Analysis | 151 字符真实用户需求（"Build REST API..."） | 7 |
| ExecutionFSM | 10 状态真实转换 + 磁盘 JSONL 持久化 | 6 |
| DAG Runtime | 5 节点 DAG（Setup→Backend→Auth→Tests→Deploy） | 3 |
| Checkpoint/Recovery/Replay | 真实快照模拟 Auth 失败 + 磁盘 I/O | 8 |
| AgentHarness | 7 上下文 + 真实记忆注入 + 版本追踪 | 10 |
| Memory Activation | 7 条技术记忆（Express/TypeORM/JWT/K8s/CI-CD） | 6 |
| Artifact Graph | 5 个真实产物节点 + 血缘追踪 | 6 |
| Learning Loop | 真实 270 秒执行记录 | 7 |
| Harness Resource Access | 真实注册/读取/搜索/权限 | 6 |

**结果: 56/56 断言通过。**

## 测试原则

1. 不使用 mock — 每个模块用真实输入、真实 I/O、真实状态转换
2. 测试系统行为，不是测试文件存在
3. 验证调用链可运行，不只是 import 链完整
4. 每个场景输出 ExecutionTrace（状态/产物/记忆/学习时间线）

---

# 🔴 二十四、架构优先修复铁律（Architecture-First Fix）

## 原则

**不要为某个问题选择只修复这一块问题的方法，要从框架、架构出发，选择最好的修复方式。**

## 反模式：局部补丁

```
看到症状 → 在症状出现的位置加 if/else → 引入新问题 → 再加补丁 → 代码腐烂
```

示例（本次对话）：
- ❌ 双回复 → 加护栏 → 加延迟 → 加 JSON 检测 → 越补越复杂
- ✅ 双回复 → 追溯数据流 → 发现 SSE/HTTP 双通道 → 改为 SSE 单通道 → 根本解决

## 正确流程

```
1. 追溯完整数据流（从哪里来、经过哪些节点、到哪里去）
2. 画出调用链（谁触发、谁处理、谁消费）
3. 找到最上游的分岔点（在哪里开始走错方向）
4. 在分岔点修复，而非在下游拦截
5. 验证所有场景（正常、异常、边界）
```

## 判断标准

| 局部补丁 | 架构修复 |
|---------|---------|
| 在下游加 if 过滤 | 在上游区分数据来源 |
| 增加状态变量协调 | 减少数据通道 |
| 依赖时序/延迟 hack | 依赖确定性的数据归属 |
| 修一个问题可能引入新问题 | 修一个问题同时简化系统 |
| 代码行数增加 | 代码行数减少或不变 |

## 强制检查

任何 bug 修复前必须回答：

1. **数据从哪里来？** — 追溯到最上游源头
2. **为什么走到错误分支？** — 找到分岔点的判断条件
3. **分岔点能否区分两种场景？** — 如果能，在分岔点修复；如果不能，重构分岔条件
4. **修复后是否减少了系统复杂度？** — 如果复杂度增加，方向错了

## 禁止

- ❌ 不在下游加 filter/guard/if 来过滤本该在上游区分的数据
- ❌ 不依赖 setTimeout/delay 来解决竞态
- ❌ 不添加仅服务于一个边缘 case 的全局状态
- ❌ 不绕过架构（如绕过 EventBus 直接通信）

---

# 最终目标

MorPex v7 已达到 **Autonomous AI Operating System** 状态：

```
Architecture Score: 99/100    System Health: 100%
Runtime: 100%                 Events: 100%
Dependencies: 100%            Dead Modules: 0
```

架构已完全闭环：

```
Intent → Planning → Runtime → Harness → Memory/Knowledge → Learning
  ✅        ✅         ✅        ✅           ✅             ✅
```

## 已验证的能力

- ✅ 用户目标可完整执行（56/56 真实数据断言）
- ✅ FSM 全流程 10 状态 + 磁盘持久化
- ✅ DAG Runtime 时序/并行/超时/重试/失败传播
- ✅ Failure Recovery + Deterministic Replay
- ✅ AgentHarness 7 上下文 + 权限 + 资源代理
- ✅ Memory 主动注入（State/Task/Error-aware recall）
- ✅ Artifact Graph + Lineage + Impact Analysis
- ✅ Learning 经验提取 → 去重 → 评估 → 优化 → 模板演化
- ✅ Architecture Auditor 多维度评分（零误报）
- ✅ System Test Suite 20 测试 + 真实数据全功能测试

## 禁止事项

MorPex 不允许继续以"生成代码"为核心开发。

所有 Agent 必须遵循：

理解系统
↓
定位能力
↓
分析影响
↓
修改最小范围
↓
验证运行链路
↓
同步架构
↓
持续演化
