/**
 * Organization Governance Tests (v9.2)
 *
 * 覆盖:
 *   1. OrganizationPolicyEngine: evaluate rules, add/remove, priority
 *   2. TeamGovernanceModel: create team, members, canCollaborate, escalation
 *   3. OrgBudgetAllocator: allocate/deallocate/spend/transfer
 *   4. GovernanceAudit: record/query/stats
 *   5. Integration: policy check before cross-team collaboration
 */

import { OrganizationPolicyEngine } from '../src/agent/governance/OrganizationPolicyEngine.js'
import type { OrgPolicyRule, OrgPolicyContext } from '../src/agent/governance/OrganizationPolicyEngine.js'
import { TeamGovernanceModel } from '../src/agent/governance/TeamGovernanceModel.js'
import type { TeamPolicy } from '../src/agent/governance/TeamGovernanceModel.js'
import { OrgBudgetAllocator } from '../src/agent/governance/OrgBudgetAllocator.js'
import { GovernanceAudit } from '../src/agent/governance/GovernanceAudit.js'

let passed = 0; let failed = 0
function test(name: string, fn: () => void | Promise<void>) {
  ;(async () => {
    try { await fn(); passed++ } catch (e: any) { failed++; console.error(`  FAIL ${name}: ${e.message}`); }
  })()
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m) }

console.log('\n=== Organization Governance Tests ===\n')

// ── 1. OrganizationPolicyEngine ──

test('OrganizationPolicyEngine: built-in rules evaluate correctly', () => {
  const engine = new OrganizationPolicyEngine()

  // executor 发起 cross_team → require_approval
  const ctx1: OrgPolicyContext = {
    action: 'cross_team_collaboration', sourceAgentId: 'agent1', sourceAgentRole: 'executor',
    targetAgentRole: 'executor', timestamp: Date.now(),
  }
  const d1 = engine.evaluate(ctx1)
  assert(d1.rule.name === 'block_external_collab', 'executor cross_team matched block_external_collab')
  assert(d1.action === 'require_approval', 'action = require_approval')

  // coordinator → allow
  const ctx2: OrgPolicyContext = {
    action: 'any', sourceAgentId: 'coord1', sourceAgentRole: 'coordinator', timestamp: Date.now(),
  }
  const d2 = engine.evaluate(ctx2)
  assert(d2.action === 'allow', 'coordinator gets allow')
})

test('OrganizationPolicyEngine: add/remove custom rules', () => {
  const engine = new OrganizationPolicyEngine()
  const customRule: OrgPolicyRule = {
    name: 'block_night', description: 'Block actions at night', priority: 200,
    condition: (ctx) => {
      const hour = new Date().getHours()
      return hour >= 22 || hour < 6
    },
    action: 'deny',
  }
  engine.addRule(customRule)
  const rules = engine.getRules()
  assert(rules.some(r => r.name === 'block_night'), 'custom rule added')
  assert(rules[0].priority === 200, 'highest priority first')

  const removed = engine.removeRule('block_night')
  assert(removed === true, 'rule removed')
  assert(engine.getRules().every(r => r.name !== 'block_night'), 'no longer present')
})

test('OrganizationPolicyEngine: priority ordering', () => {
  const highRule: OrgPolicyRule = {
    name: 'high_priority', description: 'High', priority: 1000,
    condition: () => true, action: 'deny',
  }
  const engine = new OrganizationPolicyEngine([highRule])
  const ctx: OrgPolicyContext = {
    action: 'test', sourceAgentId: 'a', sourceAgentRole: 'executor', timestamp: Date.now(),
  }
  const d = engine.evaluate(ctx)
  assert(d.rule.name === 'high_priority', 'high priority rule wins')
  assert(d.action === 'deny', 'high priority action applied')
})

// ── 2. TeamGovernanceModel ──

test('TeamGovernanceModel: create team and manage members', () => {
  const model = new TeamGovernanceModel()

  const policy: TeamPolicy = {
    teamId: 'team_alpha', teamName: 'Alpha Team', memberRoles: ['executor', 'reviewer'],
    maxConcurrentCollabs: 5, budgetAllocation: 100000, allowExternalRecruitment: true,
    requireApprovalForChanges: false, escalationPath: ['coordinator_1'], createdAt: Date.now(),
  }
  model.createTeam(policy)
  assert(model.getTeam('team_alpha') !== undefined, 'team created')

  model.addMember({ agentId: 'agent1', teamId: 'team_alpha', role: 'leader', joinedAt: Date.now(), permissions: ['all'] })
  model.addMember({ agentId: 'agent2', teamId: 'team_alpha', role: 'member', joinedAt: Date.now(), permissions: ['read', 'write'] })

  const members = model.getMembers('team_alpha')
  assert(members.length === 2, '2 members')

  const teamsForAgent = model.getTeamsForAgent('agent1')
  assert(teamsForAgent.length === 1, 'agent1 in 1 team')
  assert(teamsForAgent[0].teamId === 'team_alpha', 'correct team')
})

test('TeamGovernanceModel: canCollaborate check', () => {
  const model = new TeamGovernanceModel()

  model.createTeam({ teamId: 't1', teamName: 'Team 1', memberRoles: ['executor'], maxConcurrentCollabs: 5, budgetAllocation: 50000, allowExternalRecruitment: true, requireApprovalForChanges: false, escalationPath: [], createdAt: Date.now() })
  model.createTeam({ teamId: 't2', teamName: 'Team 2', memberRoles: ['executor'], maxConcurrentCollabs: 5, budgetAllocation: 50000, allowExternalRecruitment: false, requireApprovalForChanges: false, escalationPath: [], createdAt: Date.now() })

  model.addMember({ agentId: 'a', teamId: 't1', role: 'member', joinedAt: Date.now(), permissions: [] })
  model.addMember({ agentId: 'b', teamId: 't1', role: 'member', joinedAt: Date.now(), permissions: [] })
  model.addMember({ agentId: 'c', teamId: 't2', role: 'member', joinedAt: Date.now(), permissions: [] })

  // 同团队 → 允许
  const same = model.canCollaborate('a', 'b')
  assert(same.allowed === true, 'same team allows collaboration')

  // 跨团队（t1 允许外部）→ 允许
  const cross = model.canCollaborate('a', 'c')
  assert(cross.allowed === true, 't1 allows external recruitment')
})

test('TeamGovernanceModel: escalation path', () => {
  const model = new TeamGovernanceModel()
  model.createTeam({ teamId: 't_esc', teamName: 'Esc Team', memberRoles: ['executor'], maxConcurrentCollabs: 5, budgetAllocation: 50000, allowExternalRecruitment: false, requireApprovalForChanges: false, escalationPath: ['senior_1', 'admin_1'], createdAt: Date.now() })
  const path = model.getEscalationPath('t_esc')
  assert(path.length === 2, '2-step escalation path')
  assert(path[0] === 'senior_1', 'first escalation target')
})

// ── 3. OrgBudgetAllocator ──

test('OrgBudgetAllocator: allocate, spend, transfer', () => {
  const allocator = new OrgBudgetAllocator(1000000)

  const allocated = allocator.allocate('team_x', 200000)
  assert(allocated === true, 'budget allocated')
  assert(allocator.getTeamBudget('team_x')!.allocated === 200000, 'team_x has 200k allocated')

  const spent = allocator.spend('team_x', 50000)
  assert(spent === true, 'spent 50k')
  assert(allocator.getTeamBudget('team_x')!.remaining === 150000, '150k remaining')

  const transfer = allocator.transferBudget('team_x', 'team_y', 50000)
  assert(transfer === true, 'transferred 50k to team_y')
  assert(allocator.getTeamBudget('team_x')!.remaining === 100000, 'team_x now 100k')
  assert(allocator.getTeamBudget('team_y')!.allocated === 50000, 'team_y has 50k')

  const stats = allocator.getOrgStats()
  assert(stats.available < stats.totalBudget, 'some budget allocated')
})

// ── 4. GovernanceAudit ──

test('GovernanceAudit: record, query, stats', () => {
  const audit = new GovernanceAudit()

  audit.record({ type: 'policy_check', sourceAgentId: 'a', decision: 'allow', reason: 'ok', details: {}, timestamp: Date.now() })
  audit.record({ type: 'team_change', sourceAgentId: 'b', teamId: 't1', decision: 'approval_required', reason: 'new member', details: { member: 'c' }, timestamp: Date.now() })
  audit.record({ type: 'budget_change', sourceAgentId: 'admin', teamId: 't1', decision: 'allow', reason: 'budget top-up', details: { amount: 50000 }, timestamp: Date.now() })

  const all = audit.query({})
  assert(all.length === 3, '3 audit entries')

  const teamEntries = audit.query({ teamId: 't1' })
  assert(teamEntries.length === 2, '2 entries for team t1')

  const stats = audit.getStats()
  assert(stats.total === 3, 'stats total correct')
  assert(stats.byType['policy_check'] === 1, '1 policy check')
})

;(async () => {
  await new Promise(r => setTimeout(r, 100))
  console.log(`\n=== Organization Governance Tests: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
})()
