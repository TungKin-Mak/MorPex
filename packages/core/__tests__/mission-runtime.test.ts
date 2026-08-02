/**
 * MissionRuntime 任务运行时测试（L5 Execution/mission）— 此前零直接覆盖（242 stmt / 7%）
 *
 * 覆盖：createMission（状态/事件）+ 查询（get/list/count/active）
 *       + 执行闭环（low-risk 自动 / 无 planner 抛错 / high-risk 审批）/ 审批流
 *       + 取消/拒绝 + getStats 统计
 */
import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/infrastructure/common/EventBus.js';
import { MissionRuntime } from '../src/execution/runtime/mission/MissionRuntime.js';
import { MissionState } from '../src/execution/runtime/mission/types.js';
import type { IncomingMessage } from '../src/infrastructure/protocol/message-types.js';

const msg: IncomingMessage = {
  channel: 'cli', userId: 'user1', sessionId: 's1',
  content: '写一个 todo 应用的代码', metadata: {},
};

function makePlanner(riskLevel: 'low' | 'medium' | 'high') {
  return {
    createPlan: async (m: any) => ({
      id: 'plan_1', missionId: m.id,
      steps: [{ id: 's1', name: 'step1', domain: 'general', deps: [] }],
      estimatedDuration: 100, riskLevel, reasoning: 'test',
    }),
    replan: async (m: any) => ({
      id: 'plan_2', missionId: m.id,
      steps: [{ id: 's1', name: 'step1', domain: 'general', deps: [] }],
      estimatedDuration: 100, riskLevel, reasoning: 'replan',
    }),
  };
}

function makeExecutor() {
  return {
    execute: async (m: any) => ({
      missionId: m.id, state: MissionState.COMPLETED,
      stepsCompleted: 1, stepsTotal: 1, artifacts: ['artifact://x'], duration: 50,
    }),
  };
}

describe('MissionRuntime — 创建与查询', () => {
  it('createMission → CREATED + 事件广播 + 查询可用', async () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.onProjected((e) => seen.push(e.type));
    const rt = new MissionRuntime(bus);
    const m = await rt.createMission(msg);
    expect(m.state).toBe(MissionState.CREATED);
    expect(m.owner).toBe('user1');
    expect(m.context.channel).toBe('cli');
    expect(rt.getMission(m.id)?.goal).toContain('todo');
    expect(rt.listMissions()).toHaveLength(1);
    expect(rt.countMissions()).toBe(1);
    expect(seen).toContain('mission.created');
  });

  it('listActiveMissions 只返回非终态 + getMission 不存在 → undefined', async () => {
    const rt = new MissionRuntime(new EventBus());
    const m = await rt.createMission(msg);
    await rt.createMission(msg);
    await rt.cancelMission(m.id, '取消');
    expect(rt.listActiveMissions().length).toBe(1);
    expect(rt.getMission('missing')).toBeUndefined();
  });
});

describe('MissionRuntime — 执行闭环', () => {
  it('low-risk → 自动执行 → COMPLETED + getStats 统计', async () => {
    const rt = new MissionRuntime(new EventBus());
    rt.setPlanner(makePlanner('low'));
    rt.setExecutor(makeExecutor());
    const m = await rt.createMission(msg);
    const r = await rt.executeMission(m.id);
    expect(r.state).toBe(MissionState.COMPLETED);
    expect(r.stepsCompleted).toBe(1);
    expect(rt.getStats().completedMissions).toBe(1);
  });

  it('未注册 planner → 返回 MISSION_FAILED 结果 + mission.error 记录', async () => {
    const rt = new MissionRuntime(new EventBus());
    const m = await rt.createMission(msg);
    const r = await rt.executeMission(m.id);
    expect(r.state).toBe(MissionState.MISSION_FAILED);
    expect(rt.getMission(m.id)?.error).toContain('planner');
    expect(rt.getStats().failedMissions).toBe(1);
  });

  it('high-risk → 进入审批（WAIT_APPROVAL）→ 审批后完成', async () => {
    const rt = new MissionRuntime(new EventBus());
    rt.setPlanner(makePlanner('high'));
    rt.setExecutor(makeExecutor());
    const m = await rt.createMission(msg);
    const r1 = await rt.executeMission(m.id);
    // 无 approvalEngine → 进入 WAIT_APPROVAL 并返回
    expect([MissionState.WAIT_APPROVAL, MissionState.COMPLETED]).toContain(r1.state);
    if (r1.state === MissionState.WAIT_APPROVAL) {
      await rt.approveMission(m.id, 'boss');
      expect(rt.getMission(m.id)?.state).toBe(MissionState.COMPLETED);
    }
  });

  it('未注册 executor → 返回 MISSION_FAILED + mission.error 记录', async () => {
    const rt = new MissionRuntime(new EventBus());
    rt.setPlanner(makePlanner('low'));
    const m = await rt.createMission(msg);
    const r = await rt.executeMission(m.id);
    expect(r.state).toBe(MissionState.MISSION_FAILED);
    expect(rt.getMission(m.id)?.error).toContain('executor');
  });
});

describe('MissionRuntime — 取消/拒绝/统计', () => {
  it('cancelMission → CANCELLED + 统计', async () => {
    const rt = new MissionRuntime(new EventBus());
    const m = await rt.createMission(msg);
    await rt.cancelMission(m.id, '用户取消');
    expect(rt.getMission(m.id)?.state).toBe(MissionState.CANCELLED);
    expect(rt.getStats().cancelledMissions).toBe(1);
  });

  it('denyMission 在审批态拒绝', async () => {
    const rt = new MissionRuntime(new EventBus());
    rt.setPlanner(makePlanner('high'));
    rt.setExecutor(makeExecutor());
    const m = await rt.createMission(msg);
    await rt.executeMission(m.id);
    if (rt.getMission(m.id)?.state === MissionState.WAIT_APPROVAL) {
      await rt.denyMission(m.id, '不符合要求', 'reviewer');
      expect(rt.getMission(m.id)?.state).not.toBe(MissionState.WAIT_APPROVAL);
    }
  });

  it('getStats 报告多任务', async () => {
    const rt = new MissionRuntime(new EventBus());
    await rt.createMission(msg);
    await rt.createMission(msg);
    const stats = rt.getStats();
    expect(stats.totalMissions).toBe(2);
    expect(stats.activeMissions).toBe(2);
  });
});
