/**
 * real-providers.test.ts — 功能③ Phase 2 A：真实数据 Provider（goal_graph / mission_state）
 *
 * 验证：装配输入带 currentTask 时，Provider 挂真实 taskRef；数据源可用返回真实数据；
 * 数据源不可用（null/查询失败/未找到）返回保守占位且不抛错（装配非阻断）。
 */
import { describe, it, expect } from 'vitest';
import { GoalGraphProvider, MissionStateProvider } from '../src/knowledge/context/providers/realProviders.js';

const input = {
  missionId: 'mis_real_1',
  goal: '开发设备固件',
  currentTask: { taskId: 'mis_real_1' },
};

describe('GoalGraphProvider — 读真实 Goal', () => {
  it('ontology 可用：返回真实 Goal + taskRef', async () => {
    const ontology = {
      queryObjects: async ({ type }: { type: string }) => [
        { object: { id: 'goal_1', properties: { title: '开发固件' }, status: 'active' } },
      ],
    } as any;
    const provider = new GoalGraphProvider(ontology);
    const frag = await provider.collect(input as any);
    expect(frag.source).toBe('goal_graph');
    expect(frag.taskRef).toBe('mis_real_1');
    expect(frag.data.source).toBe('real');
    expect((frag.data.goals as any[])[0].id).toBe('goal_1');
    expect((frag.data.goals as any[])[0].title).toBe('开发固件');
  });

  it('ontology 为 null / 查询失败：返回保守占位不抛错', async () => {
    const provider = new GoalGraphProvider(null);
    const frag = await provider.collect(input as any);
    expect(frag.data.source).toBe('fallback');
    expect(frag.taskRef).toBe('mis_real_1');

    const failing = new GoalGraphProvider({ queryObjects: async () => { throw new Error('db down'); } } as any);
    const frag2 = await failing.collect(input as any);
    expect(frag2.data.source).toBe('fallback');
  });
});

describe('MissionStateProvider — 读真实 Mission 状态', () => {
  it('mission 存在：返回真实状态 + taskRef', async () => {
    const reader = { getMission: (id: string) => (id === 'mis_real_1' ? { status: 'ACTIVE', phase: 'EXECUTING', progress: 30, goalId: 'goal_1' } : undefined) };
    const provider = new MissionStateProvider(reader);
    const frag = await provider.collect(input as any);
    expect(frag.source).toBe('mission_state');
    expect(frag.taskRef).toBe('mis_real_1');
    expect(frag.data.source).toBe('real');
    expect(frag.data.phase).toBe('EXECUTING');
    expect(frag.data.goalId).toBe('goal_1');
  });

  it('mission 未找到 / reader 为 null：返回保守占位不抛错', async () => {
    const provider = new MissionStateProvider(null);
    const frag = await provider.collect(input as any);
    expect(frag.data.source).toBe('fallback');
    expect(frag.data.status).toBe('ACTIVE');

    const empty = new MissionStateProvider({ getMission: () => undefined });
    const frag2 = await empty.collect(input as any);
    expect(frag2.data.source).toBe('fallback');
  });
});
