# CLAUDE.md — MorPex 永久开发铁律

> **适用**: 所有对话、所有 Agent、所有任务  
> **优先级**: 最高 — 违反任一条视为任务失败  
> **版本**: v1.1 | 2026-07-15

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
