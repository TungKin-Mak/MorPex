import { ExperienceExtractor } from '../../packages/core/src/learning/ExperienceExtractor.js';
import { PlanEvaluator } from '../../packages/core/src/learning/PlanEvaluator.js';
import { StrategyOptimizer } from '../../packages/core/src/learning/StrategyOptimizer.js';
import { AssertionContext, type TestResult } from '../framework.js';

export async function run(): Promise<TestResult> {
  const assert = new AssertionContext();
  const start = Date.now();

  const extractor = new ExperienceExtractor();
  const evaluator = new PlanEvaluator();
  const optimizer = new StrategyOptimizer();

  const record = {
    executionId: 'exe-learn', goal: 'Build CLI tool with Node.js', planId: 'plan-learn',
    nodes: [
      { id: 'a', name: 'Init', status: 'success', duration: 1000 },
      { id: 'b', name: 'Implement', status: 'success', duration: 3000 },
      { id: 'c', name: 'Test', status: 'success', duration: 2000 },
    ],
    success: true, duration: 6000, errors: [], startTime: Date.now() - 6000, endTime: Date.now(),
  };

  const exp = extractor.extract(record);
  assert.assert(exp !== null, 'experience extracted');
  assert.assert(exp!.patterns.length >= 1, 'patterns extracted');
  assert.assert(exp!.lessons.length >= 1, 'lessons extracted');

  const plan = {
    planId: 'plan-learn', createdAt: Date.now(),
    nodes: [
      { id: 'a', name: 'Init', agentType: 'expert', description: '', deps: [], status: 'success' as const, priority: 1, retryCount: 0, maxRetries: 2 },
      { id: 'b', name: 'Implement', agentType: 'expert', description: '', deps: ['a'], status: 'success' as const, priority: 1, retryCount: 0, maxRetries: 2 },
      { id: 'c', name: 'Test', agentType: 'expert', description: '', deps: ['b'], status: 'success' as const, priority: 1, retryCount: 0, maxRetries: 2 },
    ],
    edges: [{ from: 'a', to: 'b', weight: 1 }, { from: 'b', to: 'c', weight: 1 }],
    status: { totalNodes: 3, totalEdges: 2, mutations: 0, isCyclic: false, canRollback: true, isComplete: true },
  };

  const evalResult = evaluator.evaluate(plan, record);
  assert.assert(evalResult !== null, 'evaluation produced');
  assert.assert(typeof evalResult!.score === 'number', 'evaluation score');

  const suggestions = optimizer.optimize();
  assert.assert(Array.isArray(suggestions), 'optimization suggestions');

  return {
    name: 'Integration: Execution→Learning', category: 'integration',
    passed: assert.errors.length === 0, duration: Date.now() - start,
    assertions: assert.total, assertionsPassed: assert.passed, errors: assert.errors,
  };
}
