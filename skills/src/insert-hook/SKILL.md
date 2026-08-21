---
name: insert-hook
description: 当判定"新功能未实现、要插入到现有引擎"时使用——确定合法接入点、应插在哪个函数/事件之前还是之后、消息怎么传。避免乱改核心链、避免把功能插错层导致数据流断裂。
---

# insert-hook — 接入点选择

1. 读 `docs/HOOK_MAP.md` 的「接入点速查」→ 按你想要的挑一个 hook：
   - 新工件/新行动 → `DomainPrimitiveRegistry.register` / `packages/workflows/<domain>/`
   - 执行后自动多一步 → 订阅事件（如 `evaluation.profile.scored` / `artifact.created`）
   - 需人工确认 → `UserAskService` / `ApprovalGate`
   - 前端多展示 → `TaskStateProjector` 投影 + `studio/web/views`
2. 对照「主流程各阶段挂点」决定插在**哪个阶段的前/后**。
3. 消息：新事件/字段按 `event-messaging` skill（EVENT_PAYLOAD_SPEC）加块，别在旧 payload 续字段。
4. 三不要：不改核心链主干、不绕过 EventBus、插入后同步文档（dev-flow §6）。

> 参考明细：`docs/HOOK_MAP.md`（接入点+前后顺序+主流程挂点+决策表）。