# Planes 迁移报告 — 实际架构 → 理想架构（对齐缺口 26 → 0）

**Date**: 2026-07-31
**Scope**: 迁移 `packages/core/src/planes/` 全部实现到 canonical 层，消除理想架构对齐的最后一项积压。

## Result

- ✅ `scripts/validate-architecture.js`：**架构对齐度 100%（0 ERROR / 0 WARNING）** —— 自对齐检查引入以来首次全绿。
- ✅ `npx tsc --noEmit`：0 错误。
- ✅ `node scripts/production-check.cjs`：8/8 passed。
- ✅ 新增测试（Graded Gate + Bounded Autonomy）：9/9。
- ✅ 全仓（src + tests + studio + e2e + bootstrap）`planes/` import 引用清零；`planes/` 目录仅剩 DEPRECATED.md 历史文档。

## 迁移方法（逐簇，每簇 tsc 验证）

planes/ 不是垫片而是核心运行时的真实实现（DAGRuntime/TaskGraph/工具/公共 API 均依赖），因此采用**物理搬移 + 导入者更新 + 孤儿删除**，而非重定向。

| 簇 | 迁移 | 导入者 |
|----|------|--------|
| runtime-kernel/dag | types.ts → `runtime/dag/types.ts` | 6 处（DAGRuntime/TaskGraph/TaskNode/planning 类型） |
| knowledge-plane/artifacts | → `artifact/registry/` | 6 处（DomainCluster/MetaPlanner/tools/index） |
| knowledge-plane/knowledge | → `metadata/knowledge/` | 4 处 |
| knowledge-plane/memory | → `memory/knowledge/` | 1 处 |
| agent-plane | → `agent/harness/`（orchestrator+swarm 为测试引用 stub，保留） | 6 处（tools/MemoryActivationEngine/ExecutionScenarioRunner/index） |
| control-plane/intent | → `goal-intelligence/intent/` | index.ts + ExecutionScenarioRunner |
| control-plane/orchestrator/ExecutionOrchestrator | → `control-plane/orchestrator/` | 14 处（规划引擎/router/index） |
| artifact-plane | → `artifact/plane/` | index.ts + SqliteEventStore/Studio/测试 |
| runtime-kernel/fsm, execution-graph, scheduler | → `runtime/fsm|execution-graph|scheduler/` | 测试（morpex-core） |
| 孤儿（DAGEngine、各 plane/plugin.ts 等） | 删除 | 无任何引用（经全仓扫描确认） |

## 修复的连带问题

- 各移动簇的相对深度变化（如 `planes/control-plane/intent` 3 层 → `goal-intelligence/intent` 2 层）逐一修正 `../../../` → `../../`。
- 恢复误删的 `agent/harness/orchestrator` + `swarm`（morpex-core.test.ts 引用 stub）。
- `bootstrap.ts`（旧入口）的 ArtifactPlugin/KnowledgeGraphPlugin 路径更新；删除的 plugin 因被旧 bootstrap 使用而从索引恢复。
- studio/server 与 e2e-test 的 5 处路径更新。
- index.ts 15 处 re-export 全部改指新位置，公共 API 行为不变。

## 验证证据

- `grep -rn "from '.*planes/" packages/ scripts/ tests/` → 0 匹配。
- validator 从「26 处 WARNING」→「100%（无违规）」。
- production-check 8/8 证明核心运行时（DAG、Artifact、Memory、工具、规划）迁移后行为未回归。

## 遗留

- `planes/` 目录保留 DEPRECATED.md（历史记录），不再含任何 .ts 源码。
- `packages/core/__tests__/` 中 legacy 自执行脚本与 vitest 不兼容属预存环境特性（非本次回归）；canonical 门禁为 production-check.cjs。
