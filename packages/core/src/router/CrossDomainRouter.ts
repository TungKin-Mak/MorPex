/**
 * CrossDomainRouter — 跨领域路由器（v2.4 纯净版）
 *
 * 使用强推理 LLM 分析用户输入，一次调用完成：
 *   1. 领域判定（单领域/多领域）
 *   2. 任务拆解（2-5 个子任务）
 *   3. DAG 拓扑（标注依赖关系）
 *
 * Router 只分析，不执行。通过 ExecutionOrchestrator 串联 Dispatcher。
 * 无降级路径，无后向兼容包装。LLM 调用失败直接 throw。
 *
 * 遵循迁移铁律：
 *   0.4 (删除优先法则): 不对已有 pi 功能做二次封装
 */

import type { DAGNode } from '../domains/types.js';
import { DomainClusterManager } from '../domains/DomainClusterManager.js';
import { LLMProvider } from '../services/LLMProvider.js';
import { extractJson } from '../utils/extractJson.js';
import { compileLeaderPrompt } from '../prompts/leader-prompt.js';
import type { ExecutionDAG } from '../planes/control-plane/orchestrator/ExecutionOrchestrator.js';

// ═══════════════════════════════════════════════════════════════
// Single-Shot LLM 响应结构
// ═══════════════════════════════════════════════════════════════

interface RoutingResponse {
  isMultiDomain: boolean;
  involvedDomains: string[];
  domainDependencies: Array<{ domain: string; dependsOn: string[] }>;
  globalIntent: string;
  tasks: Array<{
    id: string;
    domain: string;
    goal: string;
    deps: string[];
    expected_artifacts?: string[];
  }>;
  reasoning: string;
  needsClarification?: boolean;
  clarificationQuestions?: string[];
}

// ═══════════════════════════════════════════════════════════════
// CrossDomainRouter
// ═══════════════════════════════════════════════════════════════

/**
 * CrossDomainRouter — 跨领域路由器（v2.4 Single-Shot 重构）
 *
 * 单次 LLM 调用同时输出：领域标签 + 意图依赖关系 + DAG 拓扑节点。
 * Router 只分析，不执行。通过 ExecutionOrchestrator 串联 Dispatcher。
 *
 * @example
 * ```typescript
 * const router = new CrossDomainRouter(clusterManager);
 * const dag = await router.dispatch('帮我设计硬件并写推广计划');
 * // dag.nodes → 拓扑排序后的 DAG 节点
 * ```
 */
export class CrossDomainRouter {
  private clusterManager: DomainClusterManager;

  constructor(
    clusterManager: DomainClusterManager,
  ) {
    this.clusterManager = clusterManager;
    // 预热 prompt 模板
    compileLeaderPrompt({
      availableDomains: '{availableDomains}',
      timestamp: Date.now(),
    });
  }

  /**
   * dispatch — 单次 LLM 调用分析输入，产出 ExecutionDAG
   *
   * Single-Shot 全量解析：
   *   1. 领域判定
   *   2. 任务拆解（2-5 子任务）
   *   3. DAG 拓扑标注
   *
   * 快速路径：单领域请求直接使用 LLM 响应中的 tasks，跳过二次 LLM 调用。
   * LLM 调用失败直接 throw，不返回任何 fallback DAG。
   *
   * @param userInput - 用户原始输入
   * @returns ExecutionDAG（供 ExecutionOrchestrator 执行）
   */
  async dispatch(userInput: string): Promise<ExecutionDAG> {
    // 1. 获取领域上下文
    const domainContexts = this.clusterManager.getDomainContextText();

    // 2. 单次 LLM 调用 — Single-Shot 全量解析
    const llmResponse = await LLMProvider.get()(this.buildRoutingPrompt(userInput, domainContexts));
    const response = this.parseResponse(llmResponse, userInput);

    // 3. 构建 DAG 节点
    //    即使 LLM 认为需要澄清（needsClarification），也根据已有信息生成兜底节点。
    //    不要返回空节点数组，否则 @鲁班 等专职 Agent 会拿到空 DAG 卡片。
    const nodes = this.buildNodes(response, userInput);

    return {
      nodes,
      isMultiDomain: response.isMultiDomain ?? false,
      involvedDomains: response.involvedDomains ?? [],
      domainDependencies: response.domainDependencies ?? [],
      globalIntent: response.globalIntent ?? userInput,
      reasoning: response.reasoning ?? '',
    };
  }

  /**
   * buildRoutingPrompt — Single-Shot 路由+拆解一体化 Prompt
   *
   * 一次 LLM 调用同时输出：领域标签 + 任务拆解 + DAG 拓扑。
   */
  private buildRoutingPrompt(input: string, contexts: string): string {
    const leaderBase = compileLeaderPrompt({
      availableDomains: contexts || '无已注册领域',
      timestamp: Date.now(),
    });

    return `${leaderBase}

---
## 用户输入
"${input}"

## 系统指令（v2.4 Single-Shot 全量解析）
你是系统中央路由网关与任务拆解引擎。请完成以下三项任务：

### 任务 1：领域判定
- 判定当前用户输入属于单领域还是多领域协同
- 列出涉及的领域 ID

### 任务 2：任务拆解
- 将用户需求拆解为 2-5 个子任务
- 每个任务必须有明确的 goal 和 domain

### 任务 3：DAG 拓扑
- 标注任务间的依赖关系
- 无依赖的任务可并行执行

### 快速路径规则
- 如果 isMultiDomain=false（单领域），tasks 数组只需包含该领域内的子任务
- 单领域请求不再需要二次 LLM 拆解

### 输出格式
必须严格输出如下 JSON 格式（不要包含其他文字）：
{
  "isMultiDomain": false,
  "involvedDomains": ["domain_id"],
  "domainDependencies": [{"domain": "domain_id", "dependsOn": []}],
  "globalIntent": "宏观意图描述",
  "tasks": [
    {
      "id": "task_0",
      "domain": "domain_id",
      "goal": "子任务目标描述",
      "deps": [],
      "expected_artifacts": ["artifact_type"]
    }
  ],
  "reasoning": "简短的分析理由",
  "needsClarification": false,
  "clarificationQuestions": []
}`;
  }

  /**
   * parseResponse — 解析 LLM JSON 响应
   *
   * 解析失败直接 throw Error，不返回任何 fallback。
   */
  private parseResponse(raw: string, input: string): RoutingResponse {
    const jsonStr = extractJson(raw);
    if (!jsonStr) throw new Error('[CrossDomainRouter] LLM 返回非 JSON 格式，无法解析');

    const data = JSON.parse(jsonStr);

    return {
      isMultiDomain: data.isMultiDomain ?? false,
      involvedDomains: Array.isArray(data.involvedDomains) ? data.involvedDomains : [],
      domainDependencies: Array.isArray(data.domainDependencies) ? data.domainDependencies : [],
      globalIntent: data.globalIntent ?? input,
      tasks: Array.isArray(data.tasks) ? data.tasks : [],
      reasoning: data.reasoning ?? '',
      needsClarification: data.needsClarification ?? false,
      clarificationQuestions: Array.isArray(data.clarificationQuestions) ? data.clarificationQuestions : [],
    };
  }

  /**
   * buildNodes — 从 LLM 响应构建 DAG 节点列表
   *
   * 快速路径：单领域直接使用 tasks 字段，跳过二次 LLM 调用。
   */
  private buildNodes(response: RoutingResponse, userInput: string): DAGNode[] {
    if (!response.tasks || response.tasks.length === 0) {
      // 兜底：取第一个识别到的领域，或尝试从关键词匹配，或 fallback
      let domain = response.involvedDomains?.[0];
      if (!domain) {
        // 尝试从用户输入中匹配已知领域的关键词
        try {
          const clusters = this.clusterManager.getAllClusters();
          const matched = clusters.find((c) =>
            c.manifest.wake_conditions.intent_patterns.some((p) => userInput.includes(p))
          );
          if (matched) domain = matched.manifest.domain_id;
        } catch {
          // ignore
        }
        if (!domain) domain = 'unknown';
      }
      return [{
        taskId: 'task_0',
        domain,
        goal: response.globalIntent ?? userInput,
        deps: [],
        status: 'pending' as const,
      }];
    }

    const validDomains = new Set(response.involvedDomains);

    return response.tasks.map(t => ({
      taskId: t.id,
      domain: validDomains.has(t.domain) ? t.domain : (response.involvedDomains?.[0] ?? 'unknown'),
      goal: t.goal,
      deps: Array.isArray(t.deps) ? t.deps : [],
      status: 'pending' as const,
    }));
  }
}
