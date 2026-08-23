---
name: event-messaging
description: 当涉及"事件、消息传递、任务卡片、SSE、事件契约、payload 结构"时使用——知道事件载荷的稳定信封与可扩展分块规范、该往哪个块加字段、未知块怎么办。
---

# event-messaging — 事件/消息格式

1. **信封**：`Envelope` 稳定头（schemaVersion/id/type/timestamp/source/layer/refs）+ `payload`（MessageBox）。
2. **可扩展**：payload 分块（task/state/human/artifacts/media/error/extensions）——**新交互/新媒体=加新块或新 kind**，老消费者忽略未知块。
3. **媒体**：只带引用+元数据（不塞二进制），LLM 按引用经工具取用 / 本地打开。
4. **契约**：新事件先在 `packages/core/src/infrastructure/common/contracts/eventContractCatalog.ts` 定义 `defineContract`（必填 missionId/executionId + 可选块），否则 emit 会 WARN。
5. **卡片**：任务卡片字段对齐 `TaskStateProjector` 投影（status/stage/human/media/error 块）。

> 参考明细：`docs/EVENT_PAYLOAD_SPEC.md` + `packages/core/src/infrastructure/protocol/events/Envelope.ts`。