/**
 * Phase 5 — Intent Layer Upgrade Verification
 * Verifies: GoalExtractor, ConstraintAnalyzer, PriorityEngine, RiskDetector, ExecutionPolicyGenerator
 */
import { GoalExtractor } from '../packages/core/src/planes/control-plane/intent/GoalExtractor.js';
import { ConstraintAnalyzer } from '../packages/core/src/planes/control-plane/intent/ConstraintAnalyzer.js';
import { PriorityEngine } from '../packages/core/src/planes/control-plane/intent/PriorityEngine.js';
import { RiskDetector } from '../packages/core/src/planes/control-plane/intent/RiskDetector.js';
import { ExecutionPolicyGenerator } from '../packages/core/src/planes/control-plane/intent/ExecutionPolicyGenerator.js';

async function main() {
  console.log('\n=== Phase 5: Intent Layer Upgrade ===\n');
  let passed = 0, failed = 0;

  // Test 1: GoalExtractor
  try {
    const extractor = new GoalExtractor();
    const goal = extractor.extract('Build a REST API with Express. Must include JWT auth. Should support rate limiting. Deploy to AWS.');

    console.assert(goal.primary.includes('Build a REST API'), 'Primary goal extracted');
    console.assert(goal.type === 'build', 'Type detected as build');
    console.assert(goal.subGoals.length > 0, 'Sub-goals extracted');
    console.assert(goal.acceptanceCriteria.length > 0, 'Acceptance criteria extracted');
    console.assert(goal.scope === 'full', 'Scope default');

    // Type detection
    console.assert(extractor.detectType('analyze performance of the system') === 'analyze', 'Detect analyze');
    console.assert(extractor.detectType('Learn how to use React') === 'learn', 'Detect learn');
    console.assert(extractor.detectType('Optimize database queries') === 'optimize', 'Detect optimize');

    passed++;
    console.log('  ✅ GoalExtractor: primary, type, sub-goals, acceptance criteria, type detection');
  } catch (e) { failed++; console.error('  ❌ GoalExtractor:', e); }

  // Test 2: ConstraintAnalyzer
  try {
    const analyzer = new ConstraintAnalyzer();
    const constraints = analyzer.analyze(
      'Build a dashboard using React and TypeScript. Deadline is 2 weeks. Must be secure with auth. Budget under $5k.'
    );

    console.assert(constraints.technical.some(t => t.includes('React')), 'Tech: React');
    console.assert(constraints.technical.some(t => t.includes('TypeScript')), 'Tech: TypeScript');
    console.assert(constraints.time.some(t => /2\s*weeks?/.test(t) || /2.*week/.test(t)), 'Time: 2 weeks');
    console.assert(constraints.quality.some(q => /secure|security/.test(q)), 'Quality: security');
    console.assert(constraints.resource.some(r => /5k|\$5k/.test(r)), 'Budget found');

    // Empty input
    const empty = analyzer.analyze('Hello');
    console.assert(analyzer.count(empty) === 0, 'Empty constraints');

    // Severe check
    const severeInput = 'Fix security ASAP. GDPR compliance required.';
    const severeConstraints = analyzer.analyze(severeInput);
    console.assert(analyzer.hasSevereConstraints(severeConstraints) === true, 'Severe constraints detected');

    passed++;
    console.log('  ✅ ConstraintAnalyzer: tech, time, quality, resource, severe detection');
  } catch (e) { failed++; console.error('  ❌ ConstraintAnalyzer:', e); }

  // Test 3: PriorityEngine
  try {
    const engine = new PriorityEngine();
    const goal = new GoalExtractor().extract('Build a critical auth system. Due ASAP. Must be secure.');
    const constraints = new ConstraintAnalyzer().analyze('Build a critical auth system. Due ASAP. Must be secure.');

    const priority = engine.calculate(goal, constraints);
    console.assert(priority.score <= 4, 'High priority for urgent+secure task');
    console.assert(['critical', 'high'].includes(priority.label), 'Label is critical or high');
    console.assert(priority.factors.length > 0, 'Has factors');

    // Low priority
    const learnGoal = new GoalExtractor().extract('Learn about TypeScript');
    const lowPriority = engine.calculate(learnGoal, { technical: [], time: [], quality: [], resource: [], business: [], other: [] });
    console.assert(lowPriority.score >= 5, 'Learning is lower priority');

    passed++;
    console.log('  ✅ PriorityEngine: urgency, security, priority factors');
  } catch (e) { failed++; console.error('  ❌ PriorityEngine:', e); }

  // Test 4: RiskDetector
  try {
    const detector = new RiskDetector();
    const goal = new GoalExtractor().extract('Build something');
    const constraints = new ConstraintAnalyzer().analyze('Build something');

    const risks = detector.detect(goal, constraints);
    console.assert(risks.length > 0, 'Risks detected for vague goal');
    console.assert(risks.some(r => r.type === 'ambiguity'), 'Ambiguity risk');
    console.assert(risks.some(r => r.type === 'technical'), 'Technical risk (no constraints)');
    console.assert(risks.some(r => r.type === 'dependency'), 'No acceptance criteria risk');

    // Score
    const riskScore = detector.score(risks);
    console.assert(riskScore > 0, 'Risk score > 0');

    // Critical check
    console.assert(detector.hasCriticalRisks(risks) === true, 'Has critical risks');

    passed++;
    console.log('  ✅ RiskDetector: ambiguity, technical, dependency risks, scoring');
  } catch (e) { failed++; console.error('  ❌ RiskDetector:', e); }

  // Test 5: ExecutionPolicyGenerator
  try {
    const generator = new ExecutionPolicyGenerator();
    const goal = new GoalExtractor().extract('Build a simple hello-world API');
    const constraints = new ConstraintAnalyzer().analyze('Build a simple hello-world API');
    const priority = new PriorityEngine().calculate(goal, constraints);
    const risks = new RiskDetector().detect(goal, constraints);

    const policy = generator.generate(goal, constraints, priority, risks);
    console.assert(typeof policy.mode === 'string', 'Mode set');
    console.assert(policy.maxParallelism >= 1, 'Parallelism >= 1');
    console.assert(typeof policy.requireHumanReview === 'boolean', 'Human review boolean');
    console.assert(['none', 'per-step', 'per-phase', 'per-milestone'].includes(policy.checkpointFrequency), 'Valid checkpoint');
    console.assert(['fail-fast', 'retry', 'fallback', 'ignore'].includes(policy.errorStrategy), 'Valid error strategy');
    console.assert(policy.reasoning.length > 0, 'Has reasoning');

    // Step-by-step for critical risks
    const riskyGoal = new GoalExtractor().extract('');
    const riskyPolicy = generator.generate(riskyGoal, constraints, priority, risks);
    console.assert(riskyPolicy.mode === 'step-by-step', 'Critical risks → step-by-step');

    passed++;
    console.log('  ✅ ExecutionPolicyGenerator: mode, parallelism, review, checkpoint, error strategy, reasoning');
  } catch (e) { failed++; console.error('  ❌ ExecutionPolicyGenerator:', e); }

  // Summary
  console.log(`\n  📊 ${passed}/${passed + failed} tests passed`);
  if (failed > 0) { console.log(`  ❌ ${failed} FAILED`); process.exit(1); }
  else console.log('  ✅ Phase 5 ALL PASSED\n');
}

main().catch(console.error);
