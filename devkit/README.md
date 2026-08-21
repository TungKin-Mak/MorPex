# MorPex DevKit — 可移植开发规范套件（模板）

> 把 MorPex 沉淀的「开发决策支持体系」抽成通用模板：**新项目拷入 `devkit/` 骨架 → 填关键变量 → 立即按规范开发**，无需从零搭建 AGENTS/文档体系。

## 快速启用（~5 分钟）
1. 复制本目录骨架到你的项目根：`cp -r devkit/<skeleton>.md <你的项目>/`（或按仓库根放 AGENTS/DEVELOPMENT 等）。
2. 替换占位符：`{{PROJECT}}`、`{{LANG}}`、`{{BUILD_CMD}}`、`{{TEST_CMD}}`、`{{架构一句话}}`、`{{核心层}}`。
3. 建目录：`CAPABILITY_INDEX.md`（随第一个功能开始填能力表）、`HOOK_MAP.md`、`SESSION_LOG.md`（直接用骨架）。
4. 可选：把 `skills/devkit-bootstrap` 逻辑沉淀为项目自己的 skills；接口工具（如 Claude Code）支持则把技能镜到 `.claude/skills/`。

## 套件内容（都是通用模板，长度刻意精简）
| 文件 | 作用 | 何时填 |
|---|---|---|
| `AGENTS.skeleton.md` | 精简总纲（项目/命令/铁律速览/流程④/文档导航/会话） | 首个版本 |
| `DEVELOPMENT.skeleton.md` | 详细规范（开发流程 SOP / 第一性原理 / 文档同步协议 / 门禁 / 提交） | 首个版本 |
| `CAPABILITY_INDEX.skeleton.md` | 能力→锚点+别名+状态 索引 | 随每个新功能增长 |
| `HOOK_MAP.skeleton.md` | 接入点/前后顺序 地图 | 有插件/事件机制后填 |
| `SESSION_LOG.skeleton.md` | 交接日志（当前/里程碑/决策/待办/教训） | 每个会话收尾 |
| `README.md` | 本接入指南 | — |

## 核心理念（模板固化的）
1. **改码必更文档**：改任何代码文件 → 更新能力索引/职责/关系链→与代码同提交；无对应文档须在提交信息显式注明。
2. **检索优先于 grep**：开发前先查 `CAPABILITY_INDEX`（功能→锚点+别名）——防重复实现、防「grep 关键词不对误判没有」、防误删已接入能力。
3. **免全量读码**：知识路由 = 索引定位 → 锚点局部 → 关系链/消息 → 只读需要的。
4. **文档从代码出发**：职责/关系链文档以代码（JSDoc/AST）为准，可重生成（`check:docs` 类门禁保路径真实）。
5. **精简不堆积**：AGENTS 一页总纲 + 详细规范移 docs；文档/日志过时即弃（历史以 git 为准）。

## 维护
- 骨架有意通用化；项目专属（8 层架构、具体模块、命令）在拷贝后按骨架占位符填入。
- MorPex 本体的完整版本（成型后更详细）见 MorPex `AGENTS.md` / `docs/DEVELOPMENT.md` 等，可作参考对照。