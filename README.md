# MorPex — Autonomous Agent OS

> **v2.3** — MorPexCore Engine + Studio UI | 四阶段架构重构已完成 | Phase 3-4 质量审计与可扩展性评估完成 (2026-07-10)
>
> 🏗️ **跨领域路由重构已完成** — 统一 `POST /api/chat/message` 端点，CrossDomainRouter.dispatch() 单次 LLM 调用完成领域识别+澄清判定+拓扑排序，零前端业务耦合。详见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
>
> 📖 **技术白皮书**: [`docs/whitepaper-morpex-core-v2.3.md`](docs/whitepaper-morpex-core-v2.3.md) | 📋 **功能手册**: [`docs/features-and-architecture.md`](docs/features-and-architecture.md)

```
MorPex/
├── packages/                    # 所有核心包
│   ├── core/                    # MorPexCore 引擎
│   │   ├── services/            # AgentService, LLMProvider, Container
│   │   ├── core/                # Kernel, EventBus, PluginSystem, types
│   │   ├── gateway/             # ExecutionGateway, PiAdapter
│   │   ├── planes/              # 功能平面
│   │   │   ├── runtime/         # FSM, DAG, Scheduler, HumanInLoop
│   │   │   ├── knowledge/       # Memory, KnowledgeGraph, Artifacts
│   │   │   ├── agent/           # Orchestrator, Skills, Swarm
│   │   │   └── control/         # Intent, Planner, Prompts
│   │   ├── mirror/              # ExecutionMirror (直接消费标准化事件)
│   │   ├── industry/            # 行业适配器
│   │   └── docs/                # API 参考文档
│   │
│   ├── ai/                      # AI 推理引擎
│   │   ├── pi-agent-core/       # Agent 运行时核心
│   │   └── pi-ai/               # LLM 模型调用
│   │
│   └── studio/                  # Studio 前端 + 桥接
│       ├── server/              # Express 桥接层 (REST + SSE)
│       └── ui/                  # React + Three.js 前端
│
├── scripts/                     # 工具脚本
├── data/                        # 运行时数据 (gitignored)
├── configs/                     # 配置文件副本
├── tools/                       # 外部工具 (Python)
├── docs/                        # 文档
│
├── package.json                 # 根 monorepo 入口
└── tsconfig.json                # 根 TypeScript 配置
```

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 启动开发环境 (PM2 全栈)
npm start

# PM2 管理命令
npm stop                # 停止所有
npm run restart         # 重启所有
npm run logs            # 查看日志
npm run start:status    # 查看状态

# 或分别启动:
npm run studio:server   # 后端 Express :8080
npm run studio:dev      # 前端 Vite :3000
```

## 架构概览

```
┌────────────────────────────────────────────────────┐
│  Omni-Input Terminal (Xterm.js Canvas)             │
│  POST /api/chat/message { content: "..." }        │
│  零关键词过滤 · 零业务耦合                          │
└─────────────────────┬──────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────┐
│  StudioServer /api/chat/message                      │
│                                                      │
│  CrossDomainRouter.dispatch()                        │
│    → LLM 单次调用                                    │
│    → RoutingAnalysis { isMultiDomain, involved,      │
│        needsClarification, clarificationQuestions }  │
│                                                      │
│  ┌── needsClarification? → 返回追问给用户继续对话     │
│  ├── 🎯 单领域 → DomainCluster.decomposeSingleIntent │
│  └── 🕸️ 多领域 → toposort → fan-out → DAG           │
│                                                      │
│  → SSE EventBus → /api/stream/global → 前端 UI 级联  │
└──────────────────────────────────────────────────────┘
```

## 前端 UI 架构

```
┌────────────┬───────────────┬────────────┐
│  [A] TOP   │   32px        │ 遥测栏     │
│  TELEMETRY │               │           │
├────────────┼───────────────┼────────────┤
│ [B] LEFT   │ [C] CENTER    │ [D] RIGHT │
│ 24vw       │ 52vw          │ 24vw      │
│ Omni-Input │ 3D Brain      │ FSM       │
│ Swarm      │ Canvas        │ TaskCards │
│ DomainGrid │ Interrogation │ VU Meter  │
├────────────┴───────────────┴────────────┤
│  [E] BOTTOM  200px                      │
│  MemoryBus v2 | ArtifactRegistry        │
└──────────────────────────────────────────┘
```

## 核心包说明

| 包 | 路径 | 说明 |
|---|------|------|
| `@morpex/core` | `packages/core/` | 核心引擎: Kernel, EventBus, 所有功能平面 |
| `@morpex/ai` | `packages/ai/` | AI 推理: Agent 运行时, LLM 模型调用 |
| `@morpex/studio` | `packages/studio/` | 前端: React UI + Express 桥接服务器 |

## 启动命令

```bash
# ── 启动 (PM2 进程管理) ──
npm start               # 全栈：Embedding + 后端 + 前端
npm run start:no-embed  # 跳过 Embedding
npm run start:prod      # 生产：构建 + 单端口
npm stop                # 停止所有
npm run restart         # 重启所有
npm run logs            # 实时日志
npm run start:status    # 查看状态

# ── 备用启动 (tsx 直接启动) ──
npm run dev             # 开发模式
npm run dev:no-embed    # 跳过 Embedding

# ── 单独启动 (调试) ──
npm run studio:server   # 后端 Express :8080
npm run studio:dev      # 前端 Vite :3000
npm run studio:build    # 构建前端产物

# ── 引擎 ──
npm run core:test       # 端到端测试
npm run docs:api        # 查看 API 参考文档
```

## 自动化 UI 测试 (Playwright E2E)

MorPex 使用 Playwright 实现全自动 UI 测试框架，覆盖前端渲染、API 通信、用户工作流、集成测试等。

### 一键全自动运行

```bash
# 自动启动服务 → 运行测试 → 生成报告 → 停止服务
npm test                    # 运行全部测试（推荐）
npm run test:headed         # 带浏览器窗口（调试用）
npm run test:quick          # 仅运行关键测试（快速验证）
npm run test:ci             # CI 模式（无人工干预）
```

### 手动模式（服务需先启动）

```bash
npm run studio:server       # 终端1: 启动后端
npm run studio:dev          # 终端2: 启动前端

npm run test:all            # 运行全部测试
npm run test:quick          # 快速模式（2个核心套件）
```

### 测试覆盖

| 套件 | 文件 | 覆盖范围 |
|------|------|---------|
| API + UI 核心 | `morpex-v2.spec.ts` | 27个测试：24个API端点 + 前端渲染 + 性能基线 |
| MatrixGrid 新 UI | `matrix-grid.spec.ts` | 10个测试：五面板渲染、OmniTerminal、旧UI移除验证 |

📖 **完整文档**: [`docs/testing-guide.md`](docs/testing-guide.md)

## 环境变量

| 变量                 | 默认值             | 说明                |
| ------------------ | --------------- | ----------------- |
| `PORT`             | `8080`          | StudioServer 端口   |
| `MIRROR_PATH`      | `./data/mirror` | Mirror 事件存储路径     |
| `DEEPSEEK_API_KEY` | —               | DeepSeek API 密钥   |
| `OPENAI_API_KEY`   | —               | OpenAI API 密钥（降级） |

## 技术栈

- **核心引擎**: TypeScript, EventBus 架构, Plugin System
- **AI 推理**: pi-ai (DeepSeek/OpenAI), Agent Runtime
- **前端**: React 19, Three.js, R3F, Vite
- **桥接层**: Express, SSE (Server-Sent Events)
- **存储**: JSONL, ZVector (向量)
