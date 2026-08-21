# EVENT_PAYLOAD_SPEC — 任务事件载荷规格（v1）

> 版本：1.0 ｜ 状态：定稿（2026-08-21）｜ 目的：为「UI 任务卡片 / SSE 增量 / 多模态附件传 LLM」提供统一、稳定、可扩展的事件载荷契约。
> 配套：机读契约见 `packages/core/src/infrastructure/common/contracts/eventContractCatalog.ts` 的执行链事件段。

---

## 1. 设计原则（可扩展性根基）

1. **信封稳定、载荷分块**：外层 `Envelope` 结构永不变；新特性 = 新增一个「块（slot / namespace）」，不动其它块。
2. **引用优先（媒体）**：`media` 只带 **元数据 + 存储引用**，不塞二进制。LLM 需要时经现有工具（`file`/`artifact`/`api`）按引用取用；人看时前端/桌面用 URI **本地打开**。新媒体类型 = 新 `kind` + 新取用器，无需改事件结构。
3. **向前兼容**：`schemaVersion` + 未知块忽略不崩——老消费者读新事件安全；`plugins` 层按块读取。
4. **衔接现状，不新建体系**：复用 `MorPexEvent`（`id/type/timestamp/executionId/source` = 信封头）、`TaskStateProjector` + `/api/tasks/:id`（全量真相源）、SSE（增量）、`eventContractCatalog`（校验）。

---

## 2. 术语

| 术语 | 定义 |
|---|---|
| **Envelope（信封）** | 稳定头（id/type/timestamp/source/layer/schemaVersion/refs）+ `payload`。**
| **MessageBox（可扩展载荷盒子）** | Envelope 的 `payload`：分块对象，每块可选；新增交互/媒体/能力 = 加一个新块。|
| **块（slot）** | `messageBox` 内的命名空间（`task`/`state`/`human`/`artifacts`/`media`/`error`/`extensions`）。|

---

## 3. Envelope（稳定头）

```ts
interface EventEnvelope {
  schemaVersion: string;          // '1.0'（语义升级 bump；旧消费者按版本分支/忽略）
  id: string;
  type: string;                   // 事件类型（不因字段扩展而变）
  timestamp: number;
  source: string;                 // dag-runtime / mission / gate / approval ...
  layer: 'L0'|'L1'|'L2'|'L3'|'L4'|'L5'|'L6'|'L7'|'L8'|'S'（studio）;
  refs: {
    executionId: string;
    missionId?: string;
    stepId?: string;
    parentStepId?: string | null;
  };
  payload: MessageBox;            // 见 §4
}
```

---

## 4. MessageBox（可扩展载荷盒子）

> 每块可选；事件按需携带。**新增块 = 加命名空间**（如 `rag`/`team`/`usage` 后期需要时添加）。

### 4.1 `task` — 任务卡片头
```ts
{ goal: string; name?: string; departmentId?: string; spaceId?: string }
```

### 4.2 `state` — 进度 / 状态机 / 元数据
```ts
{
  status: 'queued'|'running'|'waiting_human'|'done'|'failed'|'cancelled';
  stage?: 'planning'|'orchestrating'|'executing'|'evaluating'|'approving';
  progressText?: string;      // '2/5'
  stepIndex?: number; stepTotal?: number;
  durationMs?: number; costTokens?: number; attempt?: number;
}
```

### 4.3 `human` — 人工交互（审批 / 问用户 / 复核）
```ts
{ kind: 'approval'|'ask'|'review'; status: 'awaiting'|'answered'|'approved'|'rejected';
  question?: string; requestId?: string; decisionBy?: string }
```

### 4.4 `artifacts` — 产物（回链 ArtifactRegistry）
```ts
[{ ref: string; name: string; type: string; verified?: boolean; uri?: string }]
```

### 4.5 `media` — 附件 / 多模态（引用优先）
```ts
[{ kind: 'image'|'video'|'document'|'file'|string; ref: string;
   mime?: string; size?: number; preview?: string;   // 预览可选（小图）
   recognizedAs?: string }]                            // 语义识别标签（可选）
```
> 取用：LLM 用引用经 `file`/`artifact`/`api` 取；人看用 URI 本地打开。

### 4.6 `error` — 结构化错误
```ts
{ code: string; message: string; recoverable?: boolean; retries?: number; detail?: unknown }
```

### 4.7 `extensions` — 开放扩展区（任意新命名空间）
```ts
Record<string, unknown>   // 例：{ collaboration:{ mentionedAgents:[...] } }
```

---

## 5. 版本与兼容

- 头字段（schemaVersion/type/refs）**只增不删、语义不突变**；
- 载荷块按 `schemaVersion` 分支读取；未知块忽略；
- 契约（eventContractCatalog）按 `type` 声明「必须 vs 可选」块；开发模式载荷校验（不阻断 emit）。

---

## 6. 与现状的映射

| 现状 | 角色 |
|---|---|
| `MorPexEvent`（id/type/timestamp/executionId/source/payload） | = Envelope 头 + payload 槽位（payload 升级为 MessageBox） |
| `TaskStateProjector` + `GET /api/tasks/:id` | 卡片全量真相源（投影到 state/artifacts/human） |
| `StudioServer` SSE | 增量推送 Envelope 事件，前端推进卡片 |
| `eventContractCatalog` | 每个 type 的块级契约校验（渐进式，逐步增补） |
| `ArtifactRegistry` | artifacts/media 的引用落地处 |

---

## 7. 示例：完整 Envelope（workflow.step_started + 附件 + 人工等待）

```jsonc
{
  "schemaVersion": "1.0",
  "id": "evt_1", "type": "workflow.step_started", "timestamp": 1728000000000,
  "source": "dag-runtime", "layer": "L5",
  "refs": { "executionId": "exe_1", "missionId": "msn_1", "stepId": "stp_2", "parentStepId": null },
  "payload": {
    "task": { "goal": "设计并销售产品到 Amazon", "name": "电商方案编排", "departmentId": "ecommerce" },
    "state": { "status": "running", "stage": "executing", "progressText": "2/5",
               "stepIndex": 2, "stepTotal": 5, "durationMs": 12345, "costTokens": 3400, "attempt": 1 },
    "human": { "kind": "ask", "status": "awaiting", "question": "选 Amazon 还是 Shopify？", "requestId": "ask_88" },
    "artifacts": [ { "ref": "artifact://ecommerce/Plan/1", "name": "销售计划.md", "type": "doc", "verified": true } ],
    "media": [ { "kind": "image", "ref": "artifact://ecommerce/Design/2", "mime": "image/png", "size": 204800 } ],
    "error": undefined,
    "extensions": {}
  }
}
```

---

## 8. 落地清单（按流水线分批）

- P1 契约：`eventContractCatalog` 增补执行链事件（mission.created/completed/failed、execution.started/completed/failed、execution.step.started/result、workflow.step_*、artifact.created/verified）的 **块级契约**（must/optional 声明）。
- P1 类型：新建 `infrastructure/protocol/events/Envelope.ts`（EventEnvelope / MessageBox / 块类型定义），供给发射点与投影复用。
- P1 投影对齐：`TaskStateProjector` 输出与 `state/human/artifacts` 块对齐。
- P2 试点发射：`DAGRuntime` 的 `workflow.step_started` 带起 `state`（stepIndex/stepTotal/progressText）。
- P2 前端卡片：消费标准字段（进度/步骤/人工/产物/错误/媒体预览）。