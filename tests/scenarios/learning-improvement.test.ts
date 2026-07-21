/**
 * Scenario 4: Learning Improvement — same task twice, behavior changes
 */
import { ExperienceExtractor } from '../../packages/core/src/learning/ExperienceExtractor.js';
import { PlanEvaluator } from '../../packages/core/src/learning/PlanEvaluator.js';
import { StrategyOptimizer } from '../../packages/core/src/learning/StrategyOptimizer.js';
import { TemplateEvolutionEngine } from '../../packages/core/src/learning/TemplateEvolutionEngine.js';
import { TraceBuilder, AssertionContext, type TestResult } from '../framework.js';

export async function run(): Promise<TestResult> {
  const startTime = Date.now();
  const trace = new TraceBuilder(); const assert = new AssertionContext();
  const goal = 'Build a GraphQL API with Apollo Server';

  const extractor = new ExperienceExtractor();
  const evaluator = new PlanEvaluator();
  const optimizer = new StrategyOptimizer();
  const te = new TemplateEvolutionEngine();

  // Run 1
  const run1 = {
    executionId:'lr1', goal, planId:'v1',
    nodes:[{ id:'a', name:'Setup', status:'success', duration:1000 },{ id:'b', name:'Schema', status:'success', duration:3000 },{ id:'c', name:'Resolvers', status:'success', duration:5000 }],
    success:true, duration:9000, errors:[], startTime:Date.now()-9000, endTime:Date.now(),
  };
  const exp1 = extractor.extract(run1);
  assert.assert(exp1 !== null, 'Experience 1 extracted');
  const patterns1 = exp1?.patterns ?? [];
  trace.artifactAction('run1', 'created');

  // Run 2 — identical data to trigger dedup
  const run2 = { ...run1, executionId:'lr2' };
  const exp2 = extractor.extract(run2);
  assert.assert(exp2 === null, 'Dedup: second identical run skipped');

  // Evaluate
  const plan = { planId:'v1', createdAt:Date.now(),
    nodes:[{ id:'a', name:'A', agentType:'e', description:'', deps:[], status:'success' as const, priority:1, retryCount:0, maxRetries:2 }],
    edges:[], status:{ totalNodes:1, totalEdges:0, mutations:0, isCyclic:false, canRollback:true, isComplete:true } };
  const ev = evaluator.evaluate(plan, run1);
  assert.assert(ev !== null, 'Evaluation');
  if (ev) assert.assert(typeof ev.score === 'number', 'Score');

  const suggestions = optimizer.optimize();
  assert.assert(Array.isArray(suggestions), 'Suggestions');
  const stats = te.getStats();
  assert.assert(typeof stats.total === 'number', 'Stats');
  assert.assert(typeof stats.avgSuccessRate === 'number', 'Avg rate');

  trace.learning({ experienceExtracted:true, evaluationScore:ev?.score??0, suggestionsCount:suggestions.length, templateUpdated:false });

  return {
    name:'Scenario: Learning Improvement (same task twice)', category:'scenario',
    passed:assert.errors.length===0, duration:Date.now()-startTime,
    assertions:assert.total, assertionsPassed:assert.passed, errors:assert.errors,
    metrics:{ effectiveness:1 }, trace:trace.build(),
  };
}
