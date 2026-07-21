/**
 * Agent Marketplace Tests (v9.2)
 *
 * Tests for MarketplaceRegistry, CapabilityAdvertiser, BidEngine,
 * TrustVerifier, MarketplaceContractManager, ThirdPartyAgentAdapter.
 */
import { MarketplaceRegistry } from '../src/agent/marketplace/MarketplaceRegistry.js'
import { CapabilityAdvertiser } from '../src/agent/marketplace/CapabilityAdvertiser.js'
import { BidEngine } from '../src/agent/marketplace/BidEngine.js'
import { TrustVerifier } from '../src/agent/marketplace/TrustVerifier.js'
import { MarketplaceContractManager } from '../src/agent/marketplace/MarketplaceContract.js'
import { ThirdPartyAgentAdapter } from '../src/agent/marketplace/ThirdPartyAgentAdapter.js'
import type { MarketplaceListing, Bid } from '../src/agent/marketplace/types.js'

let passed = 0; let failed = 0
function test(name: string, fn: () => void | Promise<void>) {
  ;(async () => {
    try { await fn(); passed++ } catch (e: any) { failed++; console.error('  FAIL ' + name + ': ' + e.message) }
  })()
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m) }
console.log('\n=== Agent Marketplace Tests ===\n')

function ml(overrides?: Partial<MarketplaceListing>): MarketplaceListing {
  return {
    id: 'l1', agentId: 'a1', agentName: 'Agent', agentType: 'executor',
    capabilities: [{ name: 'coding', level: 3, price: 100 }],
    reputation: 0.8, totalTasks: 50, successRate: 0.9, avgLatency: 200,
    pricePerTask: 100, available: true, tags: [], registeredAt: Date.now(), lastSeenAt: Date.now(),
    ...overrides,
  }
}

test('MarketplaceRegistry: register, get, query, unregister', () => {
  const reg = new MarketplaceRegistry()
  reg.register(ml({ agentId: 'a1' }))
  assert(reg.get('a1') !== undefined, 'get works')
  assert(reg.query({ capability: 'coding' }).length === 1, 'query by cap')
  reg.unregister('a1')
  assert(reg.get('a1') === undefined, 'unregistered')
})

test('CapabilityAdvertiser: advertise, update, remove', () => {
  const reg = new MarketplaceRegistry()
  const adv = new CapabilityAdvertiser(reg)
  adv.advertise('a2', 'Agent2', 'coder', [{ name: 'coding', level: 3, price: 100 }], { pricePerTask: 100, tags: ['backend'] })
  assert(reg.get('a2') !== undefined, 'advertised')
  assert(adv.getAdvertisedCapabilities('a2').length === 1, 'has caps')
  adv.updatePricing('a2', 'coding', 75)
  assert(reg.get('a2')!.capabilities[0].price === 75, 'price 75')
  adv.removeAdvert('a2')
  assert(reg.get('a2') === undefined, 'removed')
})

test('BidEngine: request and select', () => {
  const engine = new BidEngine()
  const listings = [
    ml({ agentId: 'fast', avgLatency: 50, successRate: 0.95, reputation: 0.9, pricePerTask: 200 }),
    ml({ agentId: 'cheap', avgLatency: 500, successRate: 0.6, reputation: 0.5, pricePerTask: 20 }),
  ]
  const bids = engine.requestBids(
    { id: 'r1', taskDescription: 'code', requiredCapabilities: ['coding'], maxBudget: 500, deadline: 10000, issuedAt: Date.now() },
    listings,
  )
  assert(bids.length === 2, 'got 2 bids')
  assert(engine.selectBestBid(bids, 'balanced') !== null, 'selected')
  assert(engine.selectBestBid(bids, 'cheapest')!.agentId === 'cheap', 'cheapest')
  assert(engine.selectBestBid(bids, 'fastest')!.agentId === 'fast', 'fastest')
})

test('TrustVerifier: verify registered agent', () => {
  const reg = new MarketplaceRegistry()
  reg.register(ml({ agentId: 'trusted', totalTasks: 100, successRate: 0.95, reputation: 0.8 }))
  const v = new TrustVerifier()
  const r = v.verify('trusted', reg)
  assert(r.trusted === true, 'trusted')
  assert(r.score >= 0.4, 'score >= 0.4')
})

test('TrustVerifier: verify external agent', () => {
  const v = new TrustVerifier()
  const r = v.verifyExternalAgent({ totalTasks: 50, reputation: 0.7, verified: true })
  assert(r.trusted === true, 'external trusted')
})

test('MarketplaceContractManager: lifecycle', () => {
  const mgr = new MarketplaceContractManager()
  const bid: Bid = { requestId: 'r1', agentId: 'seller', price: 100, estimatedDuration: 500, confidence: 0.9, submittedAt: Date.now() }
  const c = mgr.createContract(bid, 'buyer', 'write code', 3600000)
  assert(c.status === 'pending', 'pending')
  assert(mgr.signContract(c.id, 'seller') === true, 'signed')
  assert(mgr.getContract(c.id)!.status === 'active', 'active')
  assert(mgr.completeContract(c.id, {}) === true, 'completed')
  assert(mgr.getContract(c.id)!.status === 'completed', 'completed status')
  assert(mgr.listContracts('seller').length === 1, 'listed')
  assert(mgr.listAll().length === 1, 'all listed')
})

test('ThirdPartyAgentAdapter: adapt external agent', () => {
  const adapter = new ThirdPartyAgentAdapter()
  const l = adapter.adaptExternalAgent({ id: 'ext-1', name: 'Ext', type: 'coder', capabilities: ['write'], totalTasks: 20, successRate: 0.8, available: true })
  assert(l.tags.includes('external'), 'external tag')
  assert(adapter.isExternal(l) === true, 'detected external')
})

;(async () => {
  await new Promise(r => setTimeout(r, 50))
  console.log('\n=== Agent Marketplace Tests: ' + passed + ' passed, ' + failed + ' failed ===\n')
  if (failed > 0) process.exit(1)
})()
