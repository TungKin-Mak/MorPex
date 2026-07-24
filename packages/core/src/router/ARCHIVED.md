# Router 模块 — 已合并 (v13)

**合并目标**: `BrainFacade.routeByIntent()`

**说明**:
- `RouterLite` 的意图路由能力已合并到 `BrainFacade.routeByIntent()`
- 通过关键词匹配部门名称/描述/能力进行智能路由
- 原文件保留不动以向后兼容

**迁移路径**:
```
旧: RouterLite.route(intent, departments)
新: brainFacade.routeByIntent(intent, departments)
```
