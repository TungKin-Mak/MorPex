---
name: dev-flow
description: 每次修改/新增代码前加载——掌握完整开发流程（定位→理解→实现→门禁→文档收尾→提交）、编程第一性原理、代码质量、文档同步协议（改码必更文件职责/关系链/能力索引/文件树）。防止忘更新文档、防止零碎续写。
---

# dev-flow — 开发流程与文档同步

1. **SOP**：`定位(CAPABILITY_INDEX) → 理解(HOOK_MAP+关系链+消息) → 小步实现 → 门禁 → 收尾文档 → 同提交`。
2. **第一性原理**：真相源第一；状态是数据可重建；先契约后实现；复用优先；先问为什么。
3. **文档同步（改任意代码文件必做）**：
   - FILE_REGISTRY（文件职责）· CAPABILITY_INDEX（功能条目）· 影响调用面→重生成 `BACKEND_CODE_MAP`（`npx tsx scripts/_backend-code-analyze.ts`）
   - 文件树变化→同步 README/架构；SESSION_LOG 会话历史；与代码**同提交**；无对应文档须提交信息注明。
4. **门禁**：`npx tsc --noEmit` + `node scripts/validate-architecture.js` + `node scripts/production-check.cjs` + 相关 vitest；推荐 `npm run test:full`。
5. **防零碎**：改哪条更新哪条（统一模板）；过时文档移 archive。

> 参考明细：`docs/DEVELOPMENT.md`（§2 SOP / §3 第一性 / §5 质量 / §6 文档同步 / §8 门禁 / §9 提交）。