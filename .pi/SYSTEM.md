# MorPex — pi-coding-agent 项目系统入口（.pi/SYSTEM.md）

> 本文件是 **pi-coding-agent 的 MorPex 项目级系统入口**（system prompt 源），
> 会话启动时自动加载（需项目信任）。它做**薄壳**——权威内容在项目根文档，此处指向 + 速览。

---

## 0. 会话第一步（强制）

**先读 `SESSION_LOG.md`**（项目状态 / 上轮摘要 / 当前待办 / 关键路径）。不读 = 对项目一无所知。
紧随读 `AGENTS.md`（项目规则，跨工具入口）→ `docs/AICOS_CORE_ARCHITECTURE.md`（AICOS-Core 8 层架构唯一真相源）+ `docs/AICOS_CORE_FILE_REGISTRY.md`（逐文件注册表）。

会话结束必须更新 `SESSION_LOG.md` 的「会话历史」与「当前待办」。

## 1. 项目速览

**MorPex v16** — 一人公司 AI 工作助理（TypeScript / Node.js / pi-ai 0.81.1）
- **AICOS-Core 8 层架构**（L1 治理/L2 知识/L3 Gate/L4 认知规划/L5 执行/L6 评价/L7 演化/L8 基础设施）；统一运行时 `packages/core/src/bootstrap-unified.ts`
- 执行链：`CompanyFacade.executeGoal` → ControlPlane → 编排 → 仿真 → Ontology Gate(真实 LLM) → UnifiedExecutionEngine
- 原语注册中心 `DomainPrimitiveRegistry`（19 原语）+ `executeAuto` 兜底 + NL→参数提取
- 分层：Entry/Governance · Ontology Gate · Planning · Cognition · Execution · Tools/Primitives · Knowledge/Memory · Evolution · Workflow Plugin · Infrastructure

## 2. 硬性约束（违反即失败）

1. **Ontology Gate 强制**：所有知识检索/生成必经，禁止绕过
2. **No Domain Logic in Core**：领域逻辑只放 `packages/workflows/<domain>/`
3. **EventBus Only**：唯一通信通道
4. **禁改已废弃目录**：`planes/`（只剩 DEPRECATED.md）、`brain/`（用 `cognition/`）
5. **分级 Gate**：tier-0 禁缓存 / tier-1 缓存 / tier-2 受控探索；QueryMiss 必须 emit（缺失即信号）
6. **Bounded Autonomy**：Agent 执行必须有迭代/成本上限
7. **Verifiable Evolution**：演化产物必须经沙箱 → 版本化 → 审批 → 可回滚
8. **诚实**：不伪造 mock 冒充真实，不靠目录豁免掩盖违规（曾发生，已修复）

## 3. 验证门禁（改动后必跑）

```bash
npx tsc --noEmit -p tsconfig.json
node scripts/validate-architecture.js          # 当前 100%（0/0）
node scripts/production-check.cjs              # 8/8
npx vitest run packages/core/__tests__/ontology-gate-tiering.test.ts packages/core/__tests__/bounded-autonomy.test.ts packages/core/__tests__/feature-regression.test.ts
```

## 4. 流水线（本仓库开发模式）

```
advisor → fork/worker（可并行）→ optimizer → reviewer
 决策      实现                去冗余      审查
```

- 架构决策 → advisor；大型实现 → fork；独立小任务 → worker
- 实现完成 → optimizer（必须）→ reviewer（必须）
- 每轮结束更新 SESSION_LOG.md

## 5. 提交约定

按功能分逻辑提交（`feat:`/`fix:`/`refactor:`/`docs:`/`chore:`），中文信息说明意图；避免大杂烩提交。
