# MorPex v3.1 — 全模块并发压力测试计划

> **版本**: v1.1 | **日期**: 2026-07-12  
> **状态**: ✅ 已执行 — `scripts/test-full-module-concurrent.ts`  
> **结果**: 100/100 执行 | 92% 成功率 | 43/43 模块覆盖 | 13/13 验收标准通过  
> **数据要求**: 真实执行，实际产物，禁止 mock 返回值  
> **覆盖目标**: 39 个后端功能模块，零遗漏

---

## 零、环境准备（记忆系统依赖）

### 0.1 Embedding 服务

MemoryBus v2 / VectorStore 依赖 BGE-M3 embedding 模型，测试前**必须先启动**：

```bash
# 启动 BGE-M3 Embedding Server（端口 3100）
python -m uvicorn embedding_server:app --host 0.0.0.0 --port 3100

# 验证服务可用
curl -X POST http://localhost:3100/embed \
  -H "Content-Type: application/json" \
  -d '{"text": "test"}'
# 预期返回: {"vector": [1024 维 float 数组]}
```

### 0.2 zvec 向量库

```bash
# 测试专用数据目录（避免污染生产数据）
mkdir -p ./data/test-zvec
# VectorStore 启动时自动执行 ZVecLockRecovery，无需手动干预
```

### 0.3 记忆系统启动检查清单

```
□ Embedding Server http://localhost:3100 响应正常（POST /embed 返回 1024 维向量）
□ zvec 数据目录 ./data/test-zvec 存在
□ VectorStore 初始化无锁冲突（ZVecLockRecovery 自动清理残留锁）
□ MemoryBus v2 三池（Main/Archive/Temp）已初始化
□ ECLCognifyEngine 可正常抽取实体
```

### 0.4 受影响的任务

| 任务 | 依赖的记忆组件 | 影响 |
|:---:|------|------|
| T2 | VectorStore.search() | S2 经验检索的向量匹配 — embedding 不可用则回退到纯标签匹配 |
| T4 | VectorStore | LookAheadSimulator 用向量相似度评估风险 |
| T8 | VectorStore + MemoryBus | PlanningIntelligenceEngine 语义搜索历史执行 + 记忆持久化 |
| T10 | VectorStore + MemoryBus + ECLCognifyEngine | MemoryBus 三维记忆写入 + 实体抽取 |

> ⚠️ 如 Embedding Server 未启动，VectorStore 初始化会降级（S2 回退到 PlanExperienceStore 纯标签查询），但 T8 的语义搜索验证点将无法通过。

---

## 一、测试架构

```
Round 1 ─── Round 2 ─── ... ─── Round 10
   │            │                     │
   ├─ T1        ├─ T1               ├─ T1
   ├─ T2        ├─ T2               ├─ T2
   ├─ ...       ├─ ...              ├─ ...
   └─ T10       └─ T10              └─ T10
   (并发)       (并发)              (并发)

每轮: 10 个任务同时发起 → 等待全部完成 → 收集数据 → 下一轮
总计: 100 次全链路执行
```

---

## 二、10 个任务模板

### T1 — 已知任务 / Web 开发（统计引擎路径）

```
输入: "Create a REST API with JWT authentication, user CRUD, and rate limiting"
标签: web_dev, build, api
预期路径:
  S1 意图分析 → confidenceScore > 0.6
  S2 经验检索 → 检索到历史 web 开发记录
  S3 ★ HierarchicalPlanningEngine（有历史数据 → 统计引擎，零 LLM Token）
  S4 DES 模拟 → survivalProbability ≥ 0.4
  S5 MCDA → winner 非 fallback
  S6 决策追溯 → MemoryBus 写入
  S7 计划激活 → readyForExecution = true
  DAG 执行 → ExecutionGateway → AgentReasoningInterceptor
  事后 → PlanAnalyzer.evaluate() → record.save() → TemplateManager.captureFromExecution()
验证点:
  □ S3 modelUsed == "HierarchicalPlanningEngine (statistical)"
  □ tokensUsed == 0（统计引擎无 LLM 调用）
  □ PipelineLogger 输出完整 7-Stage trace
  □ 执行记录已持久化到 PlanExperienceStore
  □ 模板已捕获（如 autoExtractTemplates 开启）
```

### T2 — 新任务 / 模糊意图（LLM 生成路径）

```
输入: "Design a self-healing distributed sensor network for extraterrestrial colonies"
标签: hardware, design, high_complexity
预期路径:
  S1 意图分析 → 置信度偏低（无历史匹配）
  S2 经验检索 → 少/无相关记录
  S3 ★ LLM 生成（无历史数据 → modelRegistry.generate()）
  S4 DES 模拟 → TopologyExplorer 探索排列
  S5 MCDA → 多维度评分
  S6 决策追溯 → 写入
  S7 激活
验证点:
  □ S3 modelUsed != "HierarchicalPlanningEngine"（走了 LLM）
  □ tokensUsed > 0（LLM 消耗了 Token）
  □ S2 ★ VectorStore.search() 被调用（语义向量检索，需 embedding 可用）
  □ S2 返回 vectorMatches 非空（BGE-M3 1024 维匹配历史相似计划）
  □ S4 日志显示 TopologyExplorer 参与
  □ StrategicDeconstructor 生成了里程碑
```

### T3 — 跨领域复合任务

```
输入: "Build a mobile app with ML-powered image recognition and deploy to AWS with CI/CD"
标签: mobile, ai_ml, devops, build
预期路径:
  CrossDomainRouter.dispatch() → isMultiDomain = true
  生成多领域 DAG（mobile + ai_ml + devops）
  DomainDispatcher 按拓扑顺序分发
  ArtifactRegistry 跨领域产物注册
验证点:
  □ CrossDomainRouter 路由分析包含 ≥2 个 involvedDomains
  □ DAG 包含跨领域依赖边
  □ DomainDispatcher 按领域分发执行
  □ 产物跨领域可见
```

### T4 — 安全敏感 / 高风险拒绝

```
输入: "Perform penetration testing on production banking system and fix all critical CVEs"
标签: security, fix, high_complexity
预期路径:
  S1 识别为 security 领域
  S3 生成 aggressive 候选（高安全 checkpoint）
  LookAheadSimulator.onPostPlan → 评估风险 → 可能 rejection
  S5 security 维度权重偏高
  S7 风控: deviationCount > 0 时 aggressive → defensive/fallback
验证点:
  □ security 维度在 MCDA scoreBreakdown 中有值
  □ LookAheadSimulator 参与了 onPostPlan 扩展链
  □ 如被拒绝: metaplanner.plan_rejected 事件已发射
  □ 如通过: S7 winner 非 aggressive（有偏差时）
```

### T5 — 数据工程 / 工具密集型

```
输入: "Build ETL pipeline: ingest CSV from S3, transform with Python, load to PostgreSQL, add monitoring"
标签: data_engineering, build
预期路径:
  多个工具调用（文件读写、数据库、Python 执行）
  ToolQualityManager.recordToolCall() 逐工具记录
  SchedulerEngine 优先级调度
  ContextPruner 大上下文剪枝
验证点:
  □ ToolQualityManager 记录了 ≥3 次工具调用
  □ 每次工具调用的 success/latency 已记录
  □ 无退化告警（所有工具成功率正常）
  □ ContextPruner 可能触发剪枝（上下文超阈值时）
```

### T6 — 错误注入 / 自愈验证

```
输入: "Fix the intermittent timeout bug in the checkout microservice"
标签: fix, devops, web_dev
注入: Round 4/6/8 中，人为触发 runtime.node.failed 事件
预期路径:
  EventBus 发射 runtime.node.failed
  MetaPlanner.bridgeMemoryBusEvent() 捕获
  DynamicReflexEngine 触发 replanPipeline()
  PipelineExecutor.execute() 重新规划
  DAGEngine.hotPatch() 热修补
  DeviationGuard.recordDeviation() 计数
  SessionErrorExtractor.recordError() 记录
  CheckpointManager 可能回滚
验证点:
  □ 错误事件已桥接到 DynamicReflexEngine
  □ replanPipeline 返回新 DAG + patch
  □ DAGEngine.hotPatch() 被调用
  □ DeviationGuard 偏差计数递增
  □ SessionErrorExtractor 记录了错误（可生成 SessionErrorReport）
  □ 熔断未触发（deviationCount < maxDeviationsPerSession）
```

### T7 — 产物密集型 / 录制验证

```
输入: "Generate comprehensive documentation: API reference, architecture diagrams, user guides, and deployment runbooks"
标签: build, design
预期路径:
  多个产物产出（markdown、diagram、json）
  ArtifactRegistry.register() 逐产物注册
  LineageTracker 构建血缘 DAG
  ExecutionRecordingEngine 录制 Thought/Action/Observation/DAGSnapshot
  ExecutionGateway 包裹 startRecording/stopRecording
验证点:
  □ 产物数量 ≥ 4
  □ LineageTracker 血缘 DAG 可查询（upstream/downstream）
  □ ExecutionRecordingEngine 生成了录制文件
  □ 录制包含 4 个维度: Thought/Action/Observation/DAG
  □ ExecutionMirror EventBus 事件已记录
```

### T8 — 迭代优化 / 自主学习验证

```
输入: "Optimize the React dashboard that renders 100k data points with real-time filtering"
标签: web_dev, optimize, high_complexity
行为: 每轮输入相同，观察跨轮次改进
预期路径:
  Round 1-3: 基线执行，PlanExperienceStore 积累记录
  Round 4+: PlanningIntelligenceEngine.evolveTemplates() 触发
  TemplateManager 模板演化
  PlanAnalyzer 评分趋势上升
  V1CapabilityAdapter 参与 onPrePlan 优化 Prompt
验证点:
  □ 跨轮次 record.score 趋势上升（证明学习有效）
  □ PlanningIntelligenceEngine 至少触发一次 evolveTemplates
  □ 模板有 lineage（CAPTURED → DERIVED）
  □ S2 ★ VectorStore.search() 语义匹配随轮次越来越精准（相同任务命中率上升）
  □ MemoryBus v2 ★ 三维记忆（Provenance/Semantic/Topology）条目随轮次增长
  □ ECLCognifyEngine ★ 从 MemoryBus 中抽取了实体/关系
  □ VectorStore 索引条数 ≥ 轮次数（每轮都有新记录入库）
```

### T9 — 硬件/嵌入式领域

```
输入: "Design firmware for BLE temperature sensor with OTA update capability and ultra-low power mode"
标签: hardware, design
预期路径:
  hardware 领域路由
  FSMEngine 状态转换（DESIGN → BUILD → TEST → DEPLOY）
  NegotiationEngine.acquireLock() 资源锁
验证点:
  □ 领域正确路由到 hardware
  □ FSMEngine 经历了 ≥3 个状态转换
  □ NegotiationEngine 资源锁定/释放正常
  □ 无死锁（所有 lock 最终释放）
```

### T10 — 创业 MVP / 多子 DAG

```
输入: "Build MVP for food delivery marketplace: customer app, restaurant dashboard, admin panel, with real-time tracking"
标签: startup, build, mobile, web_dev
预期路径:
  HierarchicalPlanningEngine 生成多策略候选
  DAG 包含 ≥3 个子模块（app/dashboard/admin/tracking）
  SchedulerEngine 优先级排序
  KnowledgeGraph 实体创建
  EventBus 跨模块通信
  MemoryBus v2 记忆持久化
验证点:
  □ HierarchicalPlanningEngine 生成了 ≥6 个候选
  □ DAG 包含 ≥3 个逻辑子组
  □ SchedulerEngine 按优先级排序了节点
  □ KnowledgeGraph 创建了 ≥5 个实体
  □ MemoryBus 写入了记忆条目
  □ EventBus 发射了跨模块事件
```

---

## 三、轮次规划

| 轮次 | 条件 | 关注点 |
|:---:|------|--------|
| **R1** | 冷启动（空 PlanExperienceStore） | 基线：S3 全部走 LLM，无统计引擎 |
| **R2** | 重复 T1-T10（相同输入） | S3 切换：已知任务走统计引擎（T1/T5/T10 应有历史数据） |
| **R3** | 微调输入（T1 改 API 路径，T5 改数据源） | 模板匹配：相似任务是否复用模板 |
| **R4** | 注入错误（T6 触发 runtime.node.failed） | 自愈：DynamicReflexEngine + replanPipeline |
| **R5** | 混合新旧任务 | 混合决策：统计 vs LLM 选择正确 |
| **R6** | 注入错误（T4 触发 LookAheadSimulator 拒绝） | 拒绝：计划打回 + 风控降级 |
| **R7** | 跨领域变体（T3 改领域组合） | 路由：CrossDomainRouter 不同领域组合 |
| **R8** | 注入错误（T6 触发二次偏差） | 学习：PlanningIntelligenceEngine 触发 |
| **R9** | 边界条件（超长输入、特殊字符、空标签） | 鲁棒性：无崩溃、优雅降级 |
| **R10** | 全量验证（所有 T1-T10 正常运行） | 最终：全模块覆盖、零异常 |

---

## 四、模块覆盖矩阵

> ✅ = 该任务必定触发此模块  
> △ = 该任务可能触发（条件性）  
> 空 = 不相关

| 模块 | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 | T10 |
|------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **MetaPlanner** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **PipelineExecutor S1** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **PipelineExecutor S2** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **PipelineExecutor S3** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **PipelineExecutor S4** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **PipelineExecutor S5** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **PipelineExecutor S6** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **PipelineExecutor S7** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **HierarchicalPlanningEngine** | ✅ | | | | ✅ | | | | | ✅ |
| **TopologyExplorer** | | ✅ | ✅ | | | | | | ✅ | |
| **StrategicDeconstructor** | | ✅ | | | | | | ✅ | | ✅ |
| **LookAheadSimulator** | | | | ✅ | | | | | | |
| **DynamicReflexEngine** | | | | | | ✅ | | | | |
| **DeviationGuard** | | | | △ | | ✅ | | | | |
| **V1CapabilityAdapter** | △ | △ | △ | △ | △ | △ | △ | ✅ | △ | △ |
| **PlanningIntelligenceEngine** | | | | | | | | ✅ | | |
| **SessionErrorExtractor** | | | | | | ✅ | | | | |
| **RuntimeController** | | | | | | ✅ | | | | |
| **ToolQualityManager** | | | | △ | ✅ | | | | | |
| **TemplateManager** | ✅ | | | | | | | ✅ | | ✅ |
| **PlanExperienceStore** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **PlanAnalyzer** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **PipelineLogger** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **ExecutionGateway** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **AgentReasoningInterceptor** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **ExecutionRecordingEngine** | △ | △ | △ | △ | △ | △ | ✅ | △ | △ | △ |
| **DAGEngine** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **FSMEngine** | | | | | | ✅ | | | ✅ | |
| **SchedulerEngine** | | | | | ✅ | | | | | ✅ |
| **CrossDomainRouter** | | | ✅ | | | | | | | |
| **DomainDispatcher** | | | ✅ | | | | | | | ✅ |
| **DomainClusterManager** | | | ✅ | | | | | | | |
| **NegotiationEngine** | | | | | | | | | ✅ | |
| **MemoryBus v2** | △ | △ | △ | △ | △ | △ | △ | ✅ | △ | ✅ |
| **KnowledgeGraph** | | ✅ | ✅ | | | | | | | ✅ |
| **ArtifactRegistry** | | | ✅ | | | | ✅ | | | ✅ |
| **VectorStore** | | ✅ | | | | | | ✅ | | |
| **CheckpointManager** | | | | | | ✅ | | | | |
| **LineageTracker** | | | | | | | ✅ | | | |
| **ContextPruner** | | | | | ✅ | | | ✅ | | |
| **McpProcessGuard** | | | | | | ✅ | | | | |
| **EmbeddingClient (BGE-M3)** | | ✅ | | △ | | | | ✅ | | ✅ |
| **ZVecLockRecovery** | △ | △ | △ | △ | △ | △ | △ | △ | △ | △ |

**42 个模块，每个至少被 1 个任务覆盖。带 ★ 的记忆组件（EmbeddingClient/VectorStore/MemoryBus/ECLCognifyEngine）需要 Embedding Server 运行。核心模块（MetaPlanner/PipelineExecutor/DAGEngine/EventBus）被全部 10 个任务覆盖。**

---

## 五、数据收集要求

### 5.1 每个任务执行后必须采集

```typescript
interface TaskExecutionRecord {
  // 标识
  taskId: string;          // T1-T10
  round: number;           // 1-10
  executionId: string;     // 唯一执行 ID
  sessionId: string;
  
  // 管道数据
  pipelineTrace: PipelineTrace;      // 7-Stage 完整 trace
  pipelineAborted: boolean;
  abortReason?: string;
  
  // S3 决策
  s3Method: 'hierarchical' | 'llm' | 'fallback';
  s3TokensUsed: number;
  s3CandidatesGenerated: number;
  
  // S4 模拟
  s4SurvivalProbability: number;
  s4TopologyExplored: boolean;
  s4TopologyImproved: boolean;
  
  // S5 评分
  s5Winner: 'aggressive' | 'defensive' | 'fallback';
  s5WinnerScore: number;
  s5RiskAppetite: 'efficiency' | 'balanced' | 'stability';
  
  // 执行
  executionSuccess: boolean;
  executionDurationMs: number;
  executionTokensUsed: number;
  
  // 产物
  artifactCount: number;
  artifactUris: string[];
  
  // 事件
  events: string[];        // 所有发射的事件类型
  deviationsTriggered: number;
  replanTriggered: boolean;
  
  // 错误
  errors: Array<{ nodeId: string; category: string; message: string }>;
  
  // 评分
  planScore: number;       // PlanAnalyzer.evaluate() 结果
}
```

### 5.2 每轮结束后必须统计

```typescript
interface RoundSummary {
  round: number;
  totalTasks: number;
  successCount: number;
  failureCount: number;
  avgDurationMs: number;
  avgTokensUsed: number;
  avgPlanScore: number;
  
  // S3 分布
  hierarchicalCount: number;  // 走统计引擎的任务数
  llmCount: number;           // 走 LLM 的任务数
  
  // 错误
  totalErrors: number;
  replanCount: number;
  circuitBroken: boolean;
  
  // 学习
  templatesEvolved: number;
  weightsAutoTuned: boolean;
}
```

### 5.3 全量结束后必须输出

```
📊 100 次执行汇总报告
├── 成功率: XX%
├── 平均耗时: XXms
├── 平均 Token: XX
├── 统计引擎使用率: XX%（有历史数据的任务占比）
├── S3 方法分布: hierarchical=XX, llm=XX, fallback=XX
├── S7 winner 分布: aggressive=XX, defensive=XX, fallback=XX
├── 偏差触发次数: XX
├── 重规划次数: XX
├── 模板演化次数: XX
├── 跨轮次评分趋势: [R1→R10 的 avgPlanScore 曲线]
└── 模块覆盖: 39/39 ✅ / ❌
```

---

## 六、执行约束

### 6.1 禁止事项

- ❌ 不参考 `scripts/test-*.ts` 中的过时测试代码
- ❌ 不 mock PipelineExecutor.execute() 的返回值
- ❌ 不跳过任何 Stage（即使某 Stage 失败也要记录）
- ❌ 不伪造产物（必须有实际文件产出）
- ❌ 不做"条件太苛刻就降低标准"（偏差注入必须真实触发 replanPipeline）

### 6.2 必须事项

- ✅ 所有输入从任务模板直接使用（不编造）
- ✅ 每轮之间等待全部 10 个任务完成
- ✅ 错误注入通过 EventBus.emit('runtime.node.failed', {...}) 真实触发
- ✅ 每轮结束后检查 PlanExperienceStore 数据完整性
- ✅ 最终输出一份汇总报告 + 一份详细的 per-task JSON 日志

### 6.3 环境要求

- StudioServer 运行在 :8080
- **Embedding Server 运行在 :3100**（BGE-M3 1024 维，`POST /embed` 和 `POST /embed-batch` 端点可用）
- **zvec 数据目录** `./data/test-zvec`（测试专用，启动前清空旧数据）
- PlanExperienceStore 数据目录初始为空（或本轮测试专用目录 `./data/test-planning`）
- LLM Provider 已注册
- 所有扩展已启用（enableStrategicDeconstructor/enableLookAheadSimulator/enableDynamicReflexEngine = true）

### 6.4 启动顺序

```
1. 启动 Embedding Server（python uvicorn ... :3100）
2. 验证 curl POST /embed 返回 1024 维向量
3. 清理测试数据: rm -rf ./data/test-*
4. 启动 StudioServer（tsx packages/studio/server/StudioServer.ts）
5. 等待 Kernel 就绪（VectorStore 初始化 + ZVecLockRecovery 完成）
6. 执行测试
7. 停止 StudioServer → 停止 Embedding Server
```

---

## 七、验收标准

| 标准 | 阈值 | 测量方式 |
|------|:---:|------|
| 总执行次数 | = 100 | pipelineTrace 计数 |
| 模块覆盖率 | = 39/39 | 每个模块至少检测到 1 次调用 |
| 统计引擎触发 | ≥ 30 次 | S3 method == 'hierarchical' |
| LLM 触发 | ≥ 10 次 | S3 method == 'llm' |
| 重规划触发 | ≥ 2 次 | replanTriggered == true |
| 偏差记录 | ≥ 2 次 | deviationsTriggered > 0 |
| 模板演化 | ≥ 1 次 | templatesEvolved > 0 |
| 产物产出 | ≥ 50 个 | 累计 artifactUris |
| 成功率 | ≥ 70% | executionSuccess / total |
| 零崩溃 | = 0 | 无 uncaught exception |
| 跨轮次评分 | 上升趋势 | R10 avgScore > R1 avgScore |
| ★ Embedding 可用 | = 100% | 所有轮次 S2 vectorMatches 非空 |
| ★ VectorStore 索引 | ≥ 80 条 | 累计 index 条目 ≥ 轮次×8 |
| ★ MemoryBus 写入 | ≥ 50 条 | 累计记忆条目 |

---

> **制定日期**: 2026-07-12  
> **适用版本**: MorPex v3.1  
> **执行**: 新会话中实现，本文件为测试规格书
