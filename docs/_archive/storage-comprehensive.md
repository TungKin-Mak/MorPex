# 存储架构完整设计

> 逐条列出系统每一类数据的: 产生场景 → 存储结构 → 持久化方式 → 检索方式 → 关联系统

---

## 第1类: 个人知识库 (Personal Knowledge Base)

### 1.1 技能定义文件

| 属性 | 说明 |
|------|------|
| **产生场景** | 用户在 `data/skills/` 下创建 `SKILL.md` |
| **存储位置** | `data/skills/<category>/SKILL.md` |
| **格式** | Markdown + YAML frontmatter |
| **示例** | `data/skills/coding/SKILL.md` |
| **生命周期** | 永久保留，手动删除 |
| **检索方式** | `SkillLoader.loadFrom()` → `getAll()` / `get(name)` |
| **关联系统** | → LLM System Prompt (formatForSystemPrompt) |
| **持久化** | ✅ 文件系统 (已实现) |

### 1.2 用户上传文档

| 属性 | 说明 |
|------|------|
| **产生场景** | 用户通过 UI 或 API 上传 PDF/MD/TXT |
| **存储位置** | `data/documents/<id>/original.<ext>` |
| **格式** | 原始文件 + 切片后的文本块 |
| **切片存储** | `data/documents/<id>/chunks.jsonl` |
| **向量索引** | zvec 集合 `user_docs` (1024维, BGE-M3) |
| **生命周期** | 永久保留，用户可删除 |
| **检索方式** | `zvec.querySync({ vector })` → 语义搜索 |
| **关联系统** | → MemoryEngine (自动抽取知识点写入) → KnowledgeGraph (实体抽取) |
| **持久化** | ❌ 未实现 |

### 1.3 个人笔记 / 片段

| 属性       | 说明                                         |
| -------- | ------------------------------------------ |
| **产生场景** | 用户在聊天中输入"记住: xxx" 或通过 API 写入               |
| **存储位置** | `data/knowledge/notes.jsonl`               |
| **格式**   | `{ id, content, tags, source, createdAt }` |
| **向量索引** | zvec 集合 `memory_embeddings`                |
| **生命周期** | 永久保留                                       |
| **检索方式** | `POST /api/knowledge/search?q=` + 向量语义搜索   |
| **关联系统** | → MemoryEngine.L2 (持久化)                    |
| **持久化**  | ✅ JSONL + zvec (可通过 MemoryEngine.write 实现) |
|          |                                            |

### 1.4 工作区生成产物

| 属性 | 说明 |
|------|------|
| **产生场景** | Cycle/Task 执行后自动生成代码/文档 |
| **存储位置** | `data/workspace/projects/<id>/` |
| **格式** | `.py/.js/.ts/.json` 等源文件 |
| **索引** | ❌ 当前无索引，仅文件路径 |
| **需要改为** | 生成时写入 `data/workspace/index.jsonl` + 内容向量化到 zvec |
| **检索方式** | 应支持: 语义搜索(`query`) / 按项目ID / 按语言类型 |
| **关联系统** | → ArtifactRegistry (版本管理) → HistoryStore (执行记录) |
| **持久化** | ⚠️ 文件存在但不可搜索 |

### 1.5 执行报告

| 属性 | 说明 |
|------|------|
| **产生场景** | Cycle 完成时自动生成 `.md` 报告 |
| **存储位置** | `data/workspace/reports/cycle-<N>-<date>.md` |
| **格式** | Markdown |
| **当前问题** | 42 份报告只按文件名索引，内容不可搜索 |
| **需要改为** | 生成时: ① 保存 .md 文件 ② 内容写入 HistoryStore ③ 知识向量化到 zvec |
| **持久化** | ⚠️ 文件存在但不可搜索 |

---

## 第2类: 对话记忆 (Conversation Memory)

### 2.1 聊天会话 (Chat Sessions)

| 属性 | 说明 |
|------|------|
| **产生场景** | 用户在聊天面板每次对话 |
| **存储位置** | `data/sessions/<cwd-hash>/<timestamp>_<uuid>.jsonl` |
| **格式** | JSONL, 每行 `{ role, content, timestamp }` |
| **索引文件** | `data/sessions/sessions.json` |
| **生命周期** | 永久保留，用户可删除 |
| **检索方式** | `GET /api/sessions` → 列表; `GET /api/sessions/:id/messages` → 消息 |
| **关联系统** | → MemoryEngine (可从中提取记忆) → EmbeddingClient (向量化) |
| **持久化** | ✅ JSONL (pi-agent-core 实现) |

### 2.2 对话中自动提取的记忆

| 属性 | 说明 |
|------|------|
| **产生场景** | 用户对话时，系统自动识别"值得记住"的信息 |
| **示例** | 用户说"我用的数据库是 PostgreSQL" → 系统自动存为记忆 |
| **存储位置** | zvec 集合 `memory_embeddings` + `data/memory/memories.jsonl` |
| **格式** | `{ id, type: 'episodic', content, importance: auto, source: 'chat_extract' }` |
| **提取方式** | LLM 评估: "这句话值得记住吗？→ importance 几分？→ 抽取关键词" |
| **生命周期** | 自动管理: 高频访问保留, 长期不访问可压缩 |
| **检索方式** | `MemoryEngine.query({ text })` → 语义搜索 |
| **关联系统** | → WriteGate (过滤低价值) → KnowledgeGraph (实体抽取) |
| **持久化** | ⚠️ MemoryEngine 有 write() 方法，但聊天未自动调用 |

### 2.3 对话中的错误提取/幻觉修正

| 属性 | 说明 |
|------|------|
| **产生场景** | LLM 从对话中提取了错误的"事实"，用户纠正后需要修正 |
| **示例** | 系统错误记住"用户用 MySQL" → 用户说"不对，我用 PostgreSQL" |
| **当前问题** | ❌ 无法修正已存储的错误记忆 |
| **需要实现** | 修正机制: `MemoryEngine.correct(id, newContent)` → 更新 zvec + JSONL |
| **额外需求** | 关联记忆传播: 修正 A → 检查与 A 关联的 B/C 是否也需修正 |
| **持久化** | ❌ 未实现 |

### 2.4 用户画像 / 人物记忆

| 属性 | 说明 |
|------|------|
| **产生场景** | 系统从多次对话中逐步积累对用户的了解 |
| **示例** | 用户的: 技术栈偏好, 行业, 项目经验, 沟通风格, 决策模式 |
| **存储结构** | `data/knowledge/user-profiles.jsonl` |
| **格式** | `{ userId, traits: [{ key, value, confidence, source, updatedAt }] }` |
| **更新策略** | 每次对话后, LLM 增量更新: "根据这次对话, 对用户的了解有什么新发现？" |
| **生命周期** | 永久保留, 可重置 |
| **检索方式** | 每次对话自动附加到 system prompt |
| **关联系统** | → session.buildContext() 时注入 → LLM 个性化回复 |
| **持久化** | ❌ 未实现 |

### 2.5 用户反馈 / 偏好设置

| 属性 | 说明 |
|------|------|
| **产生场景** | 用户显式设置的偏好 (UI 主题, 模型选择, 推理深度) |
| **存储位置** | `data/config/user-preferences.json` |
| **格式** | `{ theme, model, thinkingLevel, language, fontSize, ... }` |
| **持久化** | ⚠️ 当前只有 `/api/config` 端点 (全局配置, 无用户隔离) |

---

## 第3类: 进化记忆 (Self-Evolving Memory)

### 3.1 写闸门日志

| 属性 | 说明 |
|------|------|
| **产生场景** | WriteGate 每次 decision (`store`/`reject`/`promote`/`demote`) |
| **存储位置** | `data/memory/gate-log.jsonl` |
| **格式** | `{ timestamp, action, reason, importance, tags }` |
| **用途** | L5 反思分析: rejection 率过高说明闸门太严 |
| **持久化** | ❌ 未实现 |

### 3.2 记忆压缩记录

| 属性 | 说明 |
|------|------|
| **产生场景** | 定期压缩时, 将多条低访问记忆合并为一条总结 |
| **存储位置** | zvec 更新 + `data/memory/compaction-log.jsonl` |
| **格式** | `{ sourceIds: [], summary, compressedAt }` |
| **用途** | 释放 zvec 空间, 保留知识精华 |
| **持久化** | ❌ 未实现 (MemoryEngine 有 compactMemories 方法但未使用) |

### 3.3 重要性自动评估日志

| 属性 | 说明 |
|------|------|
| **产生场景** | LLM 评估每条内容的重要性 (1-5) |
| **存储位置** | 直接存到 MemoryItem.importance |
| **评估依据** | 内容长度 / 包含关键词 / 是否用户显式要求记住 / 是否修正错误 |
| **持久化** | ⚠️ importance 字段存在, 但不自动评估 |

### 3.4 知识图谱自动构建记录

| 属性 | 说明 |
|------|------|
| **产生场景** | LLM 从内容中自动抽取实体+关系写入 KnowledgeGraph |
| **存储位置** | zvec 集合 `kg_entities` + `data/knowledge/entities.jsonl` + `relations.jsonl` |
| **生命周期** | 永久, 可手动删除/修正 |
| **检索方式** | `searchEntities()` + `getNeighborhood()` + Graph RAG |
| **持久化** | ❌ KnowledgeGraph 纯内存 |

---

## 第4类: 执行历史 (Execution History)

### 4.1 创业循环记录 (Cycle History)

| 属性 | 说明 |
|------|------|
| **产生场景** | `POST /api/cycle/run` 每次执行 |
| **存储位置** | `data/history/cycles.jsonl` |
| **格式** | `{ id, domain, trend, status, startedAt, completedAt, duration, result }` |
| **状态变化** | `started → running → completed/failed` |
| **检索方式** | `GET /api/cycle/history` (已实现) |
| **关联系统** | → HistoryStore → MemoryEngine (作为 episodic 记忆) |
| **持久化** | ✅ JSONL (已实现) |

### 4.2 任务执行记录 (Task History)

| 属性 | 说明 |
|------|------|
| **产生场景** | `POST /api/tasks/run` 每次执行 |
| **存储位置** | `data/history/tasks.jsonl` |
| **格式** | `{ id, taskName, taskType, input, output, status, startedAt, duration }` |
| **检索方式** | `GET /api/tasks` (未实现) + `GET /api/history` (已实现) |
| **关联系统** | → HistoryStore → MemoryEngine |
| **持久化** | ✅ JSONL (已实现) |

### 4.3 运行时事件 (Mirror)

| 属性 | 说明 |
|------|------|
| **产生场景** | 所有 EventBus 事件自动记录 |
| **存储位置** | `data/mirror/events.jsonl` + `executions.jsonl` + `snapshots.jsonl` |
| **格式** | JSONL, MirrorRecord 类型 |
| **用途** | 调试 / 可观测性 / 回放 |
| **检索方式** | `GET /api/observability/traces` |
| **持久化** | ✅ JSONL (已实现) |

---

## 第5类: 系统知识 (System Knowledge)

### 5.1 知识图谱实体 (Knowledge Entities)

| 属性 | 说明 |
|------|------|
| **产生场景** | API 添加 / LLM 抽取 / 技能导入 |
| **当前状态** | 🔴 **纯内存, 重启丢失** |
| **存储位置** | 应改为: zvec 集合 `kg_entity_names` + `kg_entity_contents` |
| **关联数据** | `data/knowledge/entities.jsonl` + `data/knowledge/relations.jsonl` |
| **实体类型** | concept, technology, person, organization, process, skill, memory, decision |
| **关系类型** | related_to, part_of, used_by, depends_on, produces, triggers, supersedes |
| **检索方式** | 向量搜索 + 标签过滤 + 邻域扩展 + 路径发现 |
| **持久化** | ✅ `KnowledgeGraph.addEntity()` 自动追加 `entities.jsonl` + `loadFromDisk()` 启动恢复 |
| **实现文件** | `packages/core/planes/knowledge-plane/knowledge/KnowledgeGraph.ts` |

### 5.2 知识图谱关系 (Knowledge Relations)

| 属性 | 说明 |
|------|------|
| **产生场景** | API 添加 / LLM 抽取 / 自动关联 |
| **当前状态** | 🔴 **纯内存, 重启丢失** |
| **存储位置** | 应改为: `data/knowledge/relations.jsonl` |
| **索引** | 邻接表 (启动时从 JSONL 重建) |
| **检索方式** | getNeighborhood() / findPath() |
| **持久化** | ✅ `KnowledgeGraph.addRelation()` 自动追加 `relations.jsonl` + 启动时重建邻接表 |
| **实现文件** | `packages/core/planes/knowledge-plane/knowledge/KnowledgeGraph.ts` |

### 5.3 行业知识 / 适配器

| 属性 | 说明 |
|------|------|
| **产生场景** | IndustryRegistry 内置 |
| **存储位置** | 代码内硬编码 (IndustryRegistry.ts) |
| **行业列表** | software, video, ecommerce, content |
| **持久化** | ✅ 代码内 (但不可扩展, 不能动态添加) |

---

## 第6类: 系统配置 (System Config)

### 6.1 全局配置

| 属性 | 说明 |
|------|------|
| **存储位置** | `data/config/system.json` |
| **内容** | `{ version, engine, thinkingLevel, model, plugins[] }` |
| **API** | `GET /api/config` + `PUT /api/config` |
| **持久化** | ⚠️ 当前只返回硬编码值, 未真正读写文件 |

### 6.2 Workflow 模板 / 蓝图

| 属性 | 说明 |
|------|------|
| **产生场景** | WorkflowPlanner 生成 / 用户自定义 |
| **存储位置** | `data/workflows/*.json` |
| **格式** | `{ name, steps: [{ agentType, prompt, deps }] }` |
| **持久化** | ❌ 未实现 |

---

## 第7类: 运行期工作内存 (Working Memory / Scratchpad)

### 7.1 Agent 任务检查点 (Checkpoints)

| 属性 | 说明 |
|------|------|
| **产生场景** | Agent 执行多步骤任务 (Cycle / DAG / 代码生成) 时自动保存中间状态 |
| **痛点** | 10 步任务执行到第 5 步崩溃/中断 → 重启后需从头推理, 浪费 Token 且可能无法复现 |
| **存储位置** | `data/workspace/checkpoints/<taskId>/<step>.json` |
| **格式** | `CheckpointPayload` (见下) |
| **生命周期** | 任务完成后保留 N 天, 或用户手动清理 |
| **检索方式** | 按 taskId 列表 / 按时间范围 / 按状态筛选 |
| **关联系统** | → HistoryStore (执行记录) → FSMEngine (状态恢复) → DAGEngine (节点恢复) |
| **持久化** | ❌ 未实现 |

**CheckpointPayload 结构**:

```typescript
interface CheckpointPayload {
  // 元数据
  checkpointId: string;
  taskId: string;
  step: number;
  totalSteps: number;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'rolled_back';
  createdAt: number;
  updatedAt: number;

  // 思考状态
  chainOfThought: string[];           // 已执行的思考步骤
  currentReasoning: string;           // 当前正在推理的内容

  // 数据状态
  variables: Record<string, any>;     // 局部变量快照
  fileSnapshots: Array<{              // 已生成的临时文件
    path: string;
    content: string;
    hash: string;
  }>;

  // 执行计划
  agenda: Array<{                     // 待执行的子任务队列
    id: string;
    type: string;
    description: string;
    deps: string[];
    status: 'pending' | 'running' | 'done';
  }>;
  completedAgenda: string[];          // 已完成的子任务 ID 列表

  // 上下文
  contextSnapshot: {                  // 执行上下文
    sessionId?: string;
    executionId: string;
    input: any;
    intermediateResults: Array<{ step: number; output: any }>;
    error?: { step: number; message: string; stack?: string };
  };

  // Token 消耗跟踪
  tokenUsage: {
    totalTokens: number;
    stepBreakdown: Array<{ step: number; tokens: number }>;
  };
}
```

### 7.2 检查点生命周期

```
任务开始
  │
  ├── Step 1 完成 → save checkpoint-1.json
  ├── Step 2 完成 → save checkpoint-2.json
  ├── Step 3 完成 → save checkpoint-3.json
  │
  ├── [崩溃] → 重启 → 加载 checkpoint-3 → 从 Step 4 继续
  ├── [用户暂停] → save checkpoint-3 → 用户回来 → 加载 → 继续
  └── [全部完成] → 保留最终 checkpoint → N 天后自动清理
```

### 7.3 应用场景

| 场景 | 说明 |
|------|------|
| **断点续传** | 网络中断/服务重启 → 从最新 checkpoint 恢复, 不丢进度 |
| **暂停/恢复** | 用户手动暂停长期任务 → 下次回来继续 |
| **回滚** | 某一步出错 → 回滚到上一步 checkpoint 重试 |
| **审计** | 检查 checkpoint 序列可追溯 Agent 完整推理路径 |
| **调试** | 开发时查看中间变量和思考链 |

### 7.4 与现有系统的关系

```
FSMEngine (状态机)          DAGEngine (DAG 执行)
     │                            │
     │ 状态: IDLE→RUNNING→...      │ 节点: pending→running→done
     ▼                            ▼
┌─────────────────────────────────────────────────────┐
│              CheckpointManager                      │
│  save(taskId, step, payload)         JSONL 写入     │
│  load(taskId, step) → payload       JSONL 读取     │
│  list(taskId) → steps[]             目录遍历       │
│  rollback(taskId, toStep)           恢复到指定步    │
│  clean(taskId, olderThan)           自动清理旧      │
└─────────────────────────────────────────────────────┘
     │                            │
     ▼                            ▼
HistoryStore                  MemoryEngine
(执行记录)                     (将 checkpoint 提取为记忆)
```

### 7.5 实现要点

| 要点 | 说明 |
|------|------|
| **写入时机** | 每完成一个原子步骤自动 save, 不丢进度 |
| **存储格式** | JSONL 逐 step 追加, 与 HistoryStore 一致 |
| **大小控制** | 每个 checkpoint 限制 1MB, 超长 CoT 自动截断 |
| **清理策略** | 任务完成 N 天后删除中间 checkpoint, 保留最终一个 |
| **恢复流程** | load(checkpoint) → 重建变量 → 重建 agenda → 继续执行 |
| **rollback** | 删除 step N..end 的 checkpoint, 从 N-1 恢复 |

---

## 存储架构总图 (更新后)

```
data/
│
├── config/                          ← 系统配置
│   ├── system.json                  ← ✅ ConfigStore 全局配置
│   └── user-preferences.json        ← ⚠️ 用户偏好 (存于 UserProfileEngine)
│
├── skills/                          ← 个人知识库: 技能
│   └── <category>/SKILL.md          ← ✅ SkillLoader 递归搜索
│
├── documents/                       ← 个人知识库: 文档
│   └── <md5-hash>/                  ← ✅ DocumentIngestion
│       ├── original.txt             ← 原始文件
│       └── chunks.jsonl             ← 切片文本
│
├── knowledge/                       ← 知识图谱 (Cognee Topology Layer)
│   ├── entities.jsonl               ← ✅ KnowledgeGraph 自动追加
│   ├── relations.jsonl              ← ✅ KnowledgeGraph 自动追加
│   ├── snapshots/                   ← ✅ 定期全量快照
│   │   └── snapshot-<ts>.json
│   ├── notes.jsonl                  ← ⚠️ 笔记 (通过 MemoryBus.remember)
│   └── user-profiles.jsonl          ← ✅ UserProfileEngine
│
├── memory-bus/                      ← 三维一体记忆总线 (新增)
│   ├── index.jsonl                  ← ✅ Provenance Layer: MD5去重索引
│   ├── gate-log.jsonl               ← ✅ WriteGate 闸门日志
│   ├── compaction-log.jsonl         ← ✅ 拓扑剪枝 + 记忆压缩记录
│   └── knowledge/                   ← ✅ 图谱持久化目录
│       ├── entities.jsonl
│       └── relations.jsonl
│
├── memory/                          ← 进化记忆 (旧版, 兼容)
│   ├── gate-log.jsonl               ← (WriteGate 独立使用时)
│   └── memories.jsonl               ← JSONLStorage 备份
│
├── history/                         ← 执行历史
│   ├── cycles.jsonl                 ← ✅ HistoryStore
│   └── tasks.jsonl                  ← ✅ HistoryStore
│
├── sessions/                        ← 会话
│   ├── sessions.json                ← ✅ pi-agent-core
│   └── <hash>/<ts>_<uuid>.jsonl    ← ✅ 每个会话消息
│
├── mirror/                          ← 可观测性
│   ├── events.jsonl                 ← ✅ Mirror
│   ├── executions.jsonl             ← ✅ Mirror
│   └── snapshots.jsonl              ← ✅ Mirror
│
├── workspace/                       ← 工作区
│   ├── projects/<id>/               ← 生成项目
│   ├── reports/*.md                 ← 执行报告
│   ├── index.jsonl                  ← ✅ WorkspaceIndexer
│   └── checkpoints/                 ← ✅ CheckpointManager
│       └── <taskId>/                ← 每个任务独立目录
│           ├── checkpoint-0.json
│           ├── checkpoint-1.json
│           └── ...
│
├── workflows/                       ← 🔷 待办: Workflow 模板
│   └── *.json                       ← 自定义工作流
│
└── zvec/                            ← 向量数据库 (所有嵌入)
    ├── memory_embeddings            ← ✅ ZVecStorage (BGE-M3/1024)
    ├── kg_entity_names              ← ✅ 知识图谱实体名向量
    ├── kg_entity_contents           ← ⚠️ 知识图谱内容向量 (待添加)
    ├── user_docs                    ← ⚠️ 用户文档切片向量 (待添加)
    ├── skill_embeddings             ← ⚠️ 技能向量 (待添加)
    └── checkpoint_embeddings        ← ⚠️ 检查点内容向量 (待添加)
```

---

## 实现优先级

```
✅ P0 — 全部完成
├── ✅ KnowledgeGraph 持久化 → entities/relations 写入 JSONL + loadFromDisk
├── ✅ 聊天自动提取记忆 → ChatMemoryExtractor (LLM评估→WriteGate→三层写入)
├── ✅ 用户画像 → UserProfileEngine (LLM增量+置信度合并+SystemPrompt)
├── ✅ 对话错误修正 → KnowledgeGraph.correctEntity/correctRelation
├── ✅ 文档上传 → DocumentIngestion (MD5→切片→三层写入→Cognify)
└── ✅ Graph RAG → MemoryBus.recall() 三种策略 (vector-first/graph-walk/hybrid-rag)

✅ P1 — 全部完成
├── ✅ 写闸门日志 → WriteGate → gate-log.jsonl
├── ✅ 笔记/片段持久化 → MemoryBus.remember() 三层写入
├── ✅ 工作区索引 → WorkspaceIndexer → index.jsonl + 按项目/语言/执行ID检索
├── ✅ 配置持久化 → ConfigStore → data/config/system.json
├── ✅ 记忆压缩 → MemoryBus.compactMemories/compactGraphNodes → compaction-log.jsonl
└── ✅ Agent 检查点 → CheckpointManager (save/load/rollback/clean)

✅ P2 — 全部完成
├── ✅ L5 反思循环 → MemoryBus.improve() (闸门分析+冷记忆+孤儿实体+拓扑剪枝+压缩)
├── ✅ 跨会话记忆 → MemoryBus 统一索引, 跨 source 检索
├── ✅ 用户画像 SystemPrompt → UserProfileEngine.formatForSystemPrompt()
├── ✅ 执行报告可搜索 → WorkspaceIndexer.indexReport()
└── ✅ 重要性自动评估 → MemoryBus.evaluateImportance()

🔷 待办 (独立子系统边界)
├── 🔷 Workflow 模板管理 → data/workflows/*.json (需对接 WorkflowPlanner, ~200行)
└── 🔷 行业知识动态扩展 → data/industries/*.json + 热加载 (需改造 IndustryRegistry, ~150行)
```

---

## 数据持久化全景图

> 以下按 "产生 → 写入 → 存储 → 检索" 完整链路说明每个功能的文件级保存方式。

| # | 功能 | 写入模块 | 存储文件 | 格式 | 索引方式 |
|---|------|---------|---------|------|---------|
| 1.1 | 技能定义 | `SkillLoader` | `data/skills/<cat>/SKILL.md` | Markdown+YAML | 文件名递归扫描 |
| 1.2 | 文档上传 | `DocumentIngestion` | `data/documents/<hash>/original.txt` + `chunks.jsonl` | TXT + JSONL | MD5去重 + zvec向量 |
| 1.3 | 笔记/片段 | `MemoryBus.remember()` | `data/memory-bus/index.jsonl` + zvec + KG entities.jsonl | JSONL | 三层联合检索 |
| 1.4 | 工作区产物 | `WorkspaceIndexer.indexFile()` | `data/workspace/index.jsonl` | JSONL (一行一个 WorkspaceEntry) | 按项目ID/语言/执行ID |
| 1.5 | 执行报告 | `WorkspaceIndexer.indexReport()` | `data/workspace/index.jsonl` | JSONL | 按 executionId |
| 2.1 | 聊天会话 | pi-agent-core | `data/sessions/<hash>/<ts>_<uuid>.jsonl` | JSONL | sessions.json 索引 |
| 2.2 | 聊天记忆提取 | `ChatMemoryExtractor` | `data/memory-bus/index.jsonl` + zvec + KG | JSONL (三层) | LLM评估→WriteGate→remember |
| 2.3 | 错误修正 | `KnowledgeGraph.correctEntity()` | `data/.../knowledge/entities.jsonl` | JSONL 追加 (旧行保留) | 最后出现的版本为准 |
| 2.4 | 用户画像 | `UserProfileEngine` | `data/knowledge/user-profiles.jsonl` | JSONL (一行一个 UserTrait) | 按 userId 筛选 |
| 2.5 | 偏好设置 | `ConfigStore` / `UserProfileEngine` | `data/config/system.json` + user-profiles | JSON | 按键读写 |
| 3.1 | 写闸门日志 | `WriteGate.logDecision()` | `data/memory-bus/gate-log.jsonl` | JSONL (timestamp+action+reason) | L5反思分析 |
| 3.2 | 记忆压缩 | `MemoryBus.compactMemories()` | `data/memory-bus/compaction-log.jsonl` | JSONL (sourceCount+originalIds) | 压缩审计 |
| 3.3 | 重要性评估 | `MemoryBus.evaluateImportance()` | 内嵌于 `index.jsonl` 的 importance 字段 | — | 按 importance 过滤 |
| 3.4 | KG自动构建 | `ECLCognifyEngine.cognifyAndCommit()` | `data/.../knowledge/entities.jsonl` + `relations.jsonl` | JSONL | LLM抽取→图谱写入 |
| 4.1 | Cycle记录 | `HistoryStore.addCycle()` | `data/history/cycles.jsonl` | JSONL | 按时间倒序 |
| 4.2 | Task记录 | `HistoryStore.addTask()` | `data/history/tasks.jsonl` | JSONL | 按 executionId |
| 4.3 | Mirror事件 | `ExecutionMirror` | `data/mirror/events.jsonl` | JSONL | 按时间/类型 |
| 5.1 | KG实体 | `KnowledgeGraph.addEntity()` | `data/.../knowledge/entities.jsonl` | JSONL (一行一个 KnowledgeEntity) | 文本搜索+标签+类型 |
| 5.2 | KG关系 | `KnowledgeGraph.addRelation()` | `data/.../knowledge/relations.jsonl` | JSONL (一行一个 KnowledgeRelation) | BFS路径+邻域扩展 |
| 5.3 | 行业知识 | `IndustryRegistry` | 代码硬编码 | TypeScript | 🔷待办: 外部化 |
| 6.1 | 全局配置 | `ConfigStore` | `data/config/system.json` | JSON (单文件) | 按键读写 |
| 6.2 | Workflow模板 | — | `data/workflows/*.json` | JSON | 🔷待办 |
| 7.1 | Agent检查点 | `CheckpointManager.save()` | `data/workspace/checkpoints/<taskId>/checkpoint-<step>.json` | JSON (每步一文件) | 按taskId+step |

### JSONL 格式说明

所有 `.jsonl` 文件遵循统一规范：**一行一个 JSON 对象，`appendFileSync` 原子追加，崩溃不丢数据。**

```
写入: fs.appendFileSync(path, JSON.stringify(entry) + '\n')
读取: fs.readFileSync → split('\n') → filter(Boolean) → map(JSON.parse)
纠错: 追加新版本行, 旧行保留为审计轨迹, 启动时以最后出现的 id 为准
```

### 三层写入链路 (Cognee 风格)

```
MemoryBus.remember(content)
  │
  ├─[Provenance] data/memory-bus/index.jsonl        ← MD5 + 时间戳 + 来源追溯
  ├─[Semantic]   zvec (ZVecStorage, BGE-M3/1024)    ← 高维向量, 粗粒度语义召回
  └─[Topology]   data/.../knowledge/entities.jsonl   ← 实体节点
                  data/.../knowledge/relations.jsonl  ← 强类型关系边
```

---

*最后更新: 2026-07-07 | 总文件: 17 个 | 总行数: 5,127 | 覆盖: 26/28 (93%)*