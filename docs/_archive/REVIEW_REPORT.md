# Review Report — MorPex vNext+ 升级（最终审查）

**Date**: 2026-07-31
**Verdict**: ✅ PASS — 升级可交付；9 项警告均为已登记的迁移/功能积压，不阻断。

## Result

- **审查结论**：两份方案（理想架构优化 + 现有架构优化）的 P0/P1 全部落地，P2 项如实登记为积压；10 层骨架与五大 Core Constraints 未被破坏。
- **门禁全绿**：tsc 0 错误；validate-architecture.js 0 ERROR / 9 WARNING；production-check 8/8；新增测试 9/9。
- **真实收获**：审查中发现并修复 1 个预存生产 bug（SubAgentFork 并发槽位死循环）与 1 处孤儿领域逻辑（core 内 XJMcuWorkflowPlugin）。
- **风险提示**：`packages/core/__tests__/` 中 35 个 legacy 自执行脚本与 vitest 不兼容（import 即 process.exit），全量 vitest 会误报大面积失败；canonical 门禁为 production-check.cjs。

## Output

### 1. 与两份方案的对照核查

**第 1 步（P0，本周）**
| 项 | 状态 | 落地证据 |
|----|------|----------|
| Gate 分级 + QueryMiss 事件 | ✅ | `RiskTier`（tier-0/1/2）；缓存按 tier 门控；`ontology.query.miss` 事件 → EventStore + EventBus → KnowledgeGapListener → Feedback |
| SubAgent/Mission 的 iteration & cost 上限 | ✅ | SubAgentFork `maxAttempts` + 舰队 Cost Ceiling（token/USD 钩子）；UnifiedExecutionEngine `maxIterations`/`maxCostTokens`；超限事件 `sub_agent.task.iteration_limit` / `sub_agent.budget.exceeded` / `execution.budget.exceeded` |
| 文档小对齐（Brain、插件列表、层状态表） | ✅ | README：brain 已废弃注记、插件名单=实际目录（xjmcu/ecommerce/hardware/software）；morpex_ARCHITECTURE.md：Layer 3/5/7/8/10 状态行 + Migration Backlog |

**第 2 步（P1，两周内）**
| 项 | 状态 | 落地证据 |
|----|------|----------|
| 副作用前 Verification 挂钩 | ✅ | ArtifactGenerationPrimitive `setVerificationHook`；写文件前阻断 + `artifact_generation_blocked` 事件 + knowledgeGaps 透出 |
| Plan 的 ontologyRefs | ✅ | `Plan.ontologyRefs` / `DAGPlan.ontologyRefs`；HierarchicalPlanner 捕获检索 ID，DeliveryPlanner 透传 |
| 校验脚本增强 | ✅ | 领域关键词（排除解析/路由层误报）、LLM bypass 白名单、插件标准（扫全目录）、planes 积压追踪 |

**第 3 步（P2，月内）— 已登记为积压（未实现，文档如实标注）**
- 演化沙箱 + 版本/回滚入口（Verifiable Evolution 标 🔶 规划中）
- 成本-质量联合仪表盘（BudgetManager 存在但未聚合）
- Ontology 事实元数据（source/confidence/version）与冲突策略
- Policy 热更新边界（启动快照）

**第 4 步（理想模型文档）**
- vNext+ 四条新 Core Constraints 已写入 morpex_ARCHITECTURE.md（Graded Gate / Bounded Autonomy / QueryMiss is Signal 标注✅；Verifiable Evolution 标注🔶）。

### 2. 审查发现的问题（按严重度）

- **[已修复] 高 — SubAgentFork 并发槽位死循环**：`executing.add(promise.then(() => set.delete(promise)))` 键不匹配，任务排队时永久挂起。由新 Cost Ceiling 测试暴露并修复。
- **[已修复] 中 — core 内孤儿领域逻辑**：`extensions/xjmcu/XJMcuWorkflowPlugin.ts` 无外部消费者，已 @deprecated，canonical 位置为 workflows/xjmcu。
- **[已修复] 低 — 类型重复**：`OntologyRiskTier` 与 `RiskTier` 双命名并存，统一为 `RiskTier`。
- **[已修复] 低 — 文档漂移**：CLAUDE.md 引用不存在的 Ecommerce/Hardware/ContentPrimitive，改为第 6 层真实通用原语。
- **[已登记] 中 — planes/ 26 处引用**：承载性旧目录，降级为 WARNING 追踪，Migration Backlog 登记。
- **[已登记] 低 — 插件完整性**：ecommerce（空 actions）/hardware/software/xjmcu 为存量 stub，属独立功能任务。
- **[已登记] 低 — 部门模拟路径 LLM 直调**：LeadAgentOrchestrator 白名单放行 + TODO 绑定 Gate。

### 3. 盲区与未验证项
- 未做真实 LLM 端到端（piBridge 在 primitives 中为占位 `{ text: '' }`，真实调用在 bootstrap 注入；Gate 两阶段逻辑依赖单测覆盖）。
- EventStore/EventBus 的双写一致性未做压力测试（QueryMiss 在 EventStore 失败时降级为仅日志/总线）。
- UnifiedExecutionEngine 的 costTokens 为轮询计数代理值（非真实 token），真实计费需 costRecorder 注入。
- 未运行遗留 vitest 全量（见风险提示）；CI workflow（architecture-check.yml）未在本机模拟 GitHub Actions 验证。

## Evidence

- 命令矩阵：`npx tsc --noEmit`（0）；`node scripts/validate-architecture.js`（0 ERROR/9 WARNING）；`node scripts/production-check.cjs`（8/8）；`npx vitest run .../bounded-autonomy.test.ts .../ontology-gate-tiering.test.ts`（9/9）。
- 关键链路锚点：`runOntologyGroundedReasoning.ts:281`（EventBus emit）；`KnowledgeGapListener.ts:87-103`（订阅+去重+Feedback）；`bootstrap-unified.ts:145-146, 249-255`（注入+挂载）；`SubAgentFork.ts` executeFleet（chained 修复）。
- 报告文件：docs/OPTIMIZER_REPORT.md（优化明细）、docs/IDEAL_ARCHITECTURE_ALIGNMENT_REPORT.md（并行会话产物）。
- 变更规模：git status 65 项（M/D/??，含并行会话与本会话的合并成果，未提交）。

## Learnings

- Learning: 全量 vitest 在 MorPex 不可作为回归门禁（legacy 脚本 import 即 exit）。
  Evidence: `morpex-common.test.ts:361 process.exit`；35 files failed 但 production-check 8/8。
  Reuse when: 任何回归验证，先跑 production-check.cjs + 定向新测试。
- Learning: 静态架构校验必须内置"实现 vs 识别"区分，否则 No Domain Logic 检测产生 ~30 个误报。
  Evidence: 领域词命中 31→8（排除 benchmark 数据与 goal-intelligence 解析层）。
  Reuse when: 扩展 validate-architecture.js 规则时。
- Learning: 两个会话并发改同一工作树会制造重复类型与"幽灵改动"——合入前先 `git diff` 盘点再动手。
  Evidence: types.ts 双 OntologyRiskTier；ontologyEvents.ts 在读取后被并发改写。
  Reuse when: 任何多 agent 协作仓库。
- Learning: 测试先于审查的价值——Cost Ceiling 测试暴露了存活已久的并发死循环。
  Evidence: bounded-autonomy.test.ts 第二个用例（maxConcurrency:1 + 2 任务）挂起 → 根因 executeFleet。
  Reuse when: 为既有并发代码补测试时，优先构造"排队等待槽位"场景。
