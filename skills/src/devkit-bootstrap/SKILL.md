---
name: devkit-bootstrap
description: 在"开始一个新项目 / 为项目搭建开发规范体系 / 不想手动新建 AGENTS+文档"时使用——按 MorPex DevKit 模板把可移植的开发规范套件导入新项目，几分钟内获得 AGENTS 总纲、DEVELOPMENT 规范、能力索引/接入点模板、文档同步规则与检索流程，避免繁琐搭建。
---

# devkit-bootstrap — 用 DevKit 为新项目建立开发规范

1. 取模板：把 `devkit/`（或 MorPex 的 `devkit/*.skeleton.md`）拷到目标项目根：
   - `AGENTS.skeleton.md` → `AGENTS.md`
   - `DEVELOPMENT.skeleton.md` → `docs/DEVELOPMENT.md`
   - `CAPABILITY_INDEX.skeleton.md` → `docs/CAPABILITY_INDEX.md`（随功能填）
   - `HOOK_MAP.skeleton.md` → `docs/HOOK_MAP.md`（有事件/插件机制后填）
   - `SESSION_LOG.skeleton.md` → `SESSION_LOG.md`（收尾更新）
2. 填占位符：`{{PROJECT}} / {{一句话}} / {{LANG}} / {{BUILD_CMD}} / {{TEST_CMD}} / {{架构一句话}} / {{核心层}} / {{铁律 N 条}}`。
3. 建「检索四连」：在项目入口（如 `.pi/SYSTEM.md` 或 README）写明——
   收到需求先 ①查 CAPABILITY_INDEX（定位/防误判）②查 HOOK_MAP+关系链+消息（理解）③决策再动手 ④收尾更新文档。
4. 固文档同步：改码必更文档（能力索引/职责/关系链/文件树），与代码同提交；有则挂 `check:docs` 类门禁。
5. 复制本 skils 家族到新项目（locate-capability / insert-hook / dev-flow 等）或按需精炼。

> 参考：本项目 `devkit/README.md`（接入指南）+ `AGENTS.md`/`docs/DEVELOPMENT.md`（成型示例）。