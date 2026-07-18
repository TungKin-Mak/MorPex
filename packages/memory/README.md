# @morpex/memory — 记忆系统

> **独立记忆引擎模块**，5 层记忆架构 + zvec 向量存储 + BGE-M3 嵌入

---

## 架构

```
┌──────────────────────────────────────────────────────────────────┐
│                     @morpex/memory                                │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ MemoryEngine │  │  VectorStore │  │  EmbeddingClient       │  │
│  │ (5层记忆)    │  │ (zvec向量库) │  │ (BGE-M3 HTTP客户端)   │  │
│  │              │  │              │  │                        │  │
│  │ L1 工作记忆  │  │ upsertSync() │  │  POST /embed          │  │
│  │ L2 情景记忆  │  │ querySync()  │  │  POST /embed-batch    │  │
│  │ L3 语义记忆  │  │ deleteSync() │  │                        │  │
│  │ L4 流程记忆  │  │ close()      │  └────────────────────────┘  │
│  │ L5 反思记忆  │  └──────────────┘                             │
│  └──────┬───────┘                                               │
│         │                                                        │
│         ├── 写: write() → Embedding → zvec.upsertSync()          │
│         └── 查: query() → Embedding → zvec.querySync() → 结果    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  ZVecLockRecovery                                        │   │
│  │  启动时自动清除残留 LOCK 文件，绝不碰数据库               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Storage Adapters                                        │   │
│  │  ├─ ZVecStorage   — 向量持久化 (zvec C++ 原生库)         │   │
│  │  ├─ JSONLStorage  — JSONL 文件存储 (Fallback)            │   │
│  │  └─ MemoryStorage — 内存存储 (测试/临时)                 │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

## 5 层记忆架构

| 层级 | 名称 | 存储位置 | 持久化 | 说明 |
|------|------|----------|--------|------|
| L1 | Working Memory | 内存 Map | ❌ | 当前执行上下文，进程退出丢失 |
| L2 | Episodic Memory | zvec + JSONL | ✅ | 历史执行记录，向量化可搜索 |
| L3 | Semantic Memory | zvec + JSONL | ✅ | 概念/知识，高 importance |
| L4 | Procedural Memory | zvec + JSONL | ✅ | 流程/技能，写入闸门控制 |
| L5 | Reflective Memory | JSONL | ✅ | 自我反思/元学习，定期压缩 |

## 写入闸门

```
write(content, importance)
  │
  ├── importance ≥ 5  ──→ 直接存入
  ├── importance ≥ 3  ──→ 写闸门检查 → 存入/拒绝
  └── importance < 2  ──→ 大概率拒绝
       │
       └── 被拒绝的记忆 → 触发 L5 反思 → 总结后重新评估
```

## 文件结构

```
packages/memory/
├── package.json              # 独立包配置
├── README.md                 # 本文档
│
├── src/
│   ├── index.ts              # 入口 — 导出所有组件
│   ├── types.ts              # 类型定义
│   │
│   ├── core/
│   │   ├── MemoryEngine.ts   # 5层记忆引擎核心
│   │   └── WriteGate.ts      # 写闸门决策
│   │
│   ├── storage/
│   │   ├── index.ts          # 存储适配器入口
│   │   ├── ZVecStorage.ts    # zvec 向量持久化
│   │   ├── JSONLStorage.ts   # JSONL 文件存储 (Fallback)
│   │   └── MemoryStorage.ts  # 内存存储 (测试用)
│   │
│   ├── vector/
│   │   ├── index.ts          # 向量服务入口
│   │   ├── EmbeddingClient.ts # BGE-M3 HTTP 客户端
│   │   └── ZVecLockRecovery.ts # LOCK 文件恢复
│   │
│   └── api/
│       └── routes.ts         # REST API 路由 (Express)
│
├── __tests__/
│   ├── MemoryEngine.test.ts
│   ├── WriteGate.test.ts
│   └── ZVecLockRecovery.test.ts
│
└── docs/
    └── ARCHITECTURE.md       # 详细架构文档
```

## 数据存储

```
data/
└── zvec/
    ├── LOCK                  # 集合锁 (非正常退出后残留)
    ├── manifest.0            # zvec 集合清单
    ├── del.0                 # 删除标记
    │
    ├── idmap.0/              # RocksDB 标量存储
    │   ├── LOCK              # RocksDB 锁 (非正常退出后残留)
    │   ├── MANIFEST-*        # RocksDB 清单
    │   ├── CURRENT           # 当前状态
    │   ├── *.sst             # 数据表
    │   └── *.log             # WAL 日志
    │
    └── 0/                    # 向量索引
        ├── embedding.index.* # HNSW 索引文件
        ├── scalar.*.ipc      # 标量 IPC
        └── *.wal             # 向量 WAL

data/
└── sessions/
    └── *.jsonl               # 会话 JSONL 备份
```

## 写入流程

```
应用层调用 memory.write({ type, content, tags, importance })
        │
        ▼
MemoryEngine.write()
        │
        ├── 1. WriteGate.decide(importance)
        │     └── reject → return null (写闸门拒绝)
        │
        ├── 2. 创建 MemoryItem { id, type, content, tags, importance, createdAt }
        │
        ├── 3. L1: 加入短期记忆 (shortTerm, 上限100条)
        │
        ├── 4. L2-L4: 持久化
        │     ├── VectorStore.index(id, content, tags)
        │     │     ├── EmbeddingClient.getEmbedding(content) → BGE-M3
        │     │     └── zvec.upsertSync({ id, vectors, fields })
        │     │
        │     └── JSONLStorage.append(item) (备份)
        │
        ├── 5. L5: 触发反思 (如果写闸门拒绝率过高)
        │
        └── 6. 回调 onMemoryStored(item, decision)
```

## 查询流程

```
应用层调用 memory.query({ text, type?, tags?, limit? })
        │
        ▼
MemoryEngine.query()
        │
        ├── 1. 如果有 text → 语义搜索
        │     ├── EmbeddingClient.getEmbedding(text) → 向量
        │     └── zvec.querySync({ vector, topK, filter }) → ids[]
        │
        ├── 2. 如果有 type/tags → 标量过滤
        │     └── zvec query filter 表达式
        │
        ├── 3. 合并 L1 短期记忆 + 持久化结果
        │
        └── 4. 回调 onMemoryRecalled(query, results)
```

## 启动方式

```bash
# 1. 启动嵌入服务
python tools-python/embedding-server.py --model-path data/models/bge-m3 --port 3100

# 2. 在应用中使用
import { createMemorySystem } from '@morpex/memory';

const memory = createMemorySystem({
  embedUrl: 'http://localhost:3100',
  dataPath: './data/zvec',
});

await memory.initialize();
await memory.write({ type: 'semantic', content: '...', importance: 4 });
const results = await memory.query({ text: '搜索关键词' });
await memory.shutdown();
```
