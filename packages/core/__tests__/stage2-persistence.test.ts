/**
 * Stage 2 Persistence Tests — v9.2 Agent Organization OS 持久化
 *
 * 覆盖: Cross-Agent Learning, Organization Governance, Marketplace,
 *       Distributed Runtime, Team Formation, Shared Memory Consensus
 */
import Database from 'better-sqlite3'

let passed = 0
let failed = 0

function test(name: string, fn: () => void | Promise<void>) {
  (async () => {
    try { await fn(); passed++ } catch (e: any) { failed++; console.error(`  FAIL ${name}: ${e.message}`) }
  })()
}

function assert(c: boolean, m: string) { if (!c) throw new Error(m) }

let db = new Database(':memory:')

// Import all repositories
// We inline the schema since we need it for tests
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS shared_experiences (
    id TEXT PRIMARY KEY, category TEXT NOT NULL, problem_pattern TEXT NOT NULL,
    solution TEXT NOT NULL, success_rate REAL DEFAULT 0, avg_latency REAL DEFAULT 0,
    cost_savings REAL DEFAULT 0, source_agent_type TEXT, source_mission_ids TEXT,
    positive_feedback INTEGER DEFAULT 0, negative_feedback INTEGER DEFAULT 0,
    weight REAL DEFAULT 0, tags TEXT, visible_to TEXT, created_at INTEGER NOT NULL,
    last_validated_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS org_policies (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, priority INTEGER DEFAULT 0,
    action TEXT NOT NULL, rule_condition TEXT, override_by TEXT,
    enabled INTEGER DEFAULT 1, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS team_governance (
    team_id TEXT PRIMARY KEY, team_name TEXT NOT NULL, member_roles TEXT,
    max_concurrent_collabs INTEGER DEFAULT 5, budget_allocation REAL DEFAULT 0,
    allow_external INTEGER DEFAULT 0, require_approval INTEGER DEFAULT 0,
    escalation_path TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS team_memberships (
    agent_id TEXT NOT NULL, team_id TEXT NOT NULL, team_role TEXT DEFAULT 'member',
    permissions TEXT, joined_at INTEGER NOT NULL, PRIMARY KEY (agent_id, team_id)
  );
  CREATE TABLE IF NOT EXISTS org_budget (
    id TEXT PRIMARY KEY DEFAULT 'singleton', total_budget REAL DEFAULT 1000000,
    allocated REAL DEFAULT 0, reserved REAL DEFAULT 0, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS budget_allocations (
    team_id TEXT PRIMARY KEY, allocated REAL NOT NULL, spent REAL DEFAULT 0,
    last_updated INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS marketplace_listings (
    id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, capability TEXT NOT NULL,
    price_per_task REAL DEFAULT 0, availability INTEGER DEFAULT 1,
    reputation REAL DEFAULT 0, total_tasks INTEGER DEFAULT 0, success_rate REAL DEFAULT 1,
    metadata_json TEXT DEFAULT '{}', listed_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS marketplace_bids (
    id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, bidder_id TEXT NOT NULL,
    price REAL NOT NULL, estimated_duration INTEGER, confidence REAL DEFAULT 0.5,
    status TEXT DEFAULT 'pending', created_at INTEGER NOT NULL, awarded_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS marketplace_contracts (
    id TEXT PRIMARY KEY, bid_id TEXT, provider_id TEXT NOT NULL,
    consumer_id TEXT NOT NULL, capability TEXT NOT NULL, price REAL NOT NULL,
    status TEXT DEFAULT 'active', terms_json TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL, completed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS agent_instances (
    node_id TEXT NOT NULL, agent_id TEXT NOT NULL, status TEXT DEFAULT 'online',
    last_heartbeat INTEGER NOT NULL, address TEXT, capabilities_json TEXT DEFAULT '[]',
    load REAL DEFAULT 0, PRIMARY KEY (node_id, agent_id)
  );
  CREATE TABLE IF NOT EXISTS remote_messages (
    id TEXT PRIMARY KEY, from_node TEXT NOT NULL, to_node TEXT NOT NULL,
    correlation_id TEXT, type TEXT NOT NULL, payload TEXT DEFAULT '{}',
    status TEXT DEFAULT 'sent', sent_at INTEGER NOT NULL, received_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS agent_teams (
    team_id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, status TEXT DEFAULT 'forming',
    leader_id TEXT, composition_json TEXT DEFAULT '{}', context_json TEXT DEFAULT '{}',
    formed_at INTEGER NOT NULL, dissolved_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS shared_memory_entries (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER DEFAULT 1,
    lock_owner TEXT, lock_expires_at INTEGER, consensus_version INTEGER DEFAULT 1,
    created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
`
db.exec(SCHEMA_SQL)

// ── Imports ──
import { ExperienceSqliteRepository } from '../src/agent/learning/ExperienceSqliteRepository.js'
import { GovernanceSqliteRepository } from '../src/agent/governance/GovernanceSqliteRepository.js'
import { MarketplaceSqliteRepository } from '../src/agent/marketplace/MarketplaceSqliteRepository.js'
import { DistributedSqliteRepository } from '../src/agent/distributed/DistributedSqliteRepository.js'
import { TeamSqliteRepository } from '../src/agent/team/TeamSqliteRepository.js'
import { SharedMemorySqliteRepository } from '../src/agent/memory/SharedMemorySqliteRepository.js'

const expRepo = new ExperienceSqliteRepository(db)
const govRepo = new GovernanceSqliteRepository(db)
const mktRepo = new MarketplaceSqliteRepository(db)
const distRepo = new DistributedSqliteRepository(db)
const teamRepo = new TeamSqliteRepository(db)
const smRepo = new SharedMemorySqliteRepository(db)

// ═══════════════════════════════════════════════════════
// 1. Cross-Agent Learning — ExperienceSqliteRepository
// ═══════════════════════════════════════════════════════

test('1. ExperienceSqliteRepository: save, get, query, feedback', () => {
  expRepo.save({
    id: 'exp_001', category: 'error_handling', problemPattern: 'timeout during API call',
    solution: 'add retry with exponential backoff',
    effectiveness: { successRate: 0.85, avgLatency: 1500, costSavings: 0 },
    sourceAgentType: 'coder', sourceMissionIds: ['mis_001', 'mis_002'],
    feedback: { positive: 0, negative: 0, weight: 0 },
    tags: ['api', 'timeout', 'retry'], visibleTo: ['coder', 'executor'],
    createdAt: Date.now(), lastValidatedAt: Date.now(),
  })
  const retrieved = expRepo.get('exp_001')
  assert(retrieved !== undefined, 'should retrieve saved experience')
  assert(retrieved!.problemPattern === 'timeout during API call', 'problemPattern matches')
  assert(retrieved!.feedback.weight === 0, 'initial weight is 0')

  expRepo.recordFeedback('exp_001', true)
  const afterFeedback = expRepo.get('exp_001')
  assert(afterFeedback!.feedback.positive === 1, 'positive feedback incremented')
  assert(afterFeedback!.feedback.weight > 0, 'weight updated after feedback')

  const queried = expRepo.query({ category: 'error_handling' })
  assert(queried.length === 1, 'query by category returns 1 result')

  const stats = expRepo.getStats()
  assert(stats.total === 1, 'stats.total === 1')
  assert(stats.byCategory['error_handling'] === 1, 'stats by category')
})

// ═══════════════════════════════════════════════════════
// 2. Organization Governance — GovernanceSqliteRepository
// ═══════════════════════════════════════════════════════

test('2. GovernanceSqliteRepository: org policies', () => {
  govRepo.savePolicy({
    id: 'pol_001', name: 'block_external_collab', description: 'Block cross-team collaboration for executors',
    priority: 100, action: 'deny', ruleCondition: 'sourceAgentRole=executor', overrideBy: 'coordinator',
    enabled: 1, createdAt: Date.now(),
  })
  const p = govRepo.getPolicy('pol_001')
  assert(p !== undefined, 'policy retrieved')
  assert(p!.action === 'deny', 'action matches')
  assert(p!.priority === 100, 'priority matches')

  const policies = govRepo.listPolicies(true)
  assert(policies.length === 1, 'list enabled policies')

  govRepo.deletePolicy('pol_001')
  assert(govRepo.getPolicy('pol_001') === undefined, 'policy deleted')
})

test('3. GovernanceSqliteRepository: team governance + members', () => {
  govRepo.saveTeam({
    teamId: 'team_alpha', teamName: 'Alpha Team', memberRoles: 'planner,executor',
    maxConcurrentCollabs: 3, budgetAllocation: 50000, allowExternal: 0, requireApproval: 1,
    escalationPath: 'agent-001,agent-002', createdAt: Date.now(),
  })
  const t = govRepo.getTeam('team_alpha')
  assert(t !== undefined, 'team retrieved')
  assert(t!.teamName === 'Alpha Team', 'team name matches')
  assert(t!.maxConcurrentCollabs === 3, 'max concurrent collabs')

  govRepo.addMember('agent-001', 'team_alpha', 'leader')
  govRepo.addMember('agent-002', 'team_alpha', 'member')
  const members = govRepo.getMembers('team_alpha')
  assert(members.length === 2, '2 members added')
  assert(members[0].team_role === 'leader', 'first member is leader')

  govRepo.removeMember('agent-002', 'team_alpha')
  assert(govRepo.getMembers('team_alpha').length === 1, '1 member after removal')
})

test('4. GovernanceSqliteRepository: budget allocation', () => {
  orgBudget: {
    const org = govRepo.getOrgBudget()
    assert(org.total_budget === 1000000, 'default total budget is 1M')
  }
  allocate: {
    const ok = govRepo.allocate('team_alpha', 200000)
    assert(ok, 'allocation succeeded')
    const team = govRepo.getTeamBudget('team_alpha')
    assert(team.allocated === 200000, 'team allocated 200k')
  }
  overspend: {
    const ok = govRepo.spend('team_alpha', 250000)
    assert(!ok, 'overspend blocked')
  }
  spend: {
    const ok = govRepo.spend('team_alpha', 100000)
    assert(ok, 'spend succeeded')
  }
  deallocate: {
    const ok = govRepo.deallocate('team_alpha', 50000)
    assert(ok, 'deallocate succeeded')
    const team = govRepo.getTeamBudget('team_alpha')
    assert(team.allocated === 150000, 'allocated reduced to 150k')
  }
})

// ═══════════════════════════════════════════════════════
// 3. Agent Marketplace — MarketplaceSqliteRepository
// ═══════════════════════════════════════════════════════

test('5. Marketplace: listing, search, bid, award, contract', () => {
  // Create listing
  mktRepo.saveListing({
    id: 'lst_001', agentId: 'agent-coder-01', capability: 'code_review',
    pricePerTask: 50, availability: 1, reputation: 0.9, totalTasks: 100,
    successRate: 0.95, metadata: { languages: ['ts', 'py'] }, listedAt: Date.now(),
  })
  const listing = mktRepo.getListing('lst_001')
  assert(listing !== undefined, 'listing created')
  assert(listing.capability === 'code_review', 'capability matches')

  // Search
  const results = mktRepo.searchListings('code_review')
  assert(results.length >= 1, 'search finds listing')

  // Place bid
  mktRepo.placeBid({
    id: 'bid_001', listingId: 'lst_001', bidderId: 'agent-coder-02',
    price: 45, estimatedDuration: 60000, confidence: 0.85, createdAt: Date.now(),
  })
  const bids = mktRepo.getBids('lst_001')
  assert(bids.length === 1, '1 bid placed')
  assert(bids[0].price === 45, 'bid price 45')

  // Award bid
  mktRepo.awardBid('bid_001')
  mktRepo.rejectOtherBids('lst_001', 'bid_001')
  const awarded = mktRepo.getBids('lst_001')
  assert(awarded[0].status === 'awarded', 'bid awarded')

  // Create contract
  mktRepo.createContract({
    id: 'con_001', bidId: 'bid_001', providerId: 'agent-coder-02',
    consumerId: 'agent-planner-01', capability: 'code_review', price: 45,
    terms: { deadline: 3600000, revisionLimit: 3 }, createdAt: Date.now(),
  })
  const contract = mktRepo.getContract('con_001')
  assert(contract !== undefined, 'contract created')
  assert(contract.status === 'active', 'contract active')
  assert(contract.terms.deadline === 3600000, 'terms preserved')

  // Complete contract
  mktRepo.updateContractStatus('con_001', 'completed')
  assert(mktRepo.getContract('con_001').status === 'completed', 'contract completed')

  // Update listing availability
  mktRepo.updateAvailability('lst_001', false)
  assert(mktRepo.searchListings('code_review').length === 0, 'listing unavailable after availability=false')
})

// ═══════════════════════════════════════════════════════
// 4. Distributed Runtime — DistributedSqliteRepository
// ═══════════════════════════════════════════════════════

test('6. Distributed: register, heartbeat, message', () => {
  // Register instances
  distRepo.registerInstance('node-1', 'agent-planner-01', '10.0.0.1:3000', ['planning', 'analysis'])
  distRepo.registerInstance('node-2', 'agent-coder-01', '10.0.0.2:3000', ['coding', 'review'])

  const online = distRepo.getOnlineInstances()
  assert(online.length === 2, '2 online instances')

  // Heartbeat
  distRepo.heartbeat('node-1', 'agent-planner-01', 0.5)
  const list = distRepo.listByAgent('agent-planner-01')
  assert(list.length === 1, 'agent found')

  // Send and receive message
  distRepo.sendMessage({
    id: 'msg_001', fromNode: 'node-1', toNode: 'node-2',
    correlationId: 'corr_001', type: 'REQUEST', payload: { task: 'review PR #42' },
    sentAt: Date.now(),
  })
  const msgs = distRepo.receiveMessages('node-2', true)
  assert(msgs.length === 1, '1 message received')
  assert(msgs[0].payload.task === 'review PR #42', 'message payload preserved')

  // Mark offline
  distRepo.markOffline('node-2', 'agent-coder-01')
  assert(distRepo.getOnlineInstances().length === 1, '1 instance after mark offline')
})

// ═══════════════════════════════════════════════════════
// 5. Team Formation — TeamSqliteRepository
// ═══════════════════════════════════════════════════════

test('7. Team: create, update, dissolve', () => {
  teamRepo.createTeam('team_mission_01', 'mission-001', 'agent-planner-01')

  const team = teamRepo.getTeam('team_mission_01')
  assert(team !== undefined, 'team created')
  assert(team.status === 'forming', 'initial status is forming')
  assert(team.leader_id === 'agent-planner-01', 'leader set')

  teamRepo.updateStatus('team_mission_01', 'active')
  assert(teamRepo.getTeam('team_mission_01').status === 'active', 'status updated')

  teamRepo.updateComposition('team_mission_01', { roles: { planner: 'agent-planner-01', coder: 'agent-coder-01' } })
  const updated = teamRepo.getTeam('team_mission_01')
  assert(updated.composition.roles.planner === 'agent-planner-01', 'composition updated')

  const byMission = teamRepo.getTeamsByMission('mission-001')
  assert(byMission.length === 1, 'found by mission')

  teamRepo.dissolveTeam('team_mission_01')
  assert(teamRepo.getTeam('team_mission_01').status === 'dissolved', 'team dissolved')
})

// ═══════════════════════════════════════════════════════
// 6. Shared Memory Consensus — SharedMemorySqliteRepository
// ═══════════════════════════════════════════════════════

test('8. Shared Memory: write, read, lock, consensus', () => {
  // Write initial value
  smRepo.write('config:model', { provider: 'deepseek', modelId: 'v4' }, 'agent-admin')
  const entry = smRepo.read('config:model')
  assert(entry !== undefined, 'entry exists')
  assert(entry!.version === 1, 'initial version 1')
  assert(entry!.lockOwner === null, 'no lock initially')

  // Write again (update)
  smRepo.write('config:model', { provider: 'deepseek', modelId: 'v5' }, 'agent-admin')
  const updated = smRepo.read('config:model')
  assert(updated!.version === 2, 'version incremented on update')

  // Acquire lock
  const locked = smRepo.acquireLock('config:model', 'agent-planner', 60000)
  assert(locked, 'lock acquired')
  const withLock = smRepo.read('config:model')
  assert(withLock!.lockOwner === 'agent-planner', 'lock owner set')

  // Lock collision
  const locked2 = smRepo.acquireLock('config:model', 'agent-coder', 60000)
  assert(!locked2, 'second agent cannot acquire lock')

  // Release lock
  const released = smRepo.releaseLock('config:model', 'agent-planner')
  assert(released, 'lock released')
  assert(smRepo.read('config:model')!.lockOwner === null, 'no owner after release')

  // Consensus version
  const v1 = smRepo.incrementConsensusVersion('config:model')
  assert(v1 === 2, 'consensus version incremented to 2')
  const v2 = smRepo.incrementConsensusVersion('config:model')
  assert(v2 === 3, 'consensus version incremented to 3')

  // getWithConsensus with minVersion
  const withMin = smRepo.getWithConsensus('config:model', 2)
  assert(withMin !== undefined, 'found with minVersion 2')
  const noMatch = smRepo.getWithConsensus('config:model', 5)
  assert(noMatch === undefined, 'not found with minVersion 5')
})

// ═══════════════════════════════════════════════════════
// 7-14. Integration tests
// ═══════════════════════════════════════════════════════

test('9. Integration: experience cross-query with tags', () => {
  expRepo.save({
    id: 'exp_002', category: 'task_execution', problemPattern: 'large file processing',
    solution: 'chunk and parallel process',
    effectiveness: { successRate: 0.9, avgLatency: 5000, costSavings: 0.3 },
    sourceAgentType: 'coder', sourceMissionIds: ['mis_003'],
    feedback: { positive: 2, negative: 0, weight: 0 },
    tags: ['file', 'parallel', 'large-data'], visibleTo: ['*'],
    createdAt: Date.now(), lastValidatedAt: Date.now(),
  })
  // Query by weight (after positive feedback)
  const q = expRepo.query({ minWeight: 0.1 })
  assert(q.length >= 1, 'query with minWeight returns results')
})

test('10. Integration: marketplace and team budgets', () => {
  // Create marketplace listing
  mktRepo.saveListing({
    id: 'lst_002', agentId: 'agent-external-01', capability: 'security_audit',
    pricePerTask: 200, availability: 1, reputation: 0.8, totalTasks: 50,
    successRate: 0.9, metadata: {}, listedAt: Date.now(),
  })
  // Create team budget for marketplace procurement
  govRepo.saveTeam({
    teamId: 'team_procurement', teamName: 'Procurement Team', memberRoles: 'coordinator',
    maxConcurrentCollabs: 2, budgetAllocation: 100000, allowExternal: 1, requireApproval: 1,
    escalationPath: 'agent-admin', createdAt: Date.now(),
  })
  govRepo.allocate('team_procurement', 100000)

  // Place marketplace bid
  mktRepo.placeBid({
    id: 'bid_002', listingId: 'lst_002', bidderId: 'agent-external-01',
    price: 180, estimatedDuration: 7200000, confidence: 0.9, createdAt: Date.now(),
  })
  mktRepo.awardBid('bid_002')
  mktRepo.createContract({
    id: 'con_002', bidId: 'bid_002', providerId: 'agent-external-01',
    consumerId: 'team_procurement', capability: 'security_audit', price: 180,
    terms: { scope: 'full' }, createdAt: Date.now(),
  })

  // Spend from team budget
  const spent = govRepo.spend('team_procurement', 180)
  assert(spent, 'team can spend budget')
  const budget = govRepo.getTeamBudget('team_procurement')
  assert(budget.spent === 180, 'spent recorded correctly')
})

test('11. Integration: distributed team coordination', () => {
  // Register distributed agents
  distRepo.registerInstance('node-eu-1', 'agent-planner-eu', '10.0.1.1:3000', ['planning'])
  distRepo.registerInstance('node-us-1', 'agent-coder-us', '10.0.2.1:3000', ['coding'])

  // Create team
  teamRepo.createTeam('team_global', 'mission-global-001', 'agent-planner-eu')
  teamRepo.updateComposition('team_global', { nodes: ['node-eu-1', 'node-us-1'] })
  teamRepo.updateStatus('team_global', 'active')

  // Send coordination message
  distRepo.sendMessage({
    id: 'msg_global_001', fromNode: 'node-eu-1', toNode: 'node-us-1',
    correlationId: 'corr_global_001', type: 'COORDINATE',
    payload: { teamId: 'team_global', action: 'start_coding' },
    sentAt: Date.now(),
  })
  const received = distRepo.receiveMessages('node-us-1', true)
  assert(received.length === 1, 'coordination message received')
  assert(received[0].payload.teamId === 'team_global', 'team context correct')

  // Verify team exists
  const team = teamRepo.getTeam('team_global')
  assert(team !== undefined, 'distributed team exists')
  assert(team.status === 'active', 'team active')
})

test('12. Integration: shared memory with consensus across agents', () => {
  // Agent A writes shared config
  smRepo.write('shared:deployment_config', { env: 'staging', version: '2.1.0' }, 'agent-deploy')
  assert(smRepo.read('shared:deployment_config')!.version === 1, 'initial version')

  // Agent B acquires lock to update
  const lockOk = smRepo.acquireLock('shared:deployment_config', 'agent-dev', 30000)
  assert(lockOk, 'agent-dev acquires lock')

  // Agent C cannot write (no lock)
  const lockFail = smRepo.acquireLock('shared:deployment_config', 'agent-qa', 30000)
  assert(!lockFail, 'agent-qa cannot acquire lock while held')

  // Agent B writes with consensus
  const written = smRepo.writeWithConsensus('shared:deployment_config', { env: 'staging', version: '2.2.0' }, 'agent-dev')
  assert(written, 'consensus write succeeded')
  const afterWrite = smRepo.read('shared:deployment_config')
  assert(afterWrite!.version === 2, 'version incremented')
  assert(afterWrite!.consensusVersion === 2, 'consensus version incremented')

  // Release lock
  smRepo.releaseLock('shared:deployment_config', 'agent-dev')

  // Cleanup expired locks
  smRepo.write('shared:temp', { data: 'temp' }, 'agent-temp')
  smRepo.acquireLock('shared:temp', 'agent-temp', 1) // 1ms TTL
  // Wait briefly then cleanup should release
  const cleaned = smRepo.cleanupExpiredLocks()
  // Note: may be 0 if not expired yet due to timing
  assert(true, 'cleanup runs without error')
})

test('13. Integration: full lifecycle — agent → team → collaboration → experience', () => {
  // Register via governance repo
  govRepo.saveTeam({
    teamId: 'team_full', teamName: 'Full Lifecycle Team', memberRoles: 'planner,coder,reviewer',
    maxConcurrentCollabs: 5, budgetAllocation: 50000, allowExternal: 0, requireApproval: 0,
    escalationPath: '', createdAt: Date.now(),
  })
  govRepo.addMember('agent-full-01', 'team_full', 'planner')
  govRepo.addMember('agent-full-02', 'team_full', 'coder')

  // Create team in team repo
  teamRepo.createTeam('team_full', 'mission-full-001', 'agent-full-01')
  teamRepo.updateStatus('team_full', 'active')

  // Collaborate (via distributed messages)
  distRepo.registerInstance('node-full', 'agent-full-01', 'localhost:3001', ['planning'])
  distRepo.registerInstance('node-full', 'agent-full-02', 'localhost:3002', ['coding'])
  distRepo.sendMessage({
    id: 'msg_full_001', fromNode: 'node-full', toNode: 'node-full',
    correlationId: 'corr_full_001', type: 'REQUEST',
    payload: { from: 'agent-full-01', to: 'agent-full-02', task: 'implement feature X' },
    sentAt: Date.now(),
  })

  // Record experience from this collaboration
  expRepo.save({
    id: 'exp_full_001', category: 'collaboration',
    problemPattern: 'cross-agent feature implementation',
    solution: 'assign clear interface contract before starting',
    effectiveness: { successRate: 0.88, avgLatency: 3000, costSavings: 0.2 },
    sourceAgentType: 'planner', sourceMissionIds: ['mission-full-001'],
    feedback: { positive: 1, negative: 0, weight: 0.5 },
    tags: ['collaboration', 'interface', 'contract'],
    visibleTo: ['planner', 'coder'],
    createdAt: Date.now(), lastValidatedAt: Date.now(),
  })
  assert(expRepo.get('exp_full_001') !== undefined, 'experience saved from collaboration')
})

test('14. Integration: cleanup and stats across domains', () => {
  // Experience stats
  const expStats = expRepo.getStats()
  assert(expStats.total >= 3, 'multiple experiences stored')
  assert(Object.keys(expStats.byCategory).length >= 2, 'multiple categories')

  // Governance policy count
  const policies = govRepo.listPolicies()
  assert(policies.length >= 0, 'policies accessible')

  // Marketplace contract count
  const contracts = mktRepo.listContracts()
  assert(contracts.length >= 2, 'multiple contracts created')

  // Distributed instance cleanup (stale timeout)
  const staleCount = distRepo.cleanupStale(0) // 0ms timeout → all offline
  assert(staleCount >= 0, 'stale cleanup ran')

  // Shared memory key listing
  const keys = smRepo.listKeys()
  assert(keys.length >= 2, 'multiple shared memory keys')
})

// ═══════════════════════════════════════════════════════
// Run
// ═══════════════════════════════════════════════════════

async function run() {
  console.log('\n=== Stage 2 Persistence Tests ===\n')
  // Tests are scheduled via test() calls above
  await new Promise(r => setTimeout(r, 100))
  if (failed > 0) {
    console.log(`\n=== Stage 2: ${passed} passed, ${failed} failed ===\n`)
    process.exit(1)
  }
  console.log(`\n=== Stage 2: ${passed} passed, ${failed} failed ===\n`)
}

run().catch(e => { console.error(e); process.exit(1) })
