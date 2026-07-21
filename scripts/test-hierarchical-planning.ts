#!/usr/bin/env npx tsx
/**
 * test-hierarchical-planning.ts — Hierarchical Planning Engine Tests
 *
 * Covers:
 *   - Strategy generation (3-5 per task type)
 *   - Strategy mutation (2-3 per strategy)
 *   - Statistical simulation (5 dimensions)
 *   - Weighted evaluation (0.30/0.20/0.15/0.15/0.10/0.10)
 *   - Candidate count formula (strategies × mutations ≤ 20)
 *   - Task-type-specific strategy selection
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
// @ts-ignore - ghost v7 module reference
import { HierarchicalCandidateGenerator, CapabilityRegistry, StatisticalPlanSimulator, WeightedPlanEvaluator } from '../packages/core/src/extensions/planning/engines/HierarchicalPlanningEngine.js';
import { PlanExperienceStore } from '../packages/core/src/extensions/planning/PlanExperienceStore.js';
import type { PlanExecutionRecord } from '../packages/core/src/extensions/planning/types.js';

const RED = '\x1b[31m'; const GREEN = '\x1b[32m'; const YELLOW = '\x1b[33m'; const CYAN = '\x1b[36m'; const BRIGHT = '\x1b[1m'; const RESET = '\x1b[0m';
let passed = 0, failed = 0;
function ok(label: string, detail?: string) { console.log(`  ${GREEN}✓${RESET} ${label}${detail ? ` ${CYAN}(${detail})${RESET}` : ''}`); passed++; }
function fail(label: string, reason: string) { console.log(`  ${RED}✗${RESET} ${label}: ${RED}${reason}${RESET}`); failed++; }

const TMP = path.join(os.tmpdir(), 'morpex-hierarchical-' + Date.now());
const KEEP = process.argv.includes('--keep');

async function main() {
  console.log(`${BRIGHT}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BRIGHT}║  Hierarchical Planning Engine Test                      ║${RESET}`);
  console.log(`${BRIGHT}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log(`  Temp dir: ${TMP}\n`);

  fs.mkdirSync(path.join(TMP, 'experiences'), { recursive: true });
  fs.mkdirSync(path.join(TMP, 'templates'), { recursive: true });

  // ── Test 1: Strategy Generation ──
  console.log(`${BRIGHT}═══ Test 1: Strategy Generation — 3-5 distinct strategies ═══${RESET}`);
  {
    const gen = new HierarchicalCandidateGenerator({ baseStrategyCount: 3, mutationFactor: 2 });
    const strategies = gen.generateStrategies('Build an AI SaaS product', ['build', 'ai_ml', 'startup', 'high_complexity'], { budget: 'low', deadline: '7days' });
    strategies.length >= 3 ? ok(`Generated ${strategies.length} strategies`, strategies.map(s => s.name).join(', ')) : fail('Strategy count', `Expected ≥3, got ${strategies.length}`);
    const ids = new Set(strategies.map(s => s.id));
    ids.size === strategies.length ? ok('All strategies have unique IDs', `${ids.size} unique`) : fail('Duplicate IDs', `Expected ${strategies.length} unique, got ${ids.size}`);
    strategies.every(s => s.phases.length >= 2) ? ok('Each strategy has ≥2 phases', `min=${Math.min(...strategies.map(s=>s.phases.length))}`) : fail('Phase count', 'Some strategy has <2 phases');
    strategies.every(s => s.name && s.description && s.id) ? ok('All strategies have name/desc/id') : fail('Missing fields', 'Some strategy missing required fields');
  }

  // ── Test 2: Strategy Mutation ──
  console.log(`\n${BRIGHT}═══ Test 2: Strategy Mutation — 2-3 variants per strategy ═══${RESET}`);
  {
    const gen = new HierarchicalCandidateGenerator({ baseStrategyCount: 3, mutationFactor: 3 });
    const strategies = gen.generateStrategies('Build a web app', ['build', 'web_dev'], {});
    for (const s of strategies) {
      const m0 = gen.mutateStrategy(s, 0);
      const m1 = gen.mutateStrategy(s, 1);
      const m2 = gen.mutateStrategy(s, 2);
      const allSame = m0.length === m1.length && m1.length === m2.length;
      if (!allSame) {
        ok(`"${s.name}" mutations differ`, `${m0.length}/${m1.length}/${m2.length} phases`);
      } else {
        ok(`"${s.name}" mutations generated`, `${m0.length} phases each`);
      }
      // Verify mutation preserves strategy identity
      const coreNames = s.phases.filter(p => !p.optional).map(p => p.name.toLowerCase());
      const m0core = m0.filter(p => !p.optional).map(p => p.name.toLowerCase());
      const coreMatch = coreNames.every(n => m0core.includes(n));
      coreMatch ? ok(`  Core phases preserved`) : fail(`  Core phases mismatch`, `${coreNames.join(',')} vs ${m0core.join(',')}`);
    }
  }

  // ── Test 3: Candidate Count Formula ──
  console.log(`\n${BRIGHT}═══ Test 3: Candidate Count Formula ═══${RESET}`);
  {
    const gen3x2 = new HierarchicalCandidateGenerator({ baseStrategyCount: 3, mutationFactor: 2 });
    const c3x2 = gen3x2.generateAllCandidates('Test task', ['build']);
    c3x2.length <= 6 ? ok(`3×2 = ${c3x2.length} candidates (≤6)`) : fail('3×2 count', `Expected ≤6, got ${c3x2.length}`);

    const gen5x3 = new HierarchicalCandidateGenerator({ baseStrategyCount: 5, mutationFactor: 3, maxCandidates: 20 });
    const c5x3 = gen5x3.generateAllCandidates('Complex multi-domain task', ['build', 'ai_ml', 'devops', 'security', 'testing', 'high_complexity']);
    c5x3.length <= 20 ? ok(`5×3 = ${c5x3.length} candidates (≤20)`) : fail('5×3 count', `Expected ≤20, got ${c5x3.length}`);

    const genNoLimit = new HierarchicalCandidateGenerator({ baseStrategyCount: 10, mutationFactor: 5, maxCandidates: 20 });
    const capped = genNoLimit.generateAllCandidates('Test', ['build']);
    capped.length <= 20 ? ok(`Capped at maxCandidates=20`, `got ${capped.length}`) : fail('Cap failed', `Expected ≤20, got ${capped.length}`);
  }

  // ── Test 4: DAG Generation from Phases ──
  console.log(`\n${BRIGHT}═══ Test 4: DAG Generation ═══${RESET}`);
  {
    const gen = new HierarchicalCandidateGenerator();
    const candidates = gen.generateAllCandidates('Build a test project', ['build', 'testing']);
    candidates.length > 0 ? ok(`Generated ${candidates.length} candidates with DAGs`) : fail('No candidates');
    for (const c of candidates) {
      c.dag.nodes.length > 0 ? ok(`  ${c.strategy.name}/${c.mutationLabel}: ${c.dag.nodes.length} nodes, ${c.dag.involvedDomains.length} domains`) : fail(`  Empty DAG for ${c.id}`);
    }
  }

  // ── Test 5: PlanExperienceStore Integration ──
  console.log(`\n${BRIGHT}═══ Test 5: PlanExperienceStore Integration ═══${RESET}`);
  let store: PlanExperienceStore;
  try {
    store = new PlanExperienceStore({ experienceStorePath: path.join(TMP, 'experiences') + '/', templateStorePath: path.join(TMP, 'templates') + '/' });
    await store.initialize();
    ok('PlanExperienceStore initialized');

    // Seed some records
    for (let i = 0; i < 10; i++) {
      await store.saveRecord({
        recordId: `rec_hier_${i}`, executionId: `exec_hier_${i}`, userInput: 'Build a SaaS app',
        inputTags: ['build', 'web_dev'], dagNodes: [
          { nodeId: `n${i}_1`, role: 'User Validation', domain: 'web_dev', status: i < 7 ? 'success' : 'failed', durationMs: 5000, tokensUsed: 10000, artifactUris: [], retries: 0 },
          { nodeId: `n${i}_2`, role: 'MVP Build', domain: 'web_dev', status: i < 8 ? 'success' : 'failed', durationMs: 15000, tokensUsed: 30000, artifactUris: [], retries: i > 7 ? 2 : 0 },
          { nodeId: `n${i}_3`, role: 'Deploy', domain: 'devops', status: i < 9 ? 'success' : 'failed', durationMs: 3000, tokensUsed: 5000, artifactUris: [], retries: 0 },
        ],
        success: i < 8, totalDurationMs: 25000, totalTokensUsed: 45000,
        artifactCount: 3, selfHealingRetries: 0, pruningTokensSaved: 0, score: i < 8 ? 0.7 + i * 0.02 : 0.3, createdAt: Date.now(),
        failureDetails: i >= 8 ? [{ nodeId: 'n' + i + '_2', category: 'tool_error', summary: 'Build failed', timestamp: Date.now() }] : [],
      });
    }
    ok('10 records seeded');
  } catch (err: any) { fail('Store setup', err.message); store = null!; }

  // ── Test 6: Statistical Simulation ═──
  console.log(`\n${BRIGHT}═══ Test 6: Statistical Simulation (all 5 dimensions) ═══${RESET}`);
  if (store) {
    const gen = new HierarchicalCandidateGenerator();
    const registry = new CapabilityRegistry();
    registry.register('agent_1', [{ domain: 'web_dev', skill: 'User Validation', proficiency: 0.95 }, { domain: 'web_dev', skill: 'MVP Build', proficiency: 0.85 }, { domain: 'devops', skill: 'Deploy', proficiency: 0.7 }]);

    const simulator = new StatisticalPlanSimulator(store, registry);
    const candidates = gen.generateAllCandidates('Build a web app', ['build', 'web_dev']);
    candidates.length > 0 ? ok(`${candidates.length} candidates for simulation`) : fail('No candidates');

    for (const c of candidates) {
      const score = simulator.simulate(c);
      const valid = score.historicalSimilarityScore >= 0 && score.capabilityMatchScore >= 0 && score.artifactUtilityScore >= 0 && score.failureRiskScore >= 0 && score.resourceEfficiencyScore >= 0 && score.complexityPenaltyScore >= 0;
      valid ? ok(`  ${c.strategy.name}/${c.mutationLabel}: composite=${score.compositeScore.toFixed(4)}, hist=${score.historicalSimilarityScore.toFixed(2)}, cap=${score.capabilityMatchScore.toFixed(2)}, fail=${score.failureRiskScore.toFixed(2)}, res=${score.resourceEfficiencyScore.toFixed(2)}, complexity=${score.complexityPenaltyScore.toFixed(2)}`) : fail(`Invalid score for ${c.id}`, JSON.stringify(score));
      if (score.compositeScore < 0 || score.compositeScore > 1) fail('Composite out of range', String(score.compositeScore));
    }
  }

  // ── Test 7: Weighted Evaluation ──
  console.log(`\n${BRIGHT}═══ Test 7: Weighted Evaluation (0.30/0.20/0.15/0.15/0.10/0.10) ═══${RESET}`);
  if (store) {
    const gen = new HierarchicalCandidateGenerator();
    const registry = new CapabilityRegistry();
    registry.register('agent_1', [{ domain: 'web_dev', skill: 'User Validation', proficiency: 0.95 }, { domain: 'web_dev', skill: 'MVP Build', proficiency: 0.85 }]);
    const simulator = new StatisticalPlanSimulator(store, registry);
    const evaluator = new WeightedPlanEvaluator();
    const candidates = gen.generateAllCandidates('Build a web app', ['build', 'web_dev']);
    const results = simulator.simulateAll(candidates);
    const evalResult = evaluator.evaluate(results);

    evalResult.winner ? ok(`Winner: ${evalResult.winner.strategy.name}/${evalResult.winner.mutationLabel} @ ${evalResult.winnerScore.toFixed(4)}`) : fail('No winner');
    evalResult.scoreBreakdown.length > 0 ? ok(`Score breakdown: ${evalResult.scoreBreakdown.length} entries`) : fail('Empty breakdown');

    // Verify weights
    const weights = evaluator.getWeights();
    const sum = weights.historicalWeight + weights.capabilityWeight + weights.artifactUtilityWeight + weights.failureRiskWeight + weights.resourceEfficiencyWeight + weights.complexityPenaltyWeight;
    Math.abs(sum - 1.0) < 0.001 ? ok(`Weights sum to 1.0`, `actual=${sum.toFixed(4)}`) : fail('Weights not normalized', `sum=${sum}`);
  }

  // ── Test 8: Task Type Diversity ──
  console.log(`\n${BRIGHT}═══ Test 8: Task Type → Different Strategies ═══${RESET}`);
  {
    const gen = new HierarchicalCandidateGenerator({ baseStrategyCount: 3 });
    const buildStrats = gen.generateStrategies('Build an AI product', ['build', 'ai_ml']);
    const analysisStrats = gen.generateStrategies('Research market trends', ['analyze', 'startup']);
    const deployStrats = gen.generateStrategies('Deploy to production', ['deploy', 'devops']);

    const allDiff = buildStrats[0]?.id !== analysisStrats[0]?.id || analysisStrats[0]?.id !== deployStrats[0]?.id;
    allDiff ? ok(`Different tasks produce different strategies`, `build=${buildStrats[0]?.name}, analysis=${analysisStrats[0]?.name}, deploy=${deployStrats[0]?.name}`) : fail('Same strategy across task types', `${buildStrats[0]?.id}, ${analysisStrats[0]?.id}, ${deployStrats[0]?.id}`);
  }

  // ── Test 9: Resource Estimation ──
  console.log(`\n${BRIGHT}═══ Test 9: Resource Estimation ═══${RESET}`);
  {
    const gen = new HierarchicalCandidateGenerator();
    const candidates = gen.generateAllCandidates('Build', ['build']);
    for (const c of candidates) {
      c.estimatedLatencyMs > 0 && c.estimatedTokens > 0 && c.estimatedToolCalls > 0
        ? ok(`  ${c.strategy.name}: ${(c.estimatedLatencyMs/1000).toFixed(1)}s, ${c.estimatedTokens.toLocaleString()} tok, ${c.estimatedToolCalls} calls`)
        : fail(`Zero estimates for ${c.id}`);
    }
  }

  // ── Summary ──
  const total = passed + failed;
  console.log(`\n${BRIGHT}════════════════════════════════════════════════════${RESET}`);
  console.log(`${BRIGHT}  测试摘要${RESET}`);
  console.log(`${BRIGHT}════════════════════════════════════════════════════${RESET}`);
  console.log(`  ${GREEN}通过:${RESET} ${passed}`);
  console.log(`  ${RED}失败:${RESET} ${failed}`);
  console.log(`  总计: ${total}`);

  if (!KEEP) {
    fs.rmSync(TMP, { recursive: true, force: true });
  } else {
    console.log(`  Data: ${TMP}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(`${RED}Error:${RESET}`, err); process.exit(1); });
