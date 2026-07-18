# MetaPlanner 拆分任务书 — v3.1

> **任务 ID**：MPL-SPLIT-001  
> **优先级**：🔴 P0（架构收敛最高优先级）  
> **预估工时**：3-4 小时  
> **风险等级**：高（涉及核心规划管道）  
> **依赖**：Phase 1-6 架构迁移已完成（`src/` 结构已稳定）

---

## 1. 背景与动机

`MetaPlanner.ts` 当前 **2520 行**，是代码库中最大的单一文件。它同时承担三类职责：

| 职责 | 行数（估算） | 说明 |
|------|:----------:|------|
| **7-Stage Pipeline 执行** | ~1800 | S1 意图分析 → S7 计划激活，含 DES 模拟、MCDA 评估、拓扑探索 |
| **扩展生命周期管理** | ~400 | `ExtensionDefinition` 实现：initialize/start/stop、模板同步、引擎注册 |
| **运行时重规划 + 事件桥接** | ~300 | `replanPipeline()`、`bridgeMemoryBusEvent()`、workflow 事件回调 |

架构文档 `docs/docsARCHITECTURE-v3.1-optimized.md` 早已声明 `pipeline/PipelineExecutor.ts` 作为独立模块，但从未实现。此任务将其落地。

---

## 2. 拆分方案

### 2.1 目标结构

```
extensions/planning/
├── MetaPlanner.ts              # 编排器 (~700 行)
├── pipeline/
│   └── PipelineExecutor.ts     # 7-Stage 管道执行器 (~1800 行)
├── PlanAnalyzer.ts             # 已存在（PlanEvaluator + PlanOptimizer）
├── TemplateManager.ts          # 已存在（TemplateEvolutionEngine + TemplateFileSystem）
├── ... (其他文件不变)
```

### 2.2 职责边界

| 文件 | 核心职责 | 关键方法 |
|------|---------|---------|
| **PipelineExecutor** | 执行 7-Stage 管道，不含编排逻辑 | `execute()`, `stage1()` ~ `stage7()`, `simulateDES()`, `evaluateMCDA()`, `buildVolatilityMatrix()`, `topologicalSort()` |
| **MetaPlanner** | 扩展生命周期 + 编排 + 事件桥接 | `initialize()`, `start()`, `stop()`, `wrapOrchestrate()`, `replanPipeline()`, `registerExtension()`, `bridgeMemoryBusEvent()` |

### 2.3 移动清单

**从 MetaPlanner 移至 PipelineExecutor：**

```
S1  Intent Analysis      — stage1IntentAnalysis()           (~90 行)
S2  Experience Retrieval — stage2ExperienceRetrieval()       (~60 行)
S3  Candidate Generation — stage3CandidateGeneration()       (~160 行)
    ├── buildStage3Prompt()
    ├── parseAndValidateCandidates()
    └── generateFallbackCandidates()
S4  Plan Simulation (DES) — stage4PlanSimulation()           (~290 行)
    ├── buildVolatilityMatrix()
    ├── simulateSingleRun()
    ├── seededRandom()
    ├── topologicalSort()
    ├── findDownstreamNodes()
    ├── averageSimulations()
    └── mergeBottlenecks()
S5  Plan Evaluation (MCDA)— stage5PlanEvaluation()           (~130 行)
    ├── computeAlignmentScore()
    └── computeKnowledgeScore()
S6  Decision Trace        — stage6DecisionTrace()            (~140 行)
S7  Best Plan Selection   — stage7BestPlanSelection()        (~140 行)
    └── buildFallbackActivation()
    主入口                   executePlanningPipeline()        (~360 行)
    辅助                     skippedStage()
    辅助                     extractTokenUsage()
    辅助                     extractDAGNodes() / findNodeResult()
    辅助                     extractArtifactCount()
    辅助                     classifyError()
```

**保留在 MetaPlanner：**

```
扩展生命周期    — initialize(), start(), stop(), getStatus()
扩展注册        — registerExtension(), 扩展列表管理
模板同步        — syncTemplatesFromFS()
编排入口        — wrapOrchestrate()
运行时重规划    — replanPipeline()
事件桥接        — bridgeMemoryBusEvent()
workflow 回调   — onWorkflowCompleted(), onWorkflowFailed(), onCheckpointRollback()
标签提取        — extractTags()
上下文注入      — injectContext()
事件发射        — emitEvent()
分类工具        — categorizeTag(), inferIntentType()
```

### 2.4 PipelineExecutor 接口设计

```typescript
export interface PipelineExecutorConfig {
  desConfig: DESConfig;
  riskAppetiteProfile: RiskAppetiteProfile;
  abortThresholds: typeof PIPELINE_ABORT_THRESHOLDS;
}

export class PipelineExecutor {
  constructor(config: PipelineExecutorConfig, deps: PipelineDeps);

  /** 执行完整 7-Stage 管道，返回 PipelineTrace */
  async execute(params: PipelineInput): Promise<PipelineTrace>;

  /** 单独执行 Stage 4（供 TopologyExplorer 复用） */
  async simulateDES(
    candidates: CandidatePlanProfile[],
    experience: ExperienceQueryResult | null,
    config: DESConfig,
  ): Promise<IShadowSimulationReport[]>;

  /** 单独执行 Stage 5（供 PlanAnalyzer 复用） */
  evaluateMCDA(
    simulations: IShadowSimulationReport[],
    candidates: CandidatePlanProfile[],
    experience: ExperienceQueryResult | null,
    intent: IntentAnalysisResult,
    deviationCount: number,
  ): IEvaluationScorecard;
}
```

---

## 3. Forge 铁律约束

> ⚠️ 此任务必须严格遵守以下全部铁律。任何违反视为任务失败。

### 架构一致性铁律
- [ ] 新文件 `pipeline/PipelineExecutor.ts` 必须放在 `extensions/planning/pipeline/` 下
- [ ] 所有导入路径使用 `.js` 后缀
- [ ] 不在 `planning/types.ts` 之外新建类型文件（如需新类型，扩展现有文件）

### 职责边界铁律（Single Responsibility）
- [ ] `PipelineExecutor` 只负责执行管道，不触碰扩展注册、事件桥接、模板同步
- [ ] `MetaPlanner` 只负责编排，不直接实现任何 Stage 逻辑
- [ ] 两者通过明确的接口通信（`PipelineInput → PipelineTrace`）

### 可观测性铁律
- [ ] PipelineExecutor 必须使用 `PipelineLogger` 输出结构化日志
- [ ] 每个 Stage 的入口/出口必须发射 EventBus 事件
- [ ] `PipelineTrace` 必须完整记录 7 个 Stage 的结果

### 错误处理与自愈铁律
- [ ] PipelineExecutor 的 `execute()` 必须在任一 Stage 失败时优雅降级
- [ ] 禁止裸 try-catch 吞异常；必须有 `PipelineStageResult.status = 'failed'` + `error` 字段
- [ ] MetaPlanner.replanPipeline() 必须在 PipelineExecutor 返回失败 Trace 时触发

### 性能与复杂度铁律
- [ ] 拆分后不引入额外 LLM 调用（Stage 调用次数不变）
- [ ] PipelineExecutor 不持有 MetaPlanner 引用（单向依赖）
- [ ] `simulateDES()` 和 `evaluateMCDA()` 作为公开方法暴露，供 TopologyExplorer 和 PlanAnalyzer 复用

### 文档与可维护性铁律
- [ ] `PipelineExecutor.ts` 文件顶部必须写清：职责、输入、输出、依赖
- [ ] 所有公开方法必须写 JSDoc
- [ ] `MetaPlanner.ts` 更新文件头注释，说明拆分后的新职责边界

### 零功能回归铁律
- [ ] 拆分后 `MetaPlanner.wrapOrchestrate()` 签名和行为完全不变
- [ ] `MetaPlanner.replanPipeline()` 签名和行为完全不变
- [ ] 所有现有消费者（`planning/index.ts`、`src/index.ts`、`StudioServer.ts`）无需修改
- [ ] `tsc --noEmit` 源代码零新增错误
- [ ] `MetaPlanner` 的 `ExtensionDefinition` 接口实现完整

---

## 4. 执行步骤

### Step 1：创建 `pipeline/` 目录 + PipelineExecutor 骨架（30 min）
```
mkdir -p packages/core/src/extensions/planning/pipeline
```

创建 `PipelineExecutor.ts`：
- 复制 MetaPlanner 中的所有 `import` 语句
- 定义 `PipelineInput`、`PipelineDeps`、`PipelineExecutorConfig` 接口
- 创建空的 `PipelineExecutor` 类
- 确认编译通过（`tsc --noEmit`）

### Step 2：迁移 Stage 方法（90 min）
按 S1→S7 顺序逐 Stage 迁移：
1. 移动 `stage1IntentAnalysis()` + 相关私有方法
2. 移动 `stage2ExperienceRetrieval()`
3. 移动 `stage3CandidateGeneration()` + `buildStage3Prompt()` + `parseAndValidateCandidates()` + `generateFallbackCandidates()`
4. 移动 `stage4PlanSimulation()` + 全部 DES 辅助方法
5. 移动 `stage5PlanEvaluation()` + `computeAlignmentScore()` + `computeKnowledgeScore()`
6. 移动 `stage6DecisionTrace()`
7. 移动 `stage7BestPlanSelection()` + `buildFallbackActivation()`
8. 移动 `executePlanningPipeline()` + `skippedStage()`
9. 移动 `extractTokenUsage()`、`extractDAGNodes()`、`findNodeResult()`、`extractArtifactCount()`、`classifyError()`

每移动一个 Stage → `tsc --noEmit` 验证。

### Step 3：在 MetaPlanner 中接入 PipelineExecutor（30 min）
- MetaPlanner 构造函数中创建 `this.pipeline = new PipelineExecutor(config, deps)`
- `wrapOrchestrate()` 中的管道调用改为 `this.pipeline.execute(input)`
- `replanPipeline()` 中的管道调用改为 `this.pipeline.execute(input)`
- 移除 MetaPlanner 中已迁移的所有方法

### Step 4：验证与收尾（30 min）
- `tsc --noEmit` 确认零新增错误
- 更新 `planning/index.ts`：添加 `PipelineExecutor` 导出
- 更新 `docs/docsARCHITECTURE-v3.1-optimized.md`：目录树中 `pipeline/PipelineExecutor.ts` 标记为"已实现"
- 更新 `CLAUDE.md` 关键文件索引

---

## 5. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|:----:|:----:|---------|
| MetaPlanner 内部状态（`this._extensions`、`this._config`）被 Stage 方法引用 | 中 | 高 | 迁移前做一次 `this.` 引用审计，将需要共享的状态作为 `PipelineDeps` 注入 |
| PipelineExecutor 缺少 LLM 调用能力（`this.callLLM()`） | 中 | 高 | 在 `PipelineDeps` 中注入 `callLLM: (prompt: string) => Promise<string>` |
| `wrapOrchestrate()` 的闭包逻辑依赖 MetaPlanner 内部字段 | 低 | 中 | 保留 `wrapOrchestrate()` 在 MetaPlanner，仅管道调用委派给 PipelineExecutor |
| `replanPipeline()` 中内联的 `import('./types.js').DAGPatch` 类型引用 | 低 | 低 | 此引用已在 Phase 2 修复为 `import('./types.js')` |

---

## 6. 验收标准

- [ ] `packages/core/src/extensions/planning/pipeline/PipelineExecutor.ts` 存在且可独立导入
- [ ] `MetaPlanner.ts` ≤ 1000 行
- [ ] `PipelineExecutor.ts` ≤ 2000 行
- [ ] `MetaPlanner` 通过 `planning/index.ts` 的 barrel export 对外完全兼容
- [ ] `tsc --noEmit` 源码零错误
- [ ] 架构文档已同步
- [ ] `CLAUDE.md` 关键文件索引已更新

---

## 7. 参考

- 架构文档：`docs/docsARCHITECTURE-v3.1-optimized.md`（Section 2 目录树）
- 类型定义：`packages/core/src/extensions/planning/types.ts`（1850 行，含全部 Stage 类型）
- 管道日志：`packages/core/src/extensions/planning/PipelineLogger.ts`（411 行）
- 当前 MetaPlanner：`packages/core/src/extensions/planning/MetaPlanner.ts`（2520 行）

---

> **制定日期**：2026-07-12  
> **制定者**：Forge (MorPex v3.1 高级后端工程师)  
> **适用规范**：Forge 铁律 v3.1（7 条铁律，全部适用）
