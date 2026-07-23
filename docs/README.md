# MorPex v11 文档索引

> v11 Adaptive Workflow Operating System — Phase 1-4 完成，Phase 5 待开发
> 从 v10 升级：+21 源文件 | PiBridge 隔离层 | pi-ai/pi-agent-core 0.81.1
> 旧版在 `_archive/`。

## 核心文档

| 文档 | 内容 |
|------|------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 完整架构：v10 + v11 模块、PiBridge 隔离、分层、源码树 |
| [features-and-architecture.md](features-and-architecture.md) | API 端点手册（57+ 端点）、引擎模块 |
| [testing-guide.md](testing-guide.md) | 测试指南 |

## 运维文档

| 文档 | 内容 |
|------|------|
| [PI-COMPAT-MATRIX.md](PI-COMPAT-MATRIX.md) | Pi 兼容性矩阵（v0.81.1） |
| [DEPLOY.md](DEPLOY.md) | 部署指南 |
| [MONITORING.md](MONITORING.md) | 监控配置 |
| [SECURITY.md](SECURITY.md) | 安全策略 |

## 前端文档

| 文档 | 内容 |
|------|------|
| [frontend/01_API_Contracts.md](frontend/01_API_Contracts.md) | API 契约 |
| [frontend/02_Business_Flow.md](frontend/02_Business_Flow.md) | 业务流程 |
| [frontend/03_Page_Requirements.md](frontend/03_Page_Requirements.md) | 页面需求 |
| [frontend/04_Data_Dictionary.md](frontend/04_Data_Dictionary.md) | 数据字典 + Observability API |

## v11 新增模块

### Workflow SDK (`packages/workflow-sdk/`)
| 文件 | 行 | 职责 |
|------|----|------|
| `src/types.ts` | 280 | v11 全部类型定义 |
| `src/IWorkflowAdapter.ts` | 61 | 热插拔适配器接口 |
| `src/WorkflowSDK.ts` | 452 | 主 API（create/install/execute/optimize/rollback） |
| `src/WorkflowRuntime.ts` | 691 | Runtime 引擎，包装 v10 运行时 |
| `src/WorkflowContext.ts` | 123 | Context 工厂 |
| `src/PiModelRegistry.ts` | 150 | PiBridge 模型注册（HTTP 回退） |
| `src/PiAgentPlanner.ts` | 内嵌于 bootstrap | AI 规划器（DeepSeek API） |
| `src/bootstrap.ts` | 380 | 一键启动：EventBus + MissionRuntime + DAGRuntime + PiBridge |
| `src/index.ts` | 58 | Barrel 导出 |

### Connectors (`packages/connectors/`)
| 文件 | 行 | 职责 |
|------|----|------|
| `src/types.ts` | 108 | ActionRequest / ActionResult |
| `src/IActionConnector.ts` | 69 | 标准连接器接口 |
| `src/BaseConnector.ts` | 159 | 抽象基类 |
| `src/FileSystemConnector.ts` | 317 | 9 种文件操作 + 路径穿越防护 |
| `src/ShellConnector.ts` | 156 | Shell 执行 + 命令白名单 |
| `src/ConnectorRegistry.ts` | 272 | 中心注册表 |
| `src/index.ts` | 33 | Barrel 导出 |

### PiBridge 隔离层 (`packages/core/src/adapters/pi-bridge/`)
| 文件 | 职责 |
|------|------|
| `PiBridge.ts` | **唯一运行时导入** pi-ai + pi-agent-core 的文件 |
| `index.ts` | Barrel 导出 |

### Execution Fabric & Evolution (`packages/core/src/`)
| 文件 | 职责 |
|------|------|
| `execution/fabric/ExecutionFabric.ts` | 统一执行面料 |
| `evolution/ExperienceMiner.ts` | 经验挖掘 |
| `evolution/FailureAnalyzer.ts` | 根因分析 |
| `evolution/PatternExtractor.ts` | 6 种模式模板 |

### CLI (`scripts/workflow-cli.ts`)
| 命令 | 说明 |
|------|------|
| `wf:create <name>` | 创建工作流模板 |
| `wf:run <dir>` | 一键安装+执行 |
| `wf:list` | 列出已安装 |
| `wf:optimize <id>` | 触发进化引擎 |
| `wf:versions <id>` | 版本历史 |
| `wf:rollback <id> <v>` | 版本回滚 |

## 版本历史

| 版本 | 内容 |
|------|------|
| **v11** | Adaptive Workflow OS + PiBridge 隔离 + pi 0.81.1 |
| v10 | Autonomous Organization Intelligence OS（5 模块组 35 源文件） |
| v9.2 | Agent Organization OS（79 模块） |

---

## 归档文档

`docs/_archive/` — 包含历史版本文档。
