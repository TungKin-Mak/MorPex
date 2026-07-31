## 变更描述

请简要描述本次变更的目的。

## 对应理想架构层（必填）

**本改动对应理想架构的哪一层？**

请从下方选择（参考 `README.md` 中的 Ideal Target Architecture）：

- [ ] 第 1 层：Entry & Governance（CompanyFacade / ControlPlane）
- [ ] 第 2 层：Ontology Gate（强制知识检索）
- [ ] 第 3 层：Planning
- [ ] 第 4 层：Cognition & Brain
- [ ] 第 5 层：Execution
- [ ] 第 6 层：Tools & Primitives
- [ ] 第 7 层：Knowledge & Memory
- [ ] 第 8 层：Evolution
- [ ] 第 9 层：Workflow Plugin（`packages/workflows/`）
- [ ] 第 10 层：Infrastructure（EventBus 等）
- [ ] 不适用（纯文档 / 测试 / 配置）

**如果不属于以上任何一层，请说明原因：**

## 架构影响

- [ ] 本次变更是否新增了对已废弃目录（`planes/`、`brain/`）的引用？
- [ ] 是否绕过了 Ontology Gate？
- [ ] 是否在 core 中新增了领域逻辑？

## 测试与验证

- [ ] `npx tsc --noEmit` 通过
- [ ] `node scripts/validate-architecture.js` 通过
- [ ] 已更新相关文档

## 其他说明
