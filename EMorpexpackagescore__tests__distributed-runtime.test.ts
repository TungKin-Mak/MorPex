/**
 * Distributed Agent Runtime Tests (v9.2) — Minimal
 */
import { AgentTransport } from '../src/agent/distributed/AgentTransport.js'
import { ConsensusCoordinator } from '../src/agent/distributed/ConsensusCoordinator.js'
import type { RemoteNode } from '../src/agent/distributed/types.js'

let passed = 0; let failed = 0
function test(name: string, fn: () => void | Promise<void>) {
  ;(async () => {
    try { await fn(); passed++ } catch (e: any) { failed++; console.error(`  FAIL ${name}: ${e.message}`) }
  })()
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m) }

console.log('\n=== Distributed Agent Runtime Tests ===\n')

const n1: RemoteNode = { nodeId: 'n1', address: 'local:5001', transport: 'local', status: 'online', capabilities: ['coding'], connectedAgents: ['a1'], lastHeartbeat: Date.now(), latency: 0 }
const n2: RemoteNode = { nodeId: 'n2', address: 'local:5002', transport: 'local', status: 'online', capabilities: ['review'], connectedAgents: ['a2'], lastHeartbeat: Date.now(), latency: 0 }

test('Transport: register, list, get', () => {
  const t = new AgentTransport()
  t.registerNode(n1)
  t.registerNode(n2)
  assert(t.listNodes().length === 2, '2 nodes')
  assert(t.getNode('n1') !== undefined, 'get n1')
  t.unregisterNode('n1')
  assert(t.listNodes().length === 1, '1 left')
})

test('Transport: send and broadcast', async () => {
  const t = new AgentTransport()
  t.registerNode(n1)
  t.registerNode(n2)
  const ok = await t.sendMessage({ id: 'm1', fromNode: 'n1', toNode: 'n2', type: 'heartbeat', payload: {}, timestamp: Date.now() })
  assert(ok === true, 'msg sent')
  t.broadcast('n1', 'heartbeat', {})
  assert(t.getMessageLog().length >= 1, 'broadcast logged')
})

test('ConsensusCoordinator: lock lifecycle', async () => {
  const t = new AgentTransport()
  t.registerNode({ ...n1, nodeId: 'local' })
  const cc = new ConsensusCoordinator(t, 'local')
  const l1 = await cc.requestLock('k1', 'a1')
  assert(l1 === true, 'lock acquired')
  const l2 = await cc.requestLock('k1', 'a2')
  assert(l2 === false, 'lock blocked')
  cc.releaseLock('k1', 'a1')
  const l3 = await cc.requestLock('k1', 'a2')
  assert(l3 === true, 'lock re-acquired')
})

;(async () => {
  await new Promise(r => setTimeout(r, 50))
  console.log(`\n=== Distributed Agent Runtime Tests: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
})()
