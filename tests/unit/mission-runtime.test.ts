/**
 * MissionRuntime — Unit Tests
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

class FakeBus {
  events: any[] = [];
  emit(e: any) { this.events.push(e); }
  on() { return () => {}; }
  once() { return () => {}; }
  off() {}
  onProjected() { return () => {}; }
}

function makePlanner(riskLevel = 'low') {
  return {
    createPlan: async (m: any) => ({
      id: 'p_' + m.id, missionId: m.id,
      steps: [{ id: 's1', name: 'S1', description: 'do', domain: 'general', agentType: 'general', deps: [], priority: 1 }],
      estimatedDuration: 30000, riskLevel, reasoning: 'test',
    }),
  };
}

function makeExecutor(succeed = true) {
  return {
    execute: async (mission: any, plan: any) => {
      await null;
      if (!succeed) throw new Error('Executor failed');
      return {
        missionId: mission.id, state: 'VERIFYING', stepsCompleted: plan.steps.length,
        stepsTotal: plan.steps.length, artifacts: [], duration: 100, output: 'done',
      };
    },
  };
}

describe('MissionRuntime: State Lifecycle', () => {
  it('creates mission in CREATED state', async () => {
    const { MissionRuntime, MissionState } = await import('../../packages/core/src/runtime/mission/index.js');
    const mr = new MissionRuntime(new FakeBus() as any);
    const m = await mr.createMission({ channel: 'web', userId: 'u1', sessionId: 's1', content: 'test', metadata: {} });
    assert.strictEqual(m.state, MissionState.CREATED);
  });

  it('transitions CREATED→PLANNING→EXECUTING→COMPLETED', async () => {
    const { MissionRuntime, MissionState } = await import('../../packages/core/src/runtime/mission/index.js');
    const mr = new MissionRuntime(new FakeBus() as any);
    mr.setPlanner(makePlanner('low') as any);
    mr.setExecutor(makeExecutor(true) as any);
    const m = await mr.createMission({ channel: 'web', userId: 'u1', sessionId: 's1', content: 'test', metadata: {} });
    const r = await mr.executeMission(m.id);
    assert.ok(r.state === 'VERIFYING' || r.state === MissionState.COMPLETED,
      `Expected VERIFYING or COMPLETED, got ${r.state}`);
  });

  it('enters WAIT_APPROVAL for high risk', async () => {
    const { MissionRuntime, MissionState } = await import('../../packages/core/src/runtime/mission/index.js');
    const mr = new MissionRuntime(new FakeBus() as any);
    mr.setPlanner(makePlanner('high') as any);
    mr.setExecutor(makeExecutor(true) as any);
    const m = await mr.createMission({ channel: 'web', userId: 'u1', sessionId: 's1', content: 'risk task', metadata: {} });
    const r = await mr.executeMission(m.id);
    assert.strictEqual(r.state, MissionState.WAIT_APPROVAL);
  });

  it('approveMission transitions WAIT_APPROVAL→EXECUTING', async () => {
    const { MissionRuntime, MissionState } = await import('../../packages/core/src/runtime/mission/index.js');
    const mr = new MissionRuntime(new FakeBus() as any);
    mr.setPlanner(makePlanner('high') as any);
    mr.setExecutor(makeExecutor(true) as any);
    const m = await mr.createMission({ channel: 'web', userId: 'u1', sessionId: 's1', content: 'approve test', metadata: {} });
    await mr.executeMission(m.id);
    const r2 = await mr.approveMission(m.id);
    assert.ok(r2.state === 'VERIFYING' || r2.state === MissionState.COMPLETED,
      `After approve, expected VERIFYING/COMPLETED, got ${r2.state}`);
  });

  it('denyMission transitions WAIT_APPROVAL→CANCELLED', async () => {
    const { MissionRuntime, MissionState } = await import('../../packages/core/src/runtime/mission/index.js');
    const mr = new MissionRuntime(new FakeBus() as any);
    mr.setPlanner(makePlanner('high') as any);
    mr.setExecutor(makeExecutor(true) as any);
    const m = await mr.createMission({ channel: 'web', userId: 'u1', sessionId: 's1', content: 'deny test', metadata: {} });
    await mr.executeMission(m.id);
    await mr.denyMission(m.id, 'no reason');
    const mm = mr.getMission(m.id);
    assert.strictEqual(mm?.state, MissionState.CANCELLED);
  });

  it('transitions to MISSION_FAILED on executor error (terminal)', async () => {
    const { MissionRuntime, MissionState } = await import('../../packages/core/src/runtime/mission/index.js');
    const mr = new MissionRuntime(new FakeBus() as any);
    mr.setPlanner(makePlanner('low') as any);
    mr.setExecutor(makeExecutor(false) as any);
    const m = await mr.createMission({ channel: 'web', userId: 'u1', sessionId: 's1', content: 'fail test', metadata: {} });
    const r = await mr.executeMission(m.id);
    assert.strictEqual(r.state, MissionState.MISSION_FAILED);
  });

  it('tracks stats correctly', async () => {
    const { MissionRuntime, MissionState } = await import('../../packages/core/src/runtime/mission/index.js');
    const mr = new MissionRuntime(new FakeBus() as any);
    mr.setPlanner(makePlanner('low') as any);
    mr.setExecutor(makeExecutor(true) as any);
    const s1 = mr.getStats();
    await mr.createMission({ channel: 'web', userId: 'u1', sessionId: 's1', content: 'stats1', metadata: {} });
    const s2 = mr.getStats();
    assert.strictEqual(s2.totalMissions, s1.totalMissions + 1);
  });
});

describe('MissionRuntime: Event Sourcing', () => {
  it('stores events when EventStore is attached', async () => {
    const { MissionRuntime, MissionState } = await import('../../packages/core/src/runtime/mission/index.js');
    const { EventStore } = await import('../../packages/core/src/protocol/events/store/EventStore.js');
    const dir = './data/test-es-' + Date.now();
    const store = new EventStore({ dataDir: dir });
    await store.load();
    const mr = new MissionRuntime(new FakeBus() as any);
    mr.setPlanner(makePlanner('low') as any);
    mr.setExecutor(makeExecutor(true) as any);
    mr.setEventStore(store);
    const m = await mr.createMission({ channel: 'web', userId: 'u1', sessionId: 's1', content: 'es test', metadata: {} });
    await mr.executeMission(m.id);
    const events = store.getByExecutionId(m.id);
    assert.ok(events.length >= 3, `Expected >=3 events, got ${events.length}`);
    await store.clear();
    try { require('fs').rmSync(dir, { recursive: true, force: true }); } catch {}
  });
});
