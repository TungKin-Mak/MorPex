# 架构总览

> 文档版本: 2.0.0 | 对应: MorPex v2.0

---

## 1. 系统分层

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Studio 前端 (React + Three.js)                │
│  packages/studio/ui/                                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ 视图层    │ │ 3D 大脑  │ │ 聊天面板  │ │ 状态管理  │ │ SSE 订阅  │  │
│  │ (9 views) │ │(R3F/GLB)│ │(chat.ts) │ │(state.ts)│ │(api.ts)  │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTP REST + SSE (localhost:3000 → :8080)
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Studio 桥接层 (Express)                         │
│  packages/studio/server/                                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ StudioServer                                                  │   │
│  │  ├─ REST API: 35+ 端点 (/api/status, /api/prompt, ...)       │   │
│  │  ├─ SSE:      /api/stream/global (EventBus → 前端事件)       │   │
│  │  ├─ 静态:     前端构建产物                                    │   │
│  │  └─ 引擎:     初始化所有核心组件 + LLMBridge                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ EventBus 事件
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     MorPexCore 引擎 (Kernel)                         │
│  packages/core/                                                     │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  EventBus (唯一通信通道)                                       │   │
│  │  └─ emit / on / once / off / getHistory / listenerCount       │   │
│  └──────────┬──────────┬──────────┬──────────┬──────────┐        │   │
│             ▼          ▼          ▼          ▼          ▼         │   │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐         │   │
│  │Control│ │Runtime│ │Agent │ │Know. │ │Mirror│ │Plugin│         │   │
│  │Plane  │ │Kernel│ │Plane  │ │Plane │ │Observ│ │System│         │   │
│  │       │ │      │ │      │ │      │ │      │ │      │         │   │
│  │Intent │ │FSM   │ │Orch  │ │Memory│ │Event │ │Reg.  │         │   │
│  │Planner│ │DAG   │ │Swarm │ │KG    │ │Store │ │Life  │         │   │
│  │Router │ │Sched │ │Skills│ │Artif │ │Query │ │Cycle │         │   │
│  │Industry│ │HIL   │ │      │ │      │ │      │ │      │         │   │
│  └───────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘         │   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  ExecutionGateway (PiAdapter → pi-agent-core)                 │   │
│  └─────────────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ 直接调用
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        AI 推理引擎                                   │
│  packages/ai/                                                       │
│  ┌────────────────┐  ┌────────────────────────────────────────┐    │
│  │  pi-ai         │  │  pi-agent-core                          │    │
│  │  ├─ getModel() │  │  ├─ Agent / PiAgent                     │    │
│  │  ├─ stream()   │  │  ├─ runAgentLoop()                      │    │
│  │  ├─ complete() │  │  ├─ Session / JsonlSessionRepo          │    │
│  │  └─ (13+ API)  │  │  ├─ Skills / PromptTemplates            │    │
│  └────────────────┘  │  └─ (20+ API)                            │    │
│                       └────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 通信方式

| 层级 | 通信方式 | 协议 |
|------|----------|------|
| 前端 ↔ StudioServer | HTTP + SSE | REST JSON / EventSource |
| StudioServer ↔ Kernel | 方法调用 + EventBus | EventBus.emit / .on |
| Kernel 内部 | EventBus 事件 | `{domain}.{action}` 事件类型 |
| Kernel → AI 引擎 | Gateway + PiAdapter | `execute()` / `stream()` |
| Kernel → LLM | LLMBridge | pi-ai stream / fetch 降级 |

---

## 3. 模块依赖关系

```
studio/ui (无后端依赖, 纯 HTTP 消费)
  └─ studio/server (依赖: core, ai)
       └─ core (依赖: ai)
            └─ ai (pi-agent-core, pi-ai)
                 └─ LLM API (DeepSeek / OpenAI)
```

---

## 4. 数据流 — 一次用户请求

```
用户输入 "分析市场趋势"
        │
        ▼
Studio UI [POST /api/prompt]
        │ { message: "分析市场趋势" }
        ▼
StudioServer [POST /api/prompt]
        │ EventBus emit: llm.request
        ▼
LLMBridge 捕获 llm.request
        │ callPiAi() → pi-ai.stream() → DeepSeek API
        ▼
LLMBridge 返回结果
        │ EventBus emit: llm.response
        ▼
StudioServer 收到 llm.response
        │ SSE push: { type: "chat.text", data: { delta: "分析结果...", done: true } }
        ▼
Studio UI 收到 SSE
        │ appendStreamDelta() → 更新对话气泡
        ▼
用户看到分析结果
```

---

## 5. 关键设计原则

| 原则 | 说明 |
|------|------|
| **EventBus 唯一通信** | 插件间禁止直接 import，只能通过 EventBus 事件 |
| **Event Schema 冻结** | 所有事件必须携带 `executionId`，类型命名空间 `{domain}.{action}` |
| **Mirror 是 observer** | ExecutionMirror 只记录，不控制；不阻塞主路径 |
| **绞杀者模式** | 新功能通过 Kernel Plugin 实现，不修改现有系统 |
| **Gateway 薄桥** | ExecutionGateway 只是转发，不缓存状态 |
| **SSE 单向推** | 后端通过 SSE 推事件，前端只通过 REST 发命令 |
