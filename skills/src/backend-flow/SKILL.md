---
name: backend-flow
description: 当需要理解"一个任务从头到尾怎么跑、数据怎么流、在哪插入自定义逻辑"时使用——核心执行链、8 层时序、持久化召回、失败路径。
---

# backend-flow — 业务流/数据链

1. **主链**：用户输入 → `CompanyFacade.executeGoal`（闲聊/任务分流）→ ControlPlane(L1) → Ontology Gate(L3，先查事实不编) → DeliveryPlanner(L4) → UnifiedExecutionEngine(L5，简单→原语 / 复杂→OrchestratorAgent+step-agent) → Evaluation(L6) → 产物+learn 记忆 → Evolution(L7)。
2. **数据持久化**：EventStore 事件溯源（全程留痕/回放）；TaskStateProjector 任务投影（UI 真相源）；ArtifactRegistry 产物；记忆（cognee/wiki）。
3. **失败路径**：工具空参→降级→重试→失败→(预算熔断)；QueryMiss→演化信号。
4. **在哪插**：见 `insert-hook` skill（主流程各阶段都有合法挂点）。

> 参考明细：`docs/AICOS_FLOW.md`（时序图/持久化/失败路径/层-日志映射）。