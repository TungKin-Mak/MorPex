/**
 * Cross-Agent Learning Tests (v9.2)
 *
 * Tests for CrossAgentLearningEngine, ExperienceRepository, KnowledgeDistiller,
 * ExperienceMatcher, LearningPropagationService.
 */
import { CrossAgentLearningEngine } from '../src/agent/learning/CrossAgentLearningEngine.js'
import { ExperienceRepository } from '../src/agent/learning/ExperienceRepository.js'
import { KnowledgeDistiller } from '../src/agent/learning/KnowledgeDistiller.js'
import { ExperienceMatcher } from '../src/agent/learning/ExperienceMatcher.js'
import { LearningPropagationService } from '../src/agent/learning/LearningPropagationService.js'
import type { GeneralizedExperience } from '../src/agent/learning/types.js'

let passed = 0; let failed = 0
function test(name: string, fn: () => void | Promise<void>) {
  ;(async () => {
    try { await fn(); passed++ } catch (e: any) { failed++; console.error('  FAIL ' + name + ': ' + e.message); }
  })()
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m) }
console.log('\n=== Cross-Agent Learning Tests ===\n')

// Helper
function makeExp(overrides?: Partial<GeneralizedExperience>): GeneralizedExperience {
  return {
    id: 'exp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    category: 'task_execution', problemPattern: 'test pattern', solution: 'test solution',
    effectiveness: { successRate: 0.8, avgLatency: 100, costSavings: 0 },
    sourceAgentType: 'tester', sourceMissionIds: [],
    feedback: { positive: 0, negative: 0, weight: 0.5 },
    createdAt: Date.now(), lastValidatedAt: Date.now(), tags: ['test'], visibleTo: ['*'],
    ...overrides,
  }
}

// 1. ExperienceRepository
test('ExperienceRepository: store, get, query', () => {
  const repo = new ExperienceRepository()
  const exp = makeExp({ id: 'e1', category: 'task_execution', sourceMissionIds: ['m1'] })
  repo.store(exp)
  assert(repo.get('e1') !== undefined, 'get works')
  assert(repo.query({ category: 'task_execution' }).length === 1, 'query by category')
  assert(repo.query({ category: 'collaboration' }).length === 0, 'empty query')
})

test('ExperienceRepository: feedback weight', () => {
  const repo = new ExperienceRepository()
  repo.store(makeExp({ id: 'fb1', feedback: { positive: 0, negative: 0, weight: 0 } }))
  repo.recordFeedback('fb1', true)
  assert(repo.get('fb1')!.feedback.positive === 1, 'positive')
  assert(repo.get('fb1')!.feedback.weight > 0, 'weight > 0')
})

test('ExperienceRepository: cleanup expired', () => {
  const repo = new ExperienceRepository()
  repo.store(makeExp({ id: 'old1', lastValidatedAt: Date.now() - 100000 }))
  const cleaned = repo.cleanupExpired(50000)
  assert(cleaned >= 1, 'cleaned at least 1, got ' + cleaned)
  assert(repo.get('old1') === undefined, 'entry removed after cleanup')
})

// 2. KnowledgeDistiller
test('KnowledgeDistiller: distill from decision event', () => {
  const d = new KnowledgeDistiller()
  const evt = { input: { task: 'deploy' }, reasoning: 'use blue-green for deployment to minimize risk', decision: 'blue-green', confidence: 0.9, source: 'dep', missionId: 'm1' }
  const r = d.distillFromDecision(evt)
  assert(r.length > 0, 'got results')
  assert(r[0].problemPattern.length > 0, 'pattern extracted')
})

test('KnowledgeDistiller: distill from mission failure', () => {
  const d = new KnowledgeDistiller()
  // Implementation checks missionResult.errors[] array, not single error field
  const r = d.distillFromMission({ missionId: 'm1', success: false, errors: ['timeout'], steps: [{ id: 's1' }], agentType: 'exec' }, 1)
  assert(r.length > 0, 'distilled failure')
  assert(r[0].category === 'error_handling', 'error category')
})

test('KnowledgeDistiller: merge duplicates', () => {
  const d = new KnowledgeDistiller()
  const a = makeExp({ id: 'a', problemPattern: 'db timeout', sourceMissionIds: ['m1'] })
  const b = makeExp({ id: 'b', problemPattern: 'db timeout', sourceMissionIds: ['m2'] })
  const merged = d.mergeDuplicate([a, b])
  assert(merged.length === 1, 'merged')
  assert(merged[0].sourceMissionIds.length === 2, 'combined missions')
})

// 3. ExperienceMatcher
test('ExperienceMatcher: match and visibility', () => {
  const repo = new ExperienceRepository()
  const matcher = new ExperienceMatcher()
  repo.store(makeExp({ id: 'm1', problemPattern: 'API rate limit', tags: ['api'], visibleTo: ['executor'] }))
  assert(matcher.match('API rate limit', repo, 'executor').length === 1, 'visible')
  assert(matcher.match('API rate limit', repo, 'coordinator').length === 0, 'invisible')
})

// 4. LearningPropagationService
test('LearningPropagationService: propagate, access, anonymize', () => {
  const p = new LearningPropagationService()
  const exp = makeExp({ sourceAgentType: 'planner', visibleTo: ['planner'] })
  assert(p.checkAccess(exp, 'planner') === true, 'planner access')
  p.propagate(exp, ['executor'])
  assert(p.checkAccess(exp, 'executor') === true, 'propagated')
  const anon = p.anonymize(exp)
  assert(anon.sourceAgentType === 'anonymous', 'anonymized')
})

// 5. CrossAgentLearningEngine
test('CrossAgentLearningEngine: learn and query', async () => {
  const engine = new CrossAgentLearningEngine(
    new ExperienceRepository(), new KnowledgeDistiller(),
    new LearningPropagationService(), new ExperienceMatcher(),
  )
  const outcome = { type: 'decision', input: { task: 'deploy' }, reasoning: 'use rolling for deployment to minimize risk', decision: 'rolling', confidence: 0.85, source: 'dep', missionId: 'm1' }
  const learned = engine.learnFromOutcome('m1', outcome, 'deployer')
  assert(learned.length > 0, 'learned')
  const relevant = engine.queryRelevant('rolling deployment', 'deployer')
  assert(relevant.length > 0, 'found relevant')
})

test('CrossAgentLearningEngine: feedback', async () => {
  const engine = new CrossAgentLearningEngine(
    new ExperienceRepository(), new KnowledgeDistiller(),
    new LearningPropagationService(), new ExperienceMatcher(),
  )
  const learned = engine.learnFromOutcome('m2', { type: 'decision', input: { task: 'x' }, reasoning: 'use approach A for solving the problem', decision: 'A', confidence: 0.5, source: 't', missionId: 'm2' }, 'tester')
  assert(learned.length > 0, 'learned')
  engine.feedback(learned[0].id, true)
  const relevant = engine.queryRelevant('approach solving', 'tester')
  assert(relevant.length > 0, 'still relevant')
})

;(async () => {
  await new Promise(r => setTimeout(r, 50))
  const totalPassed = passed; const totalFailed = failed
  console.log('\n=== Cross-Agent Learning Tests: ' + totalPassed + ' passed, ' + totalFailed + ' failed ===\n')
  // Count test as passed if all passed (no failures means the tests didn't self-execute properly yet)
  // The individual test function results will be reported above
})()
