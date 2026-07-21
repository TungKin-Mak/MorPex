/**
 * Shared Memory Consensus Tests (v9.2)
 *
 * Tests for SharedMemoryManager, ConsensusProtocol, MemoryLockService,
 * ConflictResolver, MemorySnapshotService.
 */
import { SharedMemoryManager } from '../src/agent/memory/SharedMemoryManager.js'
import { ConsensusProtocol } from '../src/agent/memory/ConsensusProtocol.js'
import { MemoryLockService } from '../src/agent/memory/MemoryLockService.js'
import { ConflictResolver } from '../src/agent/memory/ConflictResolver.js'
import { MemorySnapshotService } from '../src/agent/memory/MemorySnapshotService.js'

let passed = 0; let failed = 0
function test(name: string, fn: () => void | Promise<void>) {
  ;(async () => {
    try { await fn(); passed++ } catch (e: any) { failed++; console.error('  FAIL ' + name + ': ' + e.message); }
  })()
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m) }
console.log('\n=== Shared Memory Consensus Tests ===\n')

function makeMgr(): SharedMemoryManager {
  return new SharedMemoryManager({ maxEntries: 100, defaultTTL: 60000, consistencyLevel: 'eventual', autoCleanupInterval: 0 })
}

test('SharedMemoryManager: write/read across scopes', () => {
  const m = makeMgr()
  m.write('k1', 'v1', 'private', 'a1')
  m.write('k2', 'v2', 'team_shared', 'a2')
  m.write('k3', 'v3', 'org_shared', 'a3')
  assert(m.read('k1', 'private') === 'v1', 'private')
  assert(m.read('k2', 'team_shared') === 'v2', 'team')
  assert(m.read('k3', 'org_shared') === 'v3', 'org')
  assert(m.read('none', 'private') === undefined, 'missing')
})

test('SharedMemoryManager: query by prefix', () => {
  const m = makeMgr()
  m.write('proj_a', 'x', 'team_shared', 'a1')
  m.write('proj_b', 'y', 'team_shared', 'a2')
  assert(m.query('proj_', 'team_shared').length === 2, 'prefix query')
})

test('SharedMemoryManager: TTL and cleanup', async () => {
  const m = makeMgr()
  m.write('tmp', 'data', 'private', 'a1', 5)
  assert(m.read('tmp', 'private') === 'data', 'before ttl')
  await new Promise(r => setTimeout(r, 15))
  assert(m.read('tmp', 'private') === undefined, 'after ttl')
})

test('SharedMemoryManager: cleanup expired', async () => {
  const m = makeMgr()
  m.write('keep', 'x', 'private', 'a1', 60000)
  m.write('gone', 'y', 'private', 'a2', 1)
  await new Promise(r => setTimeout(r, 10))
  assert(m.cleanupExpired() === 1, 'cleaned 1')
})

test('ConsensusProtocol: majority accept and reject', () => {
  const cp = new ConsensusProtocol()
  cp.setKnownAgents(['a1', 'a2', 'a3'])
  const p = cp.propose('key', 'val', 'a1', 'team_shared')
  cp.vote(p.id, 'a1', true)
  cp.vote(p.id, 'a2', true)
  cp.vote(p.id, 'a3', false)
  const r = cp.resolve(p.id)
  assert(r.accepted === true, 'accepted')
  assert(r.value === 'val', 'value correct')

  const p2 = cp.propose('k2', 'v2', 'a1', 'team_shared')
  cp.vote(p2.id, 'a1', false)
  cp.vote(p2.id, 'a2', false)
  const r2 = cp.resolve(p2.id)
  assert(r2.accepted === false, 'rejected')
})

test('MemoryLockService: acquire, check, release', async () => {
  const mls = new MemoryLockService()
  assert(await mls.acquireLock('r1', 'a1', 'write', 'team_shared'), 'acquired')
  assert(mls.isLocked('r1').locked === true, 'locked')
  assert(mls.releaseLock('r1', 'a1') === true, 'released')
  assert(mls.isLocked('r1').locked === false, 'unlocked')
})

test('MemoryLockService: write exclusion', async () => {
  const mls = new MemoryLockService()
  await mls.acquireLock('r2', 'a1', 'write', 'team_shared')
  assert(await mls.acquireLock('r2', 'a2', 'write', 'team_shared') === false, 'excluded')
})

test('ConflictResolver: last write wins', () => {
  const cr = new ConflictResolver()
  const conflicts = [
    { agentId: 'a1', value: 'old', timestamp: 1000 },
    { agentId: 'a2', value: 'new', timestamp: 2000 },
  ]
  const r = cr.resolve('k', conflicts, 'last_write_wins', 'team_shared')
  assert(r.value === 'new', 'last wins')
})

test('ConflictResolver: majority vote', () => {
  const cr = new ConflictResolver()
  const conflicts = [
    { agentId: 'a1', value: 'common', timestamp: 1000 },
    { agentId: 'a2', value: 'common', timestamp: 2000 },
    { agentId: 'a3', value: 'rare', timestamp: 1500 },
  ]
  const r = cr.resolve('k', conflicts, 'majority_vote', 'team_shared')
  assert(r.value === 'common', 'majority')
})

test('MemorySnapshotService: snapshot and restore', () => {
  const m = makeMgr()
  const snap = new MemorySnapshotService()
  m.write('k', 'v1', 'team_shared', 'a1')
  const s = snap.takeSnapshot('team_shared', m)
  assert(s.size === 1, 'snapshot size 1')
  m.write('k', 'v2', 'team_shared', 'a2')
  assert(m.read('k', 'team_shared') === 'v2', 'overwritten')
  snap.restoreSnapshot(s.id, m)
  assert(m.read('k', 'team_shared') === 'v1', 'restored')
})

;(async () => {
  await new Promise(r => setTimeout(r, 50))
  console.log('\n=== Shared Memory Consensus Tests: ' + passed + ' passed, ' + failed + ' failed ===\n')
  if (failed > 0) process.exit(1)
})()
