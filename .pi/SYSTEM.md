# MorPex — pi-coding-agent 项目系统入口（.pi/SYSTEM.md）

> 本文件是 **pi-coding-agent 的 MorPex 项目级系统入口**（system prompt 源），
> 会话启动时自动加载（需项目信任）。它做**薄壳**——权威内容在项目根文档，此处指向 + 速览。

---

## 0. 会话启动协议（强制，不可跳过）

> 本文件（.pi/SYSTEM.md）是 pi-coding-agent **必然自动加载**的 system prompt 源。
> ⚠️ **重要**：AGENTS.md / Cursor 等其它入口文件 pi-coding-agent **不会自动读取**。
> 因此本文件是「唯一可靠入口」——所有关键规则在此内嵌，且必须显式读取其它文件。

**第 0 步（必须执行）**：
```
先读取这两个文件（用 read/cat 工具，LLM 主动去读，不要等用户提示）：
  1. SESSION_LOG.md   → 项目状态 / 上轮摘要 / 待办 / 关键路径
  2. AGENTS.md        → 项目完整规则 / 铁律 / 按需加载表
读取完成前，不开始任何任务。
```

**为什么必须读 AGENTS.md**：本文件只是薄壳（速览+硬约束摘要），完整规则（§1 按需加载 / §8.5 文档同步 / 架构铁律细节 / 模块分层）在 AGENTS.md。不读 AGENTS.md = 缺失关键规则。

**按需加载**（不默认全读）：涉及架构改动才读 `docs/AICOS_CORE_ARCHITECTURE.md` + `docs/AICOS_CORE_FILE_REGISTRY.md`；涉及执行链/模型配置/测试分别读 `docs/AICOS_FLOW.md` / `docs/MODEL_CONFIG.md` / `docs/TESTING_PLAN.md`（详见 AGENTS.md §1 按需表）。读完即弃，不长期占用上下文。

会话结束必须更新 `SESSION_LOG.md` 的「会话历史」与「当前待办」——**过时/冗余信息丢弃**（只留当前状态+最近进度+决策+待办，历史细节以 git 为准），保持精简。

**文档同步**：代码改动后，人工审核确认 → 才更新对应文档（FILE_REGISTRY/ARCHITECTURE/AICOS_FLOW/MODEL_CONFIG/TESTING_PLAN），文档与代码同次提交（详见 AGENTS.md §8.5）。

## 1. 项目速览

**MorPex v16** — 一人公司 AI 工作助理（TypeScript / Node.js / pi-ai 0.81.1）
- **AICOS-Core 8 层架构**（L1 治理/L2 知识/L3 Gate/L4 认知规划/L5 执行/L6 评价/L7 演化/L8 基础设施）；统一运行时 `packages/core/src/bootstrap-unified.ts`
- 执行链：`CompanyFacade.executeGoal` → ControlPlane → Ontology Gate(真实 LLM，tier 分级) → UnifiedExecutionEngine（简单→原语快路径；复杂→OrchestratorAgent 总大脑编排 step-agent）
- **上下文装配（RAG-lazy）**：Dense(bge-m3) + Sparse(BM25) → RRF → Cross-Encoder(bge-reranker) 重排 → Top-K 指针+蒸馏（`knowledge/context/`）
- **通用空参保险（16l·7，模型无关）**：prepareArguments 钩子在 schema 校验前注入可推断值（`infrastructure/tools/primitiveAgentTools.ts`）
- 原语注册中心 `DomainPrimitiveRegistry`（5 通用 + 14 插件）；模型配置 `config/morpex.yaml`（builtin/gateway 两模式）+ `config/embeddingconfig.yaml`（SiliconFlow）
- 分层：L1-L8 物理目录见 `docs/AICOS_CORE_ARCHITECTURE.md`

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
