# MorPex 模型配置与试跑指南

> 创建: 2026-08-08（会话 16l·7b）| 目的: 消除「模型切换 / LLM 试跑 / embedding 配置」的运行盲区。
> **config 是模型唯一来源**（铁律：不硬编码模型名）；本文件说明如何配置与验证。

---

## 1. 模型配置总览

| 配置文件 | 控制什么 | 说明 |
|---|---|---|
| `config/morpex.yaml` | **LLM 主模型**（规划/执行/审计/评价） | 唯一模型来源 |
| `config/embeddingconfig.yaml` | **Embedding + Rerank**（RAG 检索） | SiliconFlow，仅检索用 |
| `.env` | API Key（`GLM_API_KEY` / `OPENCODE_API_KEY` 等） | 敏感值不写明文 |

## 2. LLM 主模型（config/morpex.yaml）

`morpex.yaml` 的 `llm:` 块支持**两种模式**：

```yaml
llm:
  mode: builtin          # builtin=pi-ai 内置 provider | gateway=OpenAI 兼容网关
  enabled: true
  provider: opencode     # builtin: pi-ai 内置 provider id；gateway: 自定义标识
  model: deepseek-v4-flash-free   # 模型名
  baseUrl: https://opencode.ai/zen/v1        # gateway 模式: 网关 baseUrl
  apiKey: ${OPENCODE_API_KEY}                # 支持 ${VAR} 环境变量引用
  contextWindow: 200000
  maxTokens: 128000
```

### 模式说明

- **builtin（默认）**：用 pi-ai 内置 provider（opencode 等）。apiKey 注入 `process.env.<PROVIDER>_API_KEY` 供内置 provider 鉴权。
- **gateway**：自定义 OpenAI 兼容网关（智谱 GLM / 其他）。`baseUrl` 指向网关 `/v1`。

### 切换示例（opencode ↔ GLM）

**切到智谱 GLM**：
```yaml
mode: gateway
provider: zhipu-glm
model: glm-4-flash-250414      # 智谱 flash 模型（稳定无限流）
baseUrl: https://open.bigmodel.cn/api/paas/v4
apiKey: ${GLM_API_KEY}
```

> ⚠️ GLM-4-Flash-250414 是**较老模型，函数调用支持弱**（空参率高）——已用 MorPex 通用空参保险（prepareArguments）缓解，但复杂任务仍建议 opencode。
> ⚠️ GLM 4.7/5.x 函数调用成熟但需付费资源包（429「余额不足」）。

### 附加模型（llm_* 块，多模型并存）

除 `llm:` 主模型外，可在 `config/morpex.yaml` 追加**任意多个** `llm_<name>:` 顶层块（与 `llm:` 平级、复用相同 schema）作为**附加可选模型**。主模型（`llm:`）始终是默认，附加模型用 `"provider/model"` 完整标识显式选择，互不影响。

**当前主模型：Agnes 2.5 Flash**（OpenAI 兼容云端模型，智能体工作流/工具调用优化）：

```yaml
llm:
  mode: gateway
  enabled: true
  provider: agnes            # 运行时模型标识（agnes/agnes-2.5-flash）
  model: agnes-2.5-flash
  baseUrl: https://api.agnes-ai.cn/v1
  apiKey: ${AGNES_API_KEY}   # 环境变量 AGNES_API_KEY（Windows 用户级兑底）
  contextWindow: 524288      # 512K
  maxTokens: 65536           # 65.5K 最大输出
  reasoning: false           # 默认不强制 thinking（可用 chat_template_kwargs.enable_thinking）
```

**附加模型：本地 MiniCPM5-1B**（OpenAI 兼容网关，思考型）：

```yaml
llm_minicpm:
  mode: gateway
  enabled: true
  provider: minicpm
  model: minicpm5
  baseUrl: http://127.0.0.1:8080/v1
  apiKey: ${MINICPM_API_KEY}
  contextWindow: 131072      # 128K / 1 槽
  maxTokens: 32000
  reasoning: true
```

- 本地服务启动：`D:\llama_cpp\start-api.bat`（详见 `D:\llama_cpp\API接入文档.md`）。
- **选择模型**：业务代码调用 `generateText({ model: 'agnes/agnes-2.5-flash' | 'minicpm/minicpm5', ... })` 即可（PiBridge `parseModel` 支持 `provider/model`）。不指定 model 时仍走 `llm:` 默认模型。
- **发现路径**：`model-registry` / `model-resolver` 已从 config 构建附加模型，`listProviders` / `listModels` / `findModel` 可见。
- **禁用**：`enabled: false` 或缺 `provider/model/baseUrl` 的附加块自动跳过注册。
- **约定**：`llm_*` 块由 `yamlConfig.loadMorpexConfig` 解析为 `extraLlms`，PiBridge `init()` 在 builtin 基底上叠加注册（`setProvider`），单块失败不阻断主流程。

### 验证配置

```bash
npx tsx scripts/check-llm.ts   # 打印配置解析 + 网关连通性
```

## 3. Embedding / Rerank（config/embeddingconfig.yaml）

```yaml
embedding:
  enabled: true
  apiKey: ${SILICONFLOW_API_KEY}   # SiliconFlow
  baseUrl: https://api.siliconflow.cn/v1
  model: BAAI/bge-m3                # 向量（1024 维）
  rerankerEnabled: true
  rerankerModel: BAAI/bge-reranker-v2-m3
  rerankerTopN: 12
```

- 检索流水线：Dense(bge-m3 向量余弦) + Sparse(BM25) → RRF 融合 → Cross-Encoder(bge-reranker) 精排。
- `enabled: false` / 缺 apiKey → 回退仅 Sparse(BM25) + 确定性领域/新鲜度（无外部依赖）。
- ⚠️ `parseYaml` 仅支持 2 层嵌套（勿加第 3 层）。

## 4. LLM 批量试跑（scripts/batch-run.ts）

```bash
# 基本：跑前 N 个任务（默认 5 并发）
npx tsx scripts/batch-run.ts --limit 10

# 防 OOM（必须）：--trace-max 限制每任务 TraceRecorder 记录数（关键教训 #5）
#   TraceRecorder 全量记录每任务 2-8 万调用 → 5 并发可爆 4GB 堆；限 5000 后内存有界
NODE_OPTIONS="--max-old-space-size=8192" npx tsx scripts/batch-run.ts --limit 50 --trace-max 5000

# 并发自适应（内存/限流感知，防 OOM 与限流风暴；显式 --concurrency 时自适应不生效）
npx tsx scripts/batch-run.ts --limit 50 --trace-max 5000 --adaptive

# 限流容错：429/5xx/1305 自动退避重试（GLM 网关限流时建议 --retries 3 --delay 3000）
npx tsx scripts/batch-run.ts --limit 10 --concurrency 3 --retries 3 --delay 2000 --trace-max 5000
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `--limit <n>` | 全部 | 任务数 |
| `--concurrency <n>` | 5 | 并发数 |
| `--adaptive` | 关 | 内存/限流感知自适应并发 |
| `--trace-max <n>` | 5000 | TraceRecorder 每任务最大记录数（防 OOM） |
| `--retries <n>` | 2 | 限流/过载自动重试次数 |
| `--delay <ms>` | 3000 | 任务间退避 |
| `--only <dept>` | - | 只跑某行业 |
| `--exclude <dept>` | - | 排除行业（如 xjmcu 需真实 MCU 硬件） |

### 已知：无法完成的任务
- **「跨境电商物流方案」**（`risk` 标签）：依赖真实世界物流数据/外部 API，知识库查不到 → 多模型多轮次均以「部分步骤失败」失败。**与模型/空参保险无关**，属任务设计问题。

## 5. 模型实测对比（会话 16l·4~16l·7b，供参考）

| 模型 | 规模 | 真实成功率 | 空参 | 限流 | 备注 |
|---|---|---|---|---|---|
| opencode/deepseek-v4-flash-free | 23/50(部分) | 79%(排除限流) | 1 | 频繁(免费额度) | 质量最佳，额度易耗尽 |
| GLM-4-Flash-250414 | 50 轮 | 56% | 7 | 少 | 空参弱点，保险后 9/10 |
| GLM-4-Flash-250414(保险后) | 10 轮 | 9/10 | 0 | 0 | 通用空参保险生效 |

> 失败共性 = 「物流方案」任务（依赖外部数据）；空参保险使 GLM 空参失败 7/50 → 0/10。
