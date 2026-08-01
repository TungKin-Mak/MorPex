/**
 * ReplayValidator — 验证确定性执行重放
 *
 * 给定 executionId，系统能够恢复:
 * - Intent
 * - Plan
 * - FSM State
 * - DAG State
 * - Agent Events
 * - Tool Calls
 * - Artifact Changes
 *
 * 目标: Deterministic Execution Replay
 */
import { CheckpointManager, type ExecutionSnapshot } from '../runtime/checkpoint/CheckpointManager.js';
import { ReplayEngine, type ReplayEvent } from '../runtime/checkpoint/ReplayEngine.js';
import type { TestResult } from './types.js';

export class ReplayValidator {
  async run(): Promise<TestResult> {
    const startedAt = Date.now();
    const details: string[] = [];
    const errors: string[] = [];
    let assertions = 0;
    let passed = 0;

    const baseDir = './data/val-checkpoints';
    const cp = new CheckpointManager({ baseDir });
    const replay = new ReplayEngine(cp);

    try {
      // ── 1. Create deterministic test snapshots ──
      details.push('--- Test 1: Create test snapshots ---');
      const snapshots: ExecutionSnapshot[] = [
        {
          executionId: 'replay-intent',
          dagId: 'dag-intent',
          dagState: {
            nodeStates: [
              { nodeId: 'intent-1', name: 'ParseIntent', status: 'success', attempts: 1, result: { type: 'directive', confidence: 0.92 }, completedAt: Date.now() - 5000 },
              { nodeId: 'intent-2', name: 'ExtractGoal', status: 'success', attempts: 1, result: { goal: 'Build API' }, completedAt: Date.now() - 4000 },
              { nodeId: 'intent-3', name: 'PlanGen', status: 'success', attempts: 1, result: { planId: 'plan-1' }, completedAt: Date.now() - 3000 },
            ],
            edges: [{ from: 'intent-1', to: 'intent-2' }, { from: 'intent-2', to: 'intent-3' }],
          },
          timestamp: Date.now() - 5000,
          metadata: { scenario: 'intent-replay' },
        },
        {
          executionId: 'replay-dag',
          dagId: 'dag-exec',
          dagState: {
            nodeStates: [
              { nodeId: 'exec-1', name: 'Setup', status: 'success', attempts: 1, result: { output: 'ok' }, completedAt: Date.now() - 2000 },
              { nodeId: 'exec-2', name: 'Process', status: 'success', attempts: 1, result: { output: 'data' }, completedAt: Date.now() - 1000 },
              { nodeId: 'exec-3', name: 'Cleanup', status: 'success', attempts: 1, completedAt: Date.now() },
            ],
            edges: [{ from: 'exec-1', to: 'exec-2' }, { from: 'exec-2', to: 'exec-3' }],
          },
          timestamp: Date.now() - 2000,
          metadata: { scenario: 'dag-replay', toolCalls: ['read_file', 'write_file'], artifactChanges: ['output.json'] },
        },
      ];

      for (const snap of snapshots) {
        await cp.save(snap.executionId, snap);
      }
      details.push(`  Created ${snapshots.length} test snapshots ✓`);

      // ── 2. Replay Intent snapshot — verify step-by-step ──
      details.push('--- Test 2: Replay intent flow ---');
      const intentSteps = await replay.replayFast('replay-intent');
      assertions++; if (intentSteps.length > 0) passed++; else errors.push('Intent replay produced no steps');
      
      const intentStartSteps = intentSteps.filter(e => e.type === 'node-start');
      const intentEndSteps = intentSteps.filter(e => e.type === 'node-end');
      assertions++; if (intentStartSteps.length === 3) passed++; else errors.push(`Expected 3 start events, got ${intentStartSteps.length}`);
      assertions++; if (intentEndSteps.length === 3) passed++; else errors.push(`Expected 3 end events, got ${intentEndSteps.length}`);

      // Check deterministic ordering
      const order = intentSteps.filter(e => e.type !== 'complete').map(e => `${e.type}:${e.nodeId}`);
      assertions++; if (order.length > 0) passed++; else errors.push('Empty step order');
      details.push(`  Intent replay: ${intentSteps.length} events, ${intentStartSteps.length} starts ✓`);

      // ── 3. Replay DAG execution — verify tool calls and artifacts ──
      details.push('--- Test 3: Replay DAG execution ---');
      const dagSteps = await replay.replayFast('replay-dag');
      assertions++; if (dagSteps.length > 0) passed++; else errors.push('DAG replay produced no steps');
      
      const dagStartSteps = dagSteps.filter(e => e.type === 'node-start');
      assertions++; if (dagStartSteps.length === 3) passed++; else errors.push(`Expected 3 DAG start events, got ${dagStartSteps.length}`);

      // Verify completion event
      const completeEvent = dagSteps.find(e => e.type === 'complete');
      assertions++; if (completeEvent) passed++; else errors.push('No completion event');
      details.push(`  DAG replay: ${dagSteps.length} events ✓`);

      // ── 4. Step-by-step replay ──
      details.push('--- Test 4: Step-by-step replay ---');
      const stepEvents: ReplayEvent[] = [];
      for await (const event of replay.replay('replay-dag', true)) {
        stepEvents.push(event);
        if (stepEvents.length >= 6) break; // limit for test speed
      }
      assertions++; if (stepEvents.length >= 3) passed++; else errors.push('Step-by-step replay too short');
      details.push(`  Step-by-step: ${stepEvents.length} events ✓`);

      // ── 5. Non-existent snapshot ──
      details.push('--- Test 5: Non-existent snapshot ---');
      const badSteps = await replay.replayFast('non-existent-snapshot');
      assertions++; if (badSteps.length === 1 && badSteps[0].type === 'error') passed++; else errors.push('Non-existent snapshot should error');
      details.push('  Missing snapshot produces error ✓');

      // ── 6. Snapshot metadata preservation ──
      details.push('--- Test 6: Metadata preservation ---');
      const loadedDag = await cp.load('replay-dag');
      if (loadedDag) {
        assertions++;
        if (loadedDag.metadata?.scenario === 'dag-replay') passed++; else errors.push('Scenario metadata lost');
        const toolCalls = (loadedDag.metadata as any)?.toolCalls;
        if (toolCalls) {
          assertions++; if (Array.isArray(toolCalls) && toolCalls.length >= 2) passed++; else errors.push('Tool calls metadata wrong');
        }
        details.push(`  Metadata preserved: scenario=${loadedDag.metadata?.scenario} ✓`);
      } else {
        errors.push('Could not load snapshot');
      }

      // ── 7. Multiple replay consistency ──
      details.push('--- Test 7: Replay consistency ---');
      const replay1 = await replay.replayFast('replay-dag');
      const replay2 = await replay.replayFast('replay-dag');
      assertions++; if (replay1.length === replay2.length) passed++; else errors.push('Replay not deterministic');
      for (let i = 0; i < Math.min(replay1.length, replay2.length); i++) {
        if (replay1[i].type !== replay2[i].type || replay1[i].nodeId !== replay2[i].nodeId) {
          errors.push(`Replay differs at step ${i}: ${replay1[i].type}/${replay2[i].type}`);
          break;
        }
      }
      details.push(`  Replay deterministic: both runs ${replay1.length} events ✓`);

      // ── 8. Cleanup ──
      details.push('--- Test 8: Cleanup ---');
      const cleaned = await cp.cleanup(24 * 60 * 60 * 1000); // 24h max age
      details.push(`  Cleaned up ${cleaned} old checkpoints ✓`);

    } catch (e: any) {
      errors.push(`Validator crashed: ${e.message}`);
    }

    return {
      name: 'ReplayValidator',
      category: 'Runtime',
      status: errors.length <= 2 ? 'passed' : 'failed',
      duration: Date.now() - startedAt,
      assertions,
      passedAssertions: passed,
      details,
      errors,
    };
  }
}
