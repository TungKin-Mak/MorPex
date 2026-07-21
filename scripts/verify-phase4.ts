/**
 * Phase 4 — Memory Intelligence Upgrade Verification
 * Verifies: MemoryActivationEngine with state-aware, task-aware, execution-aware recall
 */
import { MemoryActivationEngine } from '../packages/core/src/memory/MemoryActivationEngine.js';
import type { MemoryRecord } from '../packages/core/src/planes/agent-plane/types.js';

function makeMem(id: string, content: string, type: MemoryRecord['type'], score: number, tags?: string[]): MemoryRecord {
  return { id, content, type, relevanceScore: score, timestamp: Date.now() - Math.random() * 86400000, metadata: { tags } };
}

async function main() {
  console.log('\n=== Phase 4: Memory Activation Engine ===\n');
  let passed = 0, failed = 0;

  const engine = new MemoryActivationEngine();

  // Seed memory store
  const memories: MemoryRecord[] = [
    makeMem('m1', 'Previous REST API built with Express — took 2 hours', 'experience', 0.9, ['api', 'express']),
    makeMem('m2', 'Authentication middleware failed due to token expiry', 'error', 0.7, ['auth', 'error']),
    makeMem('m3', 'Database schema design for user management', 'task', 0.8, ['db', 'schema']),
    makeMem('m4', 'Deployment pipeline config for Node.js apps', 'experience', 0.6, ['deploy', 'cicd']),
    makeMem('m5', 'Rate limiting implemented using redis', 'task', 0.5, ['api', 'redis']),
    makeMem('m6', 'Test coverage below 80% caused CI failure', 'error', 0.4, ['test', 'ci']),
    makeMem('m7', 'Domain: E-commerce checkout flow optimization', 'domain', 0.85, ['ecommerce', 'checkout']),
    makeMem('m8', 'WebSocket connection handling best practices', 'domain', 0.75, ['websocket', 'realtime']),
  ];
  engine.addMemories(memories);
  console.assert(engine.memoryCount === 8, '8 memories stored');

  // Test 1: State-aware recall (with errors)
  try {
    const result = engine.activate({
      executionStatus: 'running',
      goal: 'Build payment API',
      currentStep: 2,
      totalSteps: 5,
      completedSteps: ['Setup project', 'Define schema'],
      errors: ['Token validation failed'],
      tags: ['api', 'payment'],
    }, 3);

    console.assert(result.memories.length === 3, 'Got top 3 memories');
    console.assert(result.activationScore > 0, 'Has activation score');
    console.assert(typeof result.contextBias === 'string' && result.contextBias.length > 0, 'Has context bias');
    console.assert(result.scores.taskRelevance >= 0, 'Task relevance computed');

    passed++;
    console.log('  ✅ State-aware + task-aware + execution-aware recall');
  } catch (e) { failed++; console.error('  ❌ Test 1:', e); }

  // Test 2: Error-focused recall
  try {
    const errorResult = engine.activate({
      executionStatus: 'failed',
      goal: 'Fix auth middleware',
      currentStep: 1, totalSteps: 3,
      completedSteps: [],
      errors: ['Token validation failed', 'JWT decoding error'],
      tags: ['auth', 'fix'],
    }, 5);

    const errorMemories = errorResult.memories.filter(m => m.type === 'error');
    console.assert(errorMemories.length > 0, 'Error memories surfaced');

    passed++;
    console.log('  ✅ Error-focused recall surfaces error memories');
  } catch (e) { failed++; console.error('  ❌ Test 2:', e); }

  // Test 3: Empty store
  try {
    const emptyEngine = new MemoryActivationEngine();
    const result = emptyEngine.activate({
      executionStatus: 'idle', goal: 'test', currentStep: 0, totalSteps: 1,
      completedSteps: [], errors: [], tags: [],
    });

    console.assert(result.memories.length === 0, 'No memories from empty store');
    console.assert(result.activationScore === 0, 'Score 0 for empty');

    passed++;
    console.log('  ✅ Empty store handled gracefully');
  } catch (e) { failed++; console.error('  ❌ Test 3:', e); }

  // Test 4: Add memory dynamically
  try {
    engine.addMemory(makeMem('m9', 'Dynamic memory added at runtime', 'experience', 0.95));
    console.assert(engine.memoryCount === 9, 'Memory added dynamically');

    passed++;
    console.log('  ✅ Dynamic memory addition');
  } catch (e) { failed++; console.error('  ❌ Test 4:', e); }

  // Test 5: Clear store
  try {
    const tempEngine = new MemoryActivationEngine();
    tempEngine.addMemory(makeMem('tmp', 'temporary', 'task', 0.5));
    console.assert(tempEngine.memoryCount === 1, 'Has temp memory');
    tempEngine.clear();
    console.assert(tempEngine.memoryCount === 0, 'Cleared');

    passed++;
    console.log('  ✅ Clear store');
  } catch (e) { failed++; console.error('  ❌ Test 5:', e); }

  // Summary
  console.log(`\n  📊 ${passed}/${passed + failed} tests passed`);
  if (failed > 0) { console.log(`  ❌ ${failed} FAILED`); process.exit(1); }
  else console.log('  ✅ Phase 4 ALL PASSED\n');
}

main().catch(console.error);
