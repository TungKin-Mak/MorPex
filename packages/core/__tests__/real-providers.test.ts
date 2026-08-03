/**
 * 功能③ T5：真实上下文 Provider 测试
 *
 * 验证 4 个新增真实 Provider（ArtifactLineage/DecisionHistory/UserProfile/AgentStatus）：
 *  - 数据源可用 → 返回真实数据（data.source='real'）+ taskRef 挂载
 *  - 数据源 null / 查询失败 → 保守占位 fallback（不硬崩，装配非阻断）
 */
import { describe, expect, it } from 'vitest';
import {
  ArtifactLineageProvider,
  DecisionHistoryProvider,
  UserProfileProvider,
  AgentStatusProvider,
  type ArtifactReader,
  type DecisionEventReader,
} from '../src/knowledge/context/providers/realProviders.js';
import type { ContextAssemblyInput } from '../src/knowledge/context/ContextFragmentRegistry.js';

const baseInput: ContextAssemblyInput = {
  missionId: 'mission_ts5',
  currentTask: { taskId: 'mission_ts5' },
};

// ── ArtifactLineageProvider ──

describe('ArtifactLineageProvider', () => {
  it('数据源可用 → 返回真实产物 + source=real + taskRef', async () => {
    const reader: ArtifactReader = {
      getAll: () => [
        { id: 'a1', name: '登录模块', type: 'code', status: 'approved', version: 3 },
        { id: 'a2', name: '测试报告', type: 'report', status: 'draft', version: 1 },
      ],
    };
    const p = new ArtifactLineageProvider(reader);
    const f = await p.collect(baseInput);
    expect(f.source).toBe('artifact_lineage');
    expect(f.taskRef).toBe('mission_ts5');
    expect(f.data).toMatchObject({ totalCount: 2, source: 'real' });
    expect((f.data as { recentArtifacts: unknown[] }).recentArtifacts).toHaveLength(2);
    expect((f.data as { recentArtifacts: { name: string }[] }).recentArtifacts[0].name).toBe('登录模块');
  });

  it('数据源 null → fallback 不崩', async () => {
    const p = new ArtifactLineageProvider(null);
    const f = await p.collect(baseInput);
    expect(f.data).toMatchObject({ totalCount: 0, source: 'fallback' });
  });
});

// ── DecisionHistoryProvider ──

describe('DecisionHistoryProvider', () => {
  it('数据源可用 → 返回真实决策 + source=real', async () => {
    const reader: DecisionEventReader = {
      query: async () => [
        { id: 'e1', type: 'governance.approval', timestamp: 1000 },
        { id: 'e2', type: 'gate.rule.hit', timestamp: 2000 }, // 非决策类 → 过滤
        { id: 'e3', type: 'decision.made', timestamp: 3000 },
      ],
    };
    const p = new DecisionHistoryProvider(reader);
    const f = await p.collect(baseInput);
    expect(f.source).toBe('decision_history');
    expect(f.taskRef).toBe('mission_ts5');
    expect(f.data).toMatchObject({ source: 'real' });
    const decisions = (f.data as { recentDecisions: { type: string }[] }).recentDecisions;
    expect(decisions).toHaveLength(2); // governance + decision，过滤 gate
    expect(decisions.map((d) => d.type)).toEqual(['governance.approval', 'decision.made']);
  });

  it('数据源 null → fallback 不崩', async () => {
    const p = new DecisionHistoryProvider(null);
    const f = await p.collect(baseInput);
    expect(f.data).toMatchObject({ totalCount: 0, source: 'fallback' });
  });
});

// ── UserProfileProvider ──

describe('UserProfileProvider', () => {
  it('数据源可用 → 返回真实用户画像 + source=real', async () => {
    const ontology = {
      queryObjects: async () => [
        { object: { id: 'user_1', properties: { responseStyle: 'practical', language: 'zh-CN' }, status: 'active' } },
      ],
    } as never;
    const p = new UserProfileProvider(ontology);
    const f = await p.collect({ ...baseInput, userId: 'user_1' });
    expect(f.source).toBe('user_profile');
    expect(f.taskRef).toBe('mission_ts5');
    expect(f.data).toMatchObject({ id: 'user_1', source: 'real' });
    expect((f.data as { preferences: { responseStyle: string } }).preferences.responseStyle).toBe('practical');
  });

  it('数据源 null → fallback 不崩', async () => {
    const p = new UserProfileProvider(null);
    const f = await p.collect(baseInput);
    expect(f.data).toMatchObject({ source: 'fallback' });
  });
});

// ── AgentStatusProvider ──

describe('AgentStatusProvider', () => {
  it('input.teamAgents 可用 → 返回真实 Agent 状态 + source=real', async () => {
    const p = new AgentStatusProvider();
    const f = await p.collect({
      ...baseInput,
      teamAgents: [
        { id: 'agent_1', role: 'executor', status: 'ACTIVE' },
        { id: 'agent_2', role: 'reviewer', status: 'COMPLETED' },
      ],
    });
    expect(f.source).toBe('agent_status');
    expect(f.taskRef).toBe('mission_ts5');
    expect(f.data).toMatchObject({ activeCount: 1, source: 'real' }); // COMPLETED 不计 active
  });

  it('无 teamAgents → fallback 不崩', async () => {
    const p = new AgentStatusProvider();
    const f = await p.collect(baseInput);
    expect(f.data).toMatchObject({ activeCount: 0, source: 'fallback' });
  });
});
