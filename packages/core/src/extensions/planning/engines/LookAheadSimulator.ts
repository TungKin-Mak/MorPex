/**
 * LookAheadSimulator — 前瞻模拟与演练引擎（v2）
 *
 * 在 DAG 生成后、执行前介入。利用 VectorStore + 历史 ExecutionRecords 模拟推演，
 * 检测死锁、高风险节点，结果超标则打回重构。
 *
 * 设计原则：
 *   - 只读分析，不修改 DAG
 *   - VectorStore / PlanExperienceStore 不可用时优雅降级
 */

import type { IPlanningExtension } from './IPlanningExtension.js';
import type {
  PostPlanContext,
  PostPlanResult,
  SimulationReport,
  RiskNode,
  DeadlockWarning,
  SimulationRecommendation,
} from '../types.js';
import type { PlanExperienceStore } from '../PlanExperienceStore.js';
import type { ExecutionDAG } from '../../../planes/control-plane/orchestrator/ExecutionOrchestrator.js';
import type { DAGNodeData, ExecutionRecordData, FailurePatternData, VectorStoreService } from '../pipeline/service-types.js';

const DEFAULT_RISK_THRESHOLD = 0.7;

const FAILURE_CATEGORY_RISK: Record<string, number> = {
  llm_timeout: 0.8, llm_hallucination: 0.7, tool_error: 0.6,
  mcp_crash: 0.9, token_exhaustion: 0.5, validation_failure: 0.4,
  dependency_missing: 0.85, timeout: 0.75, unknown: 0.3,
};

export class LookAheadSimulator implements IPlanningExtension {
  public readonly name = 'LookAheadSimulator';
  public readonly version = '2.0.0';
  public readonly priority = 30;
  public enabled = true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private vectorStore: any = undefined;
  private store: PlanExperienceStore | null;
  private riskThreshold: number;

  constructor(config?: {
    vectorStore?: VectorStoreService;
    store?: PlanExperienceStore;
    riskThreshold?: number;
    enabled?: boolean;
  }) {
    this.vectorStore = config?.vectorStore ?? undefined;
    this.store = config?.store ?? null;
    this.riskThreshold = config?.riskThreshold ?? DEFAULT_RISK_THRESHOLD;
    if (config?.enabled !== undefined) this.enabled = config.enabled;
  }

  async onPrePlan(): Promise<any> { return {}; }

  async onPostPlan(context: PostPlanContext): Promise<PostPlanResult> {
    if (!this.enabled) return {};
    const startTime = Date.now();

    const dag: ExecutionDAG = context.dag;
    const nodes = dag.nodes ?? [];
    if (nodes.length === 0) {
      return { simulationReport: this.emptyReport(startTime) };
    }

    try {
      const similarRecords = await this.searchSimilarRecords(context.userInput, context.tags);
      const failurePatterns = this.store ? this.store.getFailurePatterns() : [];
      const depGraph = this.buildDependencyGraph(nodes);
      const cycleWarnings = this.detectCycles(depGraph, nodes);
      const riskNodes = this.evaluateNodeRisks(nodes, similarRecords, failurePatterns);
      const recommendations = this.generateRecommendations(riskNodes, cycleWarnings);
      const overallRiskScore = this.calculateOverallRisk(riskNodes, cycleWarnings);

      const durationMs = Date.now() - startTime;
      const rejected = overallRiskScore >= this.riskThreshold;

      const report: SimulationReport = {
        overallRiskScore,
        riskNodes,
        deadlockWarnings: cycleWarnings,
        recommendations,
        simulatedAt: Date.now(),
        durationMs,
        rejectionReason: rejected ? this.buildRejectionReason(overallRiskScore, riskNodes, cycleWarnings) : undefined,
      };

      const reasons = rejected && report.rejectionReason ? [report.rejectionReason] : [];

      return {
        rejected,
        rejectionReasons: reasons,
        simulationReport: report,
        enrichedPlan: rejected ? { additionalInstructions: reasons } : undefined,
      };
    } catch (err: unknown) {
      console.warn(`[LookAheadSimulator] 异常: ${(err as Error).message}`);
      return { simulationReport: this.emptyReport(startTime) };
    }
  }

  private async searchSimilarRecords(userInput: string, tags: string[]): Promise<ExecutionRecordData[]> {
    const records: ExecutionRecordData[] = [];
    if (this.vectorStore?.search) {
      try {
        const ids = await this.vectorStore.search(userInput, 10);
        if (Array.isArray(ids)) records.push(...ids.map((id: string) => ({ id, source: 'vector' })));
      } catch { /* ignore */ }
    }
    if (this.store?.queryByTags) {
      try {
        const tagged = this.store.queryByTags(tags, 5);
        records.push(...tagged.map((r: ExecutionRecordData) => ({ id: r.recordId ?? r.id, source: 'store', ...r })));
      } catch { /* ignore */ }
    }
    return records.slice(0, 15);
  }

  private buildDependencyGraph(nodes: DAGNodeData[]): Map<string, string[]> {
    const g = new Map<string, string[]>();
    for (const n of nodes) g.set(n.id ?? n.taskId, n.deps ?? []);
    return g;
  }

  private detectCycles(graph: Map<string, string[]>, nodes: DAGNodeData[]): DeadlockWarning[] {
    const warnings: DeadlockWarning[] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const stack: string[] = [];

    const dfs = (nodeId: string) => {
      if (inStack.has(nodeId)) {
        const start = stack.indexOf(nodeId);
        const cycle = stack.slice(start);
        if (cycle.length >= 2) {
          warnings.push({
            cycleNodes: [...cycle, nodeId],
            probability: 0.9,
            basis: `DFS 检测到循环: ${[...cycle, nodeId].join(' -> ')}`,
          });
        }
        return;
      }
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      inStack.add(nodeId);
      stack.push(nodeId);
      for (const dep of graph.get(nodeId) ?? []) {
        if (graph.has(dep)) dfs(dep);
      }
      stack.pop();
      inStack.delete(nodeId);
    };

    for (const id of graph.keys()) dfs(id);
    return warnings;
  }

  private evaluateNodeRisks(
    nodes: DAGNodeData[],
    similarRecords: ExecutionRecordData[],
    failurePatterns: Array<{ nodeRole: string; category: string; occurrenceCount: number }>,
  ): RiskNode[] {
    const risks: RiskNode[] = [];

    for (const node of nodes) {
      const nodeId = node.id ?? node.taskId;
      const role = node.agentType ?? node.role ?? 'unknown';
      const domain = node.domain ?? 'unknown';
      const deps: string[] = node.deps ?? [];

      const fr = this.failureRisk(role, domain, failurePatterns);
      const dr = this.depRisk(deps);
      const domainR = this.domainRisk(domain);
      const cr = this.criticalityRisk(deps, nodes);

      const score = fr.score * 0.35 + dr * 0.20 + domainR * 0.15 + cr * 0.30;

      if (score >= 0.3) {
        const reasons: string[] = [];
        if (fr.score > 0.5) reasons.push(`历史失败风险 ${(fr.score * 100).toFixed(0)}%`);
        if (dr > 0.4) reasons.push(`高依赖复杂度 (${deps.length} 个依赖)`);
        if (domainR > 0.5) reasons.push(`领域 "${domain}" 高风险`);
        if (cr > 0.4) reasons.push('关键路径节点');

        risks.push({
          nodeId,
          riskType: this.mapRiskType(fr.riskType),
          riskScore: Math.min(1, Math.round(score * 100) / 100),
          reason: reasons.join('; ') || `综合风险 ${(score * 100).toFixed(0)}%`,
          evidence: {
            historicalFailureRate: fr.score > 0.3 ? fr.score : undefined,
            similarRecordCount: similarRecords.length,
          },
        });
      }
    }

    return risks.sort((a, b) => b.riskScore - a.riskScore);
  }

  private failureRisk(role: string, domain: string, patterns: FailurePatternData[]): { score: number; riskType: string | null } {
    const relevant = patterns.filter((p: FailurePatternData) => p.nodeRole === role || p.nodeRole === domain);
    if (relevant.length === 0) return { score: 0, riskType: null };
    let max = 0;
    let rt: string | null = null;
    for (const p of relevant) {
      const cat = p.category ?? 'unknown';
      const s = (FAILURE_CATEGORY_RISK[cat] ?? 0.3) * 0.6 + Math.min(1, p.occurrenceCount / 10) * 0.4;
      if (s > max) { max = s; rt = cat; }
    }
    return { score: max, riskType: rt };
  }

  private depRisk(deps: string[]): number { return Math.min(1, deps.length * 0.15); }

  private domainRisk(domain: string): number {
    const m: Record<string, number> = { security: 0.8, hardware: 0.7, ai_ml: 0.6, devops: 0.5, data_engineering: 0.4, web_dev: 0.3, mobile: 0.4, testing: 0.3, startup: 0.6, general: 0.2 };
    return m[domain] ?? 0.2;
  }

  private criticalityRisk(deps: string[], nodes: DAGNodeData[]): number {
    let count = 0;
    const myId = deps[0] ?? '';
    for (const n of nodes) {
      const ndeps: string[] = n.deps ?? [];
      if (ndeps.includes(myId) || ndeps.includes(n.id)) count++;
    }
    return Math.min(1, count * 0.25);
  }

  private mapRiskType(category: string | null): RiskNode['riskType'] {
    switch (category) {
      case 'timeout': case 'llm_timeout': return 'long_running';
      case 'token_exhaustion': return 'excessive_tokens';
      case 'dependency_missing': return 'missing_dependency';
      case 'validation_failure': return 'deadlock_candidate';
      default: return 'high_failure_rate';
    }
  }

  private generateRecommendations(riskNodes: RiskNode[], cycleWarnings: DeadlockWarning[]): SimulationRecommendation[] {
    const recs: SimulationRecommendation[] = [];

    for (const w of cycleWarnings) {
      if (w.cycleNodes.length >= 2) {
        recs.push({ action: 'rework', targetNodeId: w.cycleNodes[0], reason: `循环依赖: ${w.cycleNodes.join(' -> ')}`, expectedImprovement: 0.9 });
      }
    }

    for (const rn of riskNodes) {
      switch (rn.riskType) {
        case 'deadlock_candidate':
          recs.push({ action: 'rework', targetNodeId: rn.nodeId, reason: `死锁风险 ${(rn.riskScore * 100).toFixed(0)}%`, expectedImprovement: 0.7 });
          break;
        case 'high_failure_rate':
          recs.push({ action: 'add_validation', targetNodeId: rn.nodeId, reason: `高失败率，建议验证节点`, expectedImprovement: 0.5 });
          break;
        case 'long_running':
          recs.push({ action: 'increase_timeout', targetNodeId: rn.nodeId, reason: `超时风险高`, expectedImprovement: 0.4 });
          break;
        case 'missing_dependency':
          recs.push({ action: 'mark_optional', targetNodeId: rn.nodeId, reason: `依赖可能缺失`, expectedImprovement: 0.3 });
          break;
        case 'excessive_tokens':
          recs.push({ action: 'split_node', targetNodeId: rn.nodeId, reason: `Token 消耗过高，建议拆分`, expectedImprovement: 0.4 });
          break;
      }
    }

    return recs;
  }

  private calculateOverallRisk(riskNodes: RiskNode[], cycleWarnings: DeadlockWarning[]): number {
    if (riskNodes.length === 0 && cycleWarnings.length === 0) return 0;
    const deadlockFactor = cycleWarnings.length > 0 ? Math.min(1, 0.5 + cycleWarnings.length * 0.2) : 0;
    const topScores = riskNodes.sort((a, b) => b.riskScore - a.riskScore).slice(0, 3).map(n => n.riskScore);
    const nodeAvg = topScores.length > 0 ? topScores.reduce((s, v) => s + v, 0) / topScores.length : 0;
    const riskRatio = riskNodes.length > 0 ? riskNodes.filter(n => n.riskScore > 0.5).length / riskNodes.length : 0;
    return Math.min(1, Math.round((deadlockFactor * 0.50 + nodeAvg * 0.30 + riskRatio * 0.20) * 100) / 100);
  }

  private buildRejectionReason(overallRiskScore: number, riskNodes: RiskNode[], cycleWarnings: DeadlockWarning[]): string {
    const parts: string[] = [];
    if (cycleWarnings.length > 0) parts.push(`${cycleWarnings.length} 个死锁`);
    const high = riskNodes.filter(n => n.riskScore > 0.7);
    if (high.length > 0) parts.push(`${high.length} 个高危节点`);
    parts.push(`风险评分 ${(overallRiskScore * 100).toFixed(0)}% >= ${(this.riskThreshold * 100).toFixed(0)}%`);
    return parts.join('; ');
  }

  private emptyReport(startTime: number): SimulationReport {
    return { overallRiskScore: 0, riskNodes: [], deadlockWarnings: [], recommendations: [], simulatedAt: Date.now(), durationMs: Date.now() - startTime };
  }
}
