/**
 * Distributed Agent Runtime Tests (v9.2)
 *
 * Tests for AgentTransport, RemoteAgentProxy, DistributedScheduler,
 * DistributedRuntimeManager, ConsensusCoordinator.
 */
import { AgentTransport } from '../src/agent/distributed/AgentTransport.js'
import { RemoteAgentProxy } from '../src/agent/distributed/RemoteAgentProxy.js'
import { DistributedScheduler } from '../src/agent/distributed/DistributedScheduler.js'
import { DistributedRuntimeManager } from '../src/agent/distributed/DistributedRuntimeManager.js'
import { ConsensusCoordinator } from '../src/agent/distributed/ConsensusCoordinator.js'

let passed = 0; let failed = 0
function test(name: string, fn: () => void | Promise<void>) {
  ;(async () => {
    try { await fn(); passed++ } catch (e: any) { failed++; console.error('  FAIL ' + name + ': ' + e.message) }
  })()
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m) }
console.log('\n=== Distributed Agent Runtime Tests ===\n')

// 1. AgentTransport
test('AgentTransport: register, send, stats', async () => {
  const t = new AgentTransport()
  t.registerNode({ nodeId: 'n1', address: 'local', transport: 'local', status: 'online', capabilities: ['*'], connectedAgents: ['a1'], lastHeartbeat: Date.now(), latency: 0 })
  t.registerNode({ nodeId: 'n2', address: 'local', transport: 'local', status: 'online', capabilities: ['coding'], connectedAgents: ['a2'], lastHeartbeat: Date.now(), latency: 10 })
  assert(t.listNodes().length === 2, '2 nodes registered')
  assert(t.getNode('n1') !== undefined, 'getNode works')
  const sent = await t.sendMessage({ id: 'm1', fromNode: 'n1', toNode: 'n2', type: 'heartbeat', payload: {}, timestamp: Date.now() })
  assert(sent === true, 'message sent')
  const stats = t.getStats()
  assert(stats.nodeCount === 2, 'nodeCount 2')
  assert(stats.onlineCount === 2, 'onlineCount 2')
})

test('AgentTransport: unregister and list', () => {
  const t = new AgentTransport()
  t.registerNode({ nodeId: 'n1', address: 'local', transport: 'local', status: 'online', capabilities: [], connectedAgents: [], lastHeartbeat: Date.now(), latency: 0 })
  assert(t.unregisterNode('n1') === true, 'unregistered')
  assert(t.listNodes().length === 0, 'empty after unregister')
})

test('AgentTransport: broadcast', async () => {
  const t = new AgentTransport()
  t.registerNode({ nodeId: 'n1', address: 'local', transport: 'local', status: 'online', capabilities: [], connectedAgents: [], lastHeartbeat: Date.now(), latency: 0 })
  t.registerNode({ nodeId: 'n2', address: 'local', transport: 'local', status: 'online', capabilities: [], connectedAgents: [], lastHeartbeat: Date.now(), latency: 0 })
  await t.broadcast('n1', 'heartbeat', { test: true })
  assert(t.getStats().messageQueue > 0, 'messages queued')
})

// 2. RemoteAgentProxy
test('RemoteAgentProxy: request and status', async () => {
  const t = new AgentTransport()
  t.registerNode({ nodeId: 'remote', address: 'remote', transport: 'local', status: 'online', capabilities: ['coding'], connectedAgents: ['ra'], lastHeartbeat: Date.now(), latency: 50 })
  const proxy = new RemoteAgentProxy('remote', 'ra', t)
  const result = await proxy.request('test', {})
  assert(result !== undefined, 'request returned')
  const online = await proxy.heartbeat()
  assert(online === true, 'heartbeat ok')
})

// 3. DistributedScheduler
test('DistributedScheduler: select local first', () => {
  const t = new AgentTransport()
  const localSched = { selectAgent: (task: any) => ({ taskId: task.taskId || 't1', agentId: 'local', score: 0.9 }) }
  const s = new DistributedScheduler(localSched, t)
  const r = s.selectAgent({ taskId: 't1', requiredCapabilities: ['coding'] })
  assert(r !== null, 'selected')
  assert(r.agentId === 'local', 'local agent')
})

// 4. DistributedRuntimeManager
test('DistributedRuntimeManager: start, connect, stop', async () => {
  const mgr = new DistributedRuntimeManager('local-node')
  mgr.start()
  assert(mgr.getStatus().localNodeId === 'local-node', 'local id')
  await mgr.connectRemoteNode('remote:8000', 'grpc')
  assert(mgr.getNetworkTopology().length >= 2, 'has remote')
  mgr.stop()
})

// 5. ConsensusCoordinator
test('ConsensusCoordinator: lock, propose, consensus', async () => {
  const t = new AgentTransport()
  t.registerNode({ nodeId: 'n1', address: 'local', transport: 'local', status: 'online', capabilities: [], connectedAgents: [], lastHeartbeat: Date.now(), latency: 0 })
  t.registerNode({ nodeId: 'n2', address: 'local', transport: 'local', status: 'online', capabilities: [], connectedAgents: [], lastHeartbeat: Date.now(), latency: 0 })
  const cc = new ConsensusCoordinator(t)
  const locked = await cc.requestLock('key1', 'a1')
  assert(locked === true, 'lock acquired')
  cc.releaseLock('key1', 'a1')
  const agreed = await cc.proposeValue('cfg', 'val', 'a1')
  assert(agreed === true, 'consensus reached')
  assert(cc.getValue('cfg') === 'val', 'value stored')
})

;(async () => {
  await new Promise(r => setTimeout(r, 50))
  console.log('\n=== Distributed Agent Runtime Tests: ' + passed + ' passed, ' + failed + ' failed ===\n')
  if (failed > 0) process.exit(1)
})()
