# 存储需求分析

> 按三个维度盘点整个系统"有什么数据、存在哪里、缺什么"

---

## 总览

```
data/
├── memory/              ← 记忆系统 (MemoryEngine)
├── history/             ← 执行历史 (HistoryStore)
├── mirror/              ← 可观测性 (ExecutionMirror)
├── sessions/            ← 会话 (SessionManager)
├── skills/              ← 技能定义 (SKILL.md)
├── knowledge/           ← 知识图谱 (KnowledgeGraph) 🔴 未持久化
├── workspace/           ← 工作区产物
├── zvec/                ← 向量数据库
└── models/              ← ML 模型
```

---

## 需求 1: 个人的知识库

**定义**: 用户自己导入的文档、笔记、技能定义、API 文档等，系统能长期保存并检索。

### 当前有的

| 数据 | 存储位置 | 格式 | 可检索？ | 说明 |
|------|---------|------|---------|------|
| 技能定义 | `data/skills/*/SKILL.md` | Markdown + frontmatter | ✅ SkillLoader.get() | 2 个样本技能 |
| 工作区产物 | `data/workspace/projects/*` | .py/.js/.json | ❌ 仅文件系统 | 75 个生成项目 |
| 执行报告 | `data/workspace/reports/*` | .md | ❌ 仅文件系统 | 42 份报告 |
| 知识图谱实体 | 内存 (未持久化) | — | ❌ 重启丢失 | 当前 KnowledgeGraph |
| 短期记忆 | MemoryEngine L1 | 内存 | ✅ 但重启丢失 | 最多 100 条 |

### 缺什么

```
❌ 用户文档上传/导入
  → 无 /api/knowledge/import-document 端点
  → 用户不能上传 PDF/MD/TXT 作为知识库

❌ 知识图谱不持久
  → 用户加的实体/关系重启就丢
  → 阶段 1 要解决的

❌ 工作区文件不可搜索
  → 75 个生成项目只能用文件路径找
  → 需要索引到 zvec

❌ 报告不可检索
  → 42 份报告躺在 data/workspace/reports/
  → 内容未被 MemoryEngine 索引
```

---

## 需求 2: 系统自进化的记忆

**定义**: 系统从每次交互中学习，记忆随使用自动增长和优化，不需要用户手动标记。

### 当前有的

| 机制 | 实现 | 状态 |
|------|------|------|
| 写闸门 | WriteGate — importance 过滤低价值信息 | ✅ 工作 |
| L5 反思 | 被拒绝的记忆触发生成总结 | 🔴 未实现 |
| 记忆压缩 | compactMemories() — 合并低价值记忆 | 🔴 未接入 |
| 重要性自动评估 | LLM 判断 content 重要性 | 🔴 未实现 |
| 关联推理 | memory.getRelated() — 图谱关联 | 🔴 未接入 MemoryEngine |
| 知识图谱 → 记忆反馈 | KG 中高频实体提升 importance | 🔴 未实现 |

### 数据流缺失

```
当前:
  User Input → LLM → response
              ↓ 只保存会话
  Session JSONL ← 对话历史
              ↓
  MemoryEngine ← 手动 write() 才存

需要的:
  User Input → LLM → response
              ↓ 自动
  ① 会话 JSONL (已有)
  ② MemoryEngine.write({ importance: auto })  ← LLM 自动评估
  ③ KnowledgeGraph.addEntity()                 ← LLM 自动抽取
  ④ 写闸门拒绝 → L5 反思 → 总结后重写
  ⑤ 定期压缩 → 低频记忆合并 → 释放 zvec 空间
```

---

## 需求 3: 跨会话记忆

**定义**: Session A 学到的知识, Session B 能 recall。

### 当前有的

| 机制 | 实现 | 状态 |
|------|------|------|
| 会话持久化 | `data/sessions/*.jsonl` | ✅ 每个对话独立文件 |
| 会话间共享记忆 | MemoryEngine 全局单例 | ✅ L2-L4 持久化到 zvec |
| 跨会话 recall | `query({ text })` 搜索全局记忆 | ✅ 但仅文本匹配，无 Graph RAG |
| Session context 构建 | `session.buildContext()` | ✅ 但只返回当前会话消息 |
| 跨会话上下文合并 | 当前会话 + 相关记忆 + 知识图谱 | 🔴 未实现 |

### 缺口

```
Session A: "帮我设计 EventBus 架构"
  → KnowledgeGraph 加了 EventBus 实体
  → MemoryEngine 存了 EventBus 设计记录
  
Session B: "EventBus 怎么用？"
  → 应该自动 recall:
      ① 当前会话历史 (Session B)
      ② 相关记忆 (MemoryEngine.query("EventBus"))
      ③ 知识图谱 (EventBus 实体 + 邻域)
      ④ 相关技能 (coding SKILL.md)
  → 当前只做了 ①，②③④ 需要手动调用
```

---

## 三需求交集 → 存储架构总图

```
┌─────────────────────────────────────────────────────────────────┐
│                       三需求合并架构                             │
│                                                                 │
│  个人的知识库           系统自进化记忆         跨会话记忆         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ Skills/*.md   │    │ WriteGate    │    │ Sessions/*   │      │
│  │ Documents/*   │───▶│ L5 反思      │───▶│ MemoryEngine │      │
│  │ Workspace/*   │    │ 自动评估      │    │ KnowledgeGraph│     │
│  │ Reports/*     │    │ 定期压缩      │    │ Graph RAG    │      │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
│         │                   │                   │               │
│         └───────────────────┼───────────────────┘               │
│                             ▼                                   │
│              ┌─────────────────────────┐                        │
│              │     统一存储层            │                       │
│              │                         │                        │
│              │  zvec (向量)             │                        │
│              │  ├─ memory_embeddings   │  ← 记忆向量             │
│              │  ├─ kg_entity_names     │  ← 知识图谱实体名向量   │
│              │  ├─ kg_entity_contents  │  ← 知识图谱内容向量    │
│              │  ├─ document_chunks     │  ← 文档切片向量         │
│              │  └─ skill_embeddings    │  ← 技能向量             │
│              │                         │                        │
│              │  JSONL (标量 + 关系)     │                        │
│              │  ├─ entities.jsonl      │  ← 所有实体             │
│              │  ├─ relations.jsonl     │  ← 所有关系             │
│              │  ├─ sessions/*.jsonl    │  ← 会话                │
│              │  └─ history/*.jsonl     │  ← 执行历史             │
│              │                         │                        │
│              │  文件系统 (原始文档)      │                        │
│              │  ├─ skills/*.md         │  ← 技能定义             │
│              │  ├─ documents/*         │  ← 用户文档             │
│              │  └─ workspace/*         │  ← 生成产物             │
│              └─────────────────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 具体改进清单（按优先级）

### P0 — 必须现在做

| # | 改进 | 对应需求 | 工作量 |
|---|------|---------|--------|
| 1 | **KnowledgeGraph 持久化** (阶段1) | 知识库+跨会话 | ~2天 |
| 2 | **LLM 自动抽取实体** (阶段2) | 自进化 | ~3天 |
| 3 | **跨会话 context 合并** | 跨会话 | ~2天 |

### P1 — 应该做

| # | 改进 | 对应需求 | 工作量 |
|---|------|---------|--------|
| 4 | **Graph RAG** (阶段3) | 知识库+跨会话 | ~4天 |
| 5 | **MemoryEngine 自动 write** (LLM 评估 importance) | 自进化 | ~2天 |
| 6 | **L5 反思循环** (被拒记忆→总结→重写) | 自进化 | ~3天 |

### P2 — 以后做

| # | 改进 | 对应需求 | 工作量 |
|---|------|---------|--------|
| 7 | **用户文档上传** (PDF/MD/TXT → zvec) | 知识库 | ~3天 |
| 8 | **工作区文件索引** | 知识库 | ~2天 |
| 9 | **定期压缩/老化** | 自进化 | ~2天 |

---

## 你现在的存储现状总结

```
你的知识库       → data/skills/ (2个样本)
                 → data/workspace/ (75个生成项目, 不可搜索)
                 → KnowledgeGraph (纯内存, 重启丢失)

系统自进化记忆   → WriteGate (importance 过滤)
                 → MemoryEngine L1 (100条短期)
                 → 没有自动评估, 没有反思, 没有压缩

跨会话记忆       → data/sessions/*.jsonl (对话历史)
                 → MemoryEngine L2-L4 (zvec 持久化)
                 → 跨会话需要手动 query(), 未自动合并上下文
```

要不要从 **P0 #1 (KnowledgeGraph 持久化)** 开始？这是其他所有改进的基础——知识图谱不持久，知识库和跨会话记忆都建不起来。