/**
 * Config Validation Tests — MorPexConfig v9 with Zod
 *
 * Tests: schema validation, env overrides, hot reload, onChange, backward compat
 */
import { config, MorPexConfigSchema } from '../config/MorPexConfig.js';

// ── Test Runner ──
let passed = 0, failed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  (async () => {
    try { await fn(); passed++; } catch (e: any) { failed++; console.error(`  FAIL: ${name} — ${e.message}`); }
  })();
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

console.log('\n=== Config Validation Tests (Zod Schema + Runtime) ===\n');

// ── 1. Default config parses successfully ──
test('Default config has all sections', () => {
  const cfg = config.get();
  assert(typeof cfg.idleTimeoutMs === 'number', 'legacy number field');
  assert(typeof cfg.persistence.dbPath === 'string', 'persistence.dbPath');
  assert(cfg.persistence.walMode === true, 'persistence.walMode default true');
  assert(typeof cfg.agent.defaultTTLMs === 'number', 'agent.defaultTTLMs');
  assert(typeof cfg.context.schemaVersion === 'string', 'context.schemaVersion');
  assert(Array.isArray(cfg.artifact.allowedTypes), 'artifact.allowedTypes is array');
  assert(cfg.distributed.enabled === false, 'distributed.enabled default false');
  assert(cfg.marketplace.enabled === false, 'marketplace.enabled default false');
});

// ── 2. Full parse from scratch ──
test('MorPexConfigSchema.parse({}) returns full config', () => {
  const cfg = MorPexConfigSchema.parse({});
  assert(cfg.persistence.dbPath === './data/morpex-events.db', 'default dbPath');
  assert(cfg.agent.maxConcurrentTasks === 5, 'default maxConcurrentTasks');
  assert(cfg.context.maxFragments === 50, 'default maxFragments');
  assert(cfg.artifact.maxContentSizeBytes === 10 * 1024 * 1024, 'default maxContentSizeBytes');
  assert(cfg.distributed.nodeId === 'node-1', 'default nodeId');
  assert(cfg.marketplace.bidTimeoutMs === 30000, 'default bidTimeoutMs');
});

// ── 3. Partial update merges nested objects ──
test('Partial update deep-merges nested config', () => {
  // Save original persistence dbPath
  const origDbPath = config.get().persistence.dbPath;
  // Update only one nested field
  const newDbPath = './custom/test.db';
  config.update({ persistence: { dbPath: newDbPath } as any });
  const updated = config.get();
  assert(updated.persistence.dbPath === newDbPath, 'persistence.dbPath updated');
  assert(updated.persistence.walMode === true, 'persistence.walMode preserved from default');
  // Restore
  config.update({ persistence: { dbPath: origDbPath } as any });
  const restored = config.get();
  assert(restored.persistence.dbPath === origDbPath, 'persistence.dbPath restored');
});

// ── 4. Invalid values throw Zod errors ──
test('Invalid values throw Zod error', () => {
  let threw = false;
  try {
    MorPexConfigSchema.parse({ agent: { maxConcurrentTasks: -1 } });
  } catch (e: any) {
    threw = true;
    assert(e.issues && e.issues.length > 0, 'Zod issue array present');
    assert(e.issues[0].path.includes('maxConcurrentTasks'), 'error path has maxConcurrentTasks');
  }
  assert(threw, 'should throw for invalid maxConcurrentTasks');
});

test('Invalid enum throws Zod error', () => {
  let threw = false;
  try {
    MorPexConfigSchema.parse({ distributed: { transportMode: 'tcp' } });
  } catch {
    threw = true;
  }
  assert(threw, 'should throw for invalid transportMode');
});

// ── 5. onChange fires on update ──
test('onChange listener fires', () => {
  let fired = 0;
  const unsub = config.onChange((newCfg, oldCfg) => {
    fired++;
    assert(newCfg.agent.maxConcurrentTasks === 3, 'new value correct');
    assert(oldCfg.agent.maxConcurrentTasks === 5, 'old value preserved');
  });
  config.update({ agent: { maxConcurrentTasks: 3 } as any });
  assert(fired >= 1, 'listener fired at least once');
  // Unsubscribe BEFORE reset so listener doesn't fire again
  unsub();
  const prevCount = fired;
  config.update({ agent: { maxConcurrentTasks: 4 } as any });
  assert(fired === prevCount, 'should not fire after unsubscribe');
  // Restore (listener no longer attached so no assertion problems)
  config.update({ agent: { maxConcurrentTasks: 5 } as any });
});

// ── 6. Legacy accessor backward compat ──
test('Legacy accessors work and match get()', () => {
  const cfg = config.get();
  assert(config.idleTimeoutMs === cfg.idleTimeoutMs, 'idleTimeoutMs');
  assert(config.modelProvider === cfg.modelProvider, 'modelProvider');
  assert(config.workerTimeoutMs === cfg.workerTimeoutMs, 'workerTimeoutMs');
  assert(config.eventBusMaxHistory === cfg.eventBusMaxHistory, 'eventBusMaxHistory');
  assert(config.taskTimeout === cfg.taskTimeout, 'taskTimeout');
  assert(config.memoryImportance === cfg.memoryImportance, 'memoryImportance');
});

// ── 7. v9 accessors match get() ──
test('v9 accessors match get()', () => {
  const cfg = config.get();
  assert(config.persistence.dbPath === cfg.persistence.dbPath, 'persistence.dbPath');
  assert(config.agent.maxConcurrentTasks === cfg.agent.maxConcurrentTasks, 'agent.maxConcurrentTasks');
  assert(config.context.maxFragments === cfg.context.maxFragments, 'context.maxFragments');
  assert(config.artifact.allowedTypes.length === cfg.artifact.allowedTypes.length, 'artifact.allowedTypes');
  assert(config.distributed.nodeId === cfg.distributed.nodeId, 'distributed.nodeId');
  assert(config.marketplace.enabled === cfg.marketplace.enabled, 'marketplace.enabled');
});

// ── 8. toJSON round-trip ──
test('toJSON round-trip', () => {
  const json = config.toJSON();
  assert(typeof json === 'string', 'toJSON returns string');
  const parsed = JSON.parse(json);
  assert(parsed.persistence.dbPath === config.get().persistence.dbPath, 'JSON includes persistence');
  assert(parsed.agent.maxConcurrentTasks === config.get().agent.maxConcurrentTasks, 'JSON includes agent');
});

// ── 9. validate() returns full config ──
test('validate returns complete config from partial', () => {
  const validated = config.validate({});
  assert(validated.persistence.walMode === true, 'validate fills defaults');
  assert(validated.distributed.enabled === false, 'validate fills distributed.enabled');
});

// ── 10. Reset restores defaults ──
test('reset restores defaults', () => {
  const origDbPath = config.get().persistence.dbPath;
  config.update({ persistence: { dbPath: '/tmp/test.db' } as any });
  assert(config.get().persistence.dbPath === '/tmp/test.db', 'updated before reset');
  config.reset();
  assert(config.get().persistence.dbPath === './data/morpex-events.db', 'reset restores default');
  // Restore original if it was different
  if (origDbPath !== './data/morpex-events.db') {
    config.update({ persistence: { dbPath: origDbPath } as any });
  }
});

// ── 11. Deep merge preserves sibling fields ──
test('Deep merge preserves sibling fields in nested config', () => {
  const cfg = config.get();
  const origTTL = cfg.agent.defaultTTLMs;
  config.update({ agent: { negotiationTimeoutMs: 15000 } as any });
  const updated = config.get();
  assert(updated.agent.negotiationTimeoutMs === 15000, 'negotiationTimeoutMs updated');
  assert(updated.agent.defaultTTLMs === origTTL, 'defaultTTLMs preserved');
  // Restore
  config.update({ agent: { negotiationTimeoutMs: 30000 } as any });
});

// ── 12. Extremes — max content size boundary ──
test('Max content size boundary accepts valid', () => {
  const cfg = MorPexConfigSchema.parse({ artifact: { maxContentSizeBytes: 1 } });
  assert(cfg.artifact.maxContentSizeBytes === 1, 'minimum size accepted');
});

// ── Run and report ──
(async () => {
  // Small delay to let failing tests report
  await new Promise(r => setTimeout(r, 100));
  console.log(`\n=== Config Validation Tests: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
