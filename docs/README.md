# MorPex v10 文档索引

> v10 Autonomous Organization Intelligence OS — Phase 1-5 全部完成
> 从 v9.2 升级：+35 源文件 | +9 表 | +23 测试 | 145/145 ✅
> 旧版在 `_archive/`。

## 核心文档

| 文档 | 内容 |
|------|------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 完整架构：v9.2 79 模块 + v10 5 模块组（35 源文件）、分层、FSM（24 状态）、DB（34 表）、架构审计 |
| [features-and-architecture.md](features-and-architecture.md) | API 端点手册（57+ 端点）、引擎模块 |
| [testing-guide.md](testing-guide.md) | 测试指南：coverage-runner（50 任务）、exercise-all（100% 演练） |

## 运维文档

| 文档 | 内容 |
|------|------|
| [DEPLOY.md](DEPLOY.md) | 部署指南 |
| [MONITORING.md](MONITORING.md) | 监控配置 |
| [SECURITY.md](SECURITY.md) | 安全策略 |
| [PI-COMPAT-MATRIX.md](PI-COMPAT-MATRIX.md) | Pi 兼容性矩阵 |

## 前端文档

| 文档 | 内容 |
|------|------|
| [frontend/01_API_Contracts.md](frontend/01_API_Contracts.md) | API 契约 |
| [frontend/02_Business_Flow.md](frontend/02_Business_Flow.md) | 业务流程 |
| [frontend/03_Page_Requirements.md](frontend/03_Page_Requirements.md) | 页面需求 |
| [frontend/04_Data_Dictionary.md](frontend/04_Data_Dictionary.md) | 数据字典 + Observability API |

## 模块文档

| 文档 | 内容 |
|------|------|
| [modules/core-engine.md](modules/core-engine.md) | Core 引擎 |
| [modules/memory.md](modules/memory.md) | Memory 层 |
| [modules/studio-server.md](modules/studio-server.md) | Studio Server（含 v10 模块） |
| [modules/studio-ui.md](modules/studio-ui.md) | Studio UI |
| [modules/ai-engine.md](modules/ai-engine.md) | AI 引擎 |

## v10 模块组一览

| Phase | 模块 | 位置 | 源文件 | 测试 |
|-------|------|------|--------|------|
| **Phase 1** | Behavior Verification Engine | `verification/` | 8 | 6 ✅ |
| **Phase 2** | Simulation Twin | `simulation/` | 9 | 7 ✅ |
| **Phase 3** | Learning Plane | `learning/` | 5 | 1 ✅ |
| **Phase 4** | Event Mesh v10 | `event-mesh/` | 7 | 5 ✅ |
| **Phase 5** | Runtime Federation | `federation/` | 6 | 4 ✅ |
| **集成层** | V10API + V10MissionAdapter + V10Integration | `studio/server/` | 3 | — |

## 开发指南

| 文档 | 内容 |
|------|------|
| [guides/getting-started.md](guides/getting-started.md) | 快速开始 |
| [guides/development.md](guides/development.md) | 开发指南 |

## 审计

| 文档 | 内容 |
|------|------|
| [validation/architecture-report.md](validation/architecture-report.md) | 架构审计：8 项检查 100% 通过 |

---

## 归档文档

`docs/_archive/` — 包含以下历史文档：
- v8.6 to v9 演进计划
- v4.0 架构文档
- 旧版数据流图（DATAFLOW / dataflow-mermaid）
- 恢复审计报告（recovery/）
- 旧版升级/迁移指南
