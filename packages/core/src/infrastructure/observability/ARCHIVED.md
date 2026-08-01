# Observability 模块 — 已合并 (v13)

**合并目标**: `EventBus.getMetrics()`

**说明**:
- `ObservabilityLite` 的基础指标收集已合并到 `EventBus.getMetrics()`
- 提供事件类型分布统计和总事件数
- 原文件保留不动以向后兼容

**迁移路径**:
```
旧: ObservabilityLite.getMetrics()
新: eventBus.getMetrics()
```
