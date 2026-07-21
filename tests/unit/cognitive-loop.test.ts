/**
 * CognitiveLoop Unit Tests
 *
 * Tests the 9-phase cognitive loop:
 *   detectIntent → matchGoals → retrieveTwin → createMission →
 *   executeWithTwinConstraints → learn → mineWorkflows → updateTwin → persistBrain
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

class MockEventBus {
  public events: any[] = [];
  emit(e: any) { this.events.push(e); }
  on() { return () => {}; }
  onProjected() { return () => {}; }
  getHistory() { return []; }
}

class MockMissionRuntime {
  public missions: any[] = [];
  async createMission(msg: any) {
    const m = { id: `mis_test_${Date.now()}`, goal: msg.content, owner: msg.userId, state: 'CREATED',
      context: { channel: msg.channel, sessionId: msg.sessionId, originalMessage: msg.content, metadata: {} },
      metadata: {}, createdAt: Date.now(), updatedAt: Date.now() };
    this.missions.push(m); return m;
  }
  async executeMission(id: string) {
    const m = this.missions.find(x => x.id === id);
    if (!m) throw new Error('not found');
    m.state = 'COMPLETED';
    return { missionId: id, state: 'COMPLETED', stepsCompleted: 1, stepsTotal: 1, artifacts: [], duration: 100, error: undefined };
  }
  getMission(id: string) { return this.missions.find(x => x.id === id) || null; }
  listMissions() { return [...this.missions]; }
}

class MockBehaviorTwin {
  buildProfile() { return { userId: 'test', planningStyle: 'top-down', riskTolerance: 'medium', workHours: { startHour: 9, endHour: 18 }, reviewHabit: 'milestone', taskDecomposition: 'moderate', preferredAgentTypes: ['coding'], preferredDomains: [], averageMissionDuration: 5000, collaborationStyle: 'solo', confidence: 0.8, lastUpdated: Date.now(), evidenceCount: 10 }; }
  recordMission() {}
}

class MockDecisionTwin {
  async buildProfile() { return { userId: 'test', decisionStyle: 'balanced', commonFactors: [], lastUpdated: Date.now() }; }
  recordOutcome() {}
}

class MockPreferenceModel {
  buildProfile() { return { userId: 'test', preferences: [], confidence: 0.5 }; }
  record() {}
}

class MockWorkflowMiner { async mine() { return []; } }
class MockWorkflowRegistry {
  workflows: any[] = [];
  getAll() { return this.workflows; }
  register(c: any) { const w = { id: `wf_${Date.now()}`, name: c.name, status: 'confirmed' }; this.workflows.push(w); return w; }
  activate(id: string) { const w = this.workflows.find(x => x.id === id); if (w) w.status = 'active'; }
  getAutoExecutable() { return []; }
}
class MockWorkflowExecutor { async executeScheduled() { return 0; } }

describe('CognitiveLoop: Intent Detection', () => {
  it('should detect intent and complete successfully', async () => {
    const { CognitiveLoop } = await import('../../packages/core/src/runtime/cognitive-loop/CognitiveLoop.js');
    const cl = new CognitiveLoop(new MockEventBus(), new MockMissionRuntime());
    const ctx = await cl.process({ channel: 'web', userId: 'u1', sessionId: 's1', content: '分析三个竞争产品', metadata: {} });
    assert.ok(ctx.intent);
    assert.equal(ctx.intent.goal, '分析三个竞争产品');
    assert.ok(ctx.intent.keywords.length > 0);
    assert.equal(ctx.phase, 'completed');
  });

  it('should handle empty content gracefully', async () => {
    const { CognitiveLoop } = await import('../../packages/core/src/runtime/cognitive-loop/CognitiveLoop.js');
    const cl = new CognitiveLoop(new MockEventBus(), new MockMissionRuntime());
    const ctx = await cl.process({ channel: 'web', userId: 'u1', sessionId: 's1', content: '', metadata: {} });
    assert.ok(ctx.phase === 'completed' || ctx.phase === 'failed');
  });
});

describe('CognitiveLoop: Twin Injection', () => {
  it('should inject plannerConstraint into mission.metadata', async () => {
    const { CognitiveLoop } = await import('../../packages/core/src/runtime/cognitive-loop/CognitiveLoop.js');
    const cl = new CognitiveLoop(new MockEventBus(), new MockMissionRuntime(), {
      behaviorTwin: new MockBehaviorTwin(), decisionTwin: new MockDecisionTwin(), preferenceModel: new MockPreferenceModel(),
    });
    const ctx = await cl.process({ channel: 'web', userId: 'u1', sessionId: 's1', content: '投资人会议', metadata: {} });
    assert.ok(ctx.mission);
    assert.ok(ctx.behaviorProfile);
    const meta = ctx.mission?.metadata as Record<string, any>;
    assert.ok(meta?.plannerConstraint, 'plannerConstraint should be in metadata');
  });
});

describe('CognitiveLoop: Workflow Mining', () => {
  it('should run 3 missions without mining errors', async () => {
    const { CognitiveLoop } = await import('../../packages/core/src/runtime/cognitive-loop/CognitiveLoop.js');
    const cl = new CognitiveLoop(new MockEventBus(), new MockMissionRuntime(), {
      workflowMiner: new MockWorkflowMiner(), workflowRegistry: new MockWorkflowRegistry(), workflowExecutor: new MockWorkflowExecutor(),
    });
    const msg = { channel: 'web', userId: 'u1', sessionId: 's1', content: 'test', metadata: {} };
    for (let i = 0; i < 3; i++) await cl.process(msg);
    assert.equal(cl.getStats().totalLoops, 3);
    assert.equal(cl.getStats().successfulLoops, 3);
  });
});

describe('CognitiveLoop: asMessageHandler', () => {
  it('should return valid shape', async () => {
    const { CognitiveLoop } = await import('../../packages/core/src/runtime/cognitive-loop/CognitiveLoop.js');
    const cl = new CognitiveLoop(new MockEventBus(), new MockMissionRuntime());
    const handler = cl.asMessageHandler();
    const result = await handler({ channel: 'web', userId: 'u1', sessionId: 's1', content: 'test', metadata: {} });
    assert.ok(result.content);
    assert.equal(result.channel, 'web');
    assert.equal(result.type, 'text');
    assert.ok(result.metadata.missionId);
  });
});

describe('CognitiveLoop: Stats', () => {
  it('should track loop statistics', async () => {
    const { CognitiveLoop } = await import('../../packages/core/src/runtime/cognitive-loop/CognitiveLoop.js');
    const cl = new CognitiveLoop(new MockEventBus(), new MockMissionRuntime());
    assert.equal(cl.getStats().totalLoops, 0);
    await cl.process({ channel: 'web', userId: 'u1', sessionId: 's1', content: '统计测试', metadata: {} });
    assert.equal(cl.getStats().totalLoops, 1);
    assert.equal(cl.getStats().successfulLoops, 1);
    assert.ok(cl.getStats().averageDurationMs >= 0, "Duration should be >= 0");
  });
});
