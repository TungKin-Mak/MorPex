# Memory System v2 — 架构设计

> **设计原则**：
>
> 1. **不拟人** — 不按认知距离分层，按数据形态 + 访问模式组织
> 2. **按类型遗忘** — 不同类型记忆有不同自然生命周期，不套单一规则
> 3. **宁缺毋滥** — 宁可漏引一条相关记忆，也绝不灌入十条无关记忆污染上下文
> 4. **相关性 ≠ 关键词命中** — 语义精准匹配 > 关键词广度覆盖
>
> **参考项目**：[Cognee](https://github.com/topoteretes/cognee)（ECL 流水线 + 图谱/向量/元数据三索引）、[Letta/MemGPT](https://github.com/letta-ai/letta)（Core/Main/Archive 三层存储 + Agent 自主操控）

---

## 一、为什么不用 5 层记忆

5 层模型（L1 工作 → L2 情景 → L3 语义 → L4 流程 → L5 反思）在 AI 工程中不必须：

1. **Cognee（27K★）和 Letta（23K★）都不用** — 它们按数据形态／访问模式组织，不按认知距离
2. **LLM 不需要预设分类** — 它需要检索质量，不是认知科学隐喻
3. **静态分类不如动态权重** — 写入时决定"属于哪层"是过度设计，使用模式会自然浮现重要性
4. **当前项目已有 MemoryBus（参考 Cognee）** — 保留并增强它，不必再叠一层 5 层概念

5 层可保留为 **API 标签**（`layer?: 'working'|'episodic'|'semantic'|'procedural'|'reflective'`），但不再作为独立的存储路径。引擎只认权重和池子。

---

## 二、架构总览

```
                      检索维度（怎么找到）
               ┌──────────────────────────────┐
               │ Provenance │ Semantic │ Graph │
               │  时间线     │  语义    │ 关系   │
┌──────────────┼────────────┼──────────┼───────┤
│ Core (RAM)   │ 当前会话    │    ✗     │  ✗    │  ← 上下文窗口
│ 上下文窗口    │ 原始消息    │          │       │     容量：token 预算
├──────────────┼────────────┼──────────┼───────┤
│ Main (Pool)  │ 会话摘要    │ 摘要向量  │ 实体关联│  ← 固定容量
│ 竞争池        │ 用户画像    │ 画像向量  │ 画像→知识│     容量：可配置上限
│              │ 错误修正    │ 修正向量  │ 修正→知识│     机制：score 竞争
│              │ 个人知识    │ 知识向量  │ 知识→关联│
├──────────────┼────────────┼──────────┼───────┤
│ Archive      │ 旧版画像    │ 旧版向量  │ 保留关系│  ← 无限容量
│ 归档池        │ 过期摘要    │ 过期向量  │ 保留关系│     不主动检索
│              │ 被覆盖修正  │    ✗     │ 保留关系│     被动命中可打捞
└──────────────┴────────────┴──────────┴───────┘
```

**两条轴**：
- **Y 轴（Letta 3 层）**：记忆在哪个池子 → 决定能否进上下文
- **X 轴（Cognee 3 维）**：怎么检索 → 决定能否被找到

---

## 三、记忆类型与遗忘策略

系统中的记忆按类型有不同的自然生命周期，**不同类型的遗忘策略不同**：

| 类型 | 产生速度 | 生命周期 | 遗忘策略 |
|------|----------|----------|----------|
| **个人知识 MD** | 低频，手动添加 | 永久（除非显式修改） | 不遗忘，版本覆盖 |
| **用户画像** | 每次对话可能更新 | 长期，会演化 | 新旧更替，最久未引用归档 |
| **会话摘要** | 每次对话 1-N 条 | 中期，越旧越无用 | 时间衰减 + 压缩合并 |
| **错误修正** | 每次对话 0-N 条 | 短期，修正后过期 | 被新修正覆盖时删除 |
| **当前会话上下文** | 实时 | 会话结束过期 | 会话结束清空 |

### 3.1 个人知识 MD — 永不遗忘，版本覆盖

```
触发：用户手动修改知识文件
行为：
  → 旧版本从 Main Pool 移到 Archive
  → 新版本进入 Main Pool
  → 不参与竞争淘汰，有自己的配额（如 5000 条 chunk）
  → 向量重新索引，旧版向量保留在 Archive 但排序靠后
```

### 3.2 用户画像 — 新旧更替

```
触发：每次对话结束后，LLM 提取画像更新
行为：
  → 新画像写入 Main Pool
  → 与新画像语义冲突的旧画像 → Archive（被"修正"了）
  → 与新画像不冲突的旧画像 → 保留
  → 画像条数达到上限（如 50 条）→ 最久未被对话引用的 → Archive
  → Archive 中 >90 天未被引用的旧画像 → 删除
```

### 3.3 会话摘要 — 时间衰减 + 压缩合并

```
Level 1: 即时压缩（会话结束时）
  → 同一会话的多条摘要 → LLM 合并为 1-3 条
  → 去冗余，保留关键决策和结论

Level 2: 时间衰减（Main Pool 竞争）
  → score 包含 recency 因子，越旧越低
  → 被后续对话引用过的 → accessCount↑ → score↑ → 存活
  → 从未被引用的 → score↓ → 被挤出 Main Pool → Archive

Level 3: 深度压缩（Archive 中触发）
  → Archive 中超过 30 天的摘要 → LLM 将 N 条合并为 1 条超摘要
  → 原文删除，只保留超摘要
  → 超摘要保留 90 天 → 最终删除
```

### 3.4 错误修正 — 即时淘汰

```
触发：新修正写入时
行为：
  → 检查是否有旧修正指向同一问题
  → 有 → 旧修正即时删除（不进 Archive）
  → 新修正写入 Main Pool
  → 连续 3 次同类对话未触发 → 自动删除
  → 存活超过 30 天未触发 → 删除
```

---

## 四、竞争池机制（Main Pool）

### 4.1 Score 公式

```typescript
function computeScore(item: MemoryItem): number {
  const hoursSinceAccess = (Date.now() - item.lastAccessedAt) / 3600000;

  const recencyBonus   = 1 / (1 + hoursSinceAccess / 24);   // 0~1，24h 半衰
  const frequencyBonus = Math.log(1 + item.accessCount);     // 0~∞，边际递减
  const relationBonus  = Math.log(1 + item.relationCount);   // 0~∞，关联越多越稳
  const importanceBase = item.importance / 10;               // 0~1，初始保护

  return (
    w1 * recencyBonus   +   // 默认 0.25
    w2 * frequencyBonus +   // 默认 0.30
    w3 * relationBonus  +   // 默认 0.25
    w4 * importanceBase     // 默认 0.20
  );
}

// 权重 w1-w4 可根据运行数据自动校准：
//   - 检索命中率低的记忆特征 → 降低对应权重
//   - 高频被引用的记忆特征 → 提升对应权重
```

### 4.2 写入竞争

```
新记忆写入：
  if (池未满) → 直接写入
  if (池已满) → 比较新记忆 score vs 池中最低 score
    if (新记忆 > 最低) → 挤出最低者（→ Archive），新记忆进入
    if (新记忆 ≤ 最低) → 新记忆直接 → Archive
```

### 4.3 衰减（每日维护）

```
每日对所有 Main Pool 记忆：
  → 重新计算 score（recency 自然衰减）
  → Score 低于阈值 × 池满 → 移到 Archive
  → 知识文件不受衰减影响
```

---

## 五、数据流

### 5.1 写入路径

```
会话消息 → Core (会话缓存)
  │
  └→ 会话结束时触发：
      ├─ LLM 提取用户画像更新 → Main Pool
      ├─ LLM 生成会话摘要     → Main Pool（多条合并为 1-3 条）
      ├─ LLM 提取错误修正     → Main Pool
      └─ 冲突检测：
          ├─ 旧画像冲突 → Archive
          └─ 旧修正冲突 → 直接删除

知识 MD 变更 → Main Pool（旧版 → Archive）
```

### 5.2 读取路径

```
用户 query
  │
  ├─ 向量搜索 Main Pool      → 候选集 A（语义相似）
  ├─ 图谱 1-2 跳关联          → 候选集 B（关系连接）
  ├─ 用户画像（硬注入）        → 上下文
  ├─ 错误修正（硬注入）        → 上下文
  └─ 候选集 A ∪ B → 去噪排序  → 上下文（竞争注入）
      │
      └→ 注入成功的记忆 → accessCount++
```

### 5.3 维护路径（定时 / 阈值触发）

```
Main Pool 竞争淘汰：
  → 池满 + 新写入 → score 最低者 → Archive

每日衰减：
  → 重新计算所有 Main Pool 记忆的 score
  → 极低分 → Archive

Archive 清理（每周）：
  → 会话摘要 >30 天 → LLM 合并为超摘要
  → 超摘要 >90 天 → 删除
  → 错误修正 >30 天未触发 → 删除
  → 旧画像 >90 天未被引用 → 删除
  → 旧版知识文件（已有 3+ 新版本）→ 删除

知识图谱维护：
  → 实体关联的记忆全部归档 → 保留实体节点，标记"冷"
  → 孤立实体（无关联记忆）→ 删除
```

---

## 六、API 设计

> **原则**：基于现有 `MemoryBus` API，以最小改动演进。只有一个破坏性变化。

### 6.1 现有 API（保留不变）

```typescript
// 核心四动词 — 不改
remember(payload: MemoryPayload): Promise<IndexEntry | null>
recall(query: RecallQuery): Promise<RecallResult>
forget(id: string): boolean
improve(): Promise<ImproveResult>

// 生命周期 — 不改
initialize(): Promise<void>
shutdown(): Promise<void>
getStats(): object
```

### 6.2 类型扩展（零破坏）

```typescript
// MemoryPayload — 加 2 个可选字段，现有调用无需修改
export interface MemoryPayload {
  content: string;
  source?: string;
  sourceId?: string;
  tags?: string[];
  importance?: number;          // 1-5
  metadata?: Record<string, any>;

  // 🆕 可选 — 不传也能用，传了启用类型化遗忘
  memType?: 'knowledge' | 'profile' | 'summary' | 'correction';
  references?: string[];        // 关联的其他记忆 id
}

// IndexEntry — 加 4 个运行时字段（内部）
export interface IndexEntry {
  id: string;
  contentHash: string;
  source: string;
  sourceId?: string;
  timestamp: number;
  chunkCount: number;
  tags: string[];
  importance: number;

  // 🆕 运行时跟踪（不持久化，启动从 0 开始）
  accessCount: number;          // 被 recall 命中次数
  lastAccessedAt: number;       // 最后被命中时间
  relationCount: number;        // 被 references 反向引用次数
  memType: string;              // 从 payload 透传
}

// RecallQuery — 加 1 个可选选项
export interface RecallQuery {
  text: string;
  strategy?: RecallStrategy;
  topK?: number;
  graphDepth?: number;
  entityTypes?: EntityType[];
  minImportance?: number;
  includeArchive?: boolean;     // 🆕 是否搜索 Archive
}
```

### 6.3 新增方法

```typescript
/**
 * 🆕 闭环反馈 — 标记记忆在本次对话中的价值
 *
 * useful=true  → accessCount++、lastAccessedAt 更新 → score↑
 * useful=false → 标记低价值，后续竞争更可能被淘汰
 */
feedback(id: string, useful: boolean): void;
```

### 6.4 破坏性变化（仅此一个）

```typescript
// 旧签名
compactMemories(minImportance: number, olderThanDays: number): number;

// 新签名 — 内部基于 score 自动决定，不再需要外部传参
compactMemories(): {
  evicted: number;      // 被挤出 Main Pool 的条数
  archived: number;     // 已归档的条数
  merged: number;       // 被深度压缩合并的组数
  deleted: number;      // 直接删除的条数（错误修正过期等）
};
```

### 6.5 内部实现（不暴露 API）

```
Archive 目录：
  data/memory-bus/
  ├── index.jsonl          ← Main Pool 索引（现有）
  ├── gate-log.jsonl       ← 闸门日志（现有）
  ├── compaction-log.jsonl ← 压缩日志（现有）
  ├── archive/             ← 🆕 Archive 池
  │   └── index.jsonl
  └── knowledge/           ← 图谱（现有）

compactMemories() 自动处理：
  → 计算 score → 挤出最低分 → Archive
  → Archive 中按 memType 规则清理/合并
  → recall({ includeArchive: true }) 可搜索 Archive
```

---

## 七、实现优先级

| 阶段 | 内容 | 依赖 |
|------|------|------|
| **P0** | `memType` 字段 + IndexEntry 运行时字段 | 无 |
| **P0** | Score 竞争机制 + `compactMemories()` 改签名 | IndexEntry |
| **P1** | Archive 池 + `recall({ includeArchive })` | Main Pool |
| **P1** | 按类型遗忘（摘要衰减、修正删除、画像更替） | memType |
| **P1** | `feedback()` 闭环 | accessCount |
| **P2** | 深度压缩（LLM 合并摘要） | Archive |
| **P2** | 知识图谱增强（实体+关系，替代标签共现） | 现有 KnowledgeGraph |
| **P3** | 权重自动校准 | 运行数据积累 |
| **P3** | 上下文窗口管理 — 见 [附录 A](#附录a上下文窗口设计约束) | 以上全部 |

---

## 八、与现有代码的关系

| 现有模块 | 处理方式 |
|----------|----------|
| `MemoryBus` | **保留并增强** — 它已是 Cognee 风格，补齐缺失功能 |
| `MemoryEngine` (A₁ core) | **删除** — 纯内存、无持久化、功能被覆盖 |
| `MemoryEngine` (A₂ memory) | **删除** — 薄封装、功能被 MemoryBus 覆盖 |
| `WriteGate` | **保留** — 作为写入过滤模块，解耦为独立组件 |
| `ZVecStorage` | **保留** — 作为向量存储适配器 |
| `ECLCognifyEngine` | **保留** — 作为 LLM 实体抽取模块 |
| `KnowledgeGraph` | **增强** — 从标签共现升级为实体+关系图谱 |
| `DocumentIngestion` | **保留** — 知识 MD 的摄入管道 |
| `UserProfileEngine` | **改** — 画像更新进入 Main Pool |
| `ChatMemoryExtractor` | **改** — 摘要/修正写入 Main Pool |
| `ZVecLockRecovery` | **保留** — 只处理文件→目录，不删 LOCK |

---

## 九、设计决策记录

| 决策 | 理由 |
|------|------|
| 不用 5 层 | Cognee/Letta 都不用；静态分类不如动态权重 |
| 不纯 Agent 自主 | LLM 误判风险不可接受；Agent 提议 + System 裁决 |
| 遗忘 = 竞争 + 归档 | 不设绝对阈值；记忆间相互竞争；归档可打捞 |
| 按类型遗忘 | 知识永久、画像更替、摘要衰减、修正即删 — 不同类型不同策略 |
| 宁缺毋滥 | 宁可漏引一条，不灌十条；精准 > 全面 |
| Cognee 3 维检索 | 单一检索不够；图谱关系推理 + 语义搜索 + 时间线各有用途 |
| Letta 3 层存储 | Core/Main/Archive 是最简且够用的存储分层 |
| Score 公式 | 多因子加权比单一指标（LRU/LFU）更准确；权重可自动校准 |
| 最小 API 改动 | 基于现有 MemoryBus，1 个破坏性变化 + 类型扩展 |

---

## 附录 A：上下文窗口设计约束

> ⚠️ 本附录为 P3 阶段的硬约束，不在当前实现范围内。
> 讨论时发现的核心原则，在此记录以免遗忘。

### 核心约束

**宁缺毋滥**：宁可漏引一条相关记忆，绝不灌入十条无关记忆污染上下文。

用户的原话：

> "跨会话讨论嵌入式项目，系统检索到嵌入式相关的图谱，将**强相关**的记忆引入我接受。但如果把所有嵌入式的记忆都引入，我无法忍受。"

### 这意味着什么

```
❌ 关键词匹配 → "嵌入式"命中 50 条 → 全灌入上下文
✅ 语义精准匹配 → query 的语义向量 → Top-5 最相似 → 注入
✅ 图谱精准关联 → query 涉及的实体 → 1-2 跳强关联 → 注入
✅ 相似度阈值过滤 → 相似度 < 0.7 的记忆 → 不注入
✅ 同主题去重 → 5 条记忆说同一件事 → 只取 score 最高的
```

### 硬注入也必须克制

```
❌ 所有用户画像全注入
✅ 只注入与当前 query 语义相关的画像（最多 3-5 条）

❌ 所有错误修正全注入
✅ 只注入与当前对话主题可能相关的修正（最多 3 条）
```

### 系统应当「宁可沉默」

当系统不确定一条记忆是否相关时，默认行为是**不注入**。

- 漏引一条相关记忆 → 用户可能没注意到，或者后续对话中会自然引出
- 多灌一条无关记忆 → 用户立刻感到上下文臃肿，信任度下降
- **漏引的代价远小于多灌的代价**

### 数量硬上限

无论检索命中多少条，注入上下文的数量必须有硬上限：
- 画像：≤ 5 条
- 修正：≤ 3 条
- 语义搜索结果：≤ 5 条
- 图谱扩展结果：≤ 5 条
- 会话摘要：≤ 3 条
- **总计 ≤ 15 条**（不含系统 prompt 和当前对话消息）

### 反馈闭环

```
注入的记忆被 Agent 用了 → feedback(id, true) → score↑
注入的记忆 Agent 没用到   → feedback(id, false) → score↓ → 下次可能不再注入
```

这个反馈是「宁缺毋滥」的自我强化机制 — 系统会逐渐学会什么该注入、什么不该注入。
