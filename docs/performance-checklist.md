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

## 基准数据 (首次采集 2026-07-24)

运行方式: `npx tsx scripts/benchmark-collect.ts`
执行器: ExecutionFabric Mock (无真实 LLM)

| 指标 | 当前 (Mock) | 目标 (生产) |
|------|-------------|-------------|
| 平均目标理解时间 | <1ms | <500ms |
| 平均规划时间 | <1ms | <2s |
| 平均执行时间 | 3ms | <30s |
| 全链路完成时间 | 3ms avg (1-8ms) | <30s |
| 通过率 (5 任务) | 5/5 (100%) | >95% |
| 产物创建 | 1/任务 | 1/任务 |
| 启动时间 | <1s | <3s |

### 按类别

| 类别 | 任务数 | 通过 | 平均耗时 |
|------|--------|------|----------|
| software | 1 | 1/1 | 8ms |
| hardware | 1 | 1/1 | 2ms |
| ecommerce | 1 | 1/1 | 1ms |
| business | 1 | 1/1 | 1ms |
| content | 1 | 1/1 | 1ms |

> ⚠️ 当前基准为 Mock 模式。接入真实 LLM/Agent 后需重新采集。
