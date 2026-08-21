# DEVELOPMENT — MorPex 开发规范（详细）

> 配合 `AGENTS.md`（总纲）使用。**改代码前按需读本节**；长期记忆在 `SESSION_LOG.md`；知识在 `docs/*`。

---

## 1. 总则

1. **分层规则**：总纲（AGENTS.md）→ 本规范（细节）→ 知识文档（按需）→ 代码（真相源）。文档与代码不符以代码为准并修文档。
2. 目标是「**按功能点查询、免全量读码**」：先查能力索引，再定位锚点，只读局部。
3. 每份登记/索引文档用固定模板维护，**禁止零碎旁写**（改哪条更新哪条）。

## 2. 开发流程 SOP（每次改动都走）

```
① 定位
   - 新增/改造功能 → 查 docs/CAPABILITY_INDEX.md（功能→锚点+别名+状态）
       已实现 → 复用/扩展（禁止重复实现；确认其接入链再动，防"写了没接被误删"）
       未实现 → 查 docs/HOOK_MAP.md（合法插入点 + 前后顺序）
   - 禁止仅凭 grep 关键词判"无"（别名覆盖已纳入索引）
② 理解（局部展开）
   - 读锚点函数的关系链（docs/BACKEND_CODE_MAP.md 对应文件段）
   - 读业务流/数据链/消息（docs/AICOS_FLOW.md / docs/EVENT_PAYLOAD_SPEC.md）→ 确定插在哪个函数前/后、消息怎么传
③ 实现（小步）
   - 只改「锚点 + hook 点」处；遵循 §3 第一性原理与 §5 代码质量
   - 过 §8 门禁
④ 收尾（强制，与代码同提交）
   - 更新 CAPABILITY_INDEX（条目/状态/别名/锚点）
   - 更新 FILE_REGISTRY（文件职责）
   - 影响函数/调用/文件结构 → 重生成 BACKEND_CODE_MAP（`npx tsx scripts/_backend-code-analyze.ts`）
   - 文件树/目录变化 → 同步 README / 架构文档
   - SESSION_LOG 会话历史；提交信息注明文档命中项
```

## 3. 编程第一性原理（最高优先）

1. 真相源第一：有状态实体（任务/会话/决策/产物/进度）先确立持久化真相源；UI 是投影、SSE 是增量、内存是视角——三者都不可作为真相源。
2. 状态是数据：页面可见状态必须能从真相源重建；禁止"只活在内存+事件流"。
3. 事件驱动与状态查询分离：SSE 推进增量，但任何时刻可 `GET` 完整状态（恢复能力）。
4. 先契约后实现：实体/端点/事件先定型（TS 接口），读写两端共用同一契约。
5. 可恢复即正确：刷新/切视图/后端重启后能重建视图与未决决策。
6. 复用优先：能复用既有真相源不新建；新增登记 FILE_REGISTRY + SESSION_LOG。
7. 先问为什么：答"真相源在哪/生命周期/谁写谁读"再动手。

## 4. 架构铁律

- **8 层对齐**：改动必须对齐 `docs/AICOS_CORE_ARCHITECTURE.md`；新模块对应某层；禁止在 `planes/`/`brain/` 新增；领域无需进 core（放 workflows）。
- **真实状态优先级**：运行时 > 调用关系 > 测试 > 架构文档 > 设计计划。
- **数据流闭环**：Input → Process → Output → Consumer → Storage；禁止幽灵模块。
- **Planning 与 Execution 分离**：Planning 只产 Plan；Execution 只执行，经 EventBus 反馈。
- **EventBus Only**：唯一通信通道；禁止模块间直接调用。
- **PiBridge 隔离**：唯一 `import @earendil-works/pi-*` 入口是 `adapters/pi-bridge/PiBridge.ts`（pi-types 允许 import type）；升级只改 PiBridge。
- **vNext+ 生产约束**：Graded Ontology Gate（tier-0/1/2）、Bounded Autonomy（超限终止+事件）、QueryMiss is Signal、Verifiable Evolution（沙箱+审批+版本化回滚）、Plan 携带 ontologyRefs[]。

## 5. 代码质量

| 项 | 要求 |
|---|---|
| `any` | 禁止裸 any（外部依赖/动态 LLM provider 除外），用 unknown 收窄 |
| null 安全 / 吞异常 | 可空检查；`catch{}` 至少 console.warn |
| Promise 不等待 | `.catch(err=>console.warn(...))` |
| 文件操作 | 搜索优先（查能力索引后才 grep）；修改优于新建；`.js` 后缀 import；移动改 import 全传播；行数 >800 考虑拆、>2000 强制拆 |
| 反模式 | 幽灵模块→接入或删；别名壳→删；未实例化条件→构造里实例化；目录豁免掩盖违规→如实修 |

## 6. 文档同步协议（强制）

> **改任意代码文件 = 必更新相应文档**；无对应文档须在提交信息显式注明"文档不涉及（原因）"。文档未同步 = 未完成。

**映射表（必检 ≥2）**：
| 改动 | 必须更新 |
|---|---|
| ★改代码文件 | `docs/AICOS_CORE_FILE_REGISTRY.md`（文件职责说明）必更新 |
| 影响函数/调用/文件结构 | 重新生成 `docs/BACKEND_CODE_MAP.md`（`scripts/_backend-code-analyze.ts`） |
| 新增/改造功能 | `docs/CAPABILITY_INDEX.md`（条目+状态+别名+锚点） |
| 文件树/目录 | README + 架构文档的文件树 |
| 层间/调用链 | `docs/AICOS_CORE_ARCHITECTURE.md` ｜ 执行链/Gate/装配 → `docs/AICOS_FLOW.md` · 事件 → `docs/EVENT_PAYLOAD_SPEC.md` |
| 模型/测试 | `docs/MODEL_CONFIG.md` / `docs/TESTING_PLAN.md` + README 测试数 |
| 任一功能 | `SESSION_LOG.md` 会话历史 |

**维护规则**：
1. 先人审后更新；文档随代码同提交（避免分离）。
2. **防零碎**：登记/索引用统一模板，改哪条更新哪条（禁止在旧功能上续写新内容）；无法修正的过时文档移入 `docs/archive/`。
3. 新增文件必先登记 FILE_REGISTRY。
4. 小改动最小化更新（加一行/改一行），不重写大文档。

## 7. 新功能 / 新模块 / Bug

- **新功能生命周期**：需求 → 架构定位 → 查能力索引（是否已有）→ 影响分析 → 方案 → 实现 → Runtime 接入 → 数据流验证 → 文档同步 → 验收。禁止"需求→新建文件→宣布完成"。
- **新模块硬性要求**：创建前问"是否已有类似能力/影响面"；创建后验证"谁实例化/谁调用/在 barrel 链/对接 EventBus"；完成标准含文档同步。
- **Bug 修复**：追溯完整数据流 → 在最上游分岔点修（不在下游加 guard）→ 修复应降低复杂度；禁止 timeout hack / 单 edge 全局状态 / 绕过 EventBus。

## 8. 验证门禁（改动后必跑）

```bash
npx tsc --noEmit -p tsconfig.json          # 0 错
node scripts/validate-architecture.js      # 0 违规
node scripts/production-check.cjs          # 8/8
npx vitest run                             # 全量测试
npm run test:full                          # 一键全门禁（推荐）
npm run check:docs                        # 文档-代码一致性（FILE_REGISTRY/CAPABILITY_INDEX 路径可解析）
```

**任务自检**：□tsc 0 □架构 0 □production 8/8 □无残留旧引用 □新文件 barrel+实例化+调用者 □无幽灵模块 □文档同步。

## 9. 开发流水线与提交

- **流水线**：advisor（决策）→ fork/worker（实现，可并行）→ optimizer（去冗余）→ reviewer（审查）。实现后 optimizer + reviewer 必须。
- **提交**：按功能分逻辑 `feat:/fix:/refactor:/docs:/chore:/test:`；中文说明意图；与对应文档同提交。

## 10. 文档体系（知识路由，免全量读码）

```
SESSION_LOG(状态) → CAPABILITY_INDEX(功能→锚点) → HOOK_MAP(插入点)
  → 锚点文件局部 → BACKEND_CODE_MAP(关系链) → AICOS_FLOW/EVENT_SPEC(业务流/消息)
  → FILE_REGISTRY(文件职责深层) → ARCHITECTURE/TESTING/MODEL(专项)
```
改功能定位 = 查索引得锚点 → 只读锚点+邻接调用；不读全项目。