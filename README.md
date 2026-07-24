# MorPex v12 — 一人公司 AI 工作助理

**Status**: 🟢 Production Ready | **VCOS**: 92/100  
**Version**: 12.0.0  
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

## VCOS Score: 92/100

| 维度 | 满分 | 得分 |
|------|------|------|
| CEO Intelligence | 15 | 13 |
| Organization Simulation | 15 | 14 |
| Task Execution | 15 | 14 |
| Memory & Knowledge | 15 | 14 |
| Planning Intelligence | 10 | 9 |
| Tools & Environment | 10 | 8 |
| Observability & Governance | 10 | 8 |
| Maintainability | 10 | 8 |

## Key Metrics

| Metric | Value |
|--------|-------|
| TypeScript errors | **0** |
| Core modules | **26** (from 79) |
| New code | **~7,200 lines** |
| Archived modules | **~50 files → 10 directories** |
| v12 API endpoints | **+9** |
| Learning loop | **Closed** (Task→Brain→SOP→Planning) |

## Core Principles

1. **PiBridge Isolation** — Only `PiBridge.ts` imports pi packages directly
2. **Facade Pattern** — UnifiedExecutionEngine / DeliveryPlanner / BrainFacade wrap existing modules
3. **Workflow = Department** — Each workflow instance is a virtual department
4. **Learning Loop** — Task completion → BrainFacade → SOP → Future Planning
5. **Department Isolation** — DepartmentMemoryAdapter partitions data by departmentId
6. **Event Sourcing** — All state changes persist as events via EventBus
