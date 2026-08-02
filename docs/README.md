# MorPex 文档索引（当前架构）

> 本索引维护当前 8 层单一架构的权威文档。**唯一架构真相源 = `AICOS_CORE_ARCHITECTURE.md`**。
> 历史/遗留文档（旧模块结构、已移除前端 UI、旧版本 Bootstrap 等）已随 Wave 7-9 清理删除，不再保留。

## 权威文档

| 文档 | 内容 |
|------|------|
| [AICOS_CORE_ARCHITECTURE.md](AICOS_CORE_ARCHITECTURE.md) | **唯一架构真相源**：8 层模型（L1-L8 + 领域插件非层）、依赖方向、Gate/Tier 规则 |
| [AICOS_DATA_FLOW.md](AICOS_DATA_FLOW.md) | **完整架构与数据流全链路**：端到端主链路、事件驱动演化闭环、Gate 强制链、时序 |
| [AICOS_CORE_FILE_REGISTRY.md](AICOS_CORE_FILE_REGISTRY.md) | 逐文件清单 + 目录计数（与 `find` 实时对账） |
| [PROJECT_TREE.md](PROJECT_TREE.md) | 项目目录树（8 层结构） |
| [TESTING_PLAN.md](TESTING_PLAN.md) | 测试计划与覆盖矩阵 |

## 指南

| 文档 | 内容 |
|------|------|
| [guides/getting-started.md](guides/getting-started.md) | 快速开始 |
| [guides/development.md](guides/development.md) | 开发指南 |
| [guides/workflow-xjmcu.md](guides/workflow-xjmcu.md) | 领域工作流（xjmcu） |
| [testing-guide.md](testing-guide.md) | 测试指南 |
| [ontology-grounding.md](ontology-grounding.md) | Ontology Grounded Reasoning 执行路径 |

## 运维

| 文档 | 内容 |
|------|------|
| [DEPLOY.md](DEPLOY.md) | 部署指南 |
| [MONITORING.md](MONITORING.md) | 监控配置 |
| [SECURITY.md](SECURITY.md) | 安全策略 |
| [MEMORY_DEPLOYMENT.md](MEMORY_DEPLOYMENT.md) | 记忆系统部署 |

## 验证与性能

| 文档 | 内容 |
|------|------|
| [validation/architecture-report.md](validation/architecture-report.md) | 架构验证报告 |
| [performance-checklist.md](performance-checklist.md) | 性能检查清单 |

## 功能规划（待实现方案）

| 文档 | 内容 |
|------|------|
| [FEATURE_RULE_ENFORCEMENT.md](FEATURE_RULE_ENFORCEMENT.md) | 功能②规则中断更正（L3 规则执行器）最终方案 + Phase 1 落点拆解 |
