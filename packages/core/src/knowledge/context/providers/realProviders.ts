/**
 * context/providers — 真实数据 Provider（功能③ Phase 2 A：让上下文系统吃真数据）
 *
 * 背景：功能③ 聚焦三分法 + 身份 ID 驱动已实现，但 8 种来源此前全是兜底默认值
 * （ContextAssemblyEngine.generateFallbackFragment）。本文件提供核心真实 Provider：
 *   - GoalGraphProvider（'goal_graph'）  ：读真实 Goal（OntologyService 查询）
 *   - MissionStateProvider（'mission_state'）：读真实 Mission 状态（MissionController）
 *   - ArtifactLineageProvider（'artifact_lineage'）：读真实产物谱系（ArtifactFacade/registry）
 *   - DecisionHistoryProvider（'decision_history'）：读真实历史决策（EventStore）
 *   - UserProfileProvider（'user_profile'）：读真实用户画像（Ontology User 对象）
 *   - AgentStatusProvider（'agent_status'）：读真实 Agent 状态（装配 input 传入 teamAgents）
 *
 * 尚未有实时数据源（保留 fallback）：
 *   - behavior_twin：行为孪生依赖演化系统长期沉淀（ExperienceMiner/cognition-twin），实时装配无数据源，预留
 *   - custom：领域定制扩展点（WorkflowPlugin 注册），无默认数据源，预留
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

// ═══════════════════════════════════════════════════════════
// ArtifactLineageProvider — 读真实产物谱系（ArtifactFacade.getAll）
// ═══════════════════════════════════════════════════════════

/** 产物读取最小接口（与 ArtifactFacade.getAll 兼容，解耦避免循环依赖） */
export interface ArtifactReader {
  getAll(): Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    version: number | string;
    createdAt?: number;
  }>;
}

export class ArtifactLineageProvider implements FragmentProvider {
  readonly source = 'artifact_lineage' as const;

  constructor(private artifacts: ArtifactReader | null) {}

  async collect(input: ContextAssemblyInput): Promise<ContextFragment> {
    const taskRef = taskRefOf(input);
    if (!this.artifacts) {
      return {
        source: 'artifact_lineage',
        version: 1,
        collectedAt: Date.now(),
        taskRef,
        data: { recentArtifacts: [], totalCount: 0, source: 'fallback' },
      };
    }
    try {
      const all = this.artifacts.getAll();
      const recent = all.slice(-10).map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        status: a.status,
        version: a.version,
      }));
      return {
        source: 'artifact_lineage',
        version: 1,
        collectedAt: Date.now(),
        taskRef,
        data: { recentArtifacts: recent, totalCount: all.length, source: 'real' },
      };
    } catch (err) {
      console.warn('[ArtifactLineageProvider] ⚠️ 产物查询失败，返回保守占位:', (err as Error).message);
      return {
        source: 'artifact_lineage',
        version: 1,
        collectedAt: Date.now(),
        taskRef,
        data: { recentArtifacts: [], totalCount: 0, source: 'fallback' },
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════
// DecisionHistoryProvider — 读真实历史决策（EventStore 决策类事件）
// ═══════════════════════════════════════════════════════════

/** 事件查询最小接口（与 IEventStore.query 兼容，解耦避免循环依赖） */
export interface DecisionEventReader {
  query(filter: { type?: string; limit?: number; offset?: number }): Promise<
    Array<{ id: string; type: string; timestamp?: number; payload?: unknown }>
  >;
}

/** 决策类事件类型前缀（governance/approval/decision） */
const DECISION_PREFIXES = ['decision', 'approval', 'governance'];

export class DecisionHistoryProvider implements FragmentProvider {
  readonly source = 'decision_history' as const;

  constructor(private events: DecisionEventReader | null) {}

  async collect(input: ContextAssemblyInput): Promise<ContextFragment> {
    const taskRef = taskRefOf(input);
    if (!this.events) {
      return {
        source: 'decision_history',
        version: 1,
        collectedAt: Date.now(),
        taskRef,
        data: { recentDecisions: [], totalCount: 0, source: 'fallback' },
      };
    }
    try {
      // 拉最近事件，内存过滤决策类（不依赖 type 前缀精确语义，稳妥）
      const evts = await this.events.query({ limit: 100 });
      const decisions = evts
        .filter((e) => DECISION_PREFIXES.some((p) => e.type.startsWith(p)))
        .slice(-10)
        .map((e) => ({ id: e.id, type: e.type, at: e.timestamp }));
      return {
        source: 'decision_history',
        version: 1,
        collectedAt: Date.now(),
        taskRef,
        data: { recentDecisions: decisions, totalCount: decisions.length, source: 'real' },
      };
    } catch (err) {
      console.warn('[DecisionHistoryProvider] ⚠️ 决策事件查询失败，返回保守占位:', (err as Error).message);
      return {
        source: 'decision_history',
        version: 1,
        collectedAt: Date.now(),
        taskRef,
        data: { recentDecisions: [], totalCount: 0, source: 'fallback' },
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════
// UserProfileProvider — 读真实用户画像（Ontology User 对象）
// ═══════════════════════════════════════════════════════════

export class UserProfileProvider implements FragmentProvider {
  readonly source = 'user_profile' as const;

  constructor(private ontology: OntologyService | null) {}

  async collect(input: ContextAssemblyInput): Promise<ContextFragment> {
    const taskRef = taskRefOf(input);
    if (!this.ontology) {
      return {
        source: 'user_profile',
        version: 1,
        collectedAt: Date.now(),
        taskRef,
        data: { id: input.userId ?? 'default', source: 'fallback' },
      };
    }
    try {
      const facts = await this.ontology.queryObjects({ type: 'User', limit: 10 } as never);
      const target =
        (input.userId ? facts.find((f) => f.object.id === input.userId) : undefined) ?? facts[0];
      if (target) {
        return {
          source: 'user_profile',
          version: 1,
          collectedAt: Date.now(),
          taskRef,
          data: {
            id: target.object.id,
            preferences: target.object.properties ?? {},
            source: 'real',
          },
        };
      }
      return {
        source: 'user_profile',
        version: 1,
        collectedAt: Date.now(),
        taskRef,
        data: { id: input.userId ?? 'default', source: 'fallback' },
      };
    } catch (err) {
      console.warn('[UserProfileProvider] ⚠️ 用户画像查询失败，返回保守占位:', (err as Error).message);
      return {
        source: 'user_profile',
        version: 1,
        collectedAt: Date.now(),
        taskRef,
        data: { id: input.userId ?? 'default', source: 'fallback' },
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════
// AgentStatusProvider — 读真实 Agent 状态（装配 input 传入 teamAgents）
// ═══════════════════════════════════════════════════════════
// 装配发生在 orchestrate 后（MorPexRuntime），此时 team 已创建——
// 由装配点把 team.members 概览放进 input.teamAgents，本 Provider 直接消费（无注入依赖）。

export class AgentStatusProvider implements FragmentProvider {
  readonly source = 'agent_status' as const;

  async collect(input: ContextAssemblyInput): Promise<ContextFragment> {
    const taskRef = taskRefOf(input);
    const agents = input.teamAgents;
    if (agents && agents.length > 0) {
      return {
        source: 'agent_status',
        version: 1,
        collectedAt: Date.now(),
        taskRef,
        data: {
          agents,
          activeCount: agents.filter((a) => a.status !== 'COMPLETED' && a.status !== 'BLOCKED').length,
          source: 'real',
        },
      };
    }
    return {
      source: 'agent_status',
      version: 1,
      collectedAt: Date.now(),
      taskRef,
      data: { agents: [], activeCount: 0, source: 'fallback' },
    };
  }
}

