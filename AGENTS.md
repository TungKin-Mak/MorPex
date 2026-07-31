# AGENTS.md — Agent 会话入口（自动读取）

> 本文件是主流 Agent 工具（Cursor / Codex / Claude Code / Copilot 等）的**标准入口文件**，
> 工具在会话启动时会自动发现并读取。**任何 Agent 在动工前必须先读完本文件与它指向的文档。**

---

## ⚠️ 第一步（必做）：读 SESSION_LOG.md

**在接触任何代码之前，先读仓库根的 `SESSION_LOG.md`。**
它包含：项目快速概览 / 会话历史摘要 / 当前待办 / 关键路径速查 / 版本基线。

**为什么必须读**：本项目状态由 `SESSION_LOG.md` 统一维护。不读它 = 对项目一无所知，可能重复已做的工作、破坏既有约定、遗漏待办。

---

## 项目是什么（30 秒速览）

**MorPex v16** — 一人公司 AI 工作助理（TypeScript / Node.js / pi-ai 0.81.1）
- 理想架构：**10 层 vNext+**（见 `morpex_ARCHITECTURE.md`，唯一真相源）
- 统一运行时：`packages/core/src/bootstrap-unified.ts`（`bootstrapUnified()` 全 10 层装配）
- 核心执行链：`CompanyFacade.executeGoal` → ControlPlane 门禁 → 编排 → 仿真 → Ontology Gate → 执行
- 原语注册中心：`DomainPrimitiveRegistry`（19 原语）+ `executeAuto` 兜底

## 必读文档顺序

```
1. SESSION_LOG.md         ← 项目状态 / 待办 / 会话历史（最先读）
2. CLAUDE.md              ← 开发铁律（禁止事项、架构约束）
3. morpex_ARCHITECTURE.md ← 架构唯一真相源（10 层 + 约束）
4. docs/IMPLEMENTATION_AUDIT.md ← 各层实现度矩阵
5. 具体模块源码           ← 动手前 grep 确认影响范围
```

## 验证门禁（任何改动后必须跑）

```bash
npx tsc --noEmit -p tsconfig.json                 # 编译 0 错误
node scripts/validate-architecture.js             # 架构对齐（当前 100%）
node scripts/production-check.cjs                 # 生产就绪（8/8）
npx vitest run packages/core/__tests__/ontology-gate-tiering.test.ts packages/core/__tests__/bounded-autonomy.test.ts packages/core/__tests__/feature-regression.test.ts
```

## 硬性约束（违反即失败）

- **不改 `planes/` 与 `brain/`**（已废弃，见架构文档）
- **不绕过 Ontology Gate**（所有知识检索/生成必经）
- **领域逻辑只放 `packages/workflows/<domain>/`**，禁止进 core
- **EventBus 是唯一通信通道**（禁止直接模块间调用）
- **会话结束时**：必须更新 `SESSION_LOG.md` 的会话历史 + 待办

## 当前待办速览（详见 SESSION_LOG.md）

- 🔴 `git push origin master`（本地领先远端 12 提交）
- 🟢 记忆系统（L7）增强——参考开源框架（mem0/Letta/langchain），新会话主任务
- 🟡 外部依赖项：L9 真实领域插件（需凭证）、hardware/xjmcu 工具链（需 python）、L8 自动回滚（半自动）
