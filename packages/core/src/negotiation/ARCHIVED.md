# Negotiation 模块 — 已合并 (v13)

**合并目标**: `LeadAgentOrchestrator.resolveTaskConflict()`

**说明**:
- `NegotiationLite` 的简单协商能力已合并到 `LeadAgentOrchestrator`
- 冲突解决: 基于优先级和估计耗时智能选择
- 原文件保留不动以向后兼容，但建议新代码直接使用 `LeadAgentOrchestrator`

**迁移路径**:
```
旧: NegotiationLite.negotiate(taskA, taskB)
新: leadAgentOrchestrator.resolveTaskConflict(taskA, taskB)
```
