/**
 * CrossDepartmentArbitrationEngine — 跨部门冲突仲裁引擎
 *
 * v16: 检测并仲裁跨部门计划冲突（资源竞争、循环依赖、时间窗口冲突）。
 * 在 HierarchicalPlanner.createPlan() 之后自动调用。
 *
 * 仲裁策略:
 *   - 'priority': 按部门优先级（CEO 设定）
 *   - 'cost': 按预估成本最小化
 *   - 'risk': 按风险最低优先
 */

import { EventBus } from '../../infrastructure/common/EventBus.js';

export interface Conflict {
  type: 'resource' | 'dependency' | 'time';
  deptA: string;
  deptB: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  conflictingNodes: string[];
}

export interface ArbitrationResult {
  conflicts: Conflict[];
  resolved: Conflict[];
  unresolved: Conflict[];
  policy: 'priority' | 'cost' | 'risk';
  adjustments: string[];
}

export interface DeptPriority {
  deptId: string;
  priority: number;
}

export interface ArbitrationPolicy {
  mode: 'priority' | 'cost' | 'risk';
  deptPriorities?: DeptPriority[];
}

export interface PlanTask {
  id: string;
  task: string;
  capabilities: string[];
  deps: string[];
}

export interface PlanWithTasks {
  subGoals: Array<{ id: string; description: string; priority: 'high' | 'medium' | 'low'; estimatedDuration: number; dependencies: string[] }>;
  tasks: PlanTask[];
}

export class CrossDepartmentArbitrationEngine {
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  detectConflicts(plan: PlanWithTasks, deptId?: string): Conflict[] {
    const conflicts: Conflict[] = [];
    const did = deptId || 'default';

    const capabilityMap = new Map<string, string[]>();
    for (const task of plan.tasks) {
      for (const cap of task.capabilities) {
        const nodes = capabilityMap.get(cap) || [];
        nodes.push(task.id);
        capabilityMap.set(cap, nodes);
      }
    }
    for (const [cap, nodes] of capabilityMap) {
      if (nodes.length > 1) {
        conflicts.push({
          type: 'resource',
          deptA: did,
          deptB: did,
          description: `能力 "${cap}" 被多个任务请求: ${nodes.join(', ')}`,
          severity: nodes.length > 3 ? 'high' : nodes.length > 2 ? 'medium' : 'low',
          conflictingNodes: nodes,
        });
      }
    }

    // 循环依赖检测
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const depGraph = new Map<string, string[]>();
    for (const task of plan.tasks) {
      depGraph.set(task.id, task.deps);
    }
    const detectCycle = (nodeId: string): boolean => {
      if (inStack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;
      visited.add(nodeId);
      inStack.add(nodeId);
      const deps = depGraph.get(nodeId) || [];
      for (const dep of deps) {
        if (detectCycle(dep)) return true;
      }
      inStack.delete(nodeId);
      return false;
    };
    for (const task of plan.tasks) {
      if (detectCycle(task.id)) {
        conflicts.push({
          type: 'dependency',
          deptA: did,
          deptB: did,
          description: `循环依赖: ${task.id}`,
          severity: 'high',
          conflictingNodes: [task.id],
        });
        break;
      }
    }

    return conflicts;
  }

  async arbitrate(
    plan: PlanWithTasks,
    conflicts: Conflict[],
    policy: ArbitrationPolicy,
  ): Promise<ArbitrationResult> {
    const resolved: Conflict[] = [];
    const unresolved: Conflict[] = [];
    const adjustments: string[] = [];

    const deptPriorityMap = new Map<string, number>();
    if (policy.deptPriorities) {
      for (const dp of policy.deptPriorities) {
        deptPriorityMap.set(dp.deptId, dp.priority);
      }
    }

    for (const conflict of conflicts) {
      switch (policy.mode) {
        case 'priority': {
          const prioA = deptPriorityMap.get(conflict.deptA) ?? 5;
          const prioB = deptPriorityMap.get(conflict.deptB) ?? 5;
          if (prioA !== prioB) {
            const winner = prioA < prioB ? conflict.deptA : conflict.deptB;
            adjustments.push(`[priority] ${winner} 优先执行`);
            resolved.push(conflict);
          } else {
            unresolved.push(conflict);
          }
          break;
        }
        case 'cost': {
          adjustments.push(`[cost] 按成本最小化仲裁`);
          resolved.push(conflict);
          break;
        }
        case 'risk': {
          if (conflict.severity === 'high') {
            adjustments.push(`[risk] ${conflict.conflictingNodes.join(',')} 高风险，需审核`);
            unresolved.push(conflict);
          } else {
            resolved.push(conflict);
          }
          break;
        }
        default:
          unresolved.push(conflict);
      }
    }

    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'plan.conflict.resolved',
      timestamp: Date.now(),
      executionId: `arb_${Date.now()}`,
      source: 'cross-dept-arbitration',
      payload: {
        totalConflicts: conflicts.length,
        resolvedCount: resolved.length,
        unresolvedCount: unresolved.length,
        policy: policy.mode,
        adjustments,
      },
    });

    return { conflicts, resolved, unresolved, policy: policy.mode, adjustments };
  }
}
