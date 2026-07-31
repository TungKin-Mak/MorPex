# DEPRECATED — planes/ 目录

**Status**: 2026-07-30  
**Reason**: 理想架构第 1 层已统一使用 `control-plane/`、`runtime/` 等顶层目录。

`planes/` 目录（agent-plane、artifact-plane、control-plane、knowledge-plane、runtime-kernel）为早期分层抽象，现已重复。

**已废弃子目录**：
- `control-plane/` → 已迁移至 `control-plane/`（Goal/Policy/Resource 等 Controller）

**剩余目录**（agent-plane、artifact-plane 等）：
- 仅被少数 extensions/ 引用
- 计划在 Phase 4.5 中逐步迁移或移除

**请勿在 planes/ 下新增任何新模块。**

所有新代码请直接使用理想架构对应层：
- Governance → control-plane/
- Runtime → runtime/
- Execution → execution/
- Brain → cognition/

参考：README.md 中的 Ideal Target Architecture。
