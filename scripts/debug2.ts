// @ts-nocheck
import { PlanEvaluator } from '../packages/core/src/learning/PlanEvaluator.js';
import { ExperienceExtractor } from '../packages/core/src/learning/ExperienceExtractor.js';

console.log('Test 1: ExperienceExtractor...');
const ext = new ExperienceExtractor();
const r1 = ext.extract({
  executionId: 'e1', planId: 'p1', goal: 'Build API', success: true,
  duration: 1000, nodes: [{ id:'n1', name:'n1', status:'success', duration:100 }],
  errors: [], startTime: Date.now()-1000, endTime: Date.now()
});
console.log('  OK:', r1.id, r1.patterns.length, 'patterns');

console.log('Test 2: PlanEvaluator single arg...');
const pe = new PlanEvaluator();
try {
  const ev = pe.evaluate({ id: 'x', goal: 'Test', goalType:'build', outcome:'success', duration:1000, patterns:[], lessons:[], nodeCount:1, errorCount:0, successRate:0.9, timestamp:Date.now() });
  console.log('  OK: score=', ev.score);
} catch(e: any) {
  console.log('  CRASH:', e.message);
}

console.log('Test 3: PlanEvaluator with planData...');
try {
  const ev2 = pe.evaluate({ planId:'p1', goal:'Build API', outcome:'success', duration:1000, steps:[], constraints:[], risks:[] });
  console.log('  OK: score=', ev2.score);
} catch(e: any) {
  console.log('  CRASH:', e.message);
}

console.log('Done');
