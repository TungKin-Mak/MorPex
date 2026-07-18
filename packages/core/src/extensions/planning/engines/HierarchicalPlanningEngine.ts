/**
 * HierarchicalPlanningEngine — Two-Level Plan Generation + Statistical Simulation
 *
 * Replaces Stages 3-5 (3-strategy profiles + DES + MCDA) with:
 *
 *   Level 1: Strategy Candidates (3-5 high-level approaches)
 *   Level 2: Plan Template Mutations (2-3 per strategy)
 *   → 6-15 total candidates (never >20)
 *
 * Statistical simulation scores each on 5 dimensions using
 * historical data, NOT agent execution.
 */

import type { ExecutionDAG } from '../../../planes/control-plane/orchestrator/ExecutionOrchestrator.js';
import type { PlanExperienceStore } from '../PlanExperienceStore.js';

// ── Types ──

export interface StrategyPhase {
  name: string;
  description: string;
  domain: string;
  optional: boolean;
  estimatedEffort: 'low' | 'medium' | 'high';
}

export interface StrategyCandidate {
  id: string;
  name: string;
  description: string;
  phases: StrategyPhase[];
  tags: string[];
  riskProfile: string;
  speedProfile: string;
  confidenceSource: string;
}

export interface PlanCandidate {
  id: string;
  strategy: StrategyCandidate;
  mutationLabel: string;
  dag: ExecutionDAG;
  phases: StrategyPhase[];
  estimatedLatencyMs: number;
  estimatedTokens: number;
  estimatedToolCalls: number;
}

export interface SimulationScore {
  historicalSimilarityScore: number;
  capabilityMatchScore: number;
  artifactUtilityScore: number;
  failureRiskScore: number;
  resourceEfficiencyScore: number;
  complexityPenaltyScore: number;
  compositeScore: number;
  confidence: number;
}

export interface WeightedEvaluationResult {
  candidates: Array<{ plan: PlanCandidate; scores: SimulationScore }>;
  winner: PlanCandidate;
  winnerScore: number;
  scoreBreakdown: Array<{
    planId: string; strategyName: string; mutationLabel: string;
    historicalSimilarity: number; capabilityMatch: number; artifactUtility: number;
    failureRisk: number; resourceEfficiency: number; complexityPenalty: number;
    composite: number;
  }>;
}

export interface CandidateGenerationConfig {
  baseStrategyCount: number; mutationFactor: number; maxCandidates: number;
}

export interface SimulationConfig {
  historicalWeight: number; capabilityWeight: number; artifactUtilityWeight: number;
  failureRiskWeight: number; resourceEfficiencyWeight: number; complexityPenaltyWeight: number;
}

export const DEFAULT_CANDIDATE_CONFIG: CandidateGenerationConfig = {
  baseStrategyCount: 3, mutationFactor: 2, maxCandidates: 20,
};

export const DEFAULT_SIMULATION_WEIGHTS: SimulationConfig = {
  historicalWeight: 0.30, capabilityWeight: 0.20, artifactUtilityWeight: 0.15,
  failureRiskWeight: 0.15, resourceEfficiencyWeight: 0.10, complexityPenaltyWeight: 0.10,
};

// ── CapabilityRegistry ──

export interface CapabilityEntry { domain: string; skill: string; proficiency: number; }

export class CapabilityRegistry {
  private capabilities = new Map<string, CapabilityEntry[]>();
  register(agentId: string, caps: CapabilityEntry[]): void { this.capabilities.set(agentId, caps); }
  getProficiency(domain: string, skill: string): number {
    let best = 0;
    for (const [, caps] of this.capabilities) for (const c of caps) if (c.domain === domain && c.skill === skill) best = Math.max(best, c.proficiency);
    return best;
  }
  clear(): void { this.capabilities.clear(); }
}

// ── Strategy Registry Helpers ──

interface PhaseSpec { name: string; desc: string; domain: string; opt: boolean; effort: 'low' | 'medium' | 'high'; }

function makeStrategy(id: string, name: string, desc: string, tag: string, risk: string, speed: string, phases: PhaseSpec[]): StrategyCandidate {
  return {
    id, name, description: desc,
    phases: phases.map(p => ({ name: p.name, description: p.desc, domain: p.domain, optional: p.opt, estimatedEffort: p.effort })),
    tags: [tag], riskProfile: risk, speedProfile: speed, confidenceSource: 'heuristic',
  };
}

function buildStrategyRegistry(taskType: string, tags: string[], constraints?: Record<string,string>): StrategyCandidate[] {
  const isComplex = tags.includes('high_complexity');
  const isShortDeadline = constraints?.deadline?.includes('day');
  const all: StrategyCandidate[] = [];
  const d = tags[0] ?? 'general';
  switch (taskType) {
    case 'build': case 'generation':
      all.push(makeStrategy('validation_first','Validation First','Validate needs, build MVP, iterate, scale','user_centric','low','medium',[
        {name:'User Validation',desc:'Interview users, validate problem-solution fit',domain:d,opt:false,effort:'medium'},
        {name:'MVP Build',desc:'Build minimum viable product',domain:d,opt:false,effort:'high'},
        {name:'Feedback & Iterate',desc:'Gather feedback, iterate',domain:d,opt:false,effort:'medium'},
        {name:'Scale & Optimize',desc:'Optimize and add features',domain:'devops',opt:true,effort:'high'},
      ]));
      all.push(makeStrategy('engineering_first','Engineering First','Design, develop, test, deploy','quality_focused','medium','slow',[
        {name:'Architecture Design',desc:'Design system architecture',domain:'design',opt:false,effort:'high'},
        {name:'Core Development',desc:'Implement core modules',domain:d,opt:false,effort:'high'},
        {name:'Testing',desc:'Unit, integration, E2E tests',domain:'testing',opt:false,effort:'medium'},
        {name:'Deploy & Monitor',desc:'Deploy and set up monitoring',domain:'devops',opt:false,effort:'low'},
      ]));
      all.push(makeStrategy('market_first','Market First','Research market, position, build','market_driven','medium','medium',[
        {name:'Market Research',desc:'Analyze competitors, identify gaps',domain:'startup',opt:false,effort:'medium'},
        {name:'Product Positioning',desc:'Define value proposition',domain:'startup',opt:false,effort:'medium'},
        {name:'Product Build',desc:'Develop product for market',domain:d,opt:false,effort:'high'},
        {name:'Go-to-Market',desc:'Launch strategy and marketing',domain:'startup',opt:true,effort:'medium'},
      ]));
      if (isComplex) all.push(makeStrategy('risk_averse','Risk Averse','Analyze, prototype, validate, build incrementally','risk_mitigated','very_low','slow',[
        {name:'Risk Analysis',desc:'Identify technical and market risks',domain:'design',opt:false,effort:'medium'},
        {name:'Prototype',desc:'Build prototype for riskiest assumptions',domain:d,opt:false,effort:'medium'},
        {name:'Validation',desc:'Test prototype, validate mitigations',domain:'testing',opt:false,effort:'medium'},
        {name:'Incremental Build',desc:'Build production incrementally',domain:d,opt:false,effort:'high'},
        {name:'Deploy',desc:'Gradual rollout with rollback',domain:'devops',opt:false,effort:'low'},
      ]));
      if (isShortDeadline) all.push(makeStrategy('speed_first','Speed First','Build fast, test critical paths, fix, deploy','speed_focused','high','fast',[
        {name:'Quick Build',desc:'Build core functionality rapidly',domain:d,opt:false,effort:'high'},
        {name:'Critical Test',desc:'Test only critical paths',domain:'testing',opt:false,effort:'low'},
        {name:'Fix & Polish',desc:'Fix critical bugs',domain:d,opt:false,effort:'medium'},
        {name:'Fast Deploy',desc:'Deploy early, iterate in production',domain:'devops',opt:false,effort:'low'},
      ]));
      break;
    case 'analysis': case 'research':
      all.push(makeStrategy('deep_research','Deep Research','Thorough investigation','thorough','low','slow',[
        {name:'Literature Review',desc:'Review existing work',domain:d,opt:false,effort:'high'},
        {name:'Data Collection',desc:'Gather data from sources',domain:d,opt:false,effort:'high'},
        {name:'Analysis',desc:'Analyze data, find patterns',domain:'data_engineering',opt:false,effort:'high'},
        {name:'Synthesis',desc:'Synthesize into recommendations',domain:d,opt:false,effort:'medium'},
      ]));
      all.push(makeStrategy('quick_scan','Quick Scan','Rapid analysis, key metrics','fast','medium','fast',[
        {name:'Scope Definition',desc:'Define scope and questions',domain:d,opt:false,effort:'low'},
        {name:'Data Gathering',desc:'Collect key data points',domain:d,opt:false,effort:'medium'},
        {name:'Key Findings',desc:'Identify top findings',domain:'data_engineering',opt:false,effort:'medium'},
        {name:'Report',desc:'Produce concise report',domain:d,opt:false,effort:'low'},
      ]));
      break;
    default:
      all.push(makeStrategy('standard','Standard','Plan-execute-review-deliver','general','medium','medium',[
        {name:'Plan',desc:'Define scope and approach',domain:'general',opt:false,effort:'medium'},
        {name:'Execute',desc:'Execute the work',domain:d,opt:false,effort:'high'},
        {name:'Review',desc:'Review and verify',domain:'testing',opt:false,effort:'medium'},
        {name:'Deliver',desc:'Deliver results',domain:'general',opt:false,effort:'low'},
      ]));
      all.push(makeStrategy('agile','Agile Iteration','Iterative with feedback loops','iterative','low','medium',[
        {name:'Sprint Planning',desc:'Plan sprint scope',domain:d,opt:false,effort:'low'},
        {name:'Develop',desc:'Develop deliverables',domain:d,opt:false,effort:'high'},
        {name:'Review & Retro',desc:'Review and retrospect',domain:'testing',opt:false,effort:'medium'},
        {name:'Deliver',desc:'Deliver results',domain:d,opt:false,effort:'low'},
      ]));
      break;
  }
  return all;
}

// ── HierarchicalCandidateGenerator ──

export class HierarchicalCandidateGenerator {
  private config: CandidateGenerationConfig;
  constructor(config?: Partial<CandidateGenerationConfig>) {
    this.config = { ...DEFAULT_CANDIDATE_CONFIG, ...config };
  }

  generateStrategies(userInput: string, tags: string[], constraints?: Record<string,string>): StrategyCandidate[] {
    const taskType = this.inferTaskType(userInput, tags);
    const registry = buildStrategyRegistry(taskType, tags, constraints);
    const strategies = registry.slice(0, this.config.baseStrategyCount);
    while (strategies.length < 3) strategies.push(this.fallbackStrategy());
    return strategies;
  }

  mutateStrategy(strategy: StrategyCandidate, idx: number): StrategyPhase[] {
    const base = strategy.phases;
    if (idx === 0) return [...base];
    if (idx === 1) return this.insertValidations(base);
    return this.addPrep(base);
  }

  generateAllCandidates(userInput: string, tags: string[], constraints?: Record<string,string>): PlanCandidate[] {
    const strategies = this.generateStrategies(userInput, tags, constraints);
    const candidates: PlanCandidate[] = [];
    let cid = 0;
    for (const strat of strategies) {
      const mutCount = Math.min(this.config.mutationFactor, Math.floor((this.config.maxCandidates - candidates.length) / Math.max(1, strategies.length)));
      for (let m = 0; m < mutCount && candidates.length < this.config.maxCandidates; m++) {
        const phases = this.mutateStrategy(strat, m);
        const dag = this.phasesToDAG(phases, userInput, tags, cid);
        candidates.push({
          id: `candidate_${cid}_${Date.now()}`,
          strategy: strat,
          mutationLabel: m === 0 ? 'original' : m === 1 ? 'validated' : 'prepared',
          dag, phases,
          estimatedLatencyMs: this.estimate(phases, 'latency'),
          estimatedTokens: this.estimate(phases, 'tokens'),
          estimatedToolCalls: this.estimate(phases, 'calls'),
        });
        cid++;
      }
    }
    return candidates;
  }

  private insertValidations(phases: StrategyPhase[]): StrategyPhase[] {
    const r: StrategyPhase[] = [];
    for (const p of phases) {
      r.push(p);
      if (!p.optional && !/test|validate|verify|check/i.test(p.name)) {
        r.push({ name: p.name + ' Validation', description: 'Verify ' + p.name + ' output', domain: 'testing', optional: true, estimatedEffort: 'low' });
      }
    }
    return r;
  }

  private addPrep(phases: StrategyPhase[]): StrategyPhase[] {
    const c = [...phases];
    if (!/research|analysis|validate/i.test(c[0]?.name ?? '')) {
      c.unshift({ name:'Preparation', description:'Gather requirements, set up environment', domain:'general', optional:true, estimatedEffort:'low' });
    }
    return c;
  }

  private phasesToDAG(phases: StrategyPhase[], userInput: string, tags: string[], idx: number): ExecutionDAG {
    const nodes: ExecutionDAG['nodes'] = [];
    let prev: string | null = null;
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i];
      const nid = 'node_' + idx + '_' + i + '_' + p.name.toLowerCase().replace(/\s+/g, '_');
      nodes.push({
        taskId: nid, domain: p.domain, goal: p.description,
        deps: prev ? [prev] : [], status: 'pending' as const,
        name: p.name, priority: 10 - i,
        agentType: p.domain === 'testing' ? 'tester' : p.domain === 'devops' ? 'deployer' : 'coder',
        description: p.description, requires: [],
      });
      prev = nid;
    }
    const domains = [...new Set(phases.map(p => p.domain))];
    return {
      nodes, isMultiDomain: domains.length > 1, involvedDomains: domains,
      domainDependencies: [],
      globalIntent: userInput.slice(0, 200),
      reasoning: 'Strategy: ' + phases.map(p => p.name).join(' -> '),
    };
  }

  private estimate(phases: StrategyPhase[], kind: 'latency' | 'tokens' | 'calls'): number {
    const m: Record<string, Record<string, number>> = {
      latency: { low: 5000, medium: 15000, high: 30000 },
      tokens: { low: 5000, medium: 15000, high: 40000 },
      calls: { low: 3, medium: 8, high: 20 },
    };
    return phases.reduce((s, p) => s + (m[kind][p.estimatedEffort] ?? 10000), 0);
  }

  private inferTaskType(userInput: string, tags: string[]): string {
    const l = userInput.toLowerCase();
    if (tags.includes('fix') || /\bfix\b|\bdebug\b|\brepair\b/.test(l)) return 'fix';
    if (tags.includes('analyze') || /\banalyze\b|\bresearch\b/.test(l)) return 'analysis';
    if (tags.includes('build') || /\bbuild\b|\bcreate\b|\bdevelop\b|\bimplement\b|\bgenerate\b/.test(l)) return 'build';
    if (tags.includes('deploy') || /\bdeploy\b|\blaunch\b/.test(l)) return 'deploy';
    return 'general';
  }

  private fallbackStrategy(): StrategyCandidate {
    return {
      id:'standard', name:'Standard', description:'Plan-execute-review-deliver',
      phases: [
        { name:'Plan', description:'Define scope', domain:'general', optional:false, estimatedEffort:'medium' },
        { name:'Execute', description:'Execute the work', domain:'general', optional:false, estimatedEffort:'high' },
        { name:'Review', description:'Review and verify', domain:'testing', optional:false, estimatedEffort:'medium' },
        { name:'Deliver', description:'Deliver results', domain:'general', optional:false, estimatedEffort:'low' },
      ],
      tags:[], riskProfile:'medium', speedProfile:'medium', confidenceSource:'heuristic',
    };
  }
}

// ── StatisticalPlanSimulator ──

export class StatisticalPlanSimulator {
  private store: PlanExperienceStore;
  private capabilityRegistry: CapabilityRegistry;
  private weights: SimulationConfig;

  constructor(store: PlanExperienceStore, capabilityRegistry?: CapabilityRegistry, weights?: Partial<SimulationConfig>) {
    this.store = store;
    this.capabilityRegistry = capabilityRegistry ?? new CapabilityRegistry();
    this.weights = { ...DEFAULT_SIMULATION_WEIGHTS, ...weights };
  }

  simulate(candidate: PlanCandidate): SimulationScore {
    const s = {
      historicalSimilarityScore: this.historicalSimilarity(candidate),
      capabilityMatchScore: this.capabilityMatch(candidate),
      artifactUtilityScore: this.artifactUtility(candidate),
      failureRiskScore: this.failureRisk(candidate),
      resourceEfficiencyScore: this.resourceEfficiency(candidate),
      complexityPenaltyScore: this.complexityPenalty(candidate),
      compositeScore: 0,
      confidence: 0,
    };
    s.compositeScore =
      this.weights.historicalWeight * s.historicalSimilarityScore +
      this.weights.capabilityWeight * s.capabilityMatchScore +
      this.weights.artifactUtilityWeight * s.artifactUtilityScore +
      this.weights.failureRiskWeight * s.failureRiskScore +
      this.weights.resourceEfficiencyWeight * s.resourceEfficiencyScore +
      this.weights.complexityPenaltyWeight * s.complexityPenaltyScore;
    s.confidence = this.confidence(candidate);
    return s;
  }

  simulateAll(candidates: PlanCandidate[]): Array<{ plan: PlanCandidate; scores: SimulationScore }> {
    const r = candidates.map(p => ({ plan: p, scores: this.simulate(p) }));
    r.sort((a, b) => b.scores.compositeScore - a.scores.compositeScore);
    return r;
  }

  private historicalSimilarity(candidate: PlanCandidate): number {
    try {
      const stats = this.store.getStats();
      if (stats.totalRecords === 0) return 0.5;
      return Math.min(1, (stats.successRate * 0.7) + (Math.min(stats.totalRecords, 100) / 100 * 0.3));
    } catch { return 0.5; }
  }

  private capabilityMatch(candidate: PlanCandidate): number {
    const phases = candidate.phases;
    if (phases.length === 0) return 0.5;
    let t = 0;
    for (const p of phases) t += this.capabilityRegistry.getProficiency(p.domain, p.name) || 0.4;
    return Math.min(1, t / phases.length);
  }

  private artifactUtility(candidate: PlanCandidate): number {
    let s = 0.5;
    if (candidate.phases.some(p => /test|validate|review/i.test(p.name))) s += 0.15;
    if (candidate.phases.some(p => /deploy|deliver/i.test(p.name))) s += 0.15;
    if (candidate.phases.length >= 4) s += 0.1;
    return Math.min(1, s);
  }

  private failureRisk(candidate: PlanCandidate): number {
    try {
      const patterns = this.store.getFailurePatterns();
      if (patterns.length === 0) return 0.7;
      const names = candidate.phases.map(p => p.name.toLowerCase());
      let penalty = 0;
      for (const pat of patterns) {
        if (names.some(n => n.includes(pat.nodeRole.toLowerCase()) || pat.nodeRole.toLowerCase().includes(n))) {
          penalty += Math.min(0.5, pat.occurrenceCount * 0.05);
        }
      }
      if (names.some(n => /test|validate|verify/i.test(n))) penalty *= 0.5;
      return Math.max(0.1, 0.8 - penalty);
    } catch { return 0.7; }
  }

  private resourceEfficiency(candidate: PlanCandidate): number {
    const tRatio = Math.min(candidate.estimatedTokens / 150000, 2);
    const lRatio = Math.min(candidate.estimatedLatencyMs / 600000, 2);
    return Math.max(0, Math.min(1, 1 - (tRatio * 0.4 + lRatio * 0.6) / 2));
  }

  private complexityPenalty(candidate: PlanCandidate): number {
    const nodes = candidate.phases.length;
    const depth = this.calcDepth(candidate);
    const domains = candidate.dag.involvedDomains?.length ?? 1;
    const c = Math.min(1, nodes/10) * 0.3 + Math.min(1, depth/6) * 0.4 + Math.min(1, domains/4) * 0.3;
    return Math.max(0, Math.min(1, 1 - c));
  }

  private calcDepth(candidate: PlanCandidate): number {
    const nodes = candidate.dag.nodes;
    if (nodes.length === 0) return 0;
    const dist = new Map<string, number>();
    for (const n of nodes) dist.set(n.taskId, 0);
    for (const n of nodes) {
      for (const dep of n.deps ?? []) {
        const cur = dist.get(n.taskId) ?? 0;
        const pd = dist.get(dep) ?? 0;
        if (pd + 1 > cur) dist.set(n.taskId, pd + 1);
      }
    }
    return Math.max(...dist.values(), 0);
  }

  private confidence(candidate: PlanCandidate): number {
    try {
      const stats = this.store.getStats();
      const volume = Math.min(1, stats.totalRecords / 20);
      const sc: Record<string,number> = { heuristic:0.3, template:0.5, historical:0.7, llm:0.6 };
      return volume * 0.5 + (sc[candidate.strategy.confidenceSource] ?? 0.3) * 0.5;
    } catch { return 0.3; }
  }
}

// ── WeightedPlanEvaluator ──

export class WeightedPlanEvaluator {
  private weights: SimulationConfig;
  constructor(weights?: Partial<SimulationConfig>) { this.weights = { ...DEFAULT_SIMULATION_WEIGHTS, ...weights }; }

  getWeights(): SimulationConfig { return { ...this.weights }; }

  evaluate(results: Array<{ plan: PlanCandidate; scores: SimulationScore }>): WeightedEvaluationResult {
    const sorted = [...results].sort((a, b) => b.scores.compositeScore - a.scores.compositeScore);
    const winner = sorted[0];
    return {
      candidates: sorted,
      winner: winner.plan,
      winnerScore: winner.scores.compositeScore,
      scoreBreakdown: sorted.map(r => ({
        planId: r.plan.id, strategyName: r.plan.strategy.name, mutationLabel: r.plan.mutationLabel,
        historicalSimilarity: r.scores.historicalSimilarityScore,
        capabilityMatch: r.scores.capabilityMatchScore,
        artifactUtility: r.scores.artifactUtilityScore,
        failureRisk: r.scores.failureRiskScore,
        resourceEfficiency: r.scores.resourceEfficiencyScore,
        complexityPenalty: r.scores.complexityPenaltyScore,
        composite: r.scores.compositeScore,
      })),
    };
  }
}
