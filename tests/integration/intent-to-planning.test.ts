/**
 * Integration: Intent → Planning
 */
import { GoalExtractor } from '../../packages/core/src/planes/control-plane/intent/GoalExtractor.js';
import { ConstraintAnalyzer } from '../../packages/core/src/planes/control-plane/intent/ConstraintAnalyzer.js';
import { PriorityEngine } from '../../packages/core/src/planes/control-plane/intent/PriorityEngine.js';
import { RiskDetector } from '../../packages/core/src/planes/control-plane/intent/RiskDetector.js';
import { ExecutionPolicyGenerator } from '../../packages/core/src/planes/control-plane/intent/ExecutionPolicyGenerator.js';
import { AssertionContext, TraceBuilder, type TestResult } from '../framework.js';

export async function run(): Promise<TestResult> {
  const start = Date.now();
  const ctx = new AssertionContext();
  const trace = new TraceBuilder();
  const input = 'Build a REST API for task management with TypeScript, Express, and PostgreSQL';

  trace.step('GoalExtractor', 'started');
  const ex = new GoalExtractor();
  const gs = ex.extract(input);
  ctx.assert(typeof gs.primary === 'string' && gs.primary.length > 0, 'primary');
  ctx.assert(Array.isArray(gs.subGoals), 'subGoals');
  ctx.assert(Array.isArray(gs.acceptanceCriteria), 'criteria');
  trace.step('GoalExtractor', 'completed');

  trace.step('ConstraintAnalyzer', 'started');
  const ca = new ConstraintAnalyzer();
  const cs = ca.analyze(input);
  ctx.assert(Array.isArray(cs.technical), 'technical');
  ctx.assert(Array.isArray(cs.quality), 'quality');
  trace.step('ConstraintAnalyzer', 'completed');

  trace.step('PriorityEngine', 'started');
  const pe = new PriorityEngine();
  const pr = pe.calculate(gs, cs);
  ctx.assert(typeof pr.score === 'number' && pr.score >= 1, `priority=${pr.score}`);
  trace.step('PriorityEngine', 'completed');

  trace.step('RiskDetector', 'started');
  const rd = new RiskDetector();
  const risks = rd.detect(gs, cs);
  ctx.assert(Array.isArray(risks), 'risks');
  trace.step('RiskDetector', 'completed');

  trace.step('PolicyGenerator', 'started');
  const pg = new ExecutionPolicyGenerator();
  const policy = pg.generate(gs, cs, pr, risks);
  ctx.assert(['autonomous','supervised','step-by-step','exploratory'].includes(policy.mode), `mode=${policy.mode}`);
  ctx.assert(typeof policy.maxParallelism === 'number', 'maxParallelism');
  ctx.assert(Array.isArray(policy.reasoning), 'reasoning');
  trace.step('PolicyGenerator', 'completed');

  return {
    name: 'Integration: Intent→Planning',
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
