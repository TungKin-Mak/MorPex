# MorPex 精简机会地图（Refactor Opportunity Map）

> 用途：作为"功能不变前提下精简"的决策依据。基于实测数据（vitest 覆盖率 / 模块规模 / 入口引用 / DEPRECATED 声明），把后端模块分成 **A 可移除 / B 实现收敛 / C 结构精简 / D 必须保留** 四档，并给出分批路线与风险。
> 口径：覆盖率为 `data/test-report/coverage/coverage-final.json`（测试执行路径触达度）；入口引用 = 是否被 `index.ts` / `bootstrap-unified.ts` 等在真实入口引用；文件规模为当前工作树实测。

---

## 0. 概览

| 指标 | 值 |
|---|---|
| 后端源码文件（.ts，含 scripts） | ~500 |
| 后端总行数 | ~85k |
| 非测试代码文件（核心 + 独立包） | 328 |
| 现存「低用/可移除」模块（A 类） | **24 文件 / ~3,842 行** |
| 注 | 覆盖报告含已删历史文件（cognitive-loop/scheduler/skill 等早已移除），已剔除 |

## 1. A 类：强证据 · 低用/可移除（本轮 P0）

> 判定依据：DEPRECATED 声明 / 覆盖率≈0 / 非核心入口或仅兼容引用。移除或降级后**用户可见功能不变**（均为名义能力或可选子系统）。

| 模块 | 文件 / 行 | 证据 | 动作 | 风险 |
|---|---|---|---|---|
| `execution/harness/`（AgentHarness/ContextBuilder/HarnessContext/types/index） | 5 / 449 | 自带 `DEPRECATED.md`（属 planes 废弃分层）；覆盖率≈0 | **移除**（确认无运行时引用后） | 低 |
| `knowledge/graph/knowledge/`（KnowledgeGraph + types） | 2 / 584 | 入口 0 引用；覆盖率≈0（旧图实现，被 `graph/SystemMetadataGraph` 取代） | 移除或标注废弃 | 低 |
| `studio/server/simulation/`（cost/risk/success/plan-simulator + engine/twin + types） | 9 / 1,399 | 入口仅在 StudioServer 可选注册；覆盖率≈0 | 降级为「可选挂载」或移出默认构建 | 中 |
| `studio/server/verification/`（behavior-verification/regression/quality-score…） | 8 / 1,410 | 同上；覆盖率≈0 可选子系统 | 同上 | 中 |

## 2. B 类：中证据 · 实现层冗余可收敛（P1，等语义合并）

> 判定依据：存在多套功能重叠的实现；合并需行为测试兜底，做完**总行数显著下降**。

| 收敛点 | 现状 | 收敛思路 | 风险 |
|---|---|---|---|
| **execution 编排多轨**（最大） | `UnifiedExecutionEngine` + `MissionRuntime` + `DAGRuntime` + `ExecutionFSM` + `OrchestratorAgent/step-agent` 多套编排 | 统一为单一编排模型，废弃存活于历史的多轨实现 | 高（核心路径） |
| **知识/记忆重叠** | core `knowledge/context`（RAG-lazy：Dense/BM25/RRF/Reranker）与独立 `memory` 包（cognee/wiki/jsonl） | 收敛检索/记忆入口为一套，按场景切换引擎而非并存 | 中高 |
| **工具/原语多轨** | `primitiveAgentTools` + `ToolFactory/ToolRegistry` + `ConnectorRegistry(connectors包)` | 统一原语注册/执行模型，tool 层只留薄投影 | 中 |

## 3. C 类：结构精简（改架构，P2，最快最后）

> 依据：层内职责重叠。**不推翻 8 层宪法**，只做层内收敛与可选扁平化。

| 结构点 | 动作 | 风险/注意 |
|---|---|---|
| `governance` 4 Controller + PolicyEngine/ApprovalGate/RiskAnalyzer | 收敛同职责子模块为更少类 | 中；需同步 validate-architecture/文档 |
| `cognition/learning`（10+ 文件）/ `planning`（多 planner） | 合并重复机制 | 中 |
| barrel 中间层（30+ 个 2-6 行 index.ts） | 扁平化：import 直达目标 | ⚠️ 破坏面大（所有 `from './x/index.js'` 同步改），收益仅是中间层文件数 |

## 4. D 类：必须保留（禁止精简）

- **核心链**：`facade/CompanyFacade`、`gate/runOntologyGroundedReasoning`(+ForcedQueryGuard/modelVisibleLog)、`knowledge/ontology+artifact+context` 权威、`governance/control-plane`
- **底座**：`infrastructure/common/EventBus`（唯一通信）、`adapters/pi-bridge/PiBridge`（唯一 pi 引入）、`bootstrap-unified`（装配）、`protocol/contracts+events`、`types` 契约文件、connectors（外部之手）、memory 引擎面
- **注**：A1/A4 的 `types.ts` 纯类型文件覆盖率 0 属天然属性，**不在**精简目标内。

## 5. 分批执行建议

| 批 | 内容 | 验收 | 预期收益 |
|---|---|---|---|
| **P0** | A 类移除/降级（确认引用后） | 每项：tsc 0 + 依赖 0 + 架构 0 + 相关测试 0 回归 | **-24 文件 / -3.8k 行**（约占后端 4.5%） |
| **P1** | B 类等语义收敛（execution 编排 → 工具 → 记忆） | 每收敛点独立门禁 + 行为测试等价 | 数千行级（最大头，分批） |
| **P2** | C 类结构收敛 + barrel 可选扁平 | 同步 validate-architecture/文档 | 文件数进一步收敛 |

## 6. 「功能不变」边界与验证方法

- **A 类**：移除前必须 grep **全仓（含测试、动态 import、package.json 脚本、cli）** 确认零引用；harness/KnowledgeGraph 保留引用兼容的，改为「不装载 + 标记废弃」而非物理删除，观察一轮再删。
- **B 类**：每个收敛点先建等价性测试（同输入同输出基线），再合并。
- 覆盖信号以「真实 mock 闭环 76% 使用率 + 8 盲区专项测试」为准，A 类各模块均不在该 76% 核心覆盖内 → 安全。