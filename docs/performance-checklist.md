# MorPex 性能优化清单

> Stabilization Phase — 最后才做性能

## 当前状态

| 维度 | 状态 | 优先级 |
|------|------|--------|
| 并发执行 | ✅ MissionRuntime 支持 | P0 |
| DAG 并行 | ✅ DAGRuntime maxParallel | P0 |
| 缓存 | ❌ 无系统级缓存 | P1 |
| 向量检索 | ✅ zvec + SQLite | P1 |
| 调度优化 | ⚠️ FIFO | P2 |
| 连接池 | ❌ 无 | P2 |
| 懒加载 | ⚠️ 部分 | P2 |

## 优化项

### P0: 并发控制
MorPexRuntime.run() 当前串行。同一 Mission 的独立 Capability 应并行：
```
Promise.all(teams.map(t => executeTeam(t)))
```

### P1: 缓存层
- LLM 响应缓存 (相同 prompt → 命中)
- CapabilityRegistry 查询缓存
- EventBus 事件去重

### P1: 向量检索
- MemoryWiki 的 zvec 索引优化
- Capability 搜索用向量而非关键词匹配

### P2: 调度
- DAG 调度器支持优先级队列
- Mission 调度支持资源感知

## 基准 (待收集)

| 指标 | 当前 | 目标 |
|------|------|------|
| 目标理解 | ? | <500ms |
| 规划 | ? | <2s |
| 执行 | ? | <30s |
| 内存(空闲) | ? | <200MB |
| 内存(满载) | ? | <1GB |
| 启动 | ? | <3s |
