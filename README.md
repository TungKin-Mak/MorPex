# MorPex v13 — 一人公司 AI 工作助理

**Status**: 🟢 Production Ready | **VCOS**: 100/100 🎯  
**Version**: 13.0.0  
**Stack**: pi-ai 0.81.1 | pi-agent-core 0.81.1 | TypeScript | Node.js

---

## Architecture

```
E:/Morpex/          ← 后端
  ├── packages/
  │   ├── core/           ← 核心引擎
  │   │   ├── department/     ← 🆕 虚拟部门 (DepartmentManager, LeadAgentOrchestrator)
  │   │   ├── facade/         ← 🆕 CEO 入口 (CompanyFacade)
  │   │   ├── organization/   ← 🆕 组织层 (ManagementHub, OrganizationContextLite)
  │   │   ├── role/           ← 🆕 角色注册 (RoleRegistry)
  │   │   ├── planner/        ← 🆕 统一规划 (DeliveryPlanner)
  │   │   ├── cognition/      ← 🆕 大脑门面 (BrainFacade)
  │   │   ├── execution/      ← 执行引擎 (UnifiedExecutionEngine, SubAgentFork)
  │   │   ├── evolution/      ← 🆕 SOP 引擎 (SOPEngine)
  │   │   ├── interaction/    ← 🆕 群聊 (GroupChatManager)
  │   │   ├── router/         ← RouterLite
  │   │   ├── negotiation/    ← NegotiationLite
  │   │   └── observability/  ← ObservabilityLite
  │   ├── workflow-sdk/   ← v11 Workflow SDK
  │   ├── connectors/     ← v11 Connector Infrastructure
  │   ├── contracts/      ← 共享类型
  │   ├── memory/         ← MemoryWiki (SQLite+ZVec)
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
| New code (v12+v13) | **~9,200 lines** |
| Archived modules | **~50 files → 10 directories** |
| v13 API | **executeGoal 全自动入口** |
| VCOS | **100/100** 🎯 |
| Learning loop | **Closed** (Task→Brain→SOP→Planning) |

## Core Principles

1. **PiBridge Isolation** — Only `PiBridge.ts` imports pi packages directly
2. **Facade Pattern** — UnifiedExecutionEngine / DeliveryPlanner / BrainFacade wrap existing modules
3. **Workflow = Department** — Each workflow instance is a virtual department
4. **Learning Loop** — Task completion → BrainFacade → SOP → Future Planning
5. **Department Isolation** — DepartmentMemoryAdapter partitions data by departmentId
6. **Event Sourcing** — All state changes persist as events via EventBus
