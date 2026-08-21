/**
 * HierarchicalPlanner — 分层规划器（Ontology grounded，产出 Plan 供 L5 执行）
 */
import { EventBus } from '../../infrastructure/common/EventBus.js';
import { getSharedDeblackboxRecorder } from '../../infrastructure/observability/deblackbox/DeblackboxRecorder.js';

// ── Ontology 迭代2: 可选 grounded reasoning ──
import type { OntologyService } from '../../knowledge/ontology/OntologyService.js';
import type { ForcedQueryGuard } from '../../gate/ForcedQueryGuard.js';

// ── Types ──

export interface PlanContext {
  departmentId?: string;
  existingPlanId?: string;
  constraints?: {
    maxTasks?: number;
    maxDuration?: number;
    requiredCapabilities?: string[];
    riskThreshold?: 'low' | 'medium' | 'high';
  };
  historyHints?: string[];
  sopHints?: string[];
}

export interface SubGoal {
  id: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  estimatedDuration: number;
  dependencies: string[];
}

export interface DAGNode {
  id: string;
  task: string;
  capabilities: string[];
  deps: string[];
  executor?: string;
}

export interface DAGPlan {
  subGoals: SubGoal[];
  dag: DAGNode[];
  metadata: {
    complexity: 'simple' | 'medium' | 'complex';
    riskLevel: 'low' | 'medium' | 'high';
    estimatedTotalDuration: number;
    mode: 'quick' | 'full';
    source: 'hierarchical-planner' | 'brain-facade' | 'rule-based';
  };
  /**
   * vNext+: Ontology Reference Trace
   * 规划时经 Ontology Gate 检索到的事实 ID 列表。
   */
  ontologyRefs?: string[];
}

export interface HierarchicalPlannerLike {
  createPlan(goal: string, context?: PlanContext): Promise<DAGPlan>;
  readonly name: string;
}

// ── BrainFacade 接口（松耦合） ──

interface PiBridgeForPlanner {
  generateText: (params: {
    system?: string;
    prompt: string;
    temperature?: number;
    maxTokens?: number;
  }) => Promise<{ text: string }>;
}

interface BrainFacadeForPlanner {
  processTask(task: string, context?: { departmentId?: string }): Promise<{
    reflection: { insights: Array<{ message: string; confidence: number }> };
    memoryUpdate: unknown;
  }>;
}

// ── HierarchicalPlanner ──

export class HierarchicalPlanner {
  name = 'HierarchicalPlanner';
  version = '1.0.0';

  private eventBus: EventBus;
  private brainFacade: BrainFacadeForPlanner | null = null;
  private planCounter = 0;

  /** Ontology 依赖（迭代2 — 可选 grounded reasoning） */
  private ontology: OntologyService | null = null;
  private forcedQueryGuard: ForcedQueryGuard | null = null;
  private piBridge: PiBridgeForPlanner | null = null;
  private enableOntologyGrounding = false;

  constructor(eventBus: EventBus) {
    if (!eventBus) throw new Error('[HierarchicalPlanner] EventBus 是必填参数');
    this.eventBus = eventBus;
  }

  setBrainFacade(facade: BrainFacadeForPlanner): void {
    this.brainFacade = facade;
  }

  /** setOntology — 注入 OntologyService（迭代2 — 可选 grounded reasoning） */
  setOntology(ontology: OntologyService): void {
    this.ontology = ontology;
  }

  /** setForcedQueryGuard — 注入 ForcedQueryGuard（迭代2） */
  setForcedQueryGuard(guard: ForcedQueryGuard): void {
    this.forcedQueryGuard = guard;
  }

  /** setPiBridge — 注入 PiBridge（迭代2） */
  setPiBridge(bridge: PiBridgeForPlanner): void {
    this.piBridge = bridge;
  }

  /** enableOntologyGrounding — 启用 ontology grounded reasoning */
  setOntologyGroundingEnabled(enabled: boolean): void {
    this.enableOntologyGrounding = enabled;
  }

  async createPlan(goal: string, context?: PlanContext): Promise<DAGPlan> {
    const planId = `hplan_${++this.planCounter}_${Date.now()}`;
    const startTime = Date.now();

    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'planner.hierarchical.started',
      timestamp: Date.now(),
      executionId: planId,
      source: 'hierarchical-planner',
      payload: { goal: goal.substring(0, 80), departmentId: context?.departmentId },
    });

    try {
      // 迭代2: 如果已启用 ontology grounding，在分解前执行强制查询
      if (this.enableOntologyGrounding && this.ontology && this.forcedQueryGuard && this.piBridge) {
        try {
          const { runOntologyGroundedReasoning } = await import('../../gate/runOntologyGroundedReasoning.js');
          const result = await runOntologyGroundedReasoning({
            goal,
            missionId: context?.existingPlanId,
            ontology: this.ontology,
            guard: this.forcedQueryGuard,
            piBridge: this.piBridge,
            extraContext: '需要在规划前查询 Ontology 获取真实事实。',
            // Phase 2 第二批（domain 传递补齐）：HierarchicalPlanner 有 departmentId 信号 → 按域路由规则
            domain: context?.departmentId,
          });
          console.log(`[HierarchicalPlanner] 🏁 Ontology grounded reason 完成, 引用 ${result.proposal.referenced_object_ids.length} 个 ID`);

          // 将检索到的事实注入 context
          const retrievedIds = result.queryTrace.retrievedIds;
          if (retrievedIds.length > 0) {
            // 将 ontology 信息注入 context（扩展字段）
            (context as Record<string, unknown>).ontologyRetrievedIds = retrievedIds;
            (context as Record<string, unknown>).ontologyProposal = result.proposal;
          }
        } catch (err) {
          console.warn('[HierarchicalPlanner] ⚠️ Ontology grounding 失败，降级到普通规划:', (err as Error).message);
          // 迭代4 硬门禁：标记 grounding 失败，供后续步骤消费
          if (context) {
            (context as Record<string, unknown>).ontologyGroundingFailed = true;
            (context as Record<string, unknown>).ontologyGroundingError = (err as Error).message;
          }
        }
      }

      const subGoals = await this.decomposeGoal(goal, context);
      const dagNodes = this.buildDAGNodes(subGoals);
      const complexity = this.assessComplexity(goal, subGoals);
      const totalDuration = subGoals.reduce((sum, sg) => sum + sg.estimatedDuration, 0);
      const riskLevel = this.assessRiskLevel(subGoals, context);

      const plan: DAGPlan = {
        subGoals,
        dag: dagNodes,
        metadata: {
          complexity,
          riskLevel,
          estimatedTotalDuration: totalDuration,
          mode: subGoals.length <= 3 ? 'quick' : 'full',
          source: 'hierarchical-planner',
        },
        // vNext+: 引用 Trace — 透传 Ontology Gate 检索到的事实 ID
        ontologyRefs: (context as Record<string, unknown> | undefined)?.ontologyRetrievedIds as string[] | undefined,
      };

      this.eventBus.emit({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'planner.hierarchical.plan_created',
        timestamp: Date.now(),
        executionId: planId,
        source: 'hierarchical-planner',
        payload: {
          planId,
          goal: goal.substring(0, 80),
          subGoalCount: subGoals.length,
          dagNodeCount: dagNodes.length,
          complexity,
          riskLevel,
          duration: Date.now() - startTime,
          departmentId: context?.departmentId,
        },
      });

      // ═══ 去黑盒化（黑盒⑤）：规划理由记录（L1 决策单永久）——回答"为什么这么规划"═══
      try {
        const groundingFailed = (context as Record<string, unknown> | undefined)?.ontologyGroundingFailed === true;
        getSharedDeblackboxRecorder().record({
          category: 'planner.decision',
          source: 'hierarchical-planner',
          executionId: planId,
          level: 'L1',
          isError: false,
          summary: {
            goal,
            planId,
            subGoalCount: subGoals.length,
            steps: subGoals.map((sg) => ({
              id: sg.id,
              description: sg.description,
              priority: sg.priority,
              estimatedDuration: sg.estimatedDuration,
              dependencies: sg.dependencies ?? [],
            })),
            complexity,
            riskLevel,
            mode: subGoals.length <= 3 ? 'quick' : 'full',
            estimatedTotalDuration: totalDuration,
            ontologyRefs: plan.ontologyRefs?.length ?? 0,
            ontologyGrounding: groundingFailed ? 'failed' : (plan.ontologyRefs?.length ?? 0) > 0 ? 'grounded' : 'not-grounded',
            durationMs: Date.now() - startTime,
            decision: '创建分层计划',
            reasoning: `按复杂度(${complexity})/风险(${riskLevel})将目标拆解为 ${subGoals.length} 个子目标`,
          },
        });
      } catch (err) {
        console.warn('[HierarchicalPlanner] ⚠️ 规划理由记录失败（忽略）:', (err as Error).message);
      }

      return plan;
    } catch (err) {
      console.warn('[HierarchicalPlanner] 规划失败，返回最小计划:', (err as Error).message);

      const fallbackPlan: DAGPlan = {
        subGoals: [{
          id: `${planId}_sg_1`,
          description: goal.substring(0, 100),
          priority: 'high',
          estimatedDuration: 60_000,
          dependencies: [],
        }],
        dag: [{
          id: `${planId}_node_1`,
          task: goal.substring(0, 100),
          capabilities: ['execute'],
          deps: [],
        }],
        metadata: {
          complexity: 'simple',
          riskLevel: 'medium',
          estimatedTotalDuration: 60_000,
          mode: 'quick',
          source: 'rule-based',
        },
      };

      return fallbackPlan;
    }
  }

  private async decomposeGoal(goal: string, context?: PlanContext): Promise<SubGoal[]> {
    if (this.brainFacade) {
      try {
        const result = await this.brainFacade.processTask(goal, {
          departmentId: context?.departmentId,
        });
        const insightMessages = result.reflection.insights.map(i => i.message);
        if (insightMessages.length > 0) {
          return this.ruleBasedDecompose(goal, { ...context, historyHints: insightMessages });
        }
      } catch {
        // 降级到规则分解
      }
    }

    return this.ruleBasedDecompose(goal, context);
  }

  private ruleBasedDecompose(goal: string, _context?: PlanContext): SubGoal[] {
    const subGoals: SubGoal[] = [];
    const sgId = (n: number) => `sg_${Date.now()}_${n}`;

    const hasMultiStep = /(第一步|第二步|步骤|分步|first|second|step\s*[12])/i.test(goal);
    const hasConjunctions = /(并且|同时|然后|随后|and|then|after)/i.test(goal);

    if (hasMultiStep || hasConjunctions) {
      const segments = goal.split(/[。\n；;]/).filter(s => s.trim().length > 5);
      if (segments.length >= 2) {
        segments.forEach((seg, i) => {
          subGoals.push({
            id: sgId(i + 1),
            description: seg.trim().substring(0, 100),
            priority: i === 0 ? 'high' : 'medium',
            estimatedDuration: 30_000 + i * 10_000,
            dependencies: i > 0 ? [sgId(i)] : [],
          });
        });
        return subGoals;
      }
    }

    const keywords = ['分析', '设计', '开发', '测试', '部署', '调研', '实现', '优化', '重构'];
    for (const kw of keywords) {
      if (goal.includes(kw)) {
        subGoals.push({
          id: sgId(subGoals.length + 1),
          description: `${kw}: ${goal.substring(0, 60)}`,
          priority: subGoals.length === 0 ? 'high' : 'medium',
          estimatedDuration: 45_000,
          dependencies: subGoals.length > 0 ? [sgId(subGoals.length)] : [],
        });
      }
    }

    if (subGoals.length === 0) {
      subGoals.push({
        id: sgId(1),
        description: goal.substring(0, 100),
        priority: 'high',
        estimatedDuration: 60_000,
        dependencies: [],
      });
    }

    return subGoals;
  }

  private buildDAGNodes(subGoals: SubGoal[]): DAGNode[] {
    return subGoals.map(sg => ({
      id: sg.id.replace('sg_', 'node_'),
      task: sg.description,
      capabilities: this.inferCapabilities(sg.description),
      deps: sg.dependencies.map(d => d.replace('sg_', 'node_')),
    }));
  }

  private inferCapabilities(description: string): string[] {
    const caps: string[] = [];
    if (/分析|调研|research|analyze/i.test(description)) caps.push('analyze');
    if (/设计|design/i.test(description)) caps.push('design');
    if (/开发|实现|code|implement|build/i.test(description)) caps.push('code');
    if (/测试|test|verify/i.test(description)) caps.push('test');
    if (/部署|deploy|发布|publish/i.test(description)) caps.push('deploy');
    if (caps.length === 0) caps.push('execute');
    return caps;
  }

  private assessComplexity(_goal: string, subGoals: SubGoal[]): 'simple' | 'medium' | 'complex' {
    if (subGoals.length <= 2) return 'simple';
    if (subGoals.length <= 5) return 'medium';
    return 'complex';
  }

  private assessRiskLevel(_subGoals: SubGoal[], context?: PlanContext): 'low' | 'medium' | 'high' {
    if (context?.constraints?.riskThreshold) return context.constraints.riskThreshold;
    return 'low';
  }
}
