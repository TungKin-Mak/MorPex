---
name: locate-capability
description: 在新增或改造功能前使用——判断"该功能是否已实现、在哪个文件/函数"，避免重复实现、避免 grep 关键词误判"没有"、避免把已接入能力当无用删除。凡是"要加新功能/判断有没有 X 功能"都先加载本 skill。
---

# locate-capability — 功能定位

1. 在 `docs/CAPABILITY_INDEX.md` 按**功能语义 + 别名/同义词**查目标能力。
2. 命中（✅ 已接入）→ 读其「锚点（文件·类/函数）」→ **复用/扩展**，不新建。
   - 看「接入链」确认它确实在生产被调用，别误删/别重复写。
3. 未命中 → 判定"未实现"→ 加载 `insert-hook` skill 找插入点。
4. 索引未列但直觉存在的能力 → 用 `docs/BACKEND_CODE_MAP.md` 或 FILE_REGISTRY 复核后在索引补行（模板化）。

> 参考明细：`docs/CAPABILITY_INDEX.md`（7 域 40+ 能力 → 锚点+别名+状态）。