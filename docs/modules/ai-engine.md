# 模块名称：AI 推理引擎模块

> 路径: `packages/ai/` | 外部包: `@earendil-works/pi-agent-core` + `@earendil-works/pi-ai` | 版本: ^0.79

---

## 1. 模块职责 (Responsibility)

### 本模块负责

| 职责 | 说明 |
|------|------|
| **LLM 模型调用** | 通过 pi-ai 调用 DeepSeek/OpenAI：stream / complete / getModel |
| **Agent 运行时** | 通过 pi-agent-core 执行 Agent 循环：runAgentLoop / Session 管理 |
| **对话压缩** | 长对话自动总结与压缩（compaction / branch-summarization） |
| **技能加载** | 从 `data/skills/` 加载 SKILL.md 并注入 system prompt |
| **提示词模板** | 管理与渲染 prompt templates |
| **会话持久化** | JSONL 格式的会话存储与恢复 |

### 本模块【绝不】负责

| 不负责                         | 正确归属                                                               |
| --------------------------- | ------------------------------------------------------------------ |
| ❌ 业务编排（何时调用 LLM、调用哪个 Agent） | `packages/core/` — AgentOrchestrator / FSMEngine / LLMBridge       |
| ❌ HTTP 服务 / REST API        | `packages/studio/server/` — StudioServer                           |
| ❌ 事件总线通信                    | `packages/core/core/EventBus.ts`                                   |
| ❌ 向量存储 / 语义搜索               | `packages/core/planes/knowledge-plane/memory/VectorStore.ts`       |
| ❌ 知识图谱构建                    | `packages/core/planes/knowledge-plane/knowledge/KnowledgeGraph.ts` |
| ❌ Embedding 模型推理            | `tools-python/embedding-server.py`                                 |

---

## 2. 文件结构树 (File Structure)

```text
# 注意：packages/ai/ 本地副本已删除
# 以下为外部包 @earendil-works 的目录结构（node_modules/@earendil-works/）

@earendil-works/pi-agent-core/      # Agent 运行时核心 (npm v0.79.10)
│   ├── dist/index.js               # 入口
│   ├── dist/agent.js               # Agent / PiAgent 类
│   ├── dist/agent-loop.js          # Agent 执行循环 (runAgentLoop)
│   ├── dist/base.js                # 基础类型
│   ├── dist/node.js                # Node.js 环境适配 (NodeExecutionEnv)
│   ├── dist/proxy.js               # 代理支持
│   ├── dist/types.d.ts             # TypeScript 类型定义
│   │
│   └── dist/harness/               # Agent 运行时组件
│       ├── agent-harness.js        # 运行时管理器 (AgentHarness)
│       ├── messages.js             # 消息处理
│       ├── skills.js               # 技能加载 (loadSkills)
│       ├── system-prompt.js        # 系统提示词构建
│       ├── prompt-templates.js     # 提示词模板 (loadPromptTemplates)
│       ├── types.js                # 运行时类型
│       │
│       ├── session/                # 会话管理
│       │   ├── session.js          # Session 类
│       │   ├── jsonl-repo.js       # JSONL 存储库 (JsonlSessionRepo)
│       │   ├── jsonl-storage.js    # JSONL 存储引擎
│       │   ├── memory-repo.js      # 内存存储库 (测试用)
│       │   ├── memory-storage.js   # 内存存储引擎
│       │   ├── repo-utils.js       # 仓库工具
│       │   └── uuid.js             # UUID 生成
│       │
│       ├── compaction/             # 对话压缩/总结
│       │   ├── compaction.js       # 对话压缩 (generateSummary)
│       │   ├── branch-summarization.js # 分支总结
│       │   └── utils.js            # 压缩工具
│       │
│       └── env/                    # 环境适配
│           └── nodejs.js           # Node.js 环境实现
│
@earendil-works/pi-ai/              # AI 模型调用 (npm v0.79.10)
    ├── dist/index.js               # 入口
    ├── dist/base.js                # 基础类型
    ├── dist/api-registry.js        # API 注册表
    ├── dist/models.js              # 模型定义
    ├── dist/models.generated.js    # 自动生成的模型列表
    ├── dist/cli.js                 # CLI 支持
    ├── dist/env-api-keys.js        # 环境变量 API 密钥读取
    ├── dist/image-models.js        # 图像模型
    └── dist/oauth.js               # OAuth 支持
```

---

## 3. 架构与数据流程 (Architecture & Flow)

### 3.1 模块分层

```
┌─────────────────────────────────────────────────────┐
│  MorPexCore 消费层 (packages/core/)                   │
│  LLMBridge / FSMEngine / AgentOrchestrator           │
│  → 监听 EventBus → 调用 AI 引擎                      │
└──────────────────────┬──────────────────────────────┘
                       │ 方法调用
                       ▼
┌─────────────────────────────────────────────────────┐
│  pi-ai (模型调用层)                                   │
│                                                      │
│  getModel()    → 获取模型配置 (deepseek-v4-flash 等) │
│  stream()      → 流式调用 LLM (逐 token 返回)        │
│  complete()    → 完整调用 LLM (一次性返回)            │
│  getProviders()→ 获取所有 LLM 提供商                  │
│  parseJsonWithRepair() → JSON 解析+修复               │
│  clampThinkingLevel() → 推理深度限制                   │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP API
                       ▼
┌─────────────────────────────────────────────────────┐
│  LLM API (外部)                                      │
│  DeepSeek / OpenAI / Bedrock / 自定义                │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  pi-agent-core (Agent 运行时层)                       │
│                                                      │
│  Agent / PiAgent    → Agent 对象                     │
│  runAgentLoop()     → Agent 执行循环                  │
│  Session            → 会话管理                        │
│  JsonlSessionRepo   → 会话持久化 (JSONL)              │
│  loadSkills()       → 技能文件加载                    │
│  loadPromptTemplates() → 提示词模板加载                │
│  generateSummary()  → 对话总结                        │
└─────────────────────────────────────────────────────┘
```

### 3.2 LLMBridge → pi-ai 调用链

```
LLMBridge (packages/core/LLMBridge.ts)
  │
  ├── 1. 监听 EventBus 事件:
  │      - "llm.request"          → 用户 LLM 请求
  │      - "intent.llm.request"   → 意图分类 LLM 请求
  │      - "tool.request"         → 工具调用请求
  │      - "tool.response"        → 工具返回结果
  │
  ├── 2. 调用 pi-ai (主路径):
  │      try {
  │        result = await callPiAi(prompt, systemPrompt)
  │        // 使用 pi-ai.stream() 获得流式 + usage
  │        for await (const event of stream) {
  │          emit('llm.text_delta', { requestId, delta: event.delta })
  │        }
  │      } catch {
  │        // 降级路径
  │        result = await callFetch(prompt, systemPrompt)
  │        // fetch 直连 DeepSeek/OpenAI API
  │      }
  │
  └── 3. 返回结果到 EventBus:
        emit("llm.response", { requestId, text, usage })
```

### 3.3 Agent 执行循环

```
Agent 创建
  │
  └── runAgentLoop()
        │
        ├── turn_start       → 开始一轮对话
        │     ├── 构建 system prompt (skills + templates)
        │     ├── 构建 messages (会话历史 + 新消息)
        │     └── 调用 LLM
        │
        ├── text_delta       → 逐 token 流式输出
        │
        ├── tool_execution_start → LLM 决定调用工具
        │     └── 执行工具 → 获取结果
        │
        ├── tool_execution_end   → 工具结果返回 LLM
        │
        ├── turn_end         → 本轮结束，保存到 Session
        │
        └── agent_end        → Agent 完成
              └── 触发 compaction (如有需要)
```

### 3.4 降级策略

```
pi-ai.stream()
  ├── 可用 → 返回 AsyncIterable<StreamEvent>
  │           ├── text_delta (逐 token)
  │           └── 最终 result() → { text, usage }
  │
  └── 不可用 (import 失败 / 运行时异常)
       └── fetch 直连
            ├── DEEPSEEK_API_KEY 存在 → https://api.deepseek.com/v1/chat/completions
            ├── OPENAI_API_KEY 存在   → https://api.openai.com/v1/chat/completions
            └── 都不存在 → 抛出错误
```

---

## 4. 接口与契约 (API & Contracts)

### 4.1 pi-ai — stream()

**输入契约**:

```typescript
import { getModel, stream } from 'pi-ai';

const model = getModel('deepseek', 'deepseek-v4-flash');

const streamResult = stream(model, {
  systemPrompt: string;           // 系统提示词
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
  }>;
}, {
  maxTokens?: number;             // 默认 4096
  temperature?: number;           // 默认 0.7
});
```

**输出契约**:

```typescript
// 逐 token 消费
for await (const event of streamResult) {
  // event.type: 'text_delta' | 'tool_call' | 'error'
  // event.delta: string
}

// 获取最终结果 (含 usage)
const msg = await streamResult.result();
// msg.text: string
// msg.usage: { input: number, output: number, totalTokens: number, cost: { total: number } }
```

**异常契约**:

| 场景 | 行为 |
|------|------|
| API Key 未设置 | `throw new Error('No API key found for provider deepseek')` |
| 网络超时 | `throw new Error('Request timeout')` |
| API 返回 4xx/5xx | `throw new Error('API error: ${status} ${body}')` |

### 4.2 pi-agent-core — Session

**输入契约**:

```typescript
import { JsonlSessionRepo } from 'pi-agent-core';

const repo = new JsonlSessionRepo({
  sessionsRoot: string;  // 如 './data/sessions'
});

// 创建会话
const session = await repo.create({
  cwd: string;           // 工作目录
});

// 追加消息
const entryId = await session.appendMessage({
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
});
```

**输出契约**:

```typescript
// 构建 LLM 上下文
const ctx = await session.buildContext();
// ctx.messages: Message[]     — 对话历史
// ctx.thinkingLevel: number   — 推理深度
// ctx.model: string           — 模型名

// 分支
const branch = await session.getBranch();
// branch: { id, parentId, messages, createdAt }

// 列出会话
const sessions = await repo.list();
// sessions: Array<{ id, cwd, createdAt, messageCount }>
```

**异常契约**:

| 场景 | 行为 |
|------|------|
| sessionsRoot 不可写 | `throw new Error('Cannot write to sessions root: ${path}')` |
| 会话 ID 不存在 | `throw new Error('Session not found: ${id}')` |
| JSONL 文件损坏 | 跳过损坏行，输出 warning，继续读取有效行 |

### 4.3 pi-agent-core — loadSkills

**输入契约**:

```typescript
import { loadSkills } from 'pi-agent-core';

const skills = await loadSkills({
  skillsRoot: string;  // 如 './data/skills'
});
```

**输出契约**:

```typescript
// skills: Skill[]
interface Skill {
  name: string;
  category: string;
  description: string;
  content: string;          // SKILL.md 正文
  frontmatter: Record<string, any>;  // YAML frontmatter
}

// 格式化到 system prompt
const formatted = skills.map(s => s.formatForSystemPrompt()).join('\n');
```

---

## 5. 已知 Bug 墙与回归测试 (Bug Wall & Regression)

### Bug #001 — 流式响应中断后 Session 状态不一致

**症状**: `pi-ai.stream()` 在传输中途因网络断开而中断，但 `session.appendMessage()` 未被调用，导致对话气泡只显示一半，刷新后丢失。

**根因**: `packages/core/LLMBridge.ts` — 流式 text_delta 直接通过 SSE 推到前端，但只有 `llm.response` 时才写入 session。如果流中断，前端有显示但无持久化。

**复现条件**: 长文本生成中强制断开网络。

**修复方案**: 在 `llm.response` 之前缓存所有 delta，流完成后一次性写入 session。或流中断时用已收到的 delta 拼接成 partial message 写入。

**回归测试**: `scripts/e2e-real-llm.ts` 中模拟中途断开 SSE 连接，验证刷新后消息不丢失。

---

### Bug #002 — Compaction 触发后旧消息仍占用上下文

**症状**: `generateSummary()` 执行后，摘要替换了历史消息，但 `session.buildContext()` 返回的 messages 数组仍包含被压缩前的原始消息（token 数未减少）。

**根因**: `@earendil-works/pi-agent-core/dist/harness/compaction/compaction.js` — 压缩操作只写入了 summary entry，但未标记原始消息为"已压缩"，`buildContext()` 仍将两者都包含。

**复现条件**: 长对话超过 token 限制时触发压缩，检查 `buildContext()` 返回的实际 token 数。

**修复方案**: 在 compaction 时为原始消息添加 `compacted: true` 标记，`buildContext()` 排除已压缩消息。

**回归测试**: 创建超长对话 → 触发 compaction → 验证 `buildContext()` 返回的 token 数下降至阈值以下。

---

### Bug #003 — 技能文件解析失败静默跳过

**症状**: `data/skills/` 下 SKILL.md 的 YAML frontmatter 格式错误时，`loadSkills()` 静默跳过该文件，不报告错误。用户不知道技能未加载。

**根因**: `@earendil-works/pi-agent-core/dist/harness/skills.js` — YAML 解析异常被 catch 后只 `console.warn`，不向上抛出或收集。

**复现条件**: 创建一个 frontmatter 格式错误的 SKILL.md，检查 `loadSkills()` 返回结果。

**修复方案**: 收集解析失败的文件路径列表，通过返回值或事件上报：
```typescript
const result = await loadSkills({ skillsRoot });
// result.skills: Skill[]
// result.errors: Array<{ path: string, error: string }>
```

**回归测试**: 加载包含一个正常和一个损坏 SKILL.md 的目录，验证 result.errors 包含损坏文件信息。

---

> **注意**: 本模块为外部包（`@earendil-works`），源码不在此仓库中直接维护。Bug 修复需向上游提交 PR 或在本仓库中进行 monkey-patch。修改 `packages/core/LLMBridge.ts` 中的调用方式是本项目的可控范围。
