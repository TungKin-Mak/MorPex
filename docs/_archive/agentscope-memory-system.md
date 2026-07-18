# AgentScope 记忆系统深度解析

> Mem0 / ReMe / Agentic Memory / RAG — 四种记忆方案，三个统一模式

---

## 一、架构总览

AgentScope 的记忆系统不是"一个记忆模块"，而是**四个独立的中间件**，各自实现相同的接口：

```
AgentScope 记忆体系
├── Mem0Middleware        → 向量数据库 + LLM 提取记忆 (mem0 开源/Platform)
├── ReMeMiddleware        → 文件系统 + LLM 提取记忆 (AgentScope 自己做的)
├── AgenticMemoryMiddleware → Markdown 文件 + Agent 自己管理记忆
└── RAGMiddleware         → 知识库检索 (非记忆，是文档 RAG)
```

**共同特点**：全部是 Middleware，全部通过 `on_reply` / `on_reasoning` / `on_system_prompt` / `list_tools` 四个 hook 接入 Agent。

---

## 二、三种控制模式（每个中间件都支持）

```
┌─────────────────┬──────────────────┬──────────────────┐
│  static_control │  agent_control   │      both        │
├─────────────────┼──────────────────┼──────────────────┤
│ 自动检索+注入    │ 暴露工具给 Agent  │  两者兼具         │
│ Agent 无感知     │ Agent 自己决定    │                  │
│ 不暴露工具       │ 何时查/写记忆     │                  │
└─────────────────┴──────────────────┴──────────────────┘
```

---

## 三、Mem0 方案

### 流程

```
on_reply:
  1. 提取用户输入文本 (query_text)
  2. 异步搜索 mem0: search(query_text, user_id, agent_id) → memories[]
  3. 等待 ReplyStartEvent → 注入 HintBlock("## Relevant memories...")
  4. 透传其余事件
  5. finally: 写入本轮对话到 mem0: add([user_msg, assistant_msg])

on_system_prompt (agent_control/both 模式):
  追加工具说明: "You have search_memory and add_memory tools..."

list_tools (agent_control/both 模式):
  返回 [search_memory 工具, add_memory 工具]
```

### 写策略：两级回退

```python
# 1. 正常提取 (infer=True)
result = mem0.add(messages, infer=True)
if mem0 提取到记忆:
    return result

# 2. 原始保存 (infer=False) — 保证不丢数据
return mem0.add(messages, infer=False)
```

### MorPex 对比

| Mem0 | MorPex MemoryBus |
|------|-----------------|
| 向量检索 + LLM 提取 | 关键词 + 向量 |
| 自动写入 | 手动 `remember()` |
| user_id/agent_id 命名空间 | 无多租户隔离 |
| 中间件模式接入 Agent | 独立服务 |

---

## 四、ReMe 方案

### 与 Mem0 的关键区别

| | Mem0 | ReMe |
|:--|:--|:--|
| 存储 | 向量数据库 (Qdrant) | 文件系统 (Markdown cards) |
| 部署 | 需要 mem0 服务或 Platform API | **内嵌进程**，无需外部服务 |
| 写操作 | 有 add_memory 工具 | **只有自动写回**，无手动添加 |
| 会话隔离 | user_id + agent_id | session_id (从 AgentState 读取) |
| 检索 | 向量相似度 | 关键词或向量 (可选) |

### 流程

```
on_reply:
  1. 提取用户输入
  2. 异步启动 search 任务 (background asyncio task)
  3. 快照当前 context 的 message IDs (pre_ids)
  4. 透传事件
  5. finally:
     - 取消未完成的 search 任务
     - 计算增量消息 (context 中 pre_ids 之后的新消息)
     - write_back(increment, session_id) → ReMe auto_memory job

on_reasoning:
  轮询 search 任务:
    如果完成 → 注入 HintBlock 到 agent.state.context
    如果未完成 → 下次 reasoning 再检查 (多轮 ReAct 时有用)

on_system_prompt (agent_control/both):
  追加: "You have a memory_search tool..."

list_tools (agent_control/both):
  返回 [memory_search 工具]
  (没有 add 工具 — 写回是全自动的)
```

### 关键设计：增量写回

```python
# 不是每次把整个 context 发给 ReMe
pre_ids = {m.id for m in agent.state.context}  # 本轮开始前的消息 ID

# ... agent 执行 ...

# 只取本轮新增的消息
increment = [m for m in agent.state.context 
             if m.id not in pre_ids 
             and m.name != "memory"]  # 排除自己注入的记忆提示

# 发给 ReMe 的只是增量
await reme.auto_memory(messages=increment, session_id=session_id)
```

---

## 五、AgenticMemory 方案

### 与其他方案的本质不同

Mem0 和 ReMe 是"**系统自动管理记忆**"——中间件自动写回、自动检索、自动注入。

AgenticMemory 是"**Agent 自己管理记忆**"——中间件只做两件事：
1. 把 `MEMORY.md` 注入 system prompt
2. 异步检索相关 topic 文件注入 context

Agent 通过 `Write` 工具自己创建 memory 文件。

### 流程

```
on_system_prompt:
  1. 确保 Memory/ 目录存在
  2. 读取 MEMORY.md 内容
  3. 如果超过 memory_max_tokens → 截断 + 提醒
  4. 拼接: memory_instructions + MEMORY.md → system prompt

  其中 memory_instructions 包含:
    - 4 种记忆类型 (user/feedback/project/reference)
    - 保存规范 (YAML frontmatter)
    - 检索指南 (grep MEMORY.md)
    - 什么不该保存

on_reply:
  1. 提取用户输入
  2. 异步启动 retrieve_relevant_files(agent, query):
     a. 扫描 Memory/ 下所有 .md 文件
     b. 解析 frontmatter (description, type)
     c. LLM 选择最相关的 ≤5 个文件
     d. 读取文件内容 (每文件 ≤ retrieval_max_tokens_per_md)
     e. 返回格式化的检索结果
  3. 透传事件
  4. finally: 取消未完成任务

on_reasoning:
  轮询检索任务 → 完成则注入 HintBlock
```

### 4 种记忆类型

| 类型 | 用途 | 示例 |
|------|------|------|
| `user` | 用户角色/偏好/知识 | "用户是数据科学家，关注日志系统" |
| `feedback` | 用户对 Agent 行为的纠正/确认 | "不要 mock 数据库，上次因此出过事故" |
| `project` | 项目上下文/决策/约束 | "合并冻结直到 3 月 5 日移动端发版" |
| `reference` | 外部系统指针 | "Pipeline bug 在 Linear 项目 INGEST 中追踪" |

---

## 六、RAGMiddleware（知识库检索）

与记忆系统不同的是，RAG 检索的是**文档知识库**，不是对话历史。

```
on_reply:  缓存用户输入 blocks
on_reasoning (static 模式, cur_iter==0):
  1. 用缓存的输入搜索所有 KnowledgeBase
  2. 合并结果、排序、截断 top_k
  3. 注入 HintBlock 到 context
  4. 可选 emit HintBlockEvent (前端展示匹配片段)
  
  默认 persist_hint=False: 本轮推理后自动删除 HintBlock
                          (避免多轮累积)

list_tools (agentic 模式):
  返回 [search_knowledge 工具]
  工具动态生成 description (列出所有 KB 名称和描述)
  工具动态生成 input_schema (knowledge_bases 参数的 enum 为当前 KB 列表)
```

---

## 七、对 MorPex 的借鉴

### 当前 MorPex 记忆

```
MemoryBus (三维一体):
  - remember() → ZVecStorage (向量)
  - 手动触发
  - 无自动写回
  - 无 Agent 中间件接入
```

### 建议改进（按优先级）

| # | 借鉴 | AgentScope 来源 | 基于 pi 的什么 |
|:--|:--|:--|:--|
| 1 | **自动写回** — 每轮对话自动 `remember()` | Mem0/ReMe 的 on_reply finally | `harness.subscribe()` 监听 `agent_end` |
| 2 | **on_reasoning 注入** — 相关记忆自动注入上下文 | 三个方案的 on_reasoning | `harness.on('context')` 修改 messages |
| 3 | **Agentic 模式** — Agent 通过工具自己管理记忆 | AgenticMemory | `CustomAgentMessages` + `convertToLlm` |
| 4 | **增量写回** — 只写本轮新增，不写全量 | ReMe 的 pre_ids diff | `harness.on('message_end')` 收集增量 |
| 5 | **命名空间隔离** — user_id/agent_id/session_id | Mem0 的 filter 机制 | `CustomAgentMessages` 元数据 |

### 最小实现路径

```
Step 1: 在 harness.subscribe() 中监听 agent_end
        → 提取本轮 user/assistant 消息对
        → 调用 MemoryBus.remember()

Step 2: 在 harness.on('context') 中
        → 用当前用户输入搜索 MemoryBus.recall()
        → 注入为 HintBlock (通过 CustomAgentMessages)

Step 3: 提供 memory_search / memory_add 工具
        → Agent 可通过工具调用主动管理记忆
```
