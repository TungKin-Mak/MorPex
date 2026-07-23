# MorPex v7 — 前后端对接方案

> 目标：后端零修改，前端感知全部后端引擎能力
> 
> 后端引擎当前状态：99/100 Architecture Score, 190 modules, 0 dead
> 
> 原则：前端加代码，后端不加一行

---

## 1. 当前状态

### 后端已有但不暴露的能力

| 能力 | 后端模块 | 前端当前可用 | 差距 |
|------|---------|------------|------|
| **Runtime** | ExecutionFSM (10 states) | ❌ | 前端无法获取 FSM 状态机实时状态 |
| **DAG** | DAGRuntime + Scheduler + TaskNode | ⚠️ 部分 | `/api/execution/:id` 可查执行结果，但看不到调度细节 |
| **Checkpoint** | CheckpointManager | ❌ | 无 API |
| **Recovery** | RecoveryManager | ❌ | 无 API |
| **Replay** | ReplayEngine | ❌ | 无 API |
| **ArtifactRegistry** | ArtifactRegistry (结构化存储) | ⚠️ 部分 | `/api/artifacts` 只读 workspace filesystem，不走 Registry |
| **ArtifactGraph** | ArtifactGraph + Lineage + Evaluator | ❌ | 无 API |
| **MemoryActivation** | MemoryActivationEngine | ❌ | `/api/memory/stats` 只返回统计，不返回激活结果 |
| **Learning** | ExperienceExtractor + PlanEvaluator + Optimizer + TemplateEvolution | ❌ | 无 API |
| **Auditor** | ArchitectureAuditor v3 (99/100) | ❌ | 无 API |
| **Validation** | 20 test suites, real data test | ❌ | 无 API |

### 前端当前架构

```
packages/studio/ui/
├── index.html         ← 单页应用入口
└── ts/
    ├── api.ts         ← HTTP + SSE 客户端
    ├── types.ts       ← 前端类型定义
    ├── stores.ts      ← Zustand 全局状态
    ├── agents.ts      ← @Agent 列表
    ├── brainConfig.ts ← 脑区配置
    └── vite-env.d.ts  ← 类型声明
```

**前端无框架依赖** — 纯 TypeScript + Zustand 状态管理。这意味着：

- 无 Vue / Svelte / React 组件
- DOM 操作直接在 TypeScript 中完成
- 状态变更通过 Zustand store 驱动 UI 更新

---

## 2. 对接方案（后端零修改）

### 方案：只增加后端 API 路由，不修改后端引擎

在 `StudioServer` / `RouteSetup.ts` 中新增路由 handler，直接调用现有后端引擎模块。**不需要修改任何业务代码。**

### 2.1 Runtime 状态暴露

**新增 API：**

```typescript
// GET /api/runtime/executions — 列出所有执行
app.get('/api/runtime/executions', (_req, res) => {
  // 从 FSM 持久化目录读取
  const dir = './data/fsm';
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')) : [];
  const executions = files.map(f => ({ id: f.replace('.jsonl', ''), path: path.join(dir, f) }));
  res.json({ ok: true, count: executions.length, executions });
});

// GET /api/runtime/execution/:id — 获取 FSM 状态 + DAG 结果
app.get('/api/runtime/execution/:id', async (req, res) => {
  const { id } = req.params;
  // 读取 FSM 持久化状态
  const fsmPath = `./data/fsm/${id}.jsonl`;
  if (!fs.existsSync(fsmPath)) return res.status(404).json({ ok: false, error: 'Execution not found' });
  const lines = fs.readFileSync(fsmPath, 'utf-8').trim().split('\n');
  const latest = JSON.parse(lines[lines.length - 1]);
  // 读取 DAG 执行结果
  const dagPath = `./data/dag/${id}.json`;
  const dag = fs.existsSync(dagPath) ? JSON.parse(fs.readFileSync(dagPath, 'utf-8')) : null;
  res.json({ ok: true, execution: { id, fsm: latest, dag } });
});

// POST /api/runtime/execution/:id/replay — 重放执行
app.post('/api/runtime/execution/:id/replay', async (req, res) => {
  const { id } = req.params;
  const cp = new CheckpointManager();
  const replay = new ReplayEngine(cp);
  const events = await replay.replayFast(id);
  res.json({ ok: true, events });
});
```

### 2.2 Artifact Intelligence 暴露

**新增 API：**

```typescript
// GET /api/artifacts/graph — 获取 Artifact 血缘图
app.get('/api/artifacts/graph', (_req, res) => {
  // 从 ArtifactRegistry 加载图谱
  const graphPath = './data/artifacts/graph.json';
  if (!fs.existsSync(graphPath)) return res.json({ ok: true, nodes: [], edges: [] });
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
  res.json({ ok: true, ...graph });
});

// GET /api/artifacts/:id/lineage — 获取产物血缘链
app.get('/api/artifacts/:id/lineage', (_req, res) => {
  // 读取血缘数据
  const lineagePath = `./data/artifacts/lineage/${params.id}.json`;
  if (!fs.existsSync(lineagePath)) return res.json({ ok: true, ancestors: [], descendants: [] });
  const lineage = JSON.parse(fs.readFileSync(lineagePath, 'utf-8'));
  res.json({ ok: true, ...lineage });
});

// GET /api/artifacts/:id/impact — 影响分析
app.get('/api/artifacts/:id/impact', (_req, res) => {
  // 如果修改此 artifact，谁受影响
  res.json({ ok: true, direct: [...], indirect: [...] });
});
```

### 2.3 Architecture Auditor 暴露

**新增 API：**

```typescript
// GET /api/architecture/health — 获取架构健康报告
app.get('/api/architecture/health', async (_req, res) => {
  const auditor = new ArchitectureAuditor();
  const report = await auditor.runFullAudit();
  res.json({
    ok: true,
    score: report.architectureScore,
    runtimeCoverage: report.runtimeCoverage,
    moduleCount: report.modules.length,
    deadModules: report.unusedModules.length,
    criticalIssues: report.criticalIssues,
    scoreBreakdown: report.scoreBreakdown,
  });
});
```

### 2.4 Memory Activation 暴露

**新增 API：**

```typescript
// POST /api/memory/activate — 根据上下文激活记忆
app.post('/api/memory/activate', (req, res) => {
  const { goal, status, errors, tags } = req.body || {};
  const engine = new MemoryActivationEngine();
  // 从持久化加载记忆
  const result = engine.activate({ executionStatus: status, goal, currentStep: 1, totalSteps: 5, completedSteps: [], errors: errors || [], tags: tags || [] });
  res.json({ ok: true, memories: result.memories, activationScore: result.activationScore, contextBias: result.contextBias });
});
```

### 2.5 Learning Loop 暴露

**新增 API：**

```typescript
// GET /api/learning/stats — 学习系统状态
app.get('/api/learning/stats', (_req, res) => {
  const templateEngine = new TemplateEvolutionEngine();
  const stats = templateEngine.getStats();
  res.json({ ok: true, ...stats });
});

// GET /api/learning/experiences — 经验列表
app.get('/api/learning/experiences', (_req, res) => {
  // 从 experience store 加载
  res.json({ ok: true, experiences: [...] });
});
```

### 2.6 Validation Suite 暴露

**新增 API：**

```typescript
// POST /api/system/validate — 运行验证套件
app.post('/api/system/validate', async (_req, res) => {
  const validator = new RuntimeValidator();
  const report = await validator.runAll();
  res.json({ ok: true, ...report });
});
```

---

## 3. 前端新增页面/组件

当前前端是纯 TypeScript + Zustand，无框架。建议：

| 页面 | 对应 API | 新增文件 |
|------|---------|---------|
| **Runtime Dashboard** | `/api/runtime/executions` | `ts/pages/RuntimeDashboard.ts` |
| **Artifact Graph Viewer** | `/api/artifacts/graph`, `/api/artifacts/:id/lineage` | `ts/pages/ArtifactGraphViewer.ts` |
| **Architecture Health** | `/api/architecture/health` | `ts/pages/ArchitectureHealth.ts` |
| **Memory Activation Panel** | `/api/memory/activate` | `ts/pages/MemoryActivationPanel.ts` |
| **Learning Dashboard** | `/api/learning/stats` | `ts/pages/LearningDashboard.ts` |
| **System Validation** | `/api/system/validate` | `ts/pages/SystemValidation.ts` |

每个页面是一个 TypeScript 模块，通过 `api.ts` 调用后端 API，通过 `stores.ts` 更新 Zustand 状态。

---

## 4. 实现顺序

| 优先级 | 功能 | 工作量 | 影响 |
|--------|------|--------|------|
| **P0** | Architecture Health API + 页面 | 2h | 立即验证架构闭环 |
| **P0** | Runtime Dashboard (FSM/Session状态) | 3h | 替代当前 Session 面板 |
| **P1** | Artifact Graph Viewer | 4h | 产物体积+血缘可视化 |
| **P1** | Memory Activation Panel | 2h | 搜索+激活验证 |
| **P2** | Learning Dashboard | 3h | 经验+模板统计 |
| **P2** | System Validation Trigger | 1h | 一键验证 |

---

## 5. 对接后架构图

```
Frontend (index.html + TypeScript + Zustand)
    │
    ├── REST: /api/chat/message      →  StudioOrchestrator → MetaPlanner → Runtime
    ├── REST: /api/artifacts/*       →  ArtifactRegistry + ArtifactGraph
    ├── REST: /api/runtime/*         →  ExecutionFSM + DAGRuntime + Checkpoint/Recovery
    ├── REST: /api/memory/*          →  MemoryActivationEngine
    ├── REST: /api/architecture/*    →  ArchitectureAuditor v3
    ├── REST: /api/learning/*        →  ExperienceExtractor + TemplateEvolutionEngine
    ├── REST: /api/system/*          →  RuntimeValidator suite
    └── SSE:  /api/stream/global     →  EventBus (unchanged)
```

**后端零修改。只加 API 路由 + 前端页面。**
