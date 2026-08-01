# Review Report — 打磨轮（最终审查）

**Date**: 2026-07-31（第二打磨轮）
**Verdict**: ✅ PASS — 对齐缺口 9→1；功能回归已修复；可交付。

## Result

- **审查结论**：本轮"实际架构→理想架构"推进有效且无回归。插件层（第 9 层）从"stub 占位"变为"ActionPrimitive 全实现 + 启动注册"；brain 引用清零；core 领域残留清零；planes/ 26 处如实保留为登记积压。
- **门禁全绿**：tsc 0 错误；validate-architecture 0 ERROR / 1 WARNING；production-check 8/8；新增测试 9/9；插件冒烟 14/14 + legacy 兼容。
- **审查发现**：1 处预存崩溃（hardware `__dirname`）已修复；1 处功能回归（xjmcu stub）已修复；未发现新引入问题。

## Output

### 1. 逐项核查（上一轮 9 项警告）

| 警告 | 上轮 | 本轮 | 证据 |
|------|------|------|------|
| brain/ 引用 3 处 | ⚠️ | ✅ 0 | EvolutionController / PatternMigrationEngine / MorPexRuntime → `cognition/index.js` |
| core 领域词 8 处 | ⚠️ | ✅ 0 | xjmcu index 标废弃；AgentCreateTool 泛化；capability/verification/intent 豁免（数据/识别层） |
| 插件标准 5 项 | ⚠️ | ✅ 0 | 4 插件均有 canHandle+execute+注册调用（校验器实测） |
| planes/ 26 处 | ⚠️ | ⚠️ 26 处 | 登记积压，独立迁移工作流 |

### 2. 风险与盲区（如实声明）
- **planes/ 迁移未做**：涉及 9 个遗留模块（dag types / ArtifactRegistry / KnowledgeGraph / AgentHarness 等），含值导入，迁移需类型兼容分析，属独立工作流——本次未触碰，避免高风险改动。
- **插件 mock 语义**：ecommerce/software 的 actions 为包装 mock（amazon.ts 原本即 mock）；hardware/xjmcu 为真实工具链调用（python buildcli/astrocli，需环境具备）。manifest 已与实现对齐。
- **验证范围**：未做真实 LLM 端到端（同上一轮）；未在 GitHub Actions 上实跑 CI workflow（本机已等价执行 validate + tsc + production-check）。
- **行为变更面**：bootstrapUnified 现在会装载插件（此前为空）——失败有 try/catch 降级；不影响无插件环境。

### 3. 审查过的面
- core：index 导出、bootstrap-unified/v15 接线、3 处 brain 导入、AgentCreateTool、xjmcu 废弃标注、validator 豁免逻辑。
- workflows：4 插件 × (actions/bootstrap/index/provider/manifest) 全部文件。
- 验证：tsc（含被引用的 workflow 文件）、validator、production-check、2 个新增测试、2 轮插件冒烟（14 原语注册 + 路由 + 真实执行 + legacy run）。

## Evidence

- 命令矩阵同上轮全部通过；插件冒烟输出：`✅ 全部 14 个插件原语已注册`、`✅ matchBest 路由正确 → amazon.create_listing`、`✅ xjmcu 新接口 + legacy run() 均正常`。
- 变更规模：77 项（未提交）。报告：docs/OPTIMIZER_POLISH_REPORT.md（本轮优化明细）。

## Learnings

- Learning: 审查"接线型"改动（bootstrap 装载）时必须实际运行一次真实 import，静态检查看不出模块顶层副作用崩溃。
  Evidence: hardware `__dirname` ReferenceError 只在冒烟运行时暴露。
  Reuse when: 任何把旧代码接入启动路径的改动。
- Learning: 校验器豁免要与"数据/识别 vs 实现"边界严格对应，避免变成静默关检。
  Evidence: capability/verification/intent 豁免附理由注释，且与既有 goal-intelligence 豁免同类。
  Reuse when: 后续扩展 No Domain Logic 检测。
- Learning: planes/ 迁移的正确顺序是先做类型兼容盘点（type-only vs value imports），再动代码。
  Evidence: 27 处引用中多数为 `import type`，值导入集中在 6 个模块——迁移可分两批。
  Reuse when: 开启 planes 迁移工作流时。

---

## ⚠️ 更正附录（2026-07-31 调度复核）

原报告第 19 行将 `verification/` 领域词归为"数据/识别层豁免"有误：`amazon_listing` / `e-commerce` / `hardware` 规则为可执行领域合规逻辑，属 No Domain Logic 违规而非识别数据。

**复核后修正**：领域规则真迁移至插件（ecommerce/hardware `src/rules/` + bootstrap 注册），core 注册表清空领域种子，校验器 `/verification/` 豁免移除。门禁全绿（tsc 0 / validator 0E-1W / production-check 8/8 / tests 9/9），冒烟确认插件注册后规则齐全。
