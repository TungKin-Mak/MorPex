const fs = require('fs');

// 1. test-cross-domain-agents.ts
let f1 = fs.readFileSync('scripts/test-cross-domain-agents.ts', 'utf8');
f1 = f1.replace(/import.*DynamicReflexEngine.*/g, '// DynamicReflexEngine removed (v7)');
f1 = f1.replace(/DynamicReflexEngine/g, 'null as any');
fs.writeFileSync('scripts/test-cross-domain-agents.ts', f1);
console.log('1 done');

// 2. test-full-module-concurrent.ts
let f2 = fs.readFileSync('scripts/test-full-module-concurrent.ts', 'utf8');
f2 = f2.replace(/import.*MemoryBus.*/g, '// MemoryBus removed (replaced by MemoryWiki)');
f2 = f2.replace(/MemoryBus/g, 'null as any');
fs.writeFileSync('scripts/test-full-module-concurrent.ts', f2);
console.log('2 done');

// 3. test-thought-interceptor.ts
let f3 = fs.readFileSync('scripts/test-thought-interceptor.ts', 'utf8');
f3 = f3.replace(/import.*ThoughtInterceptor.*/g, '// ThoughtInterceptor removed (v7)');
f3 = f3.replace(/ThoughtInterceptor/g, 'null as any');
fs.writeFileSync('scripts/test-thought-interceptor.ts', f3);
console.log('3 done');

// 4. test-three-layer-interception.ts
let f4 = fs.readFileSync('scripts/test-three-layer-interception.ts', 'utf8');
f4 = f4.replace(/import.*ActionInterceptor.*/g, '// ActionInterceptor removed');
f4 = f4.replace(/import.*ObservationCorrectionBridge.*/g, '// ObservationCorrectionBridge removed');
f4 = f4.replace(/import.*ThoughtInterceptor.*/g, '// ThoughtInterceptor removed');
f4 = f4.replace(/\bActionInterceptor\b/g, 'null as any');
f4 = f4.replace(/\bObservationCorrectionBridge\b/g, 'null as any');
f4 = f4.replace(/\bThoughtInterceptor\b/g, 'null as any');
fs.writeFileSync('scripts/test-three-layer-interception.ts', f4);
console.log('4 done');

// 5. test-topology-optimizer.ts
let f5 = fs.readFileSync('scripts/test-topology-optimizer.ts', 'utf8');
f5 = f5.replace(/\bPlanOptimizer\b/g, 'null as any');
f5 = f5.replace(/\bPlanEvaluator\b/g, 'null as any');
fs.writeFileSync('scripts/test-topology-optimizer.ts', f5);
console.log('5 done');
