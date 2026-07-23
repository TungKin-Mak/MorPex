/**
 * MorPex v11 Bootstrap — 将 v10 运行时实例接入 v11 WorkflowSDK
 *
 * 使用方法：
 * ```typescript
 * import { createWorkflowRuntime } from '@morpex/workflow-sdk/bootstrap.js';
 * const { runtime, sdk } = await createWorkflowRuntime();
 * const result = await sdk.execute('hello-world', { name: 'MorPex' });
 * ```
 *
 * 职责：
 * 1. 创建 v10 核心实例（EventBus, MissionRuntime, DAGRuntime, WorkflowRegistry 等）
 * 2. 创建适配器层，桥接 v10 API 与 v11 V10* 接口
 * 3. 返回配置完成的 WorkflowRuntime + WorkflowSDK
 *
 * @packageDocumentation
 */

// ── v10 核心模块 ──
// 通过 @morpex/core barrel 导入（tsconfig.json paths 映射）
import {
  EventBus,
  MissionRuntime,
  DAGRuntime,
  WorkflowRegistry,
  WorkflowExecutor as V10WorkflowExecutor,
  WorkflowOptimizer as V10WorkflowOptimizer,
  WorkflowIntelligence,
  WorkflowMemory,
  MissionState,
  DAGExecutorAdapter,
} from '@morpex/core';

// ── v10 类型（用于 planner/executor 实现）──
import type { Mission, MissionPlan, PlanStep, MissionResult } from '@morpex/core';
import type { MissionPlanner, MissionExecutor } from '@morpex/core';

// ── v11 类型 ──
import type {
  WorkflowPackage,
  InstalledWorkflow,
  WorkflowExecutionResult,
  WorkflowMetrics,
  WorkflowStatus,
  OptimizationProposal,
  WorkflowVersion as WorkflowVersionInfo,
  ExecutionOptions,
} from './types.js';

import { WorkflowRuntime } from './WorkflowRuntime.js';
import { WorkflowSDK } from './WorkflowSDK.js';
import { PiModelRegistry } from './PiModelRegistry.js';

// ═══════════════════════════════════════════════════════════════════
// 加载 .env 文件（pi-ai 需要 API key 从 process.env 读取）
// ═══════════════════════════════════════════════════════════════════

async function loadEnvFile(): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const envPath = path.resolve(process.cwd(), '.env');
  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.substring(0, eqIdx).trim();
      const value = trimmed.substring(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
    console.log('[bootstrap] .env 已加载');
  } catch {
    // .env 文件不存在，忽略
  }
}

// ═══════════════════════════════════════════════════════════════════
// PiAgentPlanner — 使用 @earendil-works/pi-ai 进行 AI 规划
// ═══════════════════════════════════════════════════════════════════

class PiAgentPlanner implements MissionPlanner {
  constructor(private piModel: PiModelRegistry) {}

  async createPlan(mission: Mission): Promise<MissionPlan> {
    if (!this.piModel.ready) {
      return this.fallbackPlan(mission);
    }

    try {
      const startTime = Date.now();
      const response = await this.piModel.generate({
        system: `You are a planning AI. Given a goal, output a JSON plan with steps.
Output ONLY valid JSON in this exact format:
{
  "steps": [
    {
      "id": "step_1",
      "name": "Short name",
      "description": "What this step does",
      "domain": "general|coding|testing|deployment|analysis",
      "deps": []
    }
  ],
  "riskLevel": "low|medium|high",
  "reasoning": "Why this plan"
}`,
        prompt: `Create an execution plan for this goal: "${mission.goal}"\n\nContext: ${JSON.stringify(mission.context ?? {})}`,
        temperature: 0.3,
        maxTokens: 2000,
        responseFormat: 'json_object',
      });
      const elapsed = Date.now() - startTime;
      const text = response.content || response.text;
      if (!text) return this.fallbackPlan(mission);
      
      console.log(`[PiAgentPlanner] ✅ AI 规划完成 (${elapsed}ms, ${response.modelUsed})`);

      // 提取 JSON（可能被 markdown 包装）
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return this.fallbackPlan(mission);

      const parsed = JSON.parse(jsonMatch[0]) as {
        steps?: Array<{
          id?: string; name?: string; description?: string;
          domain?: string; deps?: string[];
        }>;
        riskLevel?: string;
        reasoning?: string;
      };

      const steps = (parsed.steps ?? []).map((s, i) => ({
        id: s.id ?? `step_${i + 1}`,
        name: s.name ?? `Step ${i + 1}`,
        description: s.description ?? '',
        domain: s.domain ?? 'general',
        agentType: s.domain ?? 'general',
        deps: s.deps ?? [],
        priority: i + 1,
      }));

      if (steps.length === 0) return this.fallbackPlan(mission);

      return {
        id: `plan_${mission.id}_${Date.now()}`,
        missionId: mission.id,
        steps,
        estimatedDuration: steps.length * 30000,
        riskLevel: (parsed.riskLevel as 'low' | 'medium' | 'high') ?? 'low',
        reasoning: parsed.reasoning ?? `AI-generated ${steps.length}-step plan`,
      };
    } catch (err) {
      console.warn('[PiAgentPlanner] AI 规划失败，使用回退:', err);
      return this.fallbackPlan(mission);
    }
  }

  async replan(mission: Mission, reason: string): Promise<MissionPlan> {
    const plan = await this.createPlan(mission);
    plan.reasoning = `Replan (${reason}): ${plan.reasoning}`;
    return plan;
  }

  private fallbackPlan(mission: Mission): MissionPlan {
    return {
      id: `plan_${mission.id}_fallback_${Date.now()}`,
      missionId: mission.id,
      steps: [{
        id: 'step_1',
        name: `Execute: ${mission.goal.substring(0, 60)}`,
        description: mission.goal,
        domain: 'general',
        agentType: 'general',
        deps: [],
        priority: 1,
      }],
      estimatedDuration: 30000,
      riskLevel: 'low',
      reasoning: 'Fallback single-step plan',
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 适配器层 — 桥接 v10 API → v11 V10* 接口
// ═══════════════════════════════════════════════════════════════════

/**
 * MissionRuntimeAdapter — 包装 v10 MissionRuntime 以匹配 V10MissionRuntime 接口
 *
 * v10 MissionRuntime 使用两阶段流程（createMissionFromGoal → executeMission），
 * 而 v11 接口期望单阶段 executeMission(goal, context?)。
 */
class MissionRuntimeAdapter {
  private inner: MissionRuntime;

  constructor(inner: MissionRuntime) {
    this.inner = inner;
  }

  async executeMission(
    goal: string,
    context?: Record<string, unknown>
  ): Promise<{ success: boolean; missionId?: string; output?: unknown; error?: string; duration?: number }> {
    try {
      // Step 1: 从 goal 创建 Mission
      const mission = await this.inner.createMissionFromGoal(
        goal,
        'system',
        'workflow-cli'
      );

      // Step 2: 执行 Mission
      const result = await this.inner.executeMission(mission.id);

      return {
        success: result.state === MissionState.COMPLETED,
        missionId: mission.id,
        output: result.output,
        error: result.error,
        duration: result.duration,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async simulate(
    _goal: string
  ): Promise<{ success: boolean; metrics?: Record<string, number> }> {
    // v10 SimulationEngine 需要 Mission + Plan，无法仅从 goal 模拟
    // 返回基础结果
    return {
      success: true,
      metrics: {
        estimatedSteps: 1,
        confidence: 0.5,
      },
    };
  }
}

/**
 * DAGRuntimeAdapter — 包装 v10 DAGRuntime 以匹配 V10DAGRuntime 接口
 *
 * v10 使用 run()，v11 接口期望 execute()。
 */
class DAGRuntimeAdapter {
  private inner: DAGRuntime;

  constructor(inner: DAGRuntime) {
    this.inner = inner;
  }

  async execute(
    dag: unknown,
    context?: unknown
  ): Promise<{ success: boolean; output?: unknown; duration?: number }> {
    const startTime = Date.now();
    try {
      const result = await this.inner.run(dag as Parameters<DAGRuntime['run']>[0], context);
      return {
        success: result.success,
        output: result.nodeResults,
        duration: Date.now() - startTime,
      };
    } catch (err) {
      return {
        success: false,
        duration: Date.now() - startTime,
      };
    }
  }

  buildFromSteps(steps: unknown[]): unknown {
    // Simple step-to-DAG mapping
    return {
      nodes: steps.map((s, i) => ({
        id: `step_${i}`,
        data: s,
        deps: [],
      })),
    };
  }
}

/**
 * WorkflowRegistryAdapter — 包装 v10 WorkflowRegistry
 *
 * v10 WorkflowRegistry 的 API 已基本匹配 V10WorkflowRegistry 接口，
 * 只需要对 register 返回类型做适配。
 */
class WorkflowRegistryAdapter {
  private inner: WorkflowRegistry;

  constructor(inner: WorkflowRegistry) {
    this.inner = inner;
  }

  register(candidate: unknown): { id: string; name: string; status: string } {
    const result = this.inner.register(candidate as Parameters<WorkflowRegistry['register']>[0]);
    return {
      id: result.id,
      name: result.name,
      status: result.status,
    };
  }

  get(id: string): {
    id: string;
    name: string;
    status: string;
    currentVersion: number;
    versions: { version: number }[];
    executionCount: number;
    successRate: number;
    avgDuration: number;
    lastExecutedAt?: number;
  } | undefined {
    const result = this.inner.get(id);
    if (!result) return undefined;
    return {
      id: result.id,
      name: result.name,
      status: result.status,
      currentVersion: result.currentVersion,
      versions: result.versions.map(v => ({ version: v.version })),
      executionCount: result.executionCount,
      successRate: result.successRate,
      avgDuration: result.avgDuration,
      lastExecutedAt: result.lastExecutedAt,
    };
  }

  activate(id: string): void {
    this.inner.activate(id);
  }

  recordExecution(id: string, success: boolean, duration: number): void {
    this.inner.recordExecution(id, success, duration);
  }

  getAll(): { id: string; name: string; status: string }[] {
    return this.inner.getAll().map(w => ({
      id: w.id,
      name: w.name,
      status: w.status,
    }));
  }
}

/**
 * WorkflowExecutorAdapter — 包装 v10 WorkflowExecutor
 */
class WorkflowExecutorAdapter {
  private inner: V10WorkflowExecutor;

  constructor(inner: V10WorkflowExecutor) {
    this.inner = inner;
  }

  async execute(
    workflowId: string,
    params?: Record<string, unknown>
  ): Promise<{ success: boolean; missionId: string; duration: number; output?: unknown; error?: string }> {
    const result = await this.inner.execute(workflowId, params);
    return {
      success: result.success,
      missionId: result.missionId,
      duration: result.duration,
      output: result.output,
      error: result.error,
    };
  }
}

/**
 * WorkflowOptimizerAdapter — 包装 v10 WorkflowOptimizer
 *
 * v10 使用 analyze()，v11 接口期望 optimize()。
 */
class WorkflowOptimizerAdapter {
  private inner: V10WorkflowOptimizer;

  constructor(inner: V10WorkflowOptimizer) {
    this.inner = inner;
  }

  async optimize(workflowId: string): Promise<{ suggestions: unknown[]; expectedImprovement: number }> {
    const plan = await this.inner.analyze(workflowId);
    if (!plan) {
      return {
        suggestions: [],
        expectedImprovement: 0,
      };
    }
    return {
      suggestions: plan.suggestions ?? [],
      expectedImprovement: plan.expectedImprovement ?? 0,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Bootstrap 工厂函数
// ═══════════════════════════════════════════════════════════════════

export interface BootstrapResult {
  /** v11 WorkflowRuntime（已接入 v10 后端） */
  runtime: WorkflowRuntime;
  /** v11 WorkflowSDK（便捷 API） */
  sdk: WorkflowSDK;
  /** 底层 v10 EventBus（可扩展监听） */
  bus: EventBus;
  /** 底层 v10 MissionRuntime（可扩展） */
  missionRuntime: MissionRuntime;
  /** 底层 v10 WorkflowRegistry（可扩展） */
  workflowRegistry: WorkflowRegistry;
}

/**
 * createWorkflowRuntime — 一键创建 v11 运行时
 *
 * 自动完成：
 * 1. 创建 EventBus
 * 2. 创建 MissionRuntime + DAGRuntime
 * 3. 创建 WorkflowRegistry + WorkflowIntelligence + WorkflowOptimizer + WorkflowExecutor
 * 4. 创建适配器层
 * 5. 返回 WorkflowRuntime + WorkflowSDK
 *
 * @param options - 可选配置
 * @returns BootstrapResult — 所有创建的实例
 */
export async function createWorkflowRuntime(
  options?: {
    /** EventBus 最大历史记录数 */
    eventBusMaxHistory?: number;
    /** MissionRuntime 配置 */
    missionConfig?: Record<string, unknown>;
    /** DAGRuntime 配置 */
    dagConfig?: { maxParallel?: number; enablePriority?: boolean; continueOnFailure?: boolean };
  }
): Promise<BootstrapResult> {
  // ── 0. 加载 .env（pi-ai 需要 API key）──
  await loadEnvFile();

  // ── 1. EventBus ──
  const bus = new EventBus(options?.eventBusMaxHistory ?? 1000);

  // ── 2. DAGRuntime（先创建，MissionRuntime 的 executor 需要引用）──
  const dagRuntime = new DAGRuntime({
    maxParallel: options?.dagConfig?.maxParallel ?? 4,
    enablePriority: options?.dagConfig?.enablePriority ?? true,
    continueOnFailure: options?.dagConfig?.continueOnFailure ?? true,
  });

  // ── 3. MissionRuntime ──
  const missionRuntime = new MissionRuntime(bus, {
    autoExecuteByDefault: true,
    defaultPermissions: {
      allowAutoExecute: true,
      requireApproval: false,
      allowedTools: ['*'],
    },
  });

  // 注册 planner 和 executor
  // PiAgentPlanner: 使用 @earendil-works/pi-ai 进行 AI 规划
  //   模型不可用时自动降级为单步骤回退
  const piModel = new PiModelRegistry();
  missionRuntime.setPlanner(new PiAgentPlanner(piModel));
  // DAGExecutorAdapter: 使用真实 DAGRuntime 执行 DAG（支持并行 + 重试）
  missionRuntime.setExecutor(new DAGExecutorAdapter(dagRuntime));

  // ── 4. Workflow 演化引擎 ──
  const workflowRegistry = new WorkflowRegistry();
  const workflowMemory = new WorkflowMemory();
  const workflowIntelligence = new WorkflowIntelligence(workflowMemory);
  const workflowOptimizer = new V10WorkflowOptimizer(
    workflowIntelligence,
    workflowMemory,
    workflowRegistry
  );
  const workflowExecutor = new V10WorkflowExecutor(
    workflowRegistry,
    missionRuntime
  );

  // ── 5. 适配器层 ──
  const missionRuntimeAdapter = new MissionRuntimeAdapter(missionRuntime);
  const dagRuntimeAdapter = new DAGRuntimeAdapter(dagRuntime);
  const registryAdapter = new WorkflowRegistryAdapter(workflowRegistry);
  const executorAdapter = new WorkflowExecutorAdapter(workflowExecutor);
  const optimizerAdapter = new WorkflowOptimizerAdapter(workflowOptimizer);

  // ── 6. v11 WorkflowRuntime ──
  const runtime = new WorkflowRuntime({
    registry: registryAdapter,
    missionRuntime: missionRuntimeAdapter,
    dagRuntime: dagRuntimeAdapter,
    executor: executorAdapter,
    optimizer: optimizerAdapter,
  });

  // ── 7. v11 WorkflowSDK ──
  const sdk = new WorkflowSDK(runtime);

  console.log('[MorPex v11] ✅ Workflow Runtime 已启动');
  console.log(`  ├─ EventBus: active`);
  console.log(`  ├─ MissionRuntime: active`);
  console.log(`  ├─ DAGRuntime: active`);
  console.log(`  ├─ WorkflowRegistry: ${workflowRegistry.getAll().length} registered`);
  console.log(`  ├─ WorkflowOptimizer: active`);
  console.log(`  └─ WorkflowExecutor: active`);

  return {
    runtime,
    sdk,
    bus,
    missionRuntime,
    workflowRegistry,
  };
}
