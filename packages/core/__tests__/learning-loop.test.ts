/**
 * Learning Loop Tests — Experience extraction, evaluation, evolution
 */
import { ExperienceExtractor } from '../src/learning/ExperienceExtractor.js';
import { PlanEvaluator } from '../src/learning/PlanEvaluator.js';
import { StrategyOptimizer } from '../src/learning/StrategyOptimizer.js';
import { TemplateEvolutionEngine } from '../src/learning/TemplateEvolutionEngine.js';

const assert = (c: boolean, m: string) => { if (!c) throw new Error('FAIL: ' + m); };

// Test 1: Experience extraction from execution result
const extractor = new ExperienceExtractor();
const execRecord = {
  executionId: 'exe-1', goal: 'Build REST API with TypeScript', planId: 'plan-1',
  nodes: [
    { id: 'a', name: 'Setup', status: 'success', duration: 1000 },
    { id: 'b', name: 'Code', status: 'success', duration: 3000 },
    { id: 'c', name: 'Test', status: 'success', duration: 1000 },
  ],
  success: true, duration: 5000, errors: [], startTime: Date.now() - 5000, endTime: Date.now(),
};
const experience = extractor.extract(execRecord);

assert(experience !== null, 'experience extracted');
assert(experience.goal === 'Build REST API with TypeScript', 'goal preserved');
assert(experience.outcome === 'success', 'outcome success');
assert(experience.patterns.length > 0, 'patterns extracted');
assert(experience.lessons.length > 0, 'lessons extracted');

// Test 2: Experience dedup
const exp2 = extractor.extract(execRecord);
assert(exp2 === null, 'duplicate skipped');

// Test 3: Plan evaluation
const evaluator = new PlanEvaluator();
const planRecord = {
  planId: 'plan-1',
  nodes: [{ id: 'a', name: 'Setup', agentType: 'expert', description: '', deps: [], status: 'success' as const, priority: 1, retryCount: 0, maxRetries: 2 }],
  edges: [],
  status: { totalNodes: 1, totalEdges: 0, mutations: 0, isCyclic: false, canRollback: true, isComplete: true },
  createdAt: Date.now(),
};
const evaluation = evaluator.evaluate(planRecord, execRecord);
assert(evaluation !== null, 'evaluation produced');

// Test 4: Strategy optimization
const optimizer = new StrategyOptimizer();
const suggestions = optimizer.optimize();
assert(Array.isArray(suggestions), 'suggestions are array');

// Test 5: Template evolution
const templateEngine = new TemplateEvolutionEngine();
const stats = templateEngine.getStats();
assert(typeof stats.total === 'number', 'template stats');

console.log('Learning Tests: ALL PASSED');
