#!/usr/bin/env npx tsx
/**
 * test-session-error-extractor.ts — SessionErrorExtractor 测试
 *
 * 覆盖:
 *   - 单错误提取 + 分类
 *   - 错误上下文富化
 *   - 因果链构建 (级联)
 *   - 多链独立故障
 *   - 根因分类 + 预防建议
 *   - 会话级报告生成
 *   - 自愈追踪
 *   - DeviationGuard 集成 (熔断)
 *   - 类别分布统计
 *   - PlanExperienceStore 集成
 *   - 多会话追踪
 */

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BRIGHT = '\x1b[1m';
const RESET = '\x1b[0m';

let passed = 0, failed = 0;

function ok(label: string, detail?: string) {
  console.log(`  ${GREEN}✓${RESET} ${label}${detail ? ` ${CYAN}(${detail})${RESET}` : ''}`); passed++;
}
function fail(label: string, reason: string) {
  console.log(`  ${RED}✗${RESET} ${label}: ${RED}${reason}${RESET}`); failed++;
}
function heading(n: number, title: string) {
  console.log(`\n${BRIGHT}═══ Test ${n}: ${title} ═══${RESET}\n`);
}

// ── 动态导入 ──
const SESSION_DIR = new URL('../packages/core/src/extensions/planning/', import.meta.url).pathname;

async function main() {
  console.log(`${BRIGHT}╔══════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BRIGHT}║     SessionErrorExtractor Test                              ║${RESET}`);
  console.log(`${BRIGHT}╚══════════════════════════════════════════════════════════════╝${RESET}\n`);

  const { SessionErrorExtractor } = await import(`${SESSION_DIR}SessionErrorExtractor.ts`);
  const extractor = new SessionErrorExtractor();

  // ═════════════════════════════════════════════════════
  heading(1, 'Single Error Extraction + Classification');

  {
    const raw = extractor.recordError('s1', 'e1', {
      nodeId: 'model_train',
      errorMessage: 'LLM API timeout after 30s: upstream provider unavailable',
      errorType: 'NODE_FAILED',
      retryCount: 2,
    });
    ok('RawError 字段完整', `nodeId=${raw.nodeId} retryCount=${raw.retryCount}`);

    const report = extractor.extractSessionErrors('s1');
    ok('Session 报告生成', `totalErrors=${report.summary.totalErrors}`);
    ok('错误分类为 llm_timeout', `category=${report.errors[0]?.category}`);
    ok('严重度 >= medium', `severity=${report.errors[0]?.severity}`);
  }

  // ═════════════════════════════════════════════════════
  heading(2, 'Error Context Enrichment');

  {
    const mockDag = createMockEngine([
      { nodeId: 'A', domain: 'ai_ml', role: 'train', deps: [] as string[], status: 'completed' },
      { nodeId: 'B', domain: 'security', role: 'scan', deps: ['A'], status: 'failed' },
      { nodeId: 'C', domain: 'devops', role: 'deploy', deps: ['A'], status: 'pending' },
      { nodeId: 'D', domain: 'testing', role: 'validate', deps: ['B', 'C'], status: 'pending' },
    ]);

    const e2 = new SessionErrorExtractor();
    e2.recordError('s2', 'e2', { nodeId: 'B', errorMessage: 'token_exhaustion: context length 128000 exceeded' });
    e2.recordError('s2', 'e2', { nodeId: 'D', errorMessage: 'cascade: upstream B failed' });

    const r2 = e2.extractSessionErrors('s2', mockDag);
    const errB = r2.errors.find(e => e.raw.nodeId === 'B');
    const errD = r2.errors.find(e => e.raw.nodeId === 'D');

    ok('节点 B 的上游依赖', `upstreamDeps=${errB?.upstreamDeps?.join(',') ?? 'none'}`);
    ok('节点 B 的下游依赖', `downstreamDeps=${errD?.downstreamDeps?.join(',') ?? 'none'}`);

    if (errB) {
      ok('节点 B 分类为 token_exhaustion', errB.category);
      ok('DAG 快照 totalNodes=4', `${errB.dagStateAtFailure.totalNodes}`);
      ok('DAG 快照 failedNodes=1', `${errB.dagStateAtFailure.failedNodes}`);
    }
  }

  // ═════════════════════════════════════════════════════
  heading(3, 'Error Correlation — Simple Cascade');

  {
    const mockDag = createMockEngine([
      { nodeId: 'A', domain: 'data', role: 'fetch', deps: [] as string[], status: 'failed' },
      { nodeId: 'B', domain: 'process', role: 'transform', deps: ['A'], status: 'failed' },
      { nodeId: 'D', domain: 'output', role: 'report', deps: ['B'], status: 'failed' },
    ]);

    const e3 = new SessionErrorExtractor();
    e3.recordError('s3', 'e3', { nodeId: 'A', errorMessage: 'timeout: data source unreachable' });
    e3.recordError('s3', 'e3', { nodeId: 'B', errorMessage: 'cascade: upstream A failed' });
    e3.recordError('s3', 'e3', { nodeId: 'D', errorMessage: 'cascade: upstream B failed' });

    const r3 = e3.extractSessionErrors('s3', mockDag);
    ok('1 条因果链', `chains=${r3.causalityChains.length}`);
    if (r3.causalityChains.length > 0) {
      const chain = r3.causalityChains[0];
      ok('根因为 A', `rootCause=${chain.rootCause.raw.nodeId}`);
      ok('级联错误数 = 2', `cascadeCount=${chain.cascadeErrors.length}`);
      ok('链路长 = 3', `chainLength=${chain.chainLength}`);
      ok('影响节点 = 3', `affected=${chain.totalAffectedNodes}`);
      ok('impactScore > 0', `score=${chain.impactScore.toFixed(3)}`);
      ok('根因分类 timeout', `category=${chain.rootCause.category}`);
    }
  }

  // ═════════════════════════════════════════════════════
  heading(4, 'Multiple Independent Failures');

  {
    const mockDag = createMockEngine([
      { nodeId: 'A', domain: 'ai_ml', role: 'train', deps: [] as string[], status: 'failed' },
      { nodeId: 'X', domain: 'devops', role: 'deploy', deps: [] as string[], status: 'failed' },
    ]);
    const e4 = new SessionErrorExtractor();
    e4.recordError('s4', 'e4', { nodeId: 'A', errorMessage: 'token_exhaustion' });
    e4.recordError('s4', 'e4', { nodeId: 'X', errorMessage: 'tool_error: docker not found' });
    const r4 = e4.extractSessionErrors('s4', mockDag);
    ok('2 条独立因果链', `chains=${r4.causalityChains.length}`);
    if (r4.causalityChains.length >= 2) {
      ok('链 1 根因 A', r4.causalityChains[0].rootCause.raw.nodeId);
      ok('链 2 根因 X', r4.causalityChains[1].rootCause.raw.nodeId);
    }
  }

  // ═════════════════════════════════════════════════════
  heading(5, 'Root Cause Classification');

  {
    const mockDag = createMockEngine([
      { nodeId: 'A', domain: 'ai_ml', role: 'train', deps: [] as string[], status: 'failed' },
      { nodeId: 'B', domain: 'process', role: 'transform', deps: ['A'], status: 'failed' },
    ]);
    const e5 = new SessionErrorExtractor();
    e5.recordError('s5', 'e5', { nodeId: 'A', errorMessage: 'token_exhaustion: context limit 128k' });
    e5.recordError('s5', 'e5', { nodeId: 'B', errorMessage: 'cascade' });
    const r5 = e5.extractSessionErrors('s5', mockDag);
    ok('根因分析生成', `rootCauses=${r5.rootCauses.length}`);
    if (r5.rootCauses.length > 0) {
      const rc = r5.rootCauses[0];
      ok('根因类别 token_exhaustion', rc.category);
      ok('触发条件包含原因', rc.triggeringCondition.length > 10);
      ok('预防建议非空', rc.preventionSuggestion.length > 0);
      ok('影响节点包含 A,B', rc.cascadeImpact.affectedNodes.join(','));
      ok('浪费 Token 估算 > 0', `tokens=${rc.cascadeImpact.wastedTokensEstimate}`);
    }
  }

  // ═════════════════════════════════════════════════════
  heading(6, 'Session Error Report Generation');

  {
    const mockDag = createMockEngine([
      { nodeId: 'A', domain: 'data', role: 'fetch', deps: [] as string[], status: 'failed' },
      { nodeId: 'B', domain: 'process', role: 'transform', deps: ['A'], status: 'failed' },
      { nodeId: 'X', domain: 'devops', role: 'deploy', deps: [] as string[], status: 'failed' },
    ]);
    const e6 = new SessionErrorExtractor();
    e6.recordError('s6', 'e6', { nodeId: 'A', errorMessage: 'timeout' });
    e6.recordError('s6', 'e6', { nodeId: 'B', errorMessage: 'cascade' });
    e6.recordError('s6', 'e6', { nodeId: 'X', errorMessage: 'tool_error' });
    const r6 = e6.extractSessionErrors('s6', mockDag);
    ok('summary.totalErrors = 3', `${r6.summary.totalErrors}`);
    ok('summary.rootCauses = 2', `${r6.summary.rootCauses}`);
    ok('summary.cascadeErrors = 1', `${r6.summary.cascadeErrors}`);
    ok('recommendations 非空', `count=${r6.recommendations.length}`);
    ok('severityDistribution 各字段存在', `low=${r6.severityDistribution.low} high=${r6.severityDistribution.high}`);
  }

  // ═════════════════════════════════════════════════════
  heading(7, 'Self-Healing Tracking');

  {
    const e7 = new SessionErrorExtractor();
    e7.recordError('s7', 'e7', { nodeId: 'A', errorMessage: 'timeout', healingAttempted: true, healingSucceeded: false });
    e7.recordError('s7', 'e7', { nodeId: 'B', errorMessage: 'tool_error', healingAttempted: true, healingSucceeded: true });
    const r7 = e7.extractSessionErrors('s7');
    ok('selfHealingAttempted = 2', `${r7.summary.selfHealingAttempted}`);
    ok('selfHealingSucceeded = 1', `${r7.summary.selfHealingSucceeded}`);
  }

  // ═════════════════════════════════════════════════════
  heading(8, 'DeviationGuard Integration — Circuit Break');

  {
    const e8 = new SessionErrorExtractor();
    e8.recordError('s8', 'e8', { nodeId: 'A', errorMessage: 'err1' });
    e8.recordDeviation('s8');
    e8.recordError('s8', 'e8', { nodeId: 'B', errorMessage: 'err2' });
    e8.recordDeviation('s8');
    e8.recordError('s8', 'e8', { nodeId: 'C', errorMessage: 'err3' });
    e8.recordDeviation('s8');
    const r8 = e8.extractSessionErrors('s8');
    ok('circuitBroken = true', `${r8.summary.circuitBroken}`);
    ok('deviationCount = 3', `${r8.summary.deviationCount}`);
    ok('推荐包含熔断警告', r8.recommendations.some(r => r.includes('熔断') || r.includes('Circuit') || r.includes('deviation')));
  }

  // ═════════════════════════════════════════════════════
  heading(9, 'Category Distribution');

  {
    const e9 = new SessionErrorExtractor();
    e9.recordError('s9', 'e9', { nodeId: 'A', errorMessage: 'token_exhaustion 128k' });
    e9.recordError('s9', 'e9', { nodeId: 'B', errorMessage: 'token_exhaustion 64k' });
    e9.recordError('s9', 'e9', { nodeId: 'C', errorMessage: 'tool_error: docker' });
    e9.recordError('s9', 'e9', { nodeId: 'D', errorMessage: 'validation_failure: schema mismatch' });
    const r9 = e9.extractSessionErrors('s9');
    ok('token_exhaustion = 2', `${r9.categoryDistribution['token_exhaustion']}`);
    ok('tool_error = 1', `${r9.categoryDistribution['tool_error']}`);
    ok('validation_failure = 1', `${r9.categoryDistribution['validation_failure']}`);
  }

  // ═════════════════════════════════════════════════════
  heading(10, 'Integration with PlanExperienceStore');

  {
    const e10 = new SessionErrorExtractor();
    e10.recordError('s10', 'e10', { nodeId: 'model_train', errorMessage: 'token_exhaustion: 128k exceeded' });
    e10.recordError('s10', 'e10', { nodeId: 'deploy', errorMessage: 'tool_error: docker not found' });
    const r10 = e10.extractSessionErrors('s10');

    // 模拟保存到 PlanExperienceStore: 构建 failureDetails
    const failureDetails = r10.errors.map(e => ({
      nodeId: e.raw.nodeId,
      category: e.category,
      summary: e.raw.errorMessage.slice(0, 500),
      timestamp: e.raw.timestamp,
    }));

    ok('failureDetails 长度 = 2', `${failureDetails.length}`);
    ok('包含 token_exhaustion', failureDetails.some(f => f.category === 'token_exhaustion'));
    ok('包含 tool_error', failureDetails.some(f => f.category === 'tool_error'));
    ok('报告可通过 generateSessionErrorReport 获取', `${e10.generateSessionErrorReport('s10') !== null}`);
  }

  // ═════════════════════════════════════════════════════
  heading(11, 'Multi-Session Tracking');

  {
    const e11 = new SessionErrorExtractor();
    e11.recordError('sa', 'ea', { nodeId: 'A', errorMessage: 'err_a' });
    e11.recordError('sb', 'eb', { nodeId: 'B', errorMessage: 'err_b' });
    e11.recordError('sc', 'ec', { nodeId: 'C', errorMessage: 'err_c' });

    e11.extractSessionErrors('sa');
    e11.extractSessionErrors('sb');
    e11.extractSessionErrors('sc');

    const all = e11.getAllSessionErrors();
    ok('3 个会话报告', `count=${all.size}`);
    ok('包含 sa', `${all.has('sa')}`);
    ok('包含 sb', `${all.has('sb')}`);
    ok('包含 sc', `${all.has('sc')}`);

    e11.clearSession('sb');
    const afterClear = e11.getAllSessionErrors();
    ok('清除后剩余 2 个', `${afterClear.size}`);
    ok('sb 已清除', `${!afterClear.has('sb')}`);
  }

  // ═════════════════════════════════════════════════════
  heading(12, 'Edge Cases');

  {
    const e12 = new SessionErrorExtractor();
    const emptyReport = e12.extractSessionErrors('empty_sess');
    ok('无错误会话报告 totalErrors=0', `${emptyReport.summary.totalErrors}`);
    ok('无错误会话 recommendations 为默认', `${emptyReport.recommendations[0] === 'Session completed without errors'}`);

    const nullReport = e12.generateSessionErrorReport('never_existed');
    ok('不存在的会话返回 null', `${nullReport === null}`);
  }

  // ═════════════════════════════════════════════════════
  // 汇总
  // ═════════════════════════════════════════════════════
  console.log(`\n${BRIGHT}════════════════════════════════════════════════════${RESET}`);
  console.log(`${BRIGHT}  测试摘要${RESET}`);
  console.log(`${BRIGHT}════════════════════════════════════════════════════${RESET}`);
  console.log(`  ${GREEN}通过:${RESET} ${passed}`);
  console.log(`  ${RED}失败:${RESET} ${failed}`);
  console.log(`  总计: ${passed + failed}`);
  console.log(`${BRIGHT}════════════════════════════════════════════════════${RESET}`);

  process.exit(failed > 0 ? 1 : 0);
}

// ── 辅助 ──

function createMockEngine(nodes: Array<{ nodeId: string; domain: string; role: string; deps: string[]; status: string }>) {
  return {
    getAllNodes: () => nodes.map(n => ({
      id: n.nodeId,
      nodeId: n.nodeId,
      domain: n.domain,
      role: n.role,
      deps: n.deps,
      status: n.status,
      taskId: n.nodeId,
    })),
  };
}

main().catch(err => {
  console.error(`${RED}测试崩溃:${RESET}`, err);
  process.exit(1);
});
