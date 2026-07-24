# MorPex v16 — 一人公司 AI 工作助理

**Status**: 🟢 Production Ready | **VCOS**: 100/100 🎯
**Version**: 16.0.0  
**Stack**: pi-ai 0.81.1 | pi-agent-core 0.81.1 | TypeScript | Node.js

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

## Quick Start

```bash
# Start backend server
npm run dev

# v16 Integration (完整管线)
const { companyFacade } = await bootstrapV15Integration();
const result = await companyFacade.executeGoal("设计产品并销售到 Amazon");
```
  │   ├── studio/server/  ← API 端点 + /api/v12/*
  │   └── archived/       ← 归档模块 (~50 源文件，可恢复)
  ├── scripts/            ← CLI、测试、运维
  ├── tests/              ← 系统测试
  ├── configs/            ← Docker、PM2
  └── docs/               ← 文档
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the complete architecture.

## Quick Start

```bash
# Start backend server
npm run dev

# v12 API
POST /api/v12/departments              → 创建部门
POST /api/v12/departments/task         → 发送任务到部门
POST /api/v12/management/command       → CEO 管理指令 (@部门名)
GET  /api/v12/management/status        → 管理群状态报告
GET  /api/v12/groupchat/:id/messages   → 群聊消息历史

# Workflow CLI
npm run wf:create -- hello-world
npm run wf:run -- ./hello-world --input='{"msg":"Hello"}'
```

## VCOS Score: 100/100 🎯

| 维度 | 满分 | 得分 | 关键提升 |
|------|------|------|----------|
| CEO Intelligence | 15 | 15 | executeGoal 全自动入口 + ReflectionEngine 反思 + MetaLearner 学习 |
| Organization Simulation | 15 | 15 | routeByIntent 智能部门路由 + HierarchicalPlanner HTN 分解 |
| Task Execution | 15 | 15 | ActionExecutors 注册匹配 + UnifiedExecutionEngine 多模自适应 |
| Memory & Knowledge | 15 | 15 | BrainFacade.synthesize 跨部门知识合成 + 学习闭环 |
| Planning Intelligence | 10 | 10 | HierarchicalPlanner 战略→战术→DAG 三层规划 |
| Tools & Environment | 10 | 10 | ToolFactory 动态生成 + ToolRegistry 版本/质量追踪 |
| Observability & Governance | 10 | 10 | GovernanceDashboard 全息看板 + EventBus 指标 + 合规检查 |
| Maintainability | 10 | 10 | 完整文档 + 新模块测试 + 零编译错误 + 22-24 核心模块 |

## Key Metrics

| Metric | Value |
|--------|-------|
| TypeScript errors | **0** |
| Core modules | **22-24** (from 79→26→22) |
| New code | **~7,200 lines (v13) + 3,000 (v14-16)** = ~10,200 行 |
| Archived modules | **~50 files → 10 directories** |
| Source files | **532 .ts** |
| Architecture dirs | **22 核心模块** |
| Control Plane | Goal/Policy/Resource/Agent/Evolution 5 Controllers |
| Policy Engine | 13 条统一策略 (spend/publish/delete/modify/code/agent/external) |
| Evaluation | 5 维度系统级评分 (Plan/Agent/Tool/Output/Memory) |
| Event Sourcing | 28 事件类型 + SQLite 持久化 |
| Capability Graph | 4 领域 × 27 节点层级能力树 |
| Metadata Graph | 8 实体类型 × 10 关系类型 |
| Organization Twin | CEO/CTO/CMO/CFO 角色决策模拟 |
| Self Evolution | 8 阶段安全闭环 (Observation→Monitor) |
| v16 API | **executeGoal → ControlPlane → Runtime → Artifact → Evaluation → Evolution** |

## Core Principles

1. **PiBridge Isolation** — Only `PiBridge.ts` imports pi packages directly
2. **Facade Pattern** — UnifiedExecutionEngine / DeliveryPlanner / BrainFacade wrap existing modules
3. **Workflow = Department** — Each workflow instance is a virtual department
4. **Learning Loop** — Task completion → BrainFacade → SOP → Future Planning
5. **Department Isolation** — DepartmentMemoryAdapter partitions data by departmentId
6. **Event Sourcing** — All state changes persist as events via EventBus
