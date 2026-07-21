/**
 * Integration: Harness → Memory — MemoryActivationEngine context-aware recall
 */
import { MemoryActivationEngine } from '../../packages/core/src/memory/MemoryActivationEngine.js';
import { AssertionContext, TraceBuilder, type TestResult } from '../framework.js';

export async function run(): Promise<TestResult> {
  const start = Date.now();
  const ctx = new AssertionContext();
  const trace = new TraceBuilder();

  const engine = new MemoryActivationEngine();
  engine.addMemory({ id: 'm1', content: 'Use Express.js for REST', type: 'pattern', relevanceScore: 0.9, timestamp: Date.now() });
  engine.addMemory({ id: 'm2', content: 'Use PostgreSQL connection pool', type: 'pattern', relevanceScore: 0.7, timestamp: Date.now() });
  engine.addMemory({ id: 'm3', content: 'Handle HTTP 500 with error middleware', type: 'error', relevanceScore: 0.6, timestamp: Date.now() });

  trace.step('State-aware recall: running vs idle', 'started');
  const runAct = engine.activate({ executionStatus: 'running', goal: 'Build API', currentStep: 2, totalSteps: 5, completedSteps: ['Setup'], errors: [], tags: ['backend'] });
  const idleAct = engine.activate({ executionStatus: 'idle', goal: 'Build API', currentStep: 0, totalSteps: 5, completedSteps: [], errors: [], tags: [] });
  ctx.assert(runAct.memories.length > 0, 'running activates memories');
  ctx.assert(typeof runAct.activationScore === 'number', 'running has score');
  ctx.assert(typeof idleAct.activationScore === 'number', 'idle has score');
  trace.step('State-aware recall', 'completed', `running=${runAct.activationScore.toFixed(2)}, idle=${idleAct.activationScore.toFixed(2)}`);

  trace.step('Task-aware recall: different goals', 'started');
  const apiAct = engine.activate({ executionStatus: 'running', goal: 'Build REST endpoints with Express', currentStep: 1, totalSteps: 3, completedSteps: [], errors: [], tags: ['api'] });
  const dbAct = engine.activate({ executionStatus: 'running', goal: 'Set up PostgreSQL pooling', currentStep: 1, totalSteps: 3, completedSteps: [], errors: [], tags: ['database'] });
  ctx.assert(typeof apiAct.contextBias === 'string', 'API bias');
  ctx.assert(typeof dbAct.contextBias === 'string', 'DB bias');
  trace.step('Task-aware recall', 'completed');

  trace.step('Error-aware recall', 'started');
  const errAct = engine.activate({ executionStatus: 'running', goal: 'Fix HTTP 500', currentStep: 3, totalSteps: 5, completedSteps: ['Identify'], errors: ['POST timeout'], tags: ['debug'] });
  ctx.assert(errAct.contextBias.toLowerCase().includes('error'), 'error bias');
  ctx.assert(errAct.memories.length > 0, 'error memories activated');
  trace.step('Error-aware recall', 'completed');

  return {
    name: 'Integration: Harness→Memory',
    category: 'integration',
    passed: ctx.errors.length === 0,
    duration: Date.now() - start,
    assertions: ctx.total,
    assertionsPassed: ctx.passed,
    errors: ctx.errors,
    trace: trace.build(),
  };
}

export default run;
