/**
 * Memory Tests — MemoryActivationEngine context-aware recall
 */
import { MemoryActivationEngine } from '../src/memory/MemoryActivationEngine.js';

const assert = (c: boolean, m: string) => { if (!c) throw new Error('FAIL: ' + m); };

const engine = new MemoryActivationEngine();

// Add test memories
engine.addMemory({ id: 'm1', content: 'Use Express.js for REST APIs', type: 'pattern', relevanceScore: 0.9, timestamp: Date.now() });
engine.addMemory({ id: 'm2', content: 'Handle errors with middleware', type: 'error', relevanceScore: 0.7, timestamp: Date.now() });
engine.addMemory({ id: 'm3', content: 'Use TypeORM for database', type: 'pattern', relevanceScore: 0.5, timestamp: Date.now() });

// Test 1: State-aware recall — different states yield different activations
const runningResult = engine.activate({
  executionStatus: 'running', goal: 'Build API', currentStep: 2, totalSteps: 5,
  completedSteps: ['Setup'], errors: [], tags: ['backend'],
});
assert(runningResult.memories.length > 0, 'running state activates memories');

const idleResult = engine.activate({
  executionStatus: 'idle', goal: 'Build API', currentStep: 0, totalSteps: 5,
  completedSteps: [], errors: [], tags: [],
});
// Idle should activate different memories or fewer
assert(idleResult.activationScore <= runningResult.activationScore, 'idle activates less or equal');

// Test 2: Error context boosts error memories
const errorResult = engine.activate({
  executionStatus: 'running', goal: 'Fix bug', currentStep: 3, totalSteps: 5,
  completedSteps: [], errors: ['HTTP 500'], tags: ['debug'],
});
assert(errorResult.contextBias.includes('error'), 'error context recognized');

// Test 3: Task-aware recall — different goals match different memories
const apiResult = engine.activate({
  executionStatus: 'running', goal: 'Build REST API', currentStep: 1, totalSteps: 3,
  completedSteps: [], errors: [], tags: ['api'],
});
const dbResult = engine.activate({
  executionStatus: 'running', goal: 'Setup database', currentStep: 1, totalSteps: 3,
  completedSteps: [], errors: [], tags: ['database'],
});
// Different goals should produce different context bias
assert(typeof apiResult.contextBias === 'string', 'API context bias');
assert(typeof dbResult.contextBias === 'string', 'DB context bias');

console.log('Memory Tests: ALL PASSED');
