# Prompts Integration Audit — Leader → Expert → Fork 三级分封架构

> 审计 `packages/core/` 中所有与三级分封架构、系统提示词、AgentCreate、ForkExecute 相关的现有实现。
> 结论：**现有代码已实现 70% 的底层机制，但缺少提示词文件 + AgentCreate/ForkExecute 工具 + 串联注入。**

---

## Result

- **Status**: Complete. Produced full mapping and integration plan.
- **Changes**: No changes made in this audit pass.
- **Confidence**: High. All findings grounded in exact codebase paths.
- **Caveat**: The AgentCreate tool at `DomainCluster.spawnSubAgent()` exists as a programmatic API but has no LLM-facing `AgentTool` wrapper. ForkExecute has no semantic wrapper at all — `ToolExecutionProxy` is infrastructure-level only.

---

## Output

### 1. Existing Three-Tier Mapping

| Tier | Ring | Code Module | LLM Instance | Prompt Source |
|:--|:--|:--|:--|:--|
| **Leader** | Ring 0 | `CrossDomainRouter` + `DomainClusterManager` + `FSMEngine` | No dedicated AgentHarness — uses `LLMProvider.get()` for raw LLM calls | `DECOMPOSITION_SYSTEM_PROMPT` (hardcoded in CrossDomainRouter.ts) |
| **Expert** | Ring 1 | `DomainCluster.master` (AgentHarness) | One per registered domain | `DomainManifest.master_agent_config.system_prompt` (from JSON manifest) |
| **Fork** | Ring 2 | `ToolExecutionProxy` (worker_threads) | No LLM — pure code executor | None needed (no LLM context) |

**Concrete flow today:**
```
User Input
  │
  ▼
CrossDomainRouter (LLMProvider.get())    ← Ring 0: raw LLM call
  │  DECOMPOSITION_SYSTEM_PROMPT
  ├──→ DomainCluster.execute() → AgentHarness.prompt()    ← Ring 1
  │      systemPrompt from manifest
  │         └──→ ToolExecutionProxy.execute()             ← Ring 2
  │                worker_threads
  └──→ DAGEngine / DomainDispatcher
```

**Gap 1**: Leader has no AgentHarness instance — it's just raw `LLMProvider.get()` calls. No `harness.subscribe()`, no `harness.steer()`, no tool loop.

**Gap 2**: The "Leader system prompt" doesn't exist as a configurable template. It's split across `DECOMPOSITION_SYSTEM_PROMPT` and `INTENT_MATCH_SYSTEM_PROMPT`.

---

### 2. Prompt Injection Points

#### Existing (already have a prompt)

| Location | Variable/Method | What it prompts | Source |
|:--|:--|:--|:--|
| `CrossDomainRouter.ts` | `DECOMPOSITION_SYSTEM_PROMPT` | DAG route decomposition | L26-46, hardcoded string |
| `CrossDomainRouter.ts` | `buildRoutingPrompt()` | Unified route dispatch | L140-175, dynamic assembly |
| `DomainClusterManager.ts` | `INTENT_MATCH_SYSTEM_PROMPT` | Intent-to-domain matching | L202-220, static template |
| `DomainCluster.ts` | `wake()` | Master Agent systemPrompt | `manifest.master_agent_config.system_prompt` |
| `DomainCluster.ts` | `decomposeSingleIntent()` | Domain-internal task decomposition | Inline LLM prompt |
| `DomainCluster.ts` | `decomposeSubIntent()` | Domain sub-task extraction | Inline LLM prompt |

#### Missing (need new prompts)

| Missing Prompt | Where it would be used | Purpose |
|:--|:--|:--|
| **Leader Ring 0 prompt** | CrossDomainRouter / FSMEngine's central orchestrator | Full role definition with privilege isolation, AstroM trace format, security redlines |
| **Expert Ring 1 prompt (enhanced)** | DomainCluster's `buildSubAgentPrompt()` | Lazy VFS, ForkExecute, dirty log blocking, cross-domain TeamSay |
| **AgentCreate tool description** | New AgentCreate AgentTool wrapper | LLM-facing tool to spawn experts |
| **ForkExecute tool description** | New ForkExecute AgentTool wrapper | LLM-facing tool to spawn isolated workers |

---

### 3. Missing Tools

#### AgentCreate — NOT YET an AgentTool

The backend capability exists but has no LLM-facing wrapper:

**Exists**: `DomainCluster.spawnSubAgent(params)` (added in Phase 3.1, v2.4)
- File: `packages/core/domains/DomainCluster.ts` L251-330
- Parameters: `{ name, description, prompt, harness }`
- Returns a new `AgentHarness` with Cgroup quota check + tool inheritance

**Missing**: An `AgentTool` class that wraps `spawnSubAgent` so the Leader LLM can call it via tool_call mechanism.

**Required interface**:
```typescript
class AgentCreateTool implements AgentTool {
  name = 'AgentCreate';
  description = '派生一个二级领域专家智能体，挂载双层 VFS';
  parameters = Type.Object({
    domain: Type.String({ description: '目标领域 ID' }),
    expert_name: Type.String({ description: '专家名称' }),
    goal: Type.String({ description: '任务目标描述' }),
    vfs_mount_uri: Type.Optional(Type.String({ description: '产物 URI 摘要' })),
  });
}
```

#### ForkExecute — NOT YET an AgentTool

**Exists**: `ToolExecutionProxy.execute(toolCallId, toolName, args, workingDir, onProgress)`
- File: `packages/core/tool/ToolExecutionProxy.ts`
- Uses `worker_threads` with timeout/memory limits

**Missing**: An `AgentTool` wrapper that lets Expert LLMs spawn Fork workers for dirty work.

**Required interface**:
```typescript
class ForkExecuteTool implements AgentTool {
  name = 'ForkExecute';
  description = '派生出无状态短命执行肢（Fork）执行高风险任务，通过 IPC 接收进度';
  parameters = Type.Object({
    script_type: Type.String({ description: '脚本类型: bash | javascript | frida_js' }),
    payload: Type.String({ description: '执行负载内容或 base64' }),
    timeout_ms: Type.Optional(Type.Number({ description: '超时毫秒' })),
  });
}
```

---

### 4. Defense Mechanisms ↔ Prompt References

| Defense Mechanism | Code Location | How Prompt References It |
|:--|:--|:--|
| **PermissionEngine** | `permission/PermissionEngine.ts` | "Ring privilege isolation" — Leader cannot call Bash/Write directly |
| **ToolExecutionProxy** | `tool/ToolExecutionProxy.ts` | "Fork dies after execution, isolated worker_threads" |
| **ToolResultOffloader** | `tool/ToolResultOffloader.ts` | "Dirty log blocking" — >10K char results offloaded to file |
| **CompactionPolicy** | `compaction/CompactionPolicy.ts` | "Context attention preservation" — auto-trigger harness.compact() |
| **EventStore** | `event/EventStore.ts` | "State snapshot for SUSPENDED" — replayable JSONL events |
| **ToolCallTracker** | `tool/ToolCallTracker.ts` | "PENDING→ASKING→ALLOWED→EXECUTING→FINISHED" state machine |
| **extractJson (L3)** | `utils/extractJson.ts` | "Self-healing parser — Level 2 truncation + Level 3 LLM retry" |

**Mapping completeness**: All 7 defense mechanisms are explicitly referenced in the prompt design. No changes needed in defense code.

---

### 5. Integration Plan

#### File Structure

```
packages/core/prompts/
├── index.ts                 ← barrel export
├── prompt-types.ts          ← PromptTemplate, AstroMTrace interfaces
├── leader-prompt.ts         ← Ring 0 Leader system prompt template
└── expert-prompt.ts         ← Ring 1 Expert system prompt template

packages/core/tool/
├── AgentCreateTool.ts       ← NEW: AgentTool wrapping spawnSubAgent
├── ForkExecuteTool.ts       ← NEW: AgentTool wrapping ToolExecutionProxy
├── TeamSayTool.ts           ← Existing
├── ReadArtifactTool.ts      ← Existing
└── ToolExecutionProxy.ts    ← Existing

packages/core/domains/
├── DomainCluster.ts         ← MODIFY: inject expert prompt into spawnSubAgent
└── ...

packages/core/router/
├── CrossDomainRouter.ts     ← MODIFY: inject leader prompt into dispatch
└── ...
```

#### Prompt Loading Strategy

**Leader prompt**: Template with `{availableDomains}` and `{timestamp}` placeholders, loaded by CrossDomainRouter at runtime and composed into the LLM call.

**Expert prompt**: Two layers:
1. Base expert system prompt (from prompt template) — role definition, behavioral rules
2. Domain-specific system prompt (from manifest) — domain knowledge

Combined in `DomainCluster.wake()` → `buildSubAgentPrompt()`.

#### Wiring Changes

| File | Change | Impact |
|:--|:--|:--|
| `CrossDomainRouter.ts` | `buildRoutingPrompt()` → prepend Leader prompt template | Route dispatch uses Ring 0 prompt |
| `DomainCluster.ts` | `buildSubAgentPrompt()` → prepend Expert prompt template before domain prompt | All spawned experts get Ring 1 rules |
| `DomainCluster.ts` | `buildSubAgentPrompt()` → inject AgentCreateTool + ForkExecuteTool into allowed tools | Experts can spawn Forks but not create other experts |
| CrossDomainRouter dispatch | Inject AgentCreateTool into Leader's available tools | Leader can call `AgentCreate` as a tool |

---

### 6. AstroM Trace Injection Points

The `astro_m_trace` structure needs to be emitted alongside every cross-boundary message. Existing emission points:

| Emission Point | Current Behavior | AstroM Injection Strategy |
|:--|:--|:--|
| `EventBus.emitToDomain()` | Inject `sourceZone`/`targetZone` | Already has zone metadata (v2.4 Phase 5.1) |
| `EventBus.broadcastCrossDomain()` | Inject zone metadata | Already has zone metadata |
| `CrossDomainRouter.dispatch()` | LLM returns JSON with tasks | Add `astro_m_trace` to the JSON output format |
| `DomainCluster.execute()` | Sends message to Master Agent | Wrap with trace metadata before `harness.prompt()` |
| `TeamSayTool.execute()` | `harness.steer(message)` | Inject trace into the steer message |
| `NegotiationEngine.createTicket()` | Creates ticket | Add trace to ticket metadata |
| `FSMEngine.feed()` | State transition | Emit astro_m_trace via EventBus on every transition |

**AstroM Trace structure** (defined in prompt-types.ts):
```typescript
interface AstroMTrace {
  traceId: string;
  sourceZone: string;
  targetZone: string;
  contentType: 'json_dag' | 'code_diff' | 'artifact_summary' | 'negotiation' | 'error';
  timestamp: number;
}
```

---

## Evidence

| Finding | Path + Anchor | Why it matters |
|:--|:--|:--|
| Leader uses raw LLM, not AgentHarness | `CrossDomainRouter.ts` L102: `LLMProvider.get()(prompt)` | No tool loop, no state machine integration |
| Expert prompt source | `DomainCluster.ts` L183: `systemPrompt: this.manifest.master_agent_config.system_prompt` | Expert prompt is entirely domain-configurable |
| spawnSubAgent exists | `DomainCluster.ts` L256: `async spawnSubAgent(params)` | Backend capability ready, no AgentTool wrapper |
| ToolExecutionProxy infrastructure | `ToolExecutionProxy.ts` L1-127 | Worker isolation exists, no LLM-facing tool |
| DECOMPOSITION_SYSTEM_PROMPT hardcoded | `CrossDomainRouter.ts` L26-46 | Leader prompt is inline, not reusable |
| INTENT_MATCH_SYSTEM_PROMPT hardcoded | `DomainClusterManager.ts` L202-220 | No AstroM trace format included |
| Zone injection already done | `EventBus.ts` L249-250: `(event as any).sourceZone = ...` | Phase 5.1 completed, AstroM trace can leverage it |
| SUSPENDED state ready | `FSMEngine.ts` TRANSITIONS: `SUSPENDED: { user_input: 'RUNNING', resume: 'RUNNING' }` | HITL redline in prompt maps to code |
| Cgroup quota check | `DomainCluster.ts` L267: Token quota check in spawnSubAgent | Prevents LLM from spawning unlimited experts |

---

## Learnings

- **Learning**: The Leader (CrossDomainRouter) currently has **no AgentHarness loop** — it's a one-shot LLMProvider call. This means the Leader cannot use tools like AgentCreate directly. To make AgentCreate work as a tool call, the Leader must be upgraded to use AgentHarness.
  - Evidence: `CrossDomainRouter.ts` L102 uses `LLMProvider.get()(prompt)` not `harness.prompt()`
  - Reuse when: Planning Leader upgrades that need tool loops.

- **Learning**: `DomainCluster.spawnSubAgent()` is the correct backend for AgentCreate, but it currently returns an `AgentHarness` object. For it to work as a tool, the AgentHarness needs to be registered somewhere (e.g., DomainClusterManager) so the Leader can later dispatch tasks to it.
  - Evidence: `DomainCluster.ts` L256-330 shows the method creates and returns a harness but does not register it.
  - Reuse when: Implementing AgentCreateTool.

- **Learning**: The defense mechanisms (PermissionEngine, ToolExecutionProxy, etc.) are well-aligned with the prompts. No changes needed in defense code — only in how they're referenced in prompts and how tools are exposed to LLMs.
  - Evidence: Mapping in section 4 above.
  - Reuse when: Validating prompt-code alignment.

- **Learning**: `packages/core/index.ts` already has a pattern for exporting v2.4 modules. New prompt files and tools should follow the same `export { X } from './path/X.js'` pattern.
  - Evidence: `index.ts` L85+ shows the v2.4 export block.
  - Reuse when: Adding exports for new modules.
