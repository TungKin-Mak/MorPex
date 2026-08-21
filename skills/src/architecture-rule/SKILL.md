---
name: architecture-rule
description: 当改动涉及"架构、层间调用、新增模块、符合不合规 8 层宪法"时使用——知道 AICOS-Core 8 层边界、PiBridge 隔离、EventBus Only、Ontology Gate 等硬约束，避免层违规。
---

# architecture-rule — 8 层架构铁律

1. **8 层**：L1 治理/L2 知识/L3 Ontology Gate★/L4 认知规划/L5 执行/L6 评价/L7 演化/L8 基础设施；领域插件在 `packages/workflows/`。
2. **硬约束**：
   - Ontology Gate = 知识检索/生成强制前置，QueryMiss 是信号；
   - EventBus 唯一通信通道（禁模块直接调用）；
   - PiBridge 唯一 `import @earendil-works/pi-*`（`adapters/pi-bridge/PiBridge.ts`）；
   - 领域逻辑仅 `packages/workflows/`；
   - 分级 Gate（tier-0/1/2）、Bounded Autonomy、Verifiable Evolution（沙箱+审批+版本化）。
3. **校验**：`node scripts/validate-architecture.js` 0 违规为通过；新增模块必须对应某层并登记。

> 参考明细：`docs/AICOS_CORE_ARCHITECTURE.md`（v2 宪法）+ `docs/DEVELOPMENT.md §4`。