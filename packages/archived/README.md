# MorPex 已归档模块

## 归档信息

- **归档日期**: 2026-07-24
- **归档原因**: 79→26 模块精简 — 这些模块对"一人虚拟公司"场景非必需
- **可恢复性**: 所有模块仍在 git 历史中，直接 `git checkout` 或从此目录恢复

## 归档模块清单

| 目录 | 原位置 | 包含内容 | 原因 |
|------|--------|---------|------|
| `agent-marketplace/` | `packages/core/src/agent/marketplace/` | MarketplaceRegistry, BidEngine, TrustVerifier, CapabilityAdvertiser, ThirdPartyAgentAdapter, MarketplaceContract | 一人公司无第三方 Agent 竞标场景 |
| `agent-distributed/` | `packages/core/src/agent/distributed/` | DistributedRuntimeManager, DistributedScheduler, DistributedSqliteRepository, RemoteAgentProxy, ConsensusCoordinator | 单机运行，不需要分布式调度 |
| `reliability-chaos/` | `packages/core/src/reliability/chaos/` | ChaosEngine, FaultInjector | 一人公司不需要混沌工程 |
| `reliability-regression/` | `packages/core/src/reliability/regression/` | GoldenDatasetManager, RegressionRunner, WorkflowPromotion | 回归/晋升流程过于重量级 |
| `observability-legacy/` | `packages/studio/server/observability/` | coverage-runner, exercise-all | 79 模块覆盖率报告不再需要 |

## 恢复方式

如需恢复某个模块，只需：
```bash
# 恢复 marketplace 示例
mv packages/archived/agent-marketplace/* packages/core/src/agent/marketplace/
# 然后恢复 barrel export
# 在 packages/core/src/agent/index.ts 中添加相应 export
```

## 注意事项

- 这些模块归档时已被从 barrel export 中移除
- 如果恢复，需要在对应的 index.ts 中重新添加导出
- 相关测试文件仍保留在原位（未移动）
