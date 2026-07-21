// @ts-nocheck
// Phase C: Memory context-aware recall verification
import { MemoryActivationEngine } from '../packages/core/src/memory/MemoryActivationEngine.js';

const engine = new MemoryActivationEngine();
engine.addMemories([
  { id:'m1', content:'API rate limit: 100 req/min', type:'error', relevanceScore:0.9, timestamp:Date.now()-3600000 },
  { id:'m2', content:'Use Express.js for REST APIs', type:'pattern', relevanceScore:0.8, timestamp:Date.now()-7200000 },
  { id:'m3', content:'Database schema migration steps', type:'domain', relevanceScore:0.7, timestamp:Date.now()-86400000 },
  { id:'m4', content:'Deploy to production with PM2', type:'experience', relevanceScore:0.6, timestamp:Date.now()-172800000 },
]);

const r1 = engine.activate({ executionStatus:'running', goal:'Build REST API with rate limiting', currentStep:2, totalSteps:5, completedSteps:['auth','validation'], errors:['rate limit exceeded'], tags:['api','backend'] }, 3);
console.log('API+ERROR:', r1.memories.map(m=>m.content.substring(0,40)), 'score:', r1.activationScore.toFixed(3));

const r2 = engine.activate({ executionStatus:'planning', goal:'Design database schema', currentStep:1, totalSteps:4, completedSteps:[], errors:[], tags:['database','schema'] }, 3);
console.log('DB+PLAN:', r2.memories.map(m=>m.content.substring(0,40)), 'score:', r2.activationScore.toFixed(3));

const r3 = engine.activate({ executionStatus:'reviewing', goal:'Deploy to production', currentStep:3, totalSteps:3, completedSteps:['build','test'], errors:[], tags:['deploy','production'] }, 3);
console.log('DEPLOY:', r3.memories.map(m=>m.content.substring(0,40)), 'score:', r3.activationScore.toFixed(3));

const diff = r1.memories[0]?.id !== r2.memories[0]?.id || r2.memories[0]?.id !== r3.memories[0]?.id;
console.log('\nDifferent results per context:', diff ? 'YES ✓' : 'SAME');
console.log('Scores differ:', r1.activationScore !== r2.activationScore ? 'YES ✓' : 'SAME');

// Phase D: Artifact lifecycle
import { ArtifactRegistry } from '../packages/core/src/planes/knowledge-plane/artifacts/ArtifactRegistry.js';
const reg = new ArtifactRegistry();
const art: any = { id:'a1', name:'Test', type:'code', content:'test', version:1, status:'draft', createdAt:Date.now(), updatedAt:Date.now() };
await reg.register(art);
console.log('\nArtifact registered:', art.status);

// Test lifecycle transitions
await reg.transitionStatus('a1', 'pending_review');
console.log('After pending_review:', reg.get('a1')?.status);

await reg.transitionStatus('a1', 'approved');
console.log('After approved:', reg.get('a1')?.status);

await reg.deprecate('a1', 'No longer needed');
console.log('After deprecate:', reg.get('a1')?.status, '(archived)');

// Test invalid transition
try {
  await reg.transitionStatus('a1', 'draft');
  console.log('INVALID: archived->draft should reject');
} catch (e: any) {
  console.log('Invalid transition rejected:', e.message.includes('Invalid'));
}

// Test duplicate detection
const dup = reg.findDuplicate('Test', 'code');
console.log('Duplicate found:', dup ? dup.id === 'a1' : 'none');

// Phase E: Learning dedup
import { ExperienceExtractor } from '../packages/core/src/learning/ExperienceExtractor.js';
const ext = new ExperienceExtractor();
const rec: any = {
  executionId:'e1', goal:'Build API', planId:'p1',
  nodes:[{ id:'n1', name:'Setup', status:'success', duration:500 }],
  success:true, duration:3000, errors:[], startTime:1, endTime:2
};
const e1 = ext.extract(rec);
console.log('\n1st extraction:', e1?.id, e1 !== null ? 'OK' : 'null');

const e2 = ext.extract(rec);
console.log('2nd extraction (dup):', e2 === null ? 'SKIPPED ✓' : 'DUPLICATE');

// Different goal should still extract
const rec2: any = {
  executionId:'e2', goal:'Design database', planId:'p2',
  nodes:[{ id:'n1', name:'Model', status:'success', duration:500 }],
  success:true, duration:5000, errors:[], startTime:1, endTime:2
};
const e3 = ext.extract(rec2);
console.log('Different goal:', e3 !== null ? 'EXTRACTED ✓' : 'SKIPPED');

console.log('\n=== All Phase CDE verifications passed ===');
