import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('BehaviorTwin', () => {
  it('returns sensible defaults with no observations', async () => {
    const { BehaviorTwin } = await import('../../packages/core/src/cognition/twin/BehaviorTwin.js');
    const p = new BehaviorTwin('u1').buildProfile();
    assert.equal(p.planningStyle, 'top-down');
    assert.equal(p.riskTolerance, 'medium');
    assert.equal(p.reviewHabit, 'milestone');
    assert.equal(p.taskDecomposition, 'moderate');
    assert.equal(p.confidence, 0);
    assert.equal(p.evidenceCount, 0);
  });
  it('increases confidence with evidence', async () => {
    const { BehaviorTwin } = await import('../../packages/core/src/cognition/twin/BehaviorTwin.js');
    const t = new BehaviorTwin('u1');
    for (let i = 0; i < 10; i++) t.recordActivity(Date.now());
    assert.equal(t.buildProfile().confidence, 0.5);
  });
  it('caps confidence at 1.0', async () => {
    const { BehaviorTwin } = await import('../../packages/core/src/cognition/twin/BehaviorTwin.js');
    const t = new BehaviorTwin('u1');
    for (let i = 0; i < 30; i++) t.recordActivity(Date.now());
    assert.equal(t.buildProfile().confidence, 1.0);
  });
  it('infers risk tolerance from approvals', async () => {
    const { BehaviorTwin } = await import('../../packages/core/src/cognition/twin/BehaviorTwin.js');
    const t = new BehaviorTwin('u1');
    t.recordApproval(false, 1000); t.recordApproval(false, 5000); t.recordApproval(false, 2000);
    assert.equal(t.buildProfile().riskTolerance, 'low');
  });
  it('round-trips via toJSON/fromJSON', async () => {
    const { BehaviorTwin } = await import('../../packages/core/src/cognition/twin/BehaviorTwin.js');
    const t = new BehaviorTwin('ser');
    t.recordActivity(Date.now()); t.recordApproval(true, 60000);
    const r = BehaviorTwin.fromJSON(t.toJSON() as any);
    assert.equal(r.buildProfile().evidenceCount, t.buildProfile().evidenceCount);
  });
  it('handles 100 observations', async () => {
    const { BehaviorTwin } = await import('../../packages/core/src/cognition/twin/BehaviorTwin.js');
    const t = new BehaviorTwin('u1');
    for (let i = 0; i < 100; i++) t.recordActivity(Date.now());
    assert.doesNotThrow(() => t.buildProfile());
  });
  it('keeps instances independent', async () => {
    const { BehaviorTwin } = await import('../../packages/core/src/cognition/twin/BehaviorTwin.js');
    const a = new BehaviorTwin('a'); const b = new BehaviorTwin('b');
    a.recordActivity(Date.now());
    assert.equal(a.buildProfile().evidenceCount, 1);
    assert.equal(b.buildProfile().evidenceCount, 0);
  });
});
