/**
 * Agent Team Formation Tests (v9.2)
 *
 * Tests for TeamCompositionOptimizer, RoleAssignmentStrategy,
 * TeamLifecycleManager, TeamFormationEngine.
 */
import { TeamFormationEngine } from '../src/agent/team/TeamFormationEngine.js'
import { TeamCompositionOptimizer } from '../src/agent/team/TeamCompositionOptimizer.js'
import { RoleAssignmentStrategy } from '../src/agent/team/RoleAssignmentStrategy.js'
import { TeamLifecycleManager } from '../src/agent/team/TeamLifecycleManager.js'

let passed = 0; let failed = 0
function test(name: string, fn: () => void | Promise<void>) {
  ;(async () => {
    try { await fn(); passed++ } catch (e: any) { failed++; console.error('  FAIL ' + name + ': ' + e.message) }
  })()
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m) }
console.log('\n=== Agent Team Formation Tests ===\n')

// 1. TeamCompositionOptimizer
test('TeamCompositionOptimizer: optimize team', () => {
  const opt = new TeamCompositionOptimizer()
  const spec = { missionId: 'm1', requiredCapabilities: ['coding'], teamSize: 3,
    preferredRoles: [
      { role: 'coordinator' as const, minCount: 1, maxCount: 1 },
      { role: 'executor' as const, minCount: 1, maxCount: 2 },
      { role: 'reviewer' as const, minCount: 1, maxCount: 1 },
    ] }
  const candidates = [
    { identity: { id: 'c1', role: 'coordinator', capabilities: ['coding', 'planning'] }, successRate: 0.95 },
    { identity: { id: 'e1', role: 'executor', capabilities: ['coding'] }, successRate: 0.85 },
    { identity: { id: 'r1', role: 'reviewer', capabilities: ['output_validation'] }, successRate: 0.9 },
  ]
  const r = opt.optimizeComposition(spec, candidates)
  assert(r.members.length === 3, '3 members')
  assert(r.score > 0, 'score > 0')
  assert(opt.suggestTeamSize(3, 4) >= 3, 'size suggestion')
})

// 2. RoleAssignmentStrategy
test('RoleAssignmentStrategy: assign roles', () => {
  const s = new RoleAssignmentStrategy()
  const spec = { missionId: 'm1', requiredCapabilities: ['coding'], teamSize: 2,
    preferredRoles: [{ role: 'coordinator' as const, minCount: 0, maxCount: 1 }, { role: 'executor' as const, minCount: 1, maxCount: 2 }] }
  const assigned = new Map<string, number>()
  const agent = { identity: { id: 'c1', role: 'coordinator', capabilities: ['planning', 'coding'] }, successRate: 0.95, rankingScore: 0.9 }
  const role = s.assignRole(agent, spec, assigned)
  assert(role === 'coordinator' || role === 'executor', 'role assigned: ' + role)
  const caps = s.getRequiredCapabilitiesForRole('executor', 'coding')
  assert(caps.includes('coding') || caps.includes('task_execution'), 'has caps')
})

// 3. TeamLifecycleManager
test('TeamLifecycleManager: activate, health, disband', () => {
  const mgr = new TeamLifecycleManager()
  mgr.registerTeam({ teamId: 't1', missionId: 'm1', members: [{ agentId: 'a1', role: 'leader', joinedAt: Date.now(), status: 'active' }], status: 'forming', createdAt: Date.now() })
  const a = mgr.activateTeam('t1')
  assert(a !== undefined && a.status === 'active', 'activated')
  const h = mgr.getTeamHealth('t1')
  assert(h.alive === true, 'alive=' + h.alive)
  assert(h.activeMembers === 1, '1 active')
  mgr.disbandTeam('t1', 'done')
  assert(mgr.getTeamHealth('t1').alive === false, 'disbanded')
})

// 4. TeamFormationEngine
test('TeamFormationEngine: form team', async () => {
  const mockReg = {
    findAgent: (id: string) => ({ identity: { id, role: 'executor', capabilities: ['coding'] }, successRate: 0.8 }),
    findByCapabilities: (caps: string[]) => [
      { identity: { id: 'c1', role: 'coordinator', capabilities: ['coding', 'planning'] }, successRate: 0.95 },
      { identity: { id: 'e1', role: 'executor', capabilities: ['coding'] }, successRate: 0.85 },
    ],
    listAgents: () => [{ identity: { id: 'x1', role: 'executor', capabilities: ['coding'] }, successRate: 0.7 }],
  }
  const engine = new TeamFormationEngine(mockReg, new TeamCompositionOptimizer())
  const f = await engine.formTeam({ missionId: 'm1', requiredCapabilities: ['coding'], teamSize: 2,
    preferredRoles: [{ role: 'coordinator' as const, minCount: 1, maxCount: 1 }, { role: 'executor' as const, minCount: 1, maxCount: 2 }] })
  assert(f.members.length >= 1, 'has members: ' + f.members.length)
  assert(f.status === 'forming', 'status forming')
})

;(async () => {
  await new Promise(r => setTimeout(r, 50))
  console.log('\n=== Agent Team Formation Tests: ' + passed + ' passed, ' + failed + ' failed ===\n')
  if (failed > 0) process.exit(1)
})()
