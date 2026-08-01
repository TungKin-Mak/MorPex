# v15 Integration 审计 — 端到端链跟踪

> 审计目标: "输入目标 → 动态组队 → 调用工作流 → 执行 → 验证 → 交付 → 学习" 是否真实可运行
> 方法: 代码路径穿透，不只看设计

---

## 一、逐环节审计

### Step 1: 输入目标

```
CompanyFacade.executeGoal("开发空气检测设备并销售到 Amazon")
  → MorPexRuntime.run(goal)
    → PipelineOrchestrator.orchestrate(rawGoal)
      → GoalIntelligenceFacade.understandGoal(rawGoal)
        → GoalParser.parse() + RequirementExtractor.extract() + ConstraintAnalyzer.analyze() + GoalValidator.validate()
        → GoalContext { objective, domain, requiredCapabilities, riskLevel, ... }
```

**状态: ✅ 可运行**
- `PipelineOrchestrator.orchestrate()` 第 35 行调用 `GoalIntelligenceFacade.understandGoal()`
- `CompanyFacade.executeGoal()` 第 198 行检查 `if (this.runtime)` → 调用 `this.runtime.run(goal)`
- 返回 `GoalContext` 包含 domain='product-design', requiredCapabilities=['design', 'code', 'publish']

---

### Step 2: 动态组队

```
PipelineOrchestrator.orchestrate() 继续
  → DynamicTeamOrchestrator.orchestrate(goalCtx)
    → CapabilityDiscoverer.discover(goalCtx)
      → CapabilityRegistry.search() 匹配能力
      → matched: [PCB Design, Firmware, Amazon Listing, ...]
    → TeamBuilder.buildTeams({ requiredCapabilities: matched[...].map(c => c.name) })
      → specs: [{ engineering caps }, { marketing caps }]
    → AgentAllocator.allocate(spec, availableAgents)
      → 从硬编码池 ['agent-hardware', 'agent-software', 'agent-marketing'] 匹配
    → DynamicTeam[]: [HardwareTeam, MarketingTeam]
```

**状态: ⚠️ 路径可走，但 Agent 池是硬编码**
- `orchestrate()` 方法存在 (DynamicTeamOrchestrator.ts:25)
- `CapabilityDiscoverer.discover()` 从 9 项内置能力匹配 ✅
- `TeamBuilder.buildTeams()` 按能力分组 ✅
- `AgentAllocator.allocate()` 从硬编码池分配 ⚠️
- `availableAgents` 是固定 `['agent-hardware', 'agent-software', 'agent-marketing']` ❌ 不是动态发现
- 如果 `goalCtx.requiredCapabilities` 包含不在池中的能力，分配结果为 `['default-agent']`

---

### Step 3: 调用工作流

```
PipelineOrchestrator.orchestrate() 继续
  → this.workflowRegistry.findForGoal(rawGoal)  ← 前提: setWorkflowRegistry() 被调用
    → WorkflowRegistry.providers (Map)
    → providers.filter(p => p.matchGoal(goal))
```

**状态: ❌ 路径断裂 — WorkflowRegistry 为空**
- `bootstrap-v15-integration.ts` 第 43 行调用了 `setWorkflowRegistry(WorkflowRegistry)` ✅
- 但 `WorkflowRegistry.register()` 从未被任何代码调用 ❌
- `packages/workflows/ecommerce/` 中的文件没有实现 `WorkflowProvider` 接口
- `findForGoal()` 遍历空 Map → 返回 `[]` → 工作流默认为 `{ name: 'generic' }`
- 根本原因: WorkflowProvider 接口已定义，但**无实现类**

---

### Step 4: 执行

```
MorPexRuntime.run() Phase 2
  → UnifiedExecutionEngine.execute(execRequest)
    → resolveMode('auto')
      → 检查 complexity: "开发空气检测设备并销售到 Amazon" (15词, 无换行) → 'simple'
      → simple + fabric? → fabric
      → this.executionFabric 是 null? → 跳过
      → medium + dag? → dag
      → this.dagRuntime 是 null? → 跳过
      → missionRuntime? → mission
      → this.missionRuntime 是 null? → 跳过
      → dagRuntime? → null → 跳过
      → executionFabric? → null → 跳过
      → 默认返回 'mission'
    → executeViaMission()
      → if (!this.missionRuntime) → 返回 { ok: false, error: 'MissionRuntime 未注入' }
```

**状态: ❌ 路径断裂 — ExecutionEngine 无运行时后端**
- `ServiceContainer` 只做了 `new UnifiedExecutionEngine(this.eventBus)` ❌
- 没有调用 `setMissionRuntime()`, `setDAGRuntime()`, `setExecutionFabric()` ❌
- 所有 3 个引擎都是 `null`
- `resolveMode()` 的所有分支都跳过 → 默认 'mission' → try execute → 立即失败

**修复需要**: ServiceContainer 需要注入 MissionRuntime/DAGRuntime/ExecutionFabric
```
// runtime/index.ts 已导出这些类
// ServiceContainer 需要:
import { MissionRuntime } from './mission/MissionRuntime.js';
container.executionEngine.setMissionRuntime(new MissionRuntime(container.eventBus));
```

---

### Step 5: 验证

```
MorPexRuntime.run() Phase 4 (在 catch 之外, 只有执行成功才到达)
  → verificationEngine.verify([verArtifact])
    → QualityRule.init() 已在构造函数调用 → 注册 amazon_listing/code/document 规则
    → ArtifactChecker.check('document', artifact.metadata)
      → min_length 检查: content.length >= 100?
    → { pass: true/false, checks: [...] }
```

**状态: ⚠️ 代码存在但不可达**（因为 Step 4 必定失败）
- `QualityRule.init()` 在 `VerificationEngine` 构造函数中 ✅
- `verify()` 方法完整 ✅
- 但只有 Step 4 成功后才会执行到 Phase 4 ❌

---

### Step 6: 交付

```
MorPexRuntime.run() Phase 3+4 (Step 4 成功后)
  → ArtifactFacade.create('output', 'document', executionId, metadata)
    → ArtifactNode { status: 'CREATED', lineage: [] }
  → ApprovalGate.requestApproval(artifactId, 'output', complianceResult, risk)
    → LOW+PASS → 自动批准
    → BLOCK/HIGH → WAIT_HUMAN
```

**状态: ⚠️ 代码存在但不可达**
- `ArtifactFacade.create()` 完整 ✅
- `ApprovalGate.requestApproval()` 完整 ✅
- 但只有 Step 4 成功后才会执行 ❌

---

### Step 7: 学习

```
MorPexRuntime.run() Phase 5 (Step 4 成功后)
  → ExperienceMiner.mineFromCompletedTask(task)
    → PatternExtractor.extract(task) → CapabilityPattern
    → CapabilityRegistry.updateSuccessRate(capName, success)
    → CapabilityStore.save(pattern)
```

**状态: ⚠️ 代码存在但不可达**
- `ExperienceMiner.mineFromCompletedTask()` 更新 CapabilityRegistry ✅
- `CapabilityStore.save(pattern)` 被调用 ✅
- 但只有 Step 4 成功后才会执行 ❌

---

## 二、总览

```
步骤              状态    代码    运行时    说明
────────────────────────────────────────────────────────────────
① 输入目标        ✅     有      可运行    GoalIntelligenceFacade 完整
② 动态组队        ⚠️     有      可运行    但 Agent 池硬编码
③ 调用工作流      ❌     有      断裂      WorkflowProvider 无实现类
④ 执行            ❌     有      断裂      MissionRuntime/DAG/Fabric 未注入
⑤ 验证            ⚠️     有      不可达    依赖 Step 4
⑥ 交付            ⚠️     有      不可达    依赖 Step 4
⑦ 学习            ⚠️     有      不可达    依赖 Step 4
```

**结论: 设计层面 7 步齐全，运行时只到第 2 步。第 3 步断裂（工作流无实现），第 4 步断裂（执行引擎无后端）。**

---

## 三、断裂点修复

### 断裂 1: ServiceContainer 未注入 Execution 后端 (阻塞)

**位置**: `runtime/ServiceContainer.ts`

**修复**: 添加
```typescript
import { MissionRuntime } from './mission/MissionRuntime.js';
import { DAGRuntime } from './dag/DAGRuntime.js';
import { MissionRuntimeLike, DAGRuntimeLike, ExecutionFabricLike } from '../execution/UnifiedExecutionEngine.js';

// 在构造函数中:
const missionRuntime = new MissionRuntime(this.eventBus);
this.executionEngine.setMissionRuntime(missionRuntime);

const dagRuntime = new DAGRuntime(this.eventBus);
this.executionEngine.setDAGRuntime(dagRuntime);
```

### 断裂 2: WorkflowProvider 无实现类 (功能性)

**位置**: `packages/workflows/ecommerce/actions/amazon.ts`

**修复**: 需要添加 implements WorkflowProvider 的类
```typescript
import { WorkflowProvider, WorkflowAction } from '../../../core/src/workflow/WorkflowProvider.js';

export class EcommerceWorkflow implements WorkflowProvider {
  name = 'ecommerce';
  version = '1.0.0';
  description = 'E-commerce workflow for Amazon, Shopify';
  matchGoal(goal: string): boolean { return goal.toLowerCase().includes('amazon') || goal.toLowerCase().includes('电商'); }
  getActions(): WorkflowAction[] { return [createListing, uploadImage, updatePrice]; }
  getArtifactTypes(): string[] { return ['ListingJSON', 'ProductImage', 'KeywordReport']; }
  getValidators(): string[] { return ['AmazonPolicyChecker']; }
}
// 然后在 bootstrap 中:
WorkflowRegistry.register(new EcommerceWorkflow());
```

### 断裂 3: DynamicTeam Agent 池硬编码 (局限性)

**位置**: `organization/DynamicTeamOrchestrator.ts`

**修复**: 注入动态 Agent 池而不是硬编码数组
```typescript
setAgentPool(pool: Array<{ id: string; capabilities: string[]; departmentId: string }>): void {
  this.agentPool = pool;
}
// 在 orchestrate() 中使用 this.agentPool 替换硬编码数组
```

---

## 四、修复后可达路径

```
bootstrapV15Integration()
  → ServiceContainer(注入 MissionRuntime/DAGRuntime)
  → WorkflowRegistry.register(new EcommerceWorkflow())
  → DynamicTeamOrchestrator.setAgentPool(dynamicPool)
  → CompanyFacade.setRuntime(container.runtime)
  → executeGoal("开发空气检测设备并销售到 Amazon")
    → ✅ Goal (GoalIntelligenceFacade)
    → ✅ Mission (MissionController.createMission)
    → ✅ Capability (CapabilityRegistry.search)
    → ✅ Team (DynamicTeamOrchestrator)
    → ✅ Workflow (WorkflowRegistry.findForGoal → EcommerceWorkflow)
    → ✅ Execute (UnifiedExecutionEngine with MissionRuntime)
    → ✅ Artifact (ArtifactFacade.create)
    → ✅ Verify (VerificationEngine.verify)
    → ✅ Compliance (ComplianceChecker.check)
    → ✅ Approval (ApprovalGate.requestApproval)
    → ✅ Learn (ExperienceMiner → CapabilityRegistry.updateSuccessRate)
    → ✅ 闭环
```

**需要的修改量**: 4 个文件，~40 行代码
