# 知识图谱改进计划

> 参照 cognee 架构，在 MorPex 现有基础设施上分阶段实现持久化知识图谱 + Graph RAG

---

## 现有基础设施

```
zvec (C++ 向量库)          JSONL 文件存储            MemoryEngine 5层记忆
├── HNSW 索引              ├── data/history/*        ├── L1 短期 (内存)
├── 余弦相似度搜索           ├── data/mirror/*         ├── L2-L4 持久化
├── 1024维 float32          ├── data/sessions/*       └── L5 反思
└── 标量过滤                └── data/memory/*
         │                        │                        │
         └────────────────────────┴────────────────────────┘
                            全部已就绪，但 KnowledgeGraph 未接入
```

---

## 总体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                       KnowledgeGraph v2                          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Layer 1: 存储层 (Persistence)                             │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  │   │
│  │  │ zvec 集合     │  │ JSONL 文件    │  │ 内存缓存 (L1)   │  │   │
│  │  │ ent_embedding │  │ entities.jsonl│  │ hot entities   │  │   │
│  │  │ rel_embedding │  │ relations.jsl │  │ (LRU, 100条)   │  │   │
│  │  └──────────────┘  └──────────────┘  └────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Layer 2: 图谱逻辑层 (Graph Engine)                        │   │
│  │                                                           │   │
│  │  EntityManager    RelationManager     PathFinder          │   │
│  │  ├─ add/get/query  ├─ add/get/query    ├─ BFS 路径搜索    │   │
│  │  ├─ 自动ID生成     ├─ 权重传播        └─ 邻域扩展        │   │
│  │  └─ 标签索引       └─ 邻接表维护                          │   │
│  │                                                           │   │
│  │  OntologyEngine    ExtractionEngine    GraphRAG           │   │
│  │  ├─ 动态类型分类   ├─ LLM 抽取实体     ├─ 向量检索→实体   │   │
│  │  ├─ 标签推荐       ├─ LLM 抽取关系     ├─ 邻域扩展→上下文 │   │
│  │  └─ 类型层级       └─ 置信度评估       └─ 结果重排序      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Layer 3: API 层 (REST)                                   │   │
│  │                                                           │   │
│  │  /api/knowledge/*  (已有 8 个端点 + 新增)                 │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 阶段 1: 图谱持久化

**目标**: KnowledgeGraph 重启不丢失，接入 zvec + JSONL

### 数据模型

```typescript
// zvec 集合: kg_entities
// 向量字段: name_embedding (1024d), content_embedding (1024d)
// 标量字段: entity_id, type, tags[], importance
schema = {
  vectors: [
    { name: 'name_embed',   dataType: VECTOR_FP32, dimension: 1024 },
    { name: 'content_embed', dataType: VECTOR_FP32, dimension: 1024 },
  ],
  fields: [
    { name: 'entity_id', dataType: STRING },
    { name: 'type',      dataType: STRING },
    { name: 'tags',      dataType: ARRAY_STRING },
    { name: 'importance', dataType: INT32 },
  ]
}

// JSONL 文件: data/knowledge/
// entities.jsonl → { id, type, name, description, tags, refId, metadata, timestamp }
// relations.jsonl → { id, source, target, type, weight, metadata, createdAt }
```

### 存储映射

```
KnowledgeGraph (当前: 纯内存)     →     持久化层
──────────────────────────────────────────────────
entities: Map<id, Entity>         →  zvec.upsertSync() + JSONL.appendLine()
relations: Relation[]             →  JSONL.appendLine()
adjList: Map<id, Map<id, Rel[]>>  →  启动时从 relations 重建
searchEntities({ text })          →  zvec.querySync({ vector }) → 相似度搜索
```

### 启动恢复流程

```
server startup
  │
  ├── 1. JSONLStorage.read('entities.jsonl')   → 恢复 entities Map
  ├── 2. JSONLStorage.read('relations.jsonl')  → 恢复 relations[]
  ├── 3. 从 relations 重建 adjList
  ├── 4. zvec 连接 (已有 VectorStore)
  └── 5. 就绪
```

### 代码位置

```
packages/core/planes/knowledge-plane/knowledge/
├── KnowledgeGraph.ts          ← 当前文件，改为使用持久化适配器
├── types.ts                   ← 不变
├── GraphStorage.ts            ← 新增: 持久化适配器 (zvec + JSONL)
└── plugin.ts                  ← 不变
```

### 工作量

| 任务 | 估计 |
|------|------|
| 创建 GraphStorage 适配器 | 4h |
| 修改 KnowledgeGraph 接入适配器 | 3h |
| API 测试 | 2h |
| 数据迁移/兼容 | 1h |
| **合计** | **~2天** |

---

## 阶段 2: 自动实体抽取

**目标**: 给一段文本，LLM 自动抽取实体和关系

### 架构

```
POST /api/knowledge/extract { text, source? }
  │
  ├── 1. LLM 调用
  │     Prompt: "从以下文本中抽取实体和关系，输出 JSON"
  │     格式: {
  │       entities: [{ name, type, description }],
  │       relations: [{ source, target, type }]
  │     }
  │
  ├── 2. 解析 LLM 输出 → 实体列表 + 关系列表
  │
  ├── 3. 去重 (按 name + type 匹配已有实体)
  │
  ├── 4. KnowledgeGraph.addEntity() each
  ├── 5. KnowledgeGraph.addRelation() each
  │
  └── 6. 返回 { added: N, relations: M, skipped: K }
```

### LLM Prompt 设计

```
你是一个知识图谱构建器。从以下文本中抽取实体和关系。

可用实体类型:
- concept: 概念/术语
- technology: 技术/工具
- person: 人物
- organization: 组织
- process: 流程/方法

可用关系类型:
- related_to: 相关
- part_of: 属于/组成部分
- used_by: 被...使用
- depends_on: 依赖
- produces: 产生/输出

文本:
{{text}}

输出 JSON 数组格式:
{
  "entities": [
    { "name": "...", "type": "concept", "description": "..." }
  ],
  "relations": [
    { "source": "...", "target": "...", "type": "related_to" }
  ]
}
```

### 工作量

| 任务 | 估计 |
|------|------|
| LLM Prompt 设计 + 调优 | 3h |
| extract 端点实现 | 3h |
| 去重逻辑 | 2h |
| 测试 | 2h |
| **合计** | **~3天** |

---

## 阶段 3: Graph RAG

**目标**: 用户问题 → 向量搜索相关实体 → 图谱扩展 → 上下文 → LLM 回答

### 架构

```
User Question: "EventBus 是怎么工作的？"
  │
  ├── 1. 向量检索 (zvec)
  │     embed(question) → zvec.querySync({ topK: 5 })
  │     → [ent_001(EventBus), ent_002(FSMEngine), ...]
  │
  ├── 2. 图谱扩展 (KnowledgeGraph)
  │     for each entity:
  │       getNeighborhood(entity, depth=1)
  │     → 合并去重 → [ent_001, ent_002, rel_001, ...]
  │
  ├── 3. 构建上下文
  │     Entities:
  │       - EventBus: 唯一通信通道，pub/sub 模式
  │       - FSMEngine: 状态机，监听 EventBus 事件
  │     Relations:
  │       - EventBus --[used_by]--> FSMEngine
  │
  └── 4. LLM 回答 (with context)
        Prompt: "基于以下知识回答问题..."
        Context: (上一步构建的实体+关系)
        Question: "EventBus 是怎么工作的？"
        → "EventBus 是 MorPexCore 的唯一通信通道..."
```

### 对比 Cognee 的 Graph RAG

```
Cognee:                         MorPex:
  Document → Chunks               Memory item → Content
  → Extract entities              → zvec 向量 (已有)
  → Build graph                   → KnowledgeGraph (已有)
  → Store vectors + graph         → Graph RAG 阶段 3
  → Graph RAG query               → 与 cognee 模式相同
```

### 工作量

| 任务 | 估计 |
|------|------|
| 两阶段检索 (向量+图谱) | 4h |
| 上下文构建 prompt | 3h |
| /api/knowledge/query 端点 | 2h |
| 测试 + 调优 | 3h |
| **合计** | **~4天** |

---

## 阶段 4: 本体/动态分类

**目标**: 不固定 5 种实体类型，由 LLM 根据内容动态分类

### 架构

```
LLM classify(content) → { type, tags, confidence }
  │
  ├── type: 动态生成 (如 "api-gateway", "database", "protocol")
  ├── tags: ["architecture", "core", "communication"]
  └── confidence: 0.95

类型层级 (自动维护):
  technology
    ├── api-gateway
    │     └── EventBus
    ├── database
    │     ├── zvec
    │     └── JSONLStorage
    └── protocol
          └── SSE

新类型出现时:
  1. LLM 给出 type 名称
  2. 检查是否已有相似类型 (向量搜索)
  3. 如果没有 → 注册新类型
  4. 如果有 → 合并到现有类型
```

### 工作量

| 任务 | 估计 |
|------|------|
| 动态分类 LLM 调用 | 3h |
| 类型层级自动维护 | 4h |
| API 暴露 | 2h |
| **合计** | **~5天** |

---

## 路线图总览

```
阶段 1: 图谱持久化 (~2天)      ████████░░░░░░░░░░░░  40%
  当前: 纯内存 → 重启丢失
  目标: zvec + JSONL 持久化

阶段 2: 自动实体抽取 (~3天)    ████████░░░░░░░░░░░░  40%
  当前: 手动 API 加实体
  目标: 给文本 → LLM 自动抽取

阶段 3: Graph RAG (~4天)       ████████░░░░░░░░░░░░  40%
  当前: 仅文本匹配搜索
  目标: 向量+图谱+LLM 混合检索

阶段 4: 动态本体 (~5天)        ████████░░░░░░░░░░░░  40%
  当前: 5 种固定 EntityType
  目标: LLM 动态分类
```

---

## 对比直接使用 Cognee

| 因素 | 方案 B (自实现) | 方案 A (直接使用 cognee) |
|------|----------------|------------------------|
| **运行时** | Node.js 单一进程 | Node.js + Python 两个进程 |
| **部署** | 一个 Docker 容器 | 两个容器 + 网络通信 |
| **数据一致性** | 同一进程，无复制 | 需同步两个系统的数据 |
| **性能** | 0 跨进程开销 | HTTP/gRPC 序列化开销 |
| **学习成本** | 我们自己写的，完全可控 | 需学习 cognee API + 概念 |
| **维护** | 自己维护 | 依赖上游更新 |
| **灵活性** | 任意改 | 受限于 cognee 的扩展点 |
| **社区** | — | 27k stars，活跃 |
| **时间成本** | ~14 天完整实现 | ~3 天集成 |

**结论**: 方案 B 适合我们——技术栈一致、性能最优、完全可控。方案 A 适合需要最快上线的 Python 项目。

---

## 下一步

要先开始阶段 1 吗？阶段 1 完成后，我们的 KnowledgeGraph 就有了和 MemoryEngine 一样的持久化能力，重启不丢失。后续阶段可以按需推进。
