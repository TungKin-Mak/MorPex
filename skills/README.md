# MorPex Skills（按需技能包）

> 将核心文档"skill 化"：支持 Agent Skill 规范的 agent 可按需加载对应 SKILL.md（frontmatter `name` + `description` 决定触发），不支持的 agent 也当作精炼索引。
> 原则：**SKILL.md 只放精炼要点 + 指向 docs 明细**，不复制大文档（防上下文膨胀）。

## 目录
| skill | 何时触发 | 指向 |
|---|---|---|
| `locate-capability` | 新增/改功能前：判断"有没有实现、在哪个锚点" | CAPABILITY_INDEX |
| `insert-hook` | 新功能要插入：选择接入点/前·后顺序 | HOOK_MAP |
| `event-messaging` | 涉及事件/消息/卡片/payload | EVENT_PAYLOAD_SPEC |
| `dev-flow` | 每次改代码：完整流程/文档同步/质量/门禁 | DEVELOPMENT |
| `backend-flow` | 理解业务流/数据链/失败路径 | AICOS_FLOW |
| `architecture-rule` | 架构/层间/合规改动 | AICOS_CORE_ARCHITECTURE |

> 新项目一键初始化：拷 `devkit/DEVKIT.md` 到项目根并让 LLM 阅读（检测→建规范→引导填占位）。

## 新增 skill 规范
- 源码目录 `skills/src/<name>/SKILL.md`，frontmatter 必含 `name` + `description`（自然语言写"何时使用"）。
- 正文精炼（≤30 行），要点 + `> 参考明细：docs/xxx.md`。
- 改后同步到 `.pi/skills/<name>/SKILL.md`（pi 官方发现路径，`cp -r skills/src/* .pi/skills/`）；登记本表 + AGENTS §6 导航；按 `dev-flow` §6 同步文档。

## 工具自动发现适配（新 session “自动检索”关键）
- **pi-coding-agent**：自动发现 `.pi/skills/<name>/SKILL.md`（项目信任后，启动扫描 name+description 注入 system prompt，任务匹配时按需 `read` 全文；详见 `node_modules/@earendil-works/pi-coding-agent/docs/skills.md`）。源码在 `skills/src/`，需同步到 `.pi/skills/`。
- **Claude Code / 支持 Agent Skills 的工具**：自动发现 `.claude/skills/<name>/SKILL.md`——
  **使用前把 `skills/src/<name>/SKILL.md` 复制到 `.claude/skills/<name>/`**（凭 frontmatter description 自动触发）。
- 其它工具：按 `AGENTS.md §5` 流程手动加载对应 SKILL.md。