/**
 * DeliveryPlanner — 统一规划引擎（Facade）
 *
 * Phase 2 / 交付层
 *
 * 对外提供统一的规划入口，对内委托给:
 *   - MetaPlanner（完整 7 引擎规划管线）
 *   - CognitivePipeline（认知管线中的规划阶段）
 *   - SimulationEngine（执行前仿真预测）
 *
 * 设计原则：
 *   - Facade 模式：不修改现有模块
 *   - 根据任务复杂度自动选择规划路径
 *   - 支持 "快速规划"（简单任务跳过仿真）
 *   - 支持 "完整规划"（复杂任务走全管线）
 *
 * 规划模式：
 *   - 'quick': 快速规划（简单任务，无仿真）
 *   - 'full':  完整规划（复杂任务，含仿真预测）
 *   - 'auto':  自动选择（默认）
 *
 * 使用方式：
 *   const planner = new DeliveryPlanner(eventBus);
 *   planner.setMetaPlanner(metaPlanner);
 *   planner.setCognitivePipeline(pipeline);
 *   const plan = await planner.createPlan({ goal: '优化登录模块', mode: 'auto' });
 *   const simulation = await planner.simulate('计划ID');
 */

import { EventBus } from '../common/EventBus.js';
import { DepartmentContext } from '../department/DepartmentContext.js';
import type { DepartmentId } from '../department/types.js';
import type { HierarchicalPlannerLike, DAGPlan } from './HierarchicalPlanner.js';

// ── Types ──

export type PlanningMode = 'quick' | 'full' | 'auto';
export type PlanStatus = 'draft' | 'confirmed' | 'executing' | 'completed' | 'failed';

export interface PlanningRequest {
  /** 任务目标 */
  goal: string;
  /** 规划模式 */
  mode?: PlanningMode;
  /** 部门 ID */
  departmentId?: DepartmentId;
  /** 上下文 */
  context?: Record<string, unknown>;
  /** 约束 */
  constraints?: {
    maxTasks?: number;
    maxDuration?: number;
    requiredCapabilities?: string[];
    riskThreshold?: 'low' | 'medium' | 'high';
  };
}

export interface PlanTask {
  id: string;
  description: string;
  capabilities: string[];
  deps: string[];
  estimatedDuration?: number;
}

export interface Plan {
  id: string;
  goal: string;
  status: PlanStatus;
  tasks: PlanTask[];
  mode: PlanningMode;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface SimulationResult {
  successProbability: number;
  estimatedCost: number;
  riskLevel: 'low' | 'medium' | 'high';
  suggestion: 'approve' | 'reject' | 'review';
  details?: Record<string, unknown>;
}

export interface PlannerHealth {
  metaPlanner: boolean;
  cognitivePipeline: boolean;
  simulationEngine: boolean;
  uptime: number;
}

// ── 依赖接口（松耦合） ──

export interface MetaPlannerLike {
  createPlan(goal: string, context?: Record<string, unknown>): Promise<{ plan: Record<string, unknown>; planId?: string }>;
  readonly name: string;
}

export interface CognitivePipelineLike {
  run(goal: string, context?: Record<string, unknown>): Promise<{ plan: Record<string, unknown> }>;
  readonly name: string;
}

export interface SimulationEngineLike {
  simulate(plan: Record<string, unknown>, context?: Record<string, unknown>): Promise<SimulationResult>;
  readonly name: string;
}

// ── DeliveryPlanner ──

export class DeliveryPlanner {
  name = 'DeliveryPlanner';
  version = '2.0.0';

  private eventBus: EventBus;
  private metaPlanner: MetaPlannerLike | null = null;
  private cognitivePipeline: CognitivePipelineLike | null = null;
  private simulationEngine: SimulationEngineLike | null = null;
  private plans: Map<string, Plan> = new Map();
  private planCounter = 0;
  private startedAt = Date.now();

  /** 各模式成功率追踪（Phase 4.6：Brain→Planning 反馈） */
  private modeSuccessCounts: Map<PlanningMode, { success: number; failure: number }> = new Map();
  private static readonly MODE_LEARNING_THRESHOLD = 5; // 至少 5 次数据才调整

  /** 注入的已知模式（来自 BrainFacade/EvolutionEngine） */
  private knownPatterns: Array<{ type: string; confidence: number }> = [];

  /** SOPEngine 引用（Phase 5 — 规划前查询 SOP） */
  private sopEngine?: { findRelevantSOPs: (goal: string, deptId?: string) => Promise<Array<{ title: string; steps: Array<{ action: string }>; category: string; taskType: string; avgDuration: number }>> };

  /** BrainFacade 引用（Phase 5 P2 — 规划前查询历史经验） */
  private brainFacade?: { recall: (query: string, context?: { departmentId?: string }) => Promise<Array<{ content: string; relevance: number }>> };

  /** HierarchicalPlanner 引用（v13 — HTN 分层规划） */
  private hierarchicalPlanner: HierarchicalPlannerLike | null = null;

  constructor(eventBus: EventBus) {
    if (!eventBus) throw new Error('[DeliveryPlanner] EventBus 是必填参数');
    this.eventBus = eventBus;

    // 初始化模式统计
    this.modeSuccessCounts.set('quick', { success: 0, failure: 0 });
    this.modeSuccessCounts.set('full', { success: 0, failure: 0 });

    // 监听 Brain→Planning 反馈（Phase 4.6）
    this.eventBus.on('brain.planning.insight', (event: any) => {
      const p = event.payload;
      if (!p) return;
      // 当 Brain 报告成功时，记录到对应模式的成功计数
      // 这帮助 DeliveryPlanner 在未来选择更优的规划模式
      if (p.result === 'success') {
        // 通过 goal 特征推测使用的模式，并增加对应模式的权重
        const wordCount = (p.goal as string ?? '').split(/\s+/).length;
        const inferredMode: PlanningMode = wordCount < 10 ? 'quick' : 'full';
        const counts = this.modeSuccessCounts.get(inferredMode);
        if (counts) counts.success++;
      }
    });
  }

  /**
   * setMetaPlanner — 注入 MetaPlanner 实现
   */
  setMetaPlanner(planner: MetaPlannerLike): void {
    this.metaPlanner = planner;
  }

  /**
   * setCognitivePipeline — 注入 CognitivePipeline 实现
   */
  setCognitivePipeline(pipeline: CognitivePipelineLike): void {
    this.cognitivePipeline = pipeline;
  }

  /**
   * setSimulationEngine — 注入 SimulationEngine 实现
   */
  setSimulationEngine(engine: SimulationEngineLike): void {
    this.simulationEngine = engine;
  }

  /** setSOPEngine — 注入 SOPEngine（Phase 5）*/
  setSOPEngine(engine: { findRelevantSOPs: (goal: string, deptId?: string) => Promise<Array<{ title: string; steps: Array<{ action: string }>; category: string; taskType: string; avgDuration: number }>> }): void {
    this.sopEngine = engine;
  }

  /** setBrainFacade — 注入 BrainFacade（Phase 5 P2 — 规划前查询历史经验） */
  setBrainFacade(facade: { recall: (query: string, context?: { departmentId?: string }) => Promise<Array<{ content: string; relevance: number }>> }): void {
    this.brainFacade = facade;
  }

  /** setHierarchicalPlanner — 注入 HierarchicalPlanner（v13 — HTN 分层规划） */
  setHierarchicalPlanner(planner: HierarchicalPlannerLike): void {
    this.hierarchicalPlanner = planner;
  }

  /**
   * isReady — 检查是否至少有一个规划引擎可用
   */
  isReady(): boolean {
    return !!(this.metaPlanner || this.cognitivePipeline);
  }

  // ═══════════════════════════════════════════════════════════════
  // 统一规划入口
  // ═══════════════════════════════════════════════════════════════

  /**
   * createPlan — 统一规划入口
   *
   * 根据 mode 自动路由：
   *   - 'quick': 快速规划（简单任务，跳过仿真）
   *   - 'full':  完整规划（复杂任务，含仿真预测）
   *   - 'auto':  自动选择（默认）
   *
   * @param request - 规划请求
   * @returns Plan
   */
  async createPlan(request: PlanningRequest): Promise<Plan> {
    const mode = this.resolveMode(request);
    const planId = `plan_${++this.planCounter}_${Date.now()}`;

    // 设置部门上下文
    if (request.departmentId) {
      DepartmentContext.partitionKey(request.departmentId);
    }

    // Phase 5 P1: 查询相关 SOP 作为规划提示
    let sopHints: string[] = [];
    if (this.sopEngine) {
      try {
        const sops = await this.sopEngine.findRelevantSOPs(request.goal, request.departmentId);
        sopHints = sops.map(s => `📋 SOP「${s.title}」(${s.category}/${s.taskType}): ${s.steps.map(st => st.action).join(' → ')} | 平均耗时: ${Math.round(s.avgDuration/1000)}s`);
        if (sopHints.length > 0) {
          request.context = { ...request.context, sopHints };
        }
      } catch (err) {
        // SOP 查询失败不影响规划
      }
    }

    // Phase 5 P2: 查询历史经验作为规划参考
    let experienceHints: string[] = [];
    if (this.brainFacade) {
      try {
        const memories = await this.brainFacade.recall(request.goal, {
          departmentId: request.departmentId,
        });
        const relevant = memories.filter(m => m.relevance > 0.3).slice(0, 5);
        if (relevant.length > 0) {
          experienceHints = relevant.map(m => `💡 历史经验: ${m.content.substring(0, 120)}`);
          // 注入经验到 context
          request.context = { ...request.context, experienceHints, historicalTaskCount: relevant.length };

          // P2 核心：根据历史经验调整规划模式
          // 如果过去类似任务用 quick 模式失败过，强制用 full 模式
          const failureMemories = relevant.filter(m => m.content.includes('❌') || m.content.includes('失败'));
          if (failureMemories.length > 0 && mode === 'auto' && !request.mode) {
            console.log(`[DeliveryPlanner] ⚠️ 历史上有 ${failureMemories.length} 次失败经验，建议使用 full 模式`);
            // 不强制覆盖用户指定的 mode，但 auto 模式下会偏向 full
            request.context = { ...request.context, suggestedMode: 'full', failureCount: failureMemories.length };
          }

          // 如果过去成功经验很多，用 quick 模式就够了
          const successMemories = relevant.filter(m => m.content.includes('✅'));
          if (successMemories.length >= 3 && mode === 'auto' && !request.mode) {
            request.context = { ...request.context, suggestedMode: 'quick', successCount: successMemories.length };
          }
        }
      } catch (err) {
        // 经验查询失败不影响规划
      }
    }

    // 发射规划开始事件
    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'planner.plan.started',
      timestamp: Date.now(),
      executionId: planId,
      source: 'delivery-planner',
      payload: { goal: request.goal, mode, departmentId: request.departmentId },
    });

    try {
      let plan: Plan;

      switch (mode) {
        case 'quick':
          plan = await this.quickPlan(request, planId);
          break;
        case 'full':
          plan = await this.fullPlan(request, planId);
          break;
        default:
          // auto: 优先使用经验建议的模式，其次根据目标复杂度选择
          const suggestedMode = request.context?.suggestedMode as PlanningMode | undefined;
          if (suggestedMode === 'full') {
            plan = await this.fullPlan(request, planId);
          } else if (suggestedMode === 'quick') {
            plan = await this.quickPlan(request, planId);
          } else {
            const isComplex = request.goal.length > 80 || (request.constraints?.requiredCapabilities?.length ?? 0) > 2;
            plan = isComplex
              ? await this.fullPlan(request, planId)
              : await this.quickPlan(request, planId);
          }
      }

      this.plans.set(planId, plan);

      // 发射规划完成事件
      this.eventBus.emit({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'planner.plan.completed',
        timestamp: Date.now(),
        executionId: planId,
        source: 'delivery-planner',
        payload: {
          planId,
          goal: request.goal,
          mode,
          taskCount: plan.tasks.length,
          riskLevel: (plan.metadata?.riskLevel as 'low' | 'medium' | 'high') ?? 'low',
        },
      });

      return plan;
    } catch (err) {
      const errorMsg = (err as Error).message;
      const failedPlan: Plan = {
        id: planId,
        goal: request.goal,
        status: 'failed',
        tasks: [],
        mode,
        createdAt: Date.now(),
        metadata: { error: errorMsg },
      };

      this.plans.set(planId, failedPlan);

      this.eventBus.emit({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'planner.plan.failed',
        timestamp: Date.now(),
        executionId: planId,
        source: 'delivery-planner',
        payload: { goal: request.goal, mode, error: errorMsg },
      });

      return failedPlan;
    }
  }

  /**
   * resolveMode — 决定规划模式（支持从历史学习）
   *
   * Phase 4.6: 基于 Brain→Planning 反馈自动调整模式选择
   */
  private resolveMode(request: PlanningRequest): PlanningMode {
    if (request.mode && request.mode !== 'auto') return request.mode;

    // 检查工作复杂度
    const wordCount = request.goal.split(/\s+/).length;
    const hasMultiStep = /\n|1\.|2\.|first|then|finally/i.test(request.goal);

    // 简单任务 → quick
    if (wordCount < 15 && !hasMultiStep) return 'quick';

    // 复杂任务 → full
    if (wordCount >= 30 || hasMultiStep) {
      if (this.metaPlanner) return 'full';
    }

    // 检查是否有已知的成功模式（来自 BrainFacade）
    const hasSuccessPattern = this.knownPatterns.some(
      p => p.type === 'success_pattern' && p.confidence > 0.7,
    );
    if (hasSuccessPattern && this.metaPlanner) return 'full';

    // 中等任务：基于历史成功率选择
    const quickStats = this.modeSuccessCounts.get('quick');
    const fullStats = this.modeSuccessCounts.get('full');

    const quickTotal = quickStats ? quickStats.success + quickStats.failure : 0;
    const fullTotal = fullStats ? fullStats.success + fullStats.failure : 0;

    // 如果 quick 模式有足够数据和较高成功率，优先 quick
    if (quickTotal >= DeliveryPlanner.MODE_LEARNING_THRESHOLD && quickStats) {
      const quickRate = quickStats.success / quickTotal;
      if (quickRate >= 0.8 && this.cognitivePipeline) return 'quick';
    }

    // 如果 full 模式有足够数据和较高成功率，优先 full
    if (fullTotal >= DeliveryPlanner.MODE_LEARNING_THRESHOLD && fullStats) {
      const fullRate = fullStats.success / fullTotal;
      if (fullRate >= 0.8 && this.metaPlanner) return 'full';
    }

    // 默认：有 MetaPlanner 就走 full
    if (this.metaPlanner) return 'full';
    if (this.cognitivePipeline) return 'full';

    return 'quick';
  }

  /**
   * recordOutcome — 记录规划结果（Phase 4.6）
   *
   * 供调用方在规划执行完成后调用，用于持续改进模式选择。
   *
   * @param planId - 计划 ID
   * @param result - 成功或失败
   * @param duration - 执行耗时
   */
  recordOutcome(planId: string, result: 'success' | 'failure', duration: number): void {
    const plan = this.plans.get(planId);
    if (!plan) return;

    // 更新模式统计
    const counts = this.modeSuccessCounts.get(plan.mode);
    if (counts) {
      if (result === 'success') counts.success++;
      else counts.failure++;
    }

    // 更新计划状态
    plan.status = result === 'success' ? 'completed' : 'failed';
    plan.metadata = {
      ...plan.metadata,
      actualResult: result,
      actualDuration: duration,
    };

    console.log(`[DeliveryPlanner] 📊 plan "${planId}" outcome: ${result} (${duration}ms), mode: ${plan.mode}`);

    // 🆕 如果成功且有多步骤任务，发射模板演化候选事件
    if (result === 'success' && plan.tasks.length > 1) {
      this.eventBus.emit({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'planner.plan.template_candidate',
        timestamp: Date.now(),
        executionId: planId,
        source: 'delivery-planner',
        payload: {
          planId,
          goal: plan.goal,
          tasks: plan.tasks,
          duration,
          mode: plan.mode,
        },
      });
    }
  }

  /**
   * setPatterns — 注入已知模式（来自 BrainFacade/EvolutionEngine）
   *
   * 用于指导规划模式选择。当发现高置信度的成功模式时，
   * 规划器倾向于使用 'full' 模式以获得更好的规划质量。
   *
   * @param patterns - 模式列表，包含类型和置信度
   */
  setPatterns(patterns: Array<{ type: string; confidence: number }>): void {
    this.knownPatterns = patterns;
    console.log(`[DeliveryPlanner] 📐 已注入 ${patterns.length} 个模式用于规划指导`);
  }

  /**
   * quickPlan — 增强快速规划（P3）
   *
   * v1: 单任务规划（太简陋）
   * v2: 多级降级策略：SOP → PiBridge LLM → 经验提示 → 单任务
   *
   * 适用于简单任务。无需仿真，轻量分解。
   */
  private async quickPlan(request: PlanningRequest, planId: string): Promise<Plan> {
    // 策略 0: HierarchicalPlanner 快速分解（优先，简单任务直接分解）
    if (this.hierarchicalPlanner) {
      try {
        const dagPlan = await this.hierarchicalPlanner.createPlan(request.goal, {
          departmentId: request.departmentId,
          constraints: { maxTasks: 3 },
        });
        if (dagPlan.subGoals.length <= 3) {
          return this.convertDAGPlanToPlan(dagPlan, request, planId);
        }
      } catch {
        // 继续降级
      }
    }

    // 策略 1: CognitivePipeline（已有，优先）
    if (this.cognitivePipeline) {
      const result = await this.cognitivePipeline.run(request.goal, {
        ...request.context,
        departmentId: request.departmentId,
        planId,
      });
      return this.normalizePlan(result.plan, request, planId, 'quick');
    }

    // 策略 2: HierarchicalPlanner 再次尝试（作为 SOP 之前的降级）
    if (this.hierarchicalPlanner) {
      try {
        const dagPlan = await this.hierarchicalPlanner.createPlan(request.goal, {
          departmentId: request.departmentId,
        });
        return this.convertDAGPlanToPlan(dagPlan, request, planId);
      } catch {
        // 继续降级
      }
    }

    // 策略 3: SOP 模板（P1 — 已有成功经验）
    const sopHints = request.context?.sopHints as string[] | undefined;
    const experienceHints = request.context?.experienceHints as string[] | undefined;

    if (sopHints && sopHints.length > 0) {
      // 从 SOP 提取步骤 → 转为 Plan 任务
      const tasks: PlanTask[] = [];
      for (const hint of sopHints) {
        // 解析 "📋 SOP「标题」(category/taskType): step1 → step2 → step3"
        const stepsMatch = hint.match(/:(.+)$/);
        if (stepsMatch) {
          const steps = stepsMatch[1].split('→').map(s => s.trim()).filter(Boolean);
          steps.forEach((step, i) => {
            tasks.push({
              id: `${planId}_task_${i + 1}`,
              description: step,
              capabilities: ['execute'],
              deps: i > 0 ? [`${planId}_task_${i}`] : [],
              estimatedDuration: 30_000,
            });
          });
        }
      }
      if (tasks.length > 0) {
        return {
          id: planId, goal: request.goal, status: 'draft', tasks, mode: 'quick',
          createdAt: Date.now(),
          metadata: { taskCount: tasks.length, riskLevel: 'low', source: 'sop-template',
            sopCount: sopHints.length, experienceCount: experienceHints?.length ?? 0 },
        };
      }
    }

    // 策略 3: PiBridge 快速分解（P3 — 轻量 LLM 调用 ~200 tokens）
    try {
      const { PiBridge } = await import('../adapters/pi-bridge/PiBridge.js');
      const bridge = new PiBridge('deepseek/deepseek-v4-flash');
      await bridge.init();

      const prompt = `将以下任务分解为 2-5 个具体步骤。返回严格 JSON 数组（不要 markdown）：

任务: "${request.goal}"

格式: [{"step":"步骤描述","capability":"所需能力"}]

能力可选: analyze/design/code/test/write/research/review/deploy
规则: 简单任务 1-2 步，中等任务 3-4 步。只输出 JSON 数组。`;

      const result = await bridge.generateText({ prompt, maxTokens: 300, temperature: 0.2 });
      const steps = this.parseQuickSteps(result.text, planId);

      if (steps.length > 0) {
        return {
          id: planId, goal: request.goal, status: 'draft', tasks: steps, mode: 'quick',
          createdAt: Date.now(),
          metadata: { taskCount: steps.length, riskLevel: steps.length > 3 ? 'medium' : 'low',
            source: 'llm-quick-decompose', experienceCount: experienceHints?.length ?? 0 },
        };
      }
    } catch (err) {
      // PiBridge 不可用 → 继续降级
      console.warn('[DeliveryPlanner] PiBridge 快速分解失败:', (err as Error).message);
    }

    // 策略 4: 经验驱动的单/多任务（P2 — 历史经验）
    if (experienceHints && experienceHints.length > 0) {
      // 有历史经验 → 至少拆成 2 步（计划 + 执行）
      return {
        id: planId, goal: request.goal, status: 'draft',
        tasks: [
          { id: `${planId}_task_1`, description: `参考历史经验制定方案: ${request.goal.substring(0, 40)}`, capabilities: ['analyze'], deps: [], estimatedDuration: 15_000 },
          { id: `${planId}_task_2`, description: `执行: ${request.goal.substring(0, 50)}`, capabilities: ['execute'], deps: [`${planId}_task_1`], estimatedDuration: 45_000 },
        ],
        mode: 'quick', createdAt: Date.now(),
        metadata: { taskCount: 2, riskLevel: 'low', source: 'experience-driven', experienceCount: experienceHints.length },
      };
    }

    // 策略 5: 内置单任务（最终降级）
    return {
      id: planId, goal: request.goal, status: 'draft',
      tasks: [{
        id: `${planId}_task_1`,
        description: `执行: ${request.goal.substring(0, 60)}`,
        capabilities: request.constraints?.requiredCapabilities ?? ['execute'],
        deps: [],
        estimatedDuration: 60_000,
      }],
      mode: 'quick', createdAt: Date.now(),
      metadata: { taskCount: 1, estimatedDuration: 60_000, riskLevel: 'low' },
    };
  }

  /**
   * parseQuickSteps — 解析 PiBridge 快速分解的 JSON
   */
  private parseQuickSteps(raw: string, planId: string): PlanTask[] {
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];
      const parsed = JSON.parse(jsonMatch[0]) as Array<{ step: string; capability: string }>;
      if (!Array.isArray(parsed) || parsed.length === 0) return [];

      return parsed.map((s, i) => ({
        id: `${planId}_task_${i + 1}`,
        description: s.step,
        capabilities: [s.capability || 'execute'],
        deps: i > 0 ? [`${planId}_task_${i}`] : [],
        estimatedDuration: 30_000,
      }));
    } catch {
      return [];
    }
  }

  /**
   * fullPlan — 完整规划
   *
   * 适用于复杂任务。走 MetaPlanner 全管线 + 可选仿真。
   */
  private async fullPlan(request: PlanningRequest, planId: string): Promise<Plan> {
    // 策略1: 使用 HierarchicalPlanner 进行 HTN 规划（优先）
    if (this.hierarchicalPlanner) {
      try {
        const dagPlan = await this.hierarchicalPlanner.createPlan(request.goal, {
          departmentId: request.departmentId,
          constraints: request.constraints,
          sopHints: request.context?.sopHints as string[] | undefined,
          historyHints: request.context?.experienceHints as string[] | undefined,
        });
        return this.convertDAGPlanToPlan(dagPlan, request, planId);
      } catch (err) {
        console.warn('[DeliveryPlanner] HierarchicalPlanner 失败，降级到 MetaPlanner:', (err as Error).message);
      }
    }

    if (!this.metaPlanner) {
      // 降级到快速规划
      console.warn('[DeliveryPlanner] MetaPlanner 未注入，降级到快速规划');
      return this.quickPlan(request, planId);
    }

    const result = await this.metaPlanner.createPlan(request.goal, {
      ...request.context,
      departmentId: request.departmentId,
      planId,
      mode: 'full',
    });

    const plan = this.normalizePlan(result.plan, request, planId, 'full');

    // 可选：执行仿真预测
    if (this.simulationEngine && plan.tasks.length > 1) {
      try {
        const simulation = await this.simulationEngine.simulate(
          { id: planId, goal: request.goal, tasks: plan.tasks },
          { departmentId: request.departmentId },
        );
        plan.metadata = { ...plan.metadata, simulationResult: simulation as unknown as Record<string, unknown> };
      } catch (err) {
        console.warn(`[DeliveryPlanner] 仿真失败 (降级运行):`, (err as Error).message);
      }
    }

    return plan;
  }

  /**
   * normalizePlan — 将外部引擎的输出归一化为 Plan
   */
  private normalizePlan(
    raw: Record<string, unknown>,
    request: PlanningRequest,
    planId: string,
    mode: PlanningMode,
  ): Plan {
    // 如果外部引擎返回了完整的 Plan 结构，直接使用
    if (raw.tasks && Array.isArray(raw.tasks)) {
      return {
        id: (raw.id as string) || planId,
        goal: (raw.goal as string) || request.goal,
        status: ((raw.status as PlanStatus) || 'draft'),
        tasks: raw.tasks as PlanTask[],
        mode,
        createdAt: Date.now(),
        metadata: raw.metadata as Record<string, unknown> ?? {},
      };
    }

    // 否则包装为简单结构
    return {
      id: planId,
      goal: request.goal,
      status: 'draft',
      tasks: [
        {
          id: `${planId}_task_1`,
          description: `执行: ${request.goal.substring(0, 60)}`,
          capabilities: request.constraints?.requiredCapabilities ?? ['execute'],
          deps: [],
          estimatedDuration: 60_000,
        },
      ],
      mode,
      createdAt: Date.now(),
      metadata: {
        taskCount: 1,
        estimatedDuration: 60_000,
        riskLevel: 'low',
        raw: raw,
      },
    };
  }

  /**
   * convertDAGPlanToPlan — 将 HierarchicalPlanner 的 DAGPlan 转为标准 Plan
   * v13: 从 DAGPlan 到统一 Plan 的适配器
   */
  private convertDAGPlanToPlan(dagPlan: DAGPlan, request: PlanningRequest, planId: string): Plan {
    const tasks: PlanTask[] = dagPlan.dag.map((node, i) => ({
      id: node.id,
      description: node.task,
      capabilities: node.capabilities,
      deps: node.deps,
      estimatedDuration: dagPlan.subGoals[i]?.estimatedDuration || 30_000,
    }));

    return {
      id: planId,
      goal: request.goal,
      status: 'draft',
      tasks,
      mode: dagPlan.metadata.mode,
      createdAt: Date.now(),
      metadata: {
        taskCount: tasks.length,
        riskLevel: dagPlan.metadata.riskLevel,
        estimatedTotalDuration: dagPlan.metadata.estimatedTotalDuration,
        source: 'hierarchical-planner',
        complexity: dagPlan.metadata.complexity,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 仿真
  // ═══════════════════════════════════════════════════════════════

  /**
   * simulate — 对已生成的 Plan 执行仿真预测
   *
   * @param planId - 计划 ID
   * @returns 仿真结果，如果没有仿真引擎返回 undefined
   */
  async simulate(planId: string): Promise<SimulationResult | undefined> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`计划 "${planId}" 不存在`);
    if (!this.simulationEngine) return undefined;

    const result = await this.simulationEngine.simulate(
      { id: planId, goal: plan.goal, tasks: plan.tasks },
    );

    plan.metadata = { ...plan.metadata, simulationResult: result as unknown as Record<string, unknown> };
    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // 查询
  // ═══════════════════════════════════════════════════════════════

  /**
   * getPlan — 获取计划
   */
  getPlan(planId: string): Plan | undefined {
    return this.plans.get(planId);
  }

  /**
   * listPlans — 列出计划
   *
   * @param limit - 最大条数（默认 20）
   */
  listPlans(limit: number = 20): Plan[] {
    return [...this.plans.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  /**
   * confirmPlan — 确认计划（转为确认状态，可执行）
   */
  confirmPlan(planId: string): boolean {
    const plan = this.plans.get(planId);
    if (!plan || plan.status !== 'draft') return false;
    plan.status = 'confirmed';
    return true;
  }

  /**
   * getHealth — 获取规划引擎健康状态
   */
  getHealth(): PlannerHealth {
    return {
      metaPlanner: !!this.metaPlanner,
      cognitivePipeline: !!this.cognitivePipeline,
      simulationEngine: !!this.simulationEngine,
      uptime: Date.now() - this.startedAt,
    };
  }
}
