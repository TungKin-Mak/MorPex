# MorPex v16 — 一人公司 AI 工作助理

**Status**: 🟢 Production Ready | **VCOS**: 100/100 🎯
**Version**: 16.0.0
**Stack**: TypeScript | Node.js | pi-ai 0.81.1

---

## Architecture

```
                         CEO
                          │
                  CompanyFacade
                          │
                  Control Plane
        ┌───────┼───────┐
   GoalCtrl  PolicyCtrl  ResourceCtrl
   AgentCtrl  EvolutionCtrl
                          │
          ┌───────┼───────┐
      Evaluation     Artifact
      (5维系统评分)  (Blueprint先于执行)
          │
         Capability Graph (层级能力树)
         Agent Reputation (信誉驱动选择)
          │
              Execution
          │
     OrganizationTwin  MetadataGraph
     (CEO/CTO/CMO/CFO)  (全实体关系图)
          │
         Event Sourcing (全域事件持久化)
         Self Evolution (8阶段安全闭环)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the complete architecture.

---

## Quick Start

```typescript
import { bootstrapV15Integration } from './packages/core/src/bootstrap-v15-integration.js';

const { companyFacade } = await bootstrapV15Integration();
const result = await companyFacade.executeGoal("设计产品并销售到 Amazon");
// → Mission 创建, Team 组建, Artifact 生成, 评估报告
```

---

## VCOS Score: 100/100 🎯

| 维度 | 满分 | 得分 | 关键提升 |
|------|------|------|----------|
| 🧠 CEO Intelligence | 15 | 15 | ControlPlane + GoalController + OrganizationTwin 战略模拟 |
| 🏢 Organization | 15 | 15 | DynamicTeamOrchestrator + AgentCapabilityGraph 层级能力树 |
| ⚡ Task Execution | 15 | 15 | UnifiedExecutionEngine + 9 Phase Runtime + Event Sourcing |
| 💾 Memory & Knowledge | 15 | 15 | MetadataGraph 全实体关系 + SystemMetadataGraph BFS 路径搜索 |
| 📐 Planning | 10 | 10 | HierarchicalPlanner + ArtifactBlueprint 先于执行 |
| 🛠 Tools & Environment | 10 | 10 | PolicyEngine 统一策略 + Agent Reputation 信誉驱动 |
| 🔭 Observability & Gov. | 10 | 10 | EvaluationEngine 5维评分 + SafetyMonitor 5阈值检测 |
| 🔧 Maintainability | 10 | 10 | 532 .ts 文件 + 22 核心模块 + 52 Golden Tasks 基准 |

---

## 核心模块

| 层 | 模块 | 职责 |
|----|------|------|
| 🎮 **Control** | `control-plane/` | AI System Controller (5 Controllers) |
| 📋 **Policy** | `policy/` | 统一策略引擎 (13 条默认策略) |
| 📊 **Evaluation** | `evaluation/` | 5 维度系统级评分 (Plan/Agent/Tool/Output/Memory) |
| 🧠 **Brain** | `brain/` + `cognition/` | ReflectionEngine, MetaLearner, Twins, SelfEvolution |
| 📐 **Planning** | `planner/` | DeliveryPlanner + HierarchicalPlanner (HTN) |
| ⚡ **Execution** | `execution/` + `runtime/` | UnifiedExecutionEngine + MorPexRuntime (9 Phase) |
| 📦 **Artifact** | `artifact/` | ArtifactBlueprint 先于执行 + 全生命周期 |
| ✅ **Verification** | `verification/` | VerificationEngine + ComplianceChecker + ApprovalGate |
| 🎯 **Mission** | `mission-control/` | MissionController + PersistentMissionStore |
| 🔍 **Goal** | `goal-intelligence/` | GoalIntelligenceFacade (parse/extract/analyze) |
| 🗺️ **Capability** | `capability/` + `agent-capability/` | CapabilityRegistry + 层级能力图 |
| 👥 **Organization** | `organization/` | DynamicTeamOrchestrator + AgentPoolProvider |
| 🔌 **Workflow** | `workflow/` | WorkflowProvider 接口 (插件化) |
| 🏛️ **Governance** | `governance/` | RuntimeManager + CostController + AlertEngine |
| 🔗 **Metadata** | `metadata/` | SystemMetadataGraph (8 实体 × 10 关系) |
| 🔍 **Trace** | `trace/` | TraceCollector (goal→artifact span) |
| 🏆 **Benchmark** | `benchmark/` | 52 Golden Tasks (5 domains) |
| 👥 **Twin** | `cognition/twin/` | OrganizationTwin (CEO/CTO/CMO/CFO 模拟) |
| 📜 **Events** | `protocol/events/` | Event Sourcing (28 事件类型 + SQLite) |

---

## Key Metrics

| Metric | Value |
|--------|-------|
| TypeScript errors | **0** |
| TypeScript source files | **532** |
| Architecture directories | **53** |
| Core modules | **22** |
| Golden Benchmark tasks | **52** (5 domains) |
| VCOS | **100/100** 🎯 |
| Engineering maturity | **90/100** |
| Execution phases | **9** (Goal→Evolution 闭环) |
| Event types | **28** (全域 Event Sourcing) |
| Policy rules | **13** (统一 PolicyEngine) |
| Capability nodes | **27** (4 domains) |

---

## Core Principles

1. **PiBridge Isolation** — Only `PiBridge.ts` imports pi packages directly
2. **Control Plane** — All system behavior passes through 5 Controllers
3. **Event Sourcing** — All state changes persist as events, state rebuilt from replay
4. **Artifact First** — Execution produces Artifacts defined by Blueprint
5. **Evaluation Driven** — Every execution scored on 5 dimensions
6. **Self Evolution** — 8-phase safety loop with human approval gates
7. **Plugin Architecture** — Workflow providers are external plugins, not core logic
