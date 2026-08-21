# AGENTS.md — MorPex 开发规则（总纲）

> 规则分两层，避免臃肿：**本文件 = 总纲（必读，一页）**；**`docs/DEVELOPMENT.md` = 详细开发规范（改代码前按需读）**；会话进度在 `SESSION_LOG.md`。
> 强制：新会话开始只读 `AGENTS.md` + `SESSION_LOG.md`；其余文档按 §6 触发条件按需读，读完即弃。

## 1. 项目一句话

**MorPex** — 一人公司 AI 工作助理（TypeScript / Node / pi-ai 0.81）。架构 = **AICOS-Core 8 层**：L1 治理 → L2 知识 → L3 Ontology Gate★ → L4 认知规划 → L5 执行 → L6 评价 → L7 演化 → L8 基础设施；领域插件在 `packages/workflows/<domain>/`。

## 2. 仓库导航（一行）

`packages/core/src`（8 层）· `packages/connectors`（外部之手）· `packages/memory`（记忆持久化）· `packages/studio/server`（后端 API）· `packages/studio/web`+`desktop`（前端）· `packages/workflows`（领域插件）· `packages/workflow-sdk`（插件 SDK）· `packages/contracts`（跨包契约）· `scripts`（门禁/工具）· `docs`（文档体系）。

## 3. 常用命令（门禁）

```bash
npx tsc --noEmit -p tsconfig.json          # 编译 0 错（每次必跑）
node scripts/validate-architecture.js      # 架构对齐（0 违规）
node scripts/production-check.cjs          # 生产就绪（8/8）
npx vitest run                             # 测试
npm run test:full                          # 一键全门禁（推荐）
npx tsx scripts/_backend-code-analyze.ts   # 重新生成函数关系链文档（改调用面时）
```

## 4. 铁律（速览 —— 违反即失败）

1. **Knowledge Gate**：一切知识检索/生成先查 Ontology，禁止无依据生成；QueryMiss 是信号（emit 而非静默）。
2. **EventBus Only**：模块间唯一通信通道，禁止直接调用；事件 at-least-once + 消费者幂等。
3. **PiBridge 隔离**：仅 `adapters/pi-bridge/PiBridge.ts` 允许 import `@earendil-works/pi-*`；业务零直连。
4. **领域隔离**：领域逻辑只在 `packages/workflows/`；core 内禁领域关键词。
5. **真相源优先**：有状态实体必须先有持久化真相源；UI 是投影、事件流是增量、（禁内存裸奔）。
6. **文档同步（强制）**：改代码文件 → 必须同步更新相应文档（文件功能职责说明 `FILE_REGISTRY` / 函数关系链 `BACKEND_CODE_MAP` / 文件树等，详见 DEVELOPMENT §6）；无对应文档须在提交信息显式注明。
7. **禁止裸 `any` / 吞异常**（代码质量详则见 DEVELOPMENT §5）。

## 5. 规范流程（极简 —— 详见 docs/DEVELOPMENT.md §2）

```
① 定位 → 查 docs/CAPABILITY_INDEX.md（功能→锚点+别名，防 grep 误判/重复实现）；不盲目 grep 判"无"
② 理解 → 锚点函数关系链（BACKEND_CODE_MAP）+ 业务流/消息（AICOS_FLOW / EVENT_PAYLOAD_SPEC）→ 确定插在哪个函数前/后
③ 实现 → 只改锚点+hook 局部；过门禁（§3）
④ 收尾 → 更新文档（能力索引/FILE_REGISTRY/镜像面重生成 BACKEND_CODE_MAP/文件树/SESSION_LOG）→ 与代码同提交
```

## 6. 文档导航（按需读，不默认全读）

| 文档 | 何时读 | 规模 |
|---|---|---|
| `SESSION_LOG.md` | 每次开工/收尾（进度+待办++教训） | 紧凑 |
| `docs/DEVELOPMENT.md` | 开发/改代码前（完整流程/门禁/质量/提交） | 中 |
| `docs/CAPABILITY_INDEX.md` | 新增/改造功能前（功能→锚点+别名+状态，防重复/防误删/防 grep 误判） | ✅ |
| `docs/HOOK_MAP.md` | 新功能要插入时的接入点/前后顺序/事件挂点 | ✅ |
| `skills/<name>/SKILL.md` | 按需技能包（locate-capability/insert-hook/event-messaging/dev-flow/backend-flow/architecture-rule）；支持 skill 的 agent 按 description 触发加载 | 精炼+指向 docs |
| `docs/AICOS_CORE_ARCHITECTURE.md` | 架构/层间改动 | 中 |
| `docs/AICOS_CORE_FILE_REGISTRY.md` | 文件职责登记/更新 | 大（禁止常驻） |
| `docs/BACKEND_CODE_MAP.md` | 函数关系链/调用面 | 大（禁止常驻） |
| `docs/AICOS_FLOW.md` | 业务流/数据流 | 中 |
| `docs/EVENT_PAYLOAD_SPEC.md` | 事件/消息格式 | 中 |
| `docs/MODEL_CONFIG.md` / `docs/TESTING_PLAN.md` | 模型/测试相关改动 | 中 |

## 7. 会话约定

- **开始**：只读 `AGENTS.md` + `SESSION_LOG.md`（pi-coding-agent 经 `.pi/SYSTEM.md` 强制引导）。
- **结束**：更新 `SESSION_LOG.md`「会话历史 + 待办」；待办有未推送提交时提醒。
- 以代码为准（运行时 > 调用关系 > 测试 > 文档 > 设计）；文档与代码不符 → 修文档。