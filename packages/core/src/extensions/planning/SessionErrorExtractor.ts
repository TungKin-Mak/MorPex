/**
 * SessionErrorExtractor — 实时会话级错误提取管道
 *
 * 从活跃会话中提取错误，补充上下文，构建因果链，
 * 生成可操作的报告，反馈到自改进循环。
 *
 * 对比 PlanExperienceStore.getFailurePatterns()：
 *   - getFailurePatterns() 只在持久化记录上工作（事后）
 *   - SessionErrorExtractor 在活跃会话上实时工作
 *
 * @see PlanningIntelligenceEngine — 消费 SessionErrorReport 进行学习
 * @see MetaPlanner.classifyError — 用于分类的底层方法
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { MemoryWiki } from '../../../../memory/src/index.js';
import type { FailureCategory } from './types.js';

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/** 原始错误 — 从 EventBus 或 MemoryBus 直接捕获 */
export interface RawError {
  nodeId: string;
  errorMessage: string;
  timestamp: number;
  errorType: string;
  retryCount: number;
  healingAttempted: boolean;
  healingSucceeded: boolean;
}

/** 富化错误 — 补充 DAG 上下文后的错误 */
export interface EnrichedError {
  raw: RawError;
  nodeDomain: string;
  nodeRole: string;
  upstreamDeps: string[];
  downstreamDeps: string[];
  artifactUris: string[];
  dagStateAtFailure: {
    totalNodes: number;
    completedNodes: number;
    pendingNodes: number;
    failedNodes: number;
  };
  fsmState: string;
  category: FailureCategory;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

/** 因果链 — 从根因到级联错误的链路 */
export interface ErrorCausalityChain {
  rootCause: EnrichedError;
  cascadeErrors: EnrichedError[];
  chainLength: number;
  totalAffectedNodes: number;
  impactScore: number;
}

/** 根因分析结果 */
export interface RootCause {
  primaryError: EnrichedError;
  category: FailureCategory;
  triggeringCondition: string;
  cascadeImpact: {
    affectedNodes: string[];
    wastedTokensEstimate: number;
    wastedTimeMs: number;
  };
  preventionSuggestion: string;
}

/** 会话级错误报告 */
export interface SessionErrorReport {
  sessionId: string;
  executionId: string;
  generatedAt: number;
  summary: {
    totalErrors: number;
    rootCauses: number;
    cascadeErrors: number;
    selfHealingAttempted: number;
    selfHealingSucceeded: number;
    circuitBroken: boolean;
    deviationCount: number;
  };
  errors: EnrichedError[];
  causalityChains: ErrorCausalityChain[];
  rootCauses: RootCause[];
  recommendations: string[];
  severityDistribution: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  categoryDistribution: Record<string, number>;
}

// ═══════════════════════════════════════════════════════════════
// 分类映射（与 MetaPlanner.classifyError 保持一致）
// ═══════════════════════════════════════════════════════════════

function classifyErrorText(errorMsg: string): FailureCategory {
  const lower = errorMsg.toLowerCase();
  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout';
  if (lower.includes('token') || lower.includes('context length') || lower.includes('max_tokens')) return 'token_exhaustion';
  if (lower.includes('hallucination') || lower.includes('invalid json') || lower.includes('parse')) return 'llm_hallucination';
  if (lower.includes('tool') || lower.includes('toolcall')) return 'tool_error';
  if (lower.includes('mcp') || lower.includes('spawn') || lower.includes('crash')) return 'mcp_crash';
  if (lower.includes('validation') || lower.includes('verify') || lower.includes('check')) return 'validation_failure';
  if (lower.includes('dependency') || lower.includes('deps') || lower.includes('missing')) return 'dependency_missing';
  if (lower.includes('llm') || lower.includes('model') || lower.includes('api')) return 'llm_timeout';
  return 'unknown';
}

function computeSeverity(category: FailureCategory, retryCount: number, cascadeCount: number): 'low' | 'medium' | 'high' | 'critical' {
  const base: Record<string, number> = {
    llm_timeout: 2, llm_hallucination: 2, tool_error: 2,
    mcp_crash: 3, token_exhaustion: 3, validation_failure: 1,
    dependency_missing: 2, timeout: 3, unknown: 1,
  };
  const baseScore = base[category] ?? 1;
  const retryBoost = retryCount * 0.5;
  const cascadeBoost = cascadeCount * 0.3;
  const total = baseScore + retryBoost + cascadeBoost;
  if (total >= 4) return 'critical';
  if (total >= 3) return 'high';
  if (total >= 1.5) return 'medium';
  return 'low';
}

// ═══════════════════════════════════════════════════════════════
// SessionErrorExtractor
// ═══════════════════════════════════════════════════════════════

export class SessionErrorExtractor {
  /** ★ MemoryWiki 实例（SQLite 优先读取） */
  private wiki: MemoryWiki | null = null;

  /** 会话原始错误缓冲区: sessionId → RawError[] */
  private sessionErrors = new Map<string, RawError[]>();

  /** 会话偏差计数: sessionId → number */
  private sessionDeviations = new Map<string, number>();

  /** 生成的报告缓存: sessionId → SessionErrorReport */
  private reports = new Map<string, SessionErrorReport>();

  /** 回退读取路径（JSONL 文件，仅用于初始化加载） */
  private errorPath = path.resolve('./data/planning/errors.jsonl');

  constructor(errorLogPath?: string) {
    if (errorLogPath) this.errorPath = path.resolve(errorLogPath);
    this.loadRecentErrors().catch(() => {});
  }

  /** ★ MemoryWiki 注入 */
  setWiki(wiki: MemoryWiki): void {
    this.wiki = wiki;
  }

  /**
   * loadRecentErrors — Replay last N errors from JSONL into sessionErrors map
   */
  private async loadRecentErrors(limit = 500): Promise<void> {
    // ★ SQLite 优先
    if (this.wiki?.ready) {
      try {
        const rows = this.wiki.getErrorLogs(null, limit) as Record<string, unknown>[];
        if (rows.length > 0) {
          for (const row of rows) {
            const sid = (row.session_id as string) ?? 'restored';
            if (!this.sessionErrors.has(sid)) {
              this.sessionErrors.set(sid, []);
            }
            this.sessionErrors.get(sid)!.push({
              nodeId: (row.node_id as string) ?? '',
              errorMessage: (row.error_message as string) ?? '',
              timestamp: (row.timestamp as number) ?? Date.now(),
              errorType: (row.error_type as string) ?? 'unknown',
              retryCount: (row.retry_count as number) ?? 0,
              healingAttempted: (row.healing_attempted as number) === 1,
              healingSucceeded: (row.healing_succeeded as number) === 1,
            });
          }
          console.log(`[SessionErrorExtractor] Restored ${rows.length} errors from SQLite`);
          return;
        }
      } catch { /* fallback to JSONL */ }
    }

    try {
      const content = await fsp.readFile(this.errorPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const batch = lines.slice(-limit);
      for (const line of batch) {
        try {
          const entry = JSON.parse(line);
          const sid = entry.sessionId ?? 'restored';
          if (!this.sessionErrors.has(sid)) {
            this.sessionErrors.set(sid, []);
          }
          this.sessionErrors.get(sid)!.push(entry.error);
        } catch { /* skip malformed */ }
      }
      if (batch.length > 0) {
        console.log(`[SessionErrorExtractor] Restored ${batch.length} errors from disk`);
      }
    } catch { /* no persisted errors */ }
  }

  // ── 错误注入 ──

  /**
   * recordError — 记录活跃会话的原始错误
   *
   * 由 bridgeMemoryBusEvent 或 onWorkflowFailed 调用。
   * 实时追加到 sessionErrors 缓冲区。
   */
  recordError(sessionId: string, executionId: string, error: Partial<RawError>): RawError {
    const raw: RawError = {
      nodeId: error.nodeId ?? 'unknown',
      errorMessage: error.errorMessage ?? '',
      timestamp: error.timestamp ?? Date.now(),
      errorType: error.errorType ?? 'NODE_FAILED',
      retryCount: error.retryCount ?? 0,
      healingAttempted: error.healingAttempted ?? false,
      healingSucceeded: error.healingSucceeded ?? false,
    };

    if (!this.sessionErrors.has(sessionId)) {
      this.sessionErrors.set(sessionId, []);
    }
    this.sessionErrors.get(sessionId)!.push(raw);
    return raw;
  }

  /**
   * recordDeviation — 记录一次偏差计数
   */
  recordDeviation(sessionId: string): number {
    const count = (this.sessionDeviations.get(sessionId) ?? 0) + 1;
    this.sessionDeviations.set(sessionId, count);
    return count;
  }

  // ── 错误提取 ──

  /**
   * extractSessionErrors — 从活跃会话提取所有错误
   *
   * 与 getFailurePatterns() 不同，本方法在活跃会话上实时工作。
   */
  extractSessionErrors(
    sessionId: string,
    allDagNodes?: Array<{ nodeId: string; domain?: string; role?: string; deps?: string[]; status?: string }>,
  ): SessionErrorReport {
    const rawErrors = this.sessionErrors.get(sessionId) ?? [];
    const deviationCount = this.sessionDeviations.get(sessionId) ?? 0;
    const executionId = rawErrors[0]?.nodeId ? `exec_${sessionId}` : `sess_${sessionId}`;

    if (rawErrors.length === 0) {
      const empty: SessionErrorReport = {
        sessionId, executionId, generatedAt: Date.now(),
        summary: {
          totalErrors: 0, rootCauses: 0, cascadeErrors: 0,
          selfHealingAttempted: 0, selfHealingSucceeded: 0,
          circuitBroken: deviationCount >= 3, deviationCount,
        },
        errors: [], causalityChains: [], rootCauses: [],
        recommendations: [],
        severityDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
        categoryDistribution: {},
      };
      this.reports.set(sessionId, empty);
      return empty;
    }

    // 1. 富化错误上下文
    const dagNodes: Array<{ nodeId: string; domain?: string; role?: string; deps?: string[]; status?: string }> = [];
    const enriched = this.enrichErrorContext(rawErrors, dagNodes);

    // 2. 关联因果链
    const chains = this.correlateErrors(enriched, dagNodes);

    // 3. 分类根因
    const rootCauses = chains.map(c => this.classifyRootCause(c));

    // 4. 生成推荐
    const recommendations = this.generateRecommendations(rootCauses, deviationCount);

    // 5. 统计分布
    const severityDist = { low: 0, medium: 0, high: 0, critical: 0 };
    const categoryDist: Record<string, number> = {};
    for (const e of enriched) {
      severityDist[e.severity]++;
      const cat = e.category as string;
      categoryDist[cat] = (categoryDist[cat] ?? 0) + 1;
    }

    const report: SessionErrorReport = {
      sessionId,
      executionId,
      generatedAt: Date.now(),
      summary: {
        totalErrors: enriched.length,
        rootCauses: rootCauses.length,
        cascadeErrors: chains.reduce((s, c) => s + c.cascadeErrors.length, 0),
        selfHealingAttempted: rawErrors.filter(e => e.healingAttempted).length,
        selfHealingSucceeded: rawErrors.filter(e => e.healingSucceeded).length,
        circuitBroken: deviationCount >= 3,
        deviationCount,
      },
      errors: enriched,
      causalityChains: chains,
      rootCauses,
      recommendations,
      severityDistribution: severityDist,
      categoryDistribution: categoryDist,
    };

    this.reports.set(sessionId, report);

    // ★ MemoryWiki 持久化 ErrorReport
    if (this.wiki?.ready) {
      this.wiki.remember({
        id: `erpt_${sessionId}_${Date.now()}`,
        type: 'ErrorReport',
        name: `session_${sessionId}`,
        data: {
          session_id: sessionId,
          total_errors: report.summary.totalErrors,
          categories_json: JSON.stringify(categoryDist),
          root_cause: rootCauses[0]?.category ?? null,
          suggestions_json: JSON.stringify(report.recommendations),
        },
      }).catch(() => {});
    }

    return report;
  }

  /**
   * enrichErrorContext — 为每个错误灌注上下文
   *
   * 补充：上游依赖、下游依赖、DAG 快照、FSM 状态
   */
  enrichErrorContext(
    errors: RawError[],
    allDagNodes: Array<{ nodeId: string; domain?: string; role?: string; deps?: string[]; status?: string }>,
  ): EnrichedError[] {
    const nodeMap = new Map<string, Record<string, unknown>>();
    if (allDagNodes) {
      for (const n of allDagNodes) nodeMap.set(n.nodeId, n as unknown as Record<string, unknown>);
    }

    // 获取所有节点状态
    const allNodes = allDagNodes;
    const totalNodes = allNodes.length;
    const completedNodes = allNodes.filter(n => n.status === 'success' || n.status === 'completed').length;
    const pendingNodes = allNodes.filter(n => n.status === 'pending' || n.status === 'ready').length;
    const failedNodes = allNodes.filter(n => n.status === 'failed' || n.status === 'error').length;

    return errors.map((raw, idx) => {
      const dagNode = nodeMap.get(raw.nodeId);
      const deps: string[] = (dagNode?.deps as string[]) ?? [];
      // downstream: nodes that depend on this node
      const downstream = allNodes.filter(n => (n.deps ?? []).includes(raw.nodeId)).map(n => n.nodeId);

      const category = classifyErrorText(raw.errorMessage);
      const cascadeCount = idx > 0 ? errors.slice(0, idx).filter(e => deps.includes(e.nodeId)).length : 0;
      const severity = computeSeverity(category, raw.retryCount, cascadeCount);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dNode = dagNode as any;
      return {
        raw,
        nodeDomain: dNode?.domain ?? 'unknown',
        nodeRole: dNode?.role ?? dNode?.nodeId ?? raw.nodeId,
        upstreamDeps: deps,
        downstreamDeps: downstream,
        artifactUris: [],
        dagStateAtFailure: { totalNodes, completedNodes, pendingNodes, failedNodes },
        fsmState: 'RUNNING',
        category,
        severity,
      };
    });
  }

  /**
   * correlateErrors — 构建因果链
   *
   * 遍历所有富化错误，找出根因和级联错误。
   * 如果错误 B 的上游依赖包含错误 A 的节点，则 B 由 A 级联导致。
   */
  correlateErrors(
    enrichedErrors: EnrichedError[],
    allDagNodes?: Array<{ nodeId: string; deps?: string[] }>,
  ): ErrorCausalityChain[] {
    if (enrichedErrors.length === 0) return [];

    const chains: ErrorCausalityChain[] = [];
    const used = new Set<string>();

    // 构建依赖图
    const depMap = new Map<string, string[]>();
    if (allDagNodes) {
      for (const n of allDagNodes) depMap.set(n.nodeId, n.deps ?? []);
    }

    for (const err of enrichedErrors) {
      if (used.has(err.raw.nodeId)) continue;

      // 检查这个错误是否由已有错误级联导致
      let isCascade = false;
      for (const chain of chains) {
        const rootId = chain.rootCause.raw.nodeId;
        const depsOfErr = depMap.get(err.raw.nodeId) ?? err.upstreamDeps;
        if (depsOfErr.includes(rootId) || this.isTransitiveDependency(rootId, err.raw.nodeId, depMap)) {
          chain.cascadeErrors.push(err);
          chain.chainLength = chain.cascadeErrors.length + 1;
          chain.totalAffectedNodes = chain.cascadeErrors.length + 1;
          used.add(err.raw.nodeId);
          isCascade = true;
          break;
        }
      }

      if (!isCascade) {
        // 新建因果链，以这个错误为根因
        const chain: ErrorCausalityChain = {
          rootCause: err,
          cascadeErrors: [],
          chainLength: 1,
          totalAffectedNodes: 1,
          impactScore: 0,
        };
        chains.push(chain);
        used.add(err.raw.nodeId);
      }
    }

    // 计算 impactScore
    const totalNodes = allDagNodes?.length ?? enrichedErrors.length;
    for (const chain of chains) {
      const affected = chain.cascadeErrors.length + 1;
      chain.impactScore = Math.min(1, affected / Math.max(totalNodes, 1));
    }

    return chains;
  }

  /**
   * classifyRootCause — 确定根因
   */
  classifyRootCause(chain: ErrorCausalityChain): RootCause {
    const root = chain.rootCause;
    const affected = [root.raw.nodeId, ...chain.cascadeErrors.map(e => e.raw.nodeId)];

    // 估算浪费的 token 和时间
    const wastedTokensEstimate = chain.totalAffectedNodes * 15000 + (root.raw.retryCount * 10000);
    const wastedTimeMs = chain.totalAffectedNodes * 5000 + (root.raw.retryCount * 10000);

    const preventionSuggestion = this.getPreventionSuggestion(root.category);

    return {
      primaryError: root,
      category: root.category,
      triggeringCondition: `${root.category}: ${root.raw.errorMessage.slice(0, 100)}`,
      cascadeImpact: {
        affectedNodes: affected,
        wastedTokensEstimate,
        wastedTimeMs,
      },
      preventionSuggestion,
    };
  }

  /**
   * generateSessionErrorReport — 生成或返回缓存的会话错误报告
   */
  generateSessionErrorReport(sessionId: string): SessionErrorReport | null {
    return this.reports.get(sessionId) ?? null;
  }

  /**
   * getAllSessionErrors — 返回所有会话的错误报告
   */
  getAllSessionErrors(): Map<string, SessionErrorReport> {
    return new Map(this.reports);
  }

  /**
   * clearSession — 清理会话错误数据
   */
  clearSession(sessionId: string): void {
    this.sessionErrors.delete(sessionId);
    this.sessionDeviations.delete(sessionId);
    this.reports.delete(sessionId);
  }

  // ── 内部方法 ──



  private isTransitiveDependency(
    targetId: string,
    nodeId: string,
    depMap: Map<string, string[]>,
    visited: Set<string> = new Set(),
  ): boolean {
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    const deps = depMap.get(nodeId) ?? [];
    if (deps.includes(targetId)) return true;
    for (const dep of deps) {
      if (this.isTransitiveDependency(targetId, dep, depMap, visited)) return true;
    }
    return false;
  }

  private getPreventionSuggestion(category: FailureCategory): string {
    switch (category) {
      case 'llm_timeout': return '增加 LLM 超时或使用更快模型；在 Stage 3 候选生成时考虑延迟预算';
      case 'llm_hallucination': return '降低 LLM 温度到 0.1-0.3；在关键节点后添加验证步骤';
      case 'tool_error': return '检查工具可用性；在节点执行前添加工具预检';
      case 'mcp_crash': return '启用 McpProcessGuard 自愈；配置进程自动重启';
      case 'token_exhaustion': return '在耗 Token 节点前启用 ContextPruner；考虑拆分长上下文任务';
      case 'validation_failure': return '在产出节点后添加自动验证步骤；使用 ArtifactRegistry 校验';
      case 'dependency_missing': return '在执行前检查所有上游产物是否就绪；添加到 ArtifactRegistry';
      case 'timeout': return '增加节点超时配置；或在 Stage 4 DES 模拟中调高 volatility 系数';
      default: return '检查节点日志和 MemoryBus 事件追踪以定位根本原因';
    }
  }

  private generateRecommendations(rootCauses: RootCause[], deviationCount: number): string[] {
    const recs: string[] = [];
    if (rootCauses.length === 0) return ['Session completed without errors'];

    // 按类别分组根因
    const byCategory = new Map<string, number>();
    for (const rc of rootCauses) {
      const cat = rc.category;
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
    }

    for (const [cat, count] of byCategory) {
      if (count >= 2) {
        recs.push(`[严重] "${cat}" 出现 ${count} 次，建议：${this.getPreventionSuggestion(cat as FailureCategory)}`);
      } else {
        recs.push(`[建议] "${cat}" 出现 1 次，${this.getPreventionSuggestion(cat as FailureCategory)}`);
      }
    }

    if (deviationCount >= 3) {
      recs.push('[警告] 偏差计数达到 3 次上限，已触发熔断。考虑降低并行度或增加验证阶段');
    }

    if (recs.length === 0) {
      recs.push('所有错误已分类，暂无自动推荐的预防措施');
    }

    return recs;
  }
}
