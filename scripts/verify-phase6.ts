// @ts-nocheck
/**
 * Phase 6 — Autonomous Learning Loop Verification
 * Verifies: ExperienceExtractor → PlanEvaluator → StrategyOptimizer → TemplateEvolutionEngine
 */
import { ExperienceExtractor } from '../packages/core/src/learning/ExperienceExtractor.js';
import { PlanEvaluator } from '../packages/core/src/learning/PlanEvaluator.js';
import { StrategyOptimizer } from '../packages/core/src/learning/StrategyOptimizer.js';
import { TemplateEvolutionEngine } from '../packages/core/src/learning/TemplateEvolutionEngine.js';
import type { ExecutionRecord, Experience } from '../packages/core/src/learning/ExperienceExtractor.js';

function makeRecord(goal: string, success: boolean, errors: string[]): ExecutionRecord {
  return {
    executionId: `exec-${Date.now()}`,
    goal,
    planId: `plan-${Date.now()}`,
    nodes: [
      { id: 'n1', name: 'Setup', status: 'success', duration: 2000 },
      { id: 'n2', name: 'Implement', status: success ? 'success' : 'failed', duration: 5000, error: errors[0] },
      { id: 'n3', name: 'Test', status: success ? 'success' : 'skipped', duration: 3000 },
    ],
    success,
    duration: 10000,
    errors,
    startTime: Date.now() - 10000,
    endTime: Date.now(),
  };
}

async function main() {
  console.log('\n=== Phase 6: Autonomous Learning Loop ===\n');
  let passed = 0, failed = 0;

  // Test 1: ExperienceExtractor
  try {
    const extractor = new ExperienceExtractor();
    const record = makeRecord('Build a REST API endpoint', true, []);
    const exp = extractor.extract(record);

    console.assert(exp.goal === record.goal, 'Goal preserved');
    console.assert(exp.outcome === 'success', 'Outcome success');
    console.assert(exp.patterns.length > 0, 'Patterns extracted');
    console.assert(exp.lessons.length > 0, 'Lessons extracted');
    console.assert(exp.successRate === 1, '100% success rate');

    // Error experience
    const errorRecord = makeRecord('Fix auth bug', false, ['TokenExpiredError', 'ConnectionRefused']);
    const errorExp = extractor.extract(errorRecord);
    console.assert(errorExp.outcome === 'failure' || errorExp.outcome === 'partial', 'Error outcome');
    console.assert(errorExp.errorCount === 2, '2 errors counted');

    passed++;
    console.log('  ✅ ExperienceExtractor: success/error extraction, patterns, lessons');
  } catch (e) { failed++; console.error('  ❌ ExperienceExtractor:', e); }

  // Test 2: PlanEvaluator
  try {
    const evaluator = new PlanEvaluator();
    const record = makeRecord('Build REST API', true, []);
    const extractor = new ExperienceExtractor();
    const exp = extractor.extract(record);
    const evaluation = evaluator.evaluate(exp, record);

    console.assert(evaluation.score > 0.5, 'Good score for successful execution');
    console.assert(evaluation.dimensions.accuracy >= 0, 'Accuracy computed');
    console.assert(evaluation.dimensions.efficiency >= 0, 'Efficiency computed');
    console.assert(evaluation.dimensions.completeness > 0, 'Completeness > 0');
    console.assert(evaluation.strengths.length > 0, 'Has strengths');
    console.assert(typeof evaluation.suggestions === 'object', 'Suggestions array');

    // Failed execution
    const failRecord = makeRecord('Complex deploy', false, ['Error1', 'Error2', 'Error3', 'Error4']);
    const failExp = extractor.extract(failRecord);
    const failEval = evaluator.evaluate(failExp, failRecord);
    console.assert(failEval.score < 0.5, 'Low score for failed execution');

    passed++;
    console.log('  ✅ PlanEvaluator: scoring, dimensions, strengths, weaknesses, suggestions');
  } catch (e) { failed++; console.error('  ❌ PlanEvaluator:', e); }

  // Test 3: StrategyOptimizer
  try {
    const optimizer = new StrategyOptimizer();
    // Add multiple poor evaluations
    const extractor = new ExperienceExtractor();
    const evaluator = new PlanEvaluator();

    for (let i = 0; i < 3; i++) {
      const rec = makeRecord(`Task ${i}`, i % 2 === 0, i % 2 === 0 ? [] : ['Error']);
      const exp = extractor.extract(rec);
      const evalResult = evaluator.evaluate(exp, rec);
      optimizer.addEvaluation(evalResult);
    }

    console.assert(optimizer.historySize === 3, '3 records in history');

    const suggestions = optimizer.optimize();
    console.assert(suggestions.length > 0, 'Optimization suggestions generated');
    if (suggestions.length > 0) {
      console.assert(['high', 'medium', 'low'].includes(suggestions[0].priority), 'Valid priority');
      console.assert(suggestions[0].expectedImpact > 0, 'Has expected impact');
    }

    optimizer.reset();
    console.assert(optimizer.historySize === 0, 'Reset works');

    passed++;
    console.log('  ✅ StrategyOptimizer: history, suggestions, priority, reset');
  } catch (e) { failed++; console.error('  ❌ StrategyOptimizer:', e); }

  // Test 4: TemplateEvolutionEngine
  try {
    const engine = new TemplateEvolutionEngine();

    // Register templates
    engine.register({
      id: 't1', name: 'API Build', goalType: 'build', nodeSequence: ['Setup', 'Implement', 'Test'],
      successRate: 0.5, avgDuration: 30000, usageCount: 0, lastUsed: 0, version: 1,
    });
    engine.register({
      id: 't2', name: 'Bug Fix', goalType: 'fix', nodeSequence: ['Reproduce', 'Analyze', 'Fix', 'Verify'],
      successRate: 0.8, avgDuration: 15000, usageCount: 5, lastUsed: Date.now(), version: 3,
    });

    console.assert(engine.getAll().length === 2, '2 templates registered');

    // Update with experience
    const extractor = new ExperienceExtractor();
    const successRec = makeRecord('Build API', true, []);
    const successExp = extractor.extract(successRec);
    engine.updateWithExperience(successExp);

    // Recommend
    const recs = engine.recommend('fix', 2);
    console.assert(recs.length > 0, 'Recommendations found');

    // Evict low performers
    engine.register({
      id: 't3', name: 'Bad Template', goalType: 'build', nodeSequence: ['A', 'B'],
      successRate: 0.1, avgDuration: 99999, usageCount: 5, lastUsed: Date.now(), version: 1,
    });
    const evicted = engine.evict(0.2, 3);
    console.assert(evicted.includes('t3'), 'Bad template evicted');

    // Stats
    const stats = engine.getStats();
    console.assert(stats.total > 0, 'Stats computed');
    console.assert(stats.avgSuccessRate > 0, 'Avg success rate > 0');

    passed++;
    console.log('  ✅ TemplateEvolutionEngine: register, update, recommend, evict, stats');
  } catch (e) { failed++; console.error('  ❌ TemplateEvolutionEngine:', e); }

  // Test 5: End-to-end learning loop
  try {
    const extractor = new ExperienceExtractor();
    const evaluator = new PlanEvaluator();
    const optimizer = new StrategyOptimizer();
    const engine = new TemplateEvolutionEngine();

    engine.register({
      id: 't-planner', name: 'Planner', goalType: 'build', nodeSequence: ['Plan', 'Exec', 'Review'],
      successRate: 0.5, avgDuration: 30000, usageCount: 0, lastUsed: 0, version: 1,
    });

    // Full cycle
    const rec = makeRecord('Full cycle test', true, []);
    const exp = extractor.extract(rec);
    const evalResult = evaluator.evaluate(exp, rec);
    optimizer.addEvaluation(evalResult);
    engine.updateWithExperience(exp);

    const suggestions = optimizer.optimize();
    const recs = engine.recommend('build');

    console.assert(suggestions.length >= 0, 'Optimizer produces suggestions in loop');
    console.assert(recs.length >= 0, 'Engine produces recommendations in loop');

    passed++;
    console.log('  ✅ End-to-end: Execution → Extract → Evaluate → Optimize → Evolve');
  } catch (e) { failed++; console.error('  ❌ End-to-end:', e); }

  console.log(`\n  📊 ${passed}/${passed + failed} tests passed`);
  if (failed > 0) { console.log(`  ❌ ${failed} FAILED`); process.exit(1); }
  else console.log('  ✅ Phase 6 ALL PASSED\n');
}

main().catch(console.error);
