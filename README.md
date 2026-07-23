# MorPex v11 — Adaptive Workflow Operating System

**Status**: 🟢 Production Ready — 8/8 production checks | 20/20 system tests | 31/31 EventMesh tests  
**Version**: 11.0.0  
**Stack**: pi-ai 0.81.1 | pi-agent-core 0.81.1 | TypeScript | Node.js

---

## Architecture

```
E:/Morpex/          ← 后端
  ├── packages/
  │   ├── core/           ← 核心引擎 (MissionRuntime, DAGRuntime, FSM, PiBridge)
  │   ├── workflow-sdk/   ← v11 Workflow SDK (WorkflowSDK, WorkflowRuntime)
  │   ├── connectors/     ← v11 Connector Infrastructure (FileSystem, Shell)
  │   ├── contracts/      ← 共享类型
  │   ├── memory/         ← 内存层
  │   └── studio/server/  ← API 端点、EventMesh、联邦
  ├── scripts/            ← CLI、测试、运维
  ├── tests/              ← 系统测试
  ├── configs/            ← Docker、PM2
  └── docs/               ← 文档

E:/MorPex_UI/       ← 前端
  └── (React/Vite)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the complete architecture.

## Quick Start

```bash
# Start backend server
npm run dev

# Workflow CLI
npm run wf:create -- hello-world
npm run wf:run -- ./hello-world --input='{"msg":"Hello"}'
npm run wf:list
npm run wf:optimize -- wf-v11_hello-world_1_0_0
```

## Key Metrics

| Metric | Value |
|--------|-------|
| TypeScript errors | **0** |
| System tests | **20/20** pass |
| Production check | **8/8** pass |
| EventMesh tests | **31/31** pass |
| Pi packages | pi-ai 0.81.1 / pi-agent-core 0.81.1 |

## Core Principles

1. **PiBridge Isolation** — Only `PiBridge.ts` imports pi packages directly
2. **Human-in-the-loop** — AI never auto-executes without approval
3. **Event Sourcing** — All state changes persist as events
4. **Layer isolation** — All communication through EventBus
