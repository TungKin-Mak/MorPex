import { EventBus } from '../common/EventBus.js';

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
}

export interface HierarchicalPlannerLike {
  createPlan(goal: string, context?: PlanContext): Promise<DAGPlan>;
  readonly name: string;
}

// ── BrainFacade 接口（松耦合） ──

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

  constructor(eventBus: EventBus) {
    if (!eventBus) throw new Error('[HierarchicalPlanner] EventBus 是必填参数');
    this.eventBus = eventBus;
  }

  setBrainFacade(facade: BrainFacadeForPlanner): void {
    this.brainFacade = facade;
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

  private ruleBasedDecompose(goal: string, context?: PlanContext): SubGoal[] {
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
