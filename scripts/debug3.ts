// @ts-nocheck
import { PlanEvaluator } from '../packages/core/src/learning/PlanEvaluator.js';

const pe = new PlanEvaluator();
const data = { id: 'x', goal: 'Test', goalType:'build', outcome:'success', duration:1000, patterns:[], lessons:[], nodeCount:1, errorCount:0, successRate:0.9, timestamp:Date.now() };

try {
  console.log('calling evaluate...');
  const r = pe.evaluate(data);
  console.log('OK:', r.score, JSON.stringify(r));
} catch(e: any) {
  console.log('ERROR:', e.message);
  console.log('STACK:', e.stack?.split('\n').slice(0, 5).join('\n'));
}
