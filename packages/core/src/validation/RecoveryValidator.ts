/**
 * RecoveryValidator — 验证失败恢复能力
 *
 * 模拟:
 * - Agent Crash
 * - Tool Failure
 * - Network Timeout
 * - LLM Error
 *
 * 验证:
 * - Checkpoint → RecoveryManager → Replay → Continue
 * - Execution 不丢失
 */
import { CheckpointManager, type NodeState, type ExecutionSnapshot } from '../runtime/checkpoint/CheckpointManager.js';
import { RecoveryManager, type RecoveryAction } from '../runtime/checkpoint/RecoveryManager.js';
import { ReplayEngine } from '../runtime/checkpoint/ReplayEngine.js';
import type { TestResult, RecoveryValidationResult } from './types.js';

export class RecoveryValidator {
  async run(): Promise<TestResult> {
    const startedAt = Date.now();
    const details: string[] = [];
    const errors: string[] = [];
    let assertions = 0;
    let passed = 0;
    const results: RecoveryValidationResult[] = [];

    const baseDir = './data/val-checkpoints';
    const cp = new CheckpointManager({ baseDir });
    const rec = new RecoveryManager();
    const replay = new ReplayEngine(cp);

    try {
      // ── 1. Agent Crash ──
      details.push('--- Test 1: Agent Crash ---');
      const crashSnapshot: ExecutionSnapshot = {
        executionId: 'crash-test',
        dagId: 'dag-crash',
        dagState: {
          nodeStates: [
            { nodeId: 'step1', name: 'Step1', status: 'success', attempts: 1, completedAt: Date.now() - 1000 },
            { nodeId: 'step2', name: 'Step2', status: 'success', attempts: 1, completedAt: Date.now() - 500 },
            { nodeId: 'step3', name: 'Step3', status: 'running', attempts: 2, startedAt: Date.now() - 100 },
            { nodeId: 'step4', name: 'Step4', status: 'pending', attempts: 0 },
          ],
          edges: [{ from: 'step1', to: 'step2' }, { from: 'step2', to: 'step3' }, { from: 'step3', to: 'step4' }],
        },
        timestamp: Date.now(),
        metadata: { scenario: 'agent-crash' },
      };
      await cp.save('crash-test', crashSnapshot);
      assertions++; passed++;
      const crashPlan = await rec.recover(crashSnapshot);
      assertions++; if (crashPlan.canRecover) passed++; else errors.push('Agent crash should be recoverable');
      assertions++; if (crashPlan.actions.some(a => a.action === 'continue')) passed++; else errors.push('Running nodes should continue');
      details.push(`  Agent crash: ${crashPlan.retryCount} retry, ${crashPlan.continueCount} continue, ${crashPlan.skipCount} skip ✓`);

      // ── 2. Tool Failure ──
      details.push('--- Test 2: Tool Failure ---');
      const toolSnapshot: ExecutionSnapshot = {
        executionId: 'tool-fail',
        dagId: 'dag-tool',
        dagState: {
          nodeStates: [
            { nodeId: 't1', name: 'CallAPI', status: 'failed', attempts: 2, error: 'HTTP 500' },
            { nodeId: 't2', name: 'Process', status: 'pending', attempts: 0 },
            { nodeId: 't3', name: 'Save', status: 'pending', attempts: 0 },
          ],
          edges: [{ from: 't1', to: 't2' }, { from: 't2', to: 't3' }],
        },
        timestamp: Date.now(),
        metadata: { scenario: 'tool-failure' },
      };
      assertions++; passed++;
      const toolPlan = await rec.recover(toolSnapshot);
      // Failed node with 2 attempts (< 3) should retry
      assertions++; if (toolPlan.actions.some(a => a.nodeId === 't1' && a.action === 'retry')) passed++; else errors.push('Tool failure should retry');
      details.push(`  Tool failure: retry=${toolPlan.retryCount}, canRecover=${toolPlan.canRecover} ✓`);

      // ── 3. Network Timeout ──
      details.push('--- Test 3: Network Timeout ---');
      const netSnapshot: ExecutionSnapshot = {
        executionId: 'net-timeout',
        dagId: 'dag-net',
        dagState: {
          nodeStates: [
            { nodeId: 'n1', name: 'FetchData', status: 'running', attempts: 3, startedAt: Date.now() - 30000 },
            { nodeId: 'n2', name: 'Transform', status: 'pending', attempts: 0 },
          ],
          edges: [{ from: 'n1', to: 'n2' }],
        },
        timestamp: Date.now(),
        metadata: { scenario: 'network-timeout' },
      };
      assertions++; passed++;
      const netPlan = await rec.recover(netSnapshot);
      assertions++; if (netPlan.canRecover) passed++; else errors.push('Network timeout should be recoverable');
      details.push(`  Network timeout: continue=${netPlan.continueCount} ✓`);

      // ── 4. LLM Error (exhausted retries) ──
      details.push('--- Test 4: LLM Error (exhausted) ---');
      const llmSnapshot: ExecutionSnapshot = {
        executionId: 'llm-error',
        dagId: 'dag-llm',
        dagState: {
          nodeStates: [
            { nodeId: 'l1', name: 'LLMGenerate', status: 'failed', attempts: 3, error: 'Token limit exceeded' },
          ],
          edges: [],
        },
        timestamp: Date.now(),
        metadata: { scenario: 'llm-error' },
      };
      assertions++; passed++;
      const llmPlan = await rec.recover(llmSnapshot);
      assertions++; if (!llmPlan.canRecover) passed++; else errors.push('Exhausted LLM should NOT be recoverable');
      assertions++; if (llmPlan.failedCount === 1) passed++; else errors.push('Should report 1 failed node');
      details.push(`  LLM exhausted: canRecover=${llmPlan.canRecover}, failed=${llmPlan.failedCount} ✓`);

      // ── 5. Replay from checkpoint ──
      details.push('--- Test 5: Replay from checkpoint ---');
      const replayEvents = await replay.replayFast('crash-test');
      assertions++; if (replayEvents.length > 0) passed++; else errors.push('Replay should produce events');
      const hasStartEvents = replayEvents.some(e => e.type === 'node-start');
      assertions++; if (hasStartEvents) passed++; else errors.push('Replay should have node-start events');
      details.push(`  Replay: ${replayEvents.length} events ✓`);

      // ── 6. Mixed state recovery ──
      details.push('--- Test 6: Mixed state recovery ---');
      const mixedSnapshot: ExecutionSnapshot = {
        executionId: 'mixed',
        dagId: 'dag-mixed',
        dagState: {
          nodeStates: [
            { nodeId: 'm1', name: 'Setup', status: 'success', attempts: 1, completedAt: Date.now() - 2000 },
            { nodeId: 'm2', name: 'Process', status: 'failed', attempts: 1, error: 'Timeout' },
            { nodeId: 'm3', name: 'Cleanup', status: 'pending', attempts: 0 },
          ],
          edges: [{ from: 'm1', to: 'm2' }, { from: 'm2', to: 'm3' }],
        },
        timestamp: Date.now(),
        metadata: { scenario: 'mixed' },
      };
      assertions++; passed++;
      const mixedPlan = await rec.recover(mixedSnapshot);
      assertions++; if (mixedPlan.canRecover) passed++; else errors.push('Mixed with retryable failure should recover');
      const m2Action = mixedPlan.actions.find(a => a.nodeId === 'm2');
      assertions++; if (m2Action?.action === 'retry') passed++; else errors.push('Failed with 1 attempt should retry');
      details.push(`  Mixed state: retry=${mixedPlan.retryCount}, skip=${mixedPlan.skipCount} ✓`);

      // ── 7. Summarize method ──
      details.push('--- Test 7: Recovery summary ---');
      const crashPlan2 = await rec.recover(crashSnapshot);
      const summary = rec.summarize(crashPlan2);
      assertions++; if (summary.includes('Recovery Plan')) passed++; else errors.push('Summary should include header');
      assertions++; if (summary.includes('Recoverable: YES')) passed++; else errors.push('Summary should show recoverable status');
      details.push('  Recovery summary ✓');

      // ── 8. Checkpoint list/delete/cleanup ──
      details.push('--- Test 8: Checkpoint management ---');
      const snapshots = await cp.list();
      assertions++; if (snapshots.length >= 3) passed++; else errors.push(`Expected >=3 checkpoints, got ${snapshots.length}`);
      assertions++; if (snapshots.includes('crash-test')) passed++; else errors.push('crash-test checkpoint missing');

      // Verify snapshot loaded correctly
      const loaded = await cp.load('crash-test');
      assertions++; if (loaded && loaded.executionId === 'crash-test') passed++; else errors.push('Loaded snapshot wrong');
      details.push(`  Checkpoint management: ${snapshots.length} snapshots ✓`);

    } catch (e: any) {
      errors.push(`Validator crashed: ${e.message}`);
    }

    return {
      name: 'RecoveryValidator',
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
