/**
 * context/providers — 真实数据 Provider（功能③ Phase 2 A：让上下文系统吃真数据）
 *
 * 背景：功能③ 聚焦三分法 + 身份 ID 驱动已实现，但 8 种来源此前全是兜底默认值
 * （ContextAssemblyEngine.generateFallbackFragment）。本文件提供核心真实 Provider：
 *   - GoalGraphProvider（'goal_graph'）  ：读真实 Goal（OntologyService 查询）
 *   - MissionStateProvider（'mission_state'）：读真实 Mission 状态（MissionController）
 *
 * 设计：
 *   - 采集时挂 taskRef（input.currentTask 的 missionId/goalId 优先）→ 身份过滤真实生效
 *   - 数据源不可用（null/查询失败）→ 返回保守占位（不硬崩，装配非阻断）
 *   - Provider 在 bootstrap 装配时经 ContextFragmentRegistry.registerProvider 注入
 */

import type { OntologyService } from '../../ontology/OntologyService.js';
import type {
  ContextAssemblyInput,
  ContextFragment,
  FragmentProvider,
} from '../ContextFragmentRegistry.js';

/** 从装配输入提取任务归属（身份 ID 主键：currentTask 优先，退 missionId） */
function taskRefOf(input: ContextAssemblyInput): string | undefined {
  const ct = input.currentTask;
  return ct?.goalId ?? ct?.planId ?? ct?.taskId ?? input.missionId;
}

/** Mission 状态读取最小接口（与 MissionController.getMission 兼容，解耦避免循环依赖） */
export interface MissionStateReader {
  getMission(missionId: string): { status?: string; phase?: string; progress?: number; goalId?: string } | undefined;
}

// ═══════════════════════════════════════════════════════════
// GoalGraphProvider — 读真实 Goal
// ═══════════════════════════════════════════════════════════

export class GoalGraphProvider implements FragmentProvider {
  readonly source = 'goal_graph' as const;

  constructor(private ontology: OntologyService | null) {}

  async collect(input: ContextAssemblyInput): Promise<ContextFragment> {
    const taskRef = taskRefOf(input);
    // 数据源不可用 → 直接保守占位（不硬崩，装配非阻断）
    if (!this.ontology) {
      return {
        source: 'goal_graph',
        version: 1,
        collectedAt: Date.now(),
        taskRef,
        data: { goals: [], activeCount: 0, currentGoal: input.goal, source: 'fallback' },
      };
    }
    // 真实查询：Ontology 里查 Goal 类型对象
    try {
      const facts = await this.ontology.queryObjects({ type: 'Goal', limit: 20 });
      const goals = facts
        .map((f) => f.object)
        .map((o) => ({
          id: o.id,
          title: (o.properties.title as string | undefined) ?? o.id,
          status: o.status,
          domain: o.properties.domain as string | undefined,
        }));
      return {
        source: 'goal_graph',
        version: 1,
        collectedAt: Date.now(),
        taskRef,
        data: {
          goals,
          activeCount: goals.filter((g) => g.status === 'active').length,
          currentGoal: input.goal,
          source: 'real',
        },
      };
    } catch (err) {
      console.warn('[GoalGraphProvider] ⚠️ Goal 查询失败，返回保守占位:', (err as Error).message);
      return {
        source: 'goal_graph',
        version: 1,
        collectedAt: Date.now(),
        taskRef,
        data: { goals: [], activeCount: 0, currentGoal: input.goal, source: 'fallback' },
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════
// MissionStateProvider — 读真实 Mission 状态
// ═══════════════════════════════════════════════════════════

export class MissionStateProvider implements FragmentProvider {
  readonly source = 'mission_state' as const;

  constructor(private missions: MissionStateReader | null) {}

  async collect(input: ContextAssemblyInput): Promise<ContextFragment> {
    const taskRef = taskRefOf(input);
    const mission = this.missions?.getMission(input.missionId);
    if (mission) {
      return {
        source: 'mission_state',
        version: 1,
        collectedAt: Date.now(),
        taskRef,
        data: {
          id: input.missionId,
          status: mission.status ?? 'ACTIVE',
          phase: mission.phase ?? 'EXECUTING',
          progress: mission.progress ?? 0,
          goalId: mission.goalId,
          source: 'real',
        },
      };
    }
    // Mission 未找到（如装配早于 Mission 注册）→ 保守占位（非阻断）
    return {
      source: 'mission_state',
      version: 1,
      collectedAt: Date.now(),
      taskRef,
      data: {
        id: input.missionId,
        status: 'ACTIVE',
        phase: 'EXECUTING',
        progress: 0,
        source: 'fallback',
      },
    };
  }
}
