# MorPex 文档中心

> **基石协议 · 文档即真理源** | 版本: 3.2.0 | 最后更新: 2026-07-17

---

## 文档结构

```
docs/
├── README.md                              ← 你在这里（文档索引）
├── ARCHITECTURE.md                        ← ★ 全局架构基准（宪法）
├── docsARCHITECTURE-v3.2-optimized.md     ← ★ 当前架构文档（详细）
├── features-and-architecture.md           ← 全功能手册（API + 引擎 + 数据结构）
├── architecture-cross-reference.md        ← pi / AgentScope 架构对照
│
├── modules/                               ← 模块参考
│   ├── core-engine.md
│   ├── ai-engine.md
│   ├── memory.md
│   ├── studio-server.md
│   └── studio-ui.md
│
├── guides/                                ← 开发指南
│   ├── getting-started.md
│   └── development.md
│
├── testing-guide.md                       ← E2E 测试指南
│
└── _archive/                              ← 🗄️ 历史计划/评估/报告
    ├── upgrade-plan-openspace-fusion.md   ← v3.0 计划（已交付）
    ├── morpex-v2.4-upgrade-plan.md        ← v2.4 计划（已交付）
    ├── metaplanner-split-v3.1.md          ← v3.1 拆分计划（已执行）
    ├── cross-domain-upgrade-todo.md       ← 跨领域升级（已交付）
    ├── pi-migration-todo.md               ← pi 迁移（已交付）
    ├── pi-hooks-implementation.md         ← pi hook 分析
    ├── prompts-integration-audit.md       ← Prompt 审计
    ├── test-plan.md                       ← v2.4 测试计划
    ├── phase3-4-delivery.md               ← Bug 修复报告
    ├── phase4-extensibility-assessment.md ← 可扩展性评估
    ├── ...
```

**活跃文档 17 个**，归档 24 个。清晰分界：当前架构 vs 历史记录。

---

## 阅读顺序

### 新成员入门

1. **快速开始** → `guides/getting-started.md`
2. **全局架构** → `ARCHITECTURE.md`
3. **当前架构详解** → `docsARCHITECTURE-v3.2-optimized.md`
4. **按需深入** → 模块文档

### 开发者日常

| 你要做什么             | 先读哪个文档                                          |
| ----------------- | ----------------------------------------------- |
| 理解系统分层和设计原则       | `ARCHITECTURE.md`                               |
| 查看当前 Planning 层架构 | `docsARCHITECTURE-v3.2-optimized.md`            |
| 查所有 API 端点和引擎模块   | `features-and-architecture.md`                  |
| 修改引擎核心逻辑          | `ARCHITECTURE.md` → `modules/core-engine.md`    |
| 调整 LLM 调用方式       | `modules/ai-engine.md`                          |
| 新增/修改 API 端点      | `modules/studio-server.md`                      |
| 开发前端页面            | `modules/studio-ui.md`                          |
| 添加新的事件类型          | `ARCHITECTURE.md` §6 + `modules/core-engine.md` |

---

## 核心铁律

> ⚠️ **修改代码必须同步更新文档**

- 修改 `packages/core/` → 同步更新 `modules/core-engine.md`
- 修改 `@earendil-works/pi-ai` 或 `@earendil-works/pi-agent-core` 的引用方式 → 同步更新 `modules/ai-engine.md`
- 修改 `packages/studio/server/` → 同步更新 `modules/studio-server.md`
- 修改 `packages/studio/ui/` → 同步更新 `modules/studio-ui.md`
- 架构级变更（新模块、新通信方式） → 同步更新 `ARCHITECTURE.md` 和 `docsARCHITECTURE-v3.2-optimized.md`

**Git 联动**: 每次 Merge/PR 前检查 `docs/` 是否有对应的 Diff。

---

## 快速链接

| 文档 | 说明 |
|------|------|
| [全局架构基准](ARCHITECTURE.md) | 系统宪法，设计原则 |
| [v3.2 当前架构](docsARCHITECTURE-v3.2-optimized.md) | 详细架构，模块清单，文件树，数据流 |
| [全功能手册](features-and-architecture.md) | 57 API + 27 引擎 + 数据结构速查 |
| [MorPexCore 引擎](modules/core-engine.md) | 引擎核心参考 |
| [AI 推理引擎](modules/ai-engine.md) | LLM 调用参考 |
| [Studio 桥接服务](modules/studio-server.md) | API 端点参考 |
| [Studio 前端](modules/studio-ui.md) | 前端参考 |
| [快速开始](guides/getting-started.md) | 环境搭建 |
| [开发指南](guides/development.md) | 开发规范 |
| [E2E 测试指南](testing-guide.md) | Playwright 自动化测试 |
