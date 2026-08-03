/**
 * scripts/analyze-trace-reports.ts — 分析 50 份数据流报告，统计函数调用频次
 *
 * 输出：
 *   1. 高频函数 Top（核心路径）
 *   2. 低频函数（仅少量任务调用）
 *   3. 从未被调用的函数（服务类方法 - 报告出现方法 = 散落/无用候选）
 *
 * 运行：npx tsx scripts/analyze-trace-reports.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPORT_DIR = 'data/trace-reports';

// 服务 → 类文件（与 batch-run 追踪覆盖一致）
const SERVICES: Record<string, string> = {
  CompanyFacade: 'packages/core/src/facade/CompanyFacade.ts',
  ControlPlane: 'packages/core/src/governance/control-plane/ControlPlane.ts',
  MorPexRuntime: 'packages/core/src/execution/runtime/MorPexRuntime.ts',
  MissionController: 'packages/core/src/execution/runtime/mission/MissionController.ts',
  UnifiedExecutionEngine: 'packages/core/src/execution/UnifiedExecutionEngine.ts',
  ApprovalGate: 'packages/core/src/governance/ApprovalGate.ts',
  ArtifactFacade: 'packages/core/src/knowledge/artifact/ArtifactFacade.ts',
  ExperienceMiner: 'packages/core/src/evolution/ExperienceMiner.ts',
  VerificationEngine: 'packages/core/src/execution/runtime/verification/VerificationEngine.ts',
  ComplianceChecker: 'packages/core/src/governance/ComplianceChecker.ts',
  ExecutionSimulator: 'packages/core/src/execution/runtime/simulation/ExecutionSimulator.ts',
  TeamOrchestrator: 'packages/core/src/execution/DynamicTeamOrchestrator.ts',
  LearningEngine: 'packages/core/src/cognition/learning/agent/CrossAgentLearningEngine.ts',
  OntologyService: 'packages/core/src/knowledge/ontology/OntologyService.ts',
  ContextAssemblyEngine: 'packages/core/src/knowledge/context/ContextAssemblyEngine.ts',
};

interface FnStat {
  reports: Set<string>;
  calls: number;
  fail: number;
}

const NOISE = new Set([
  'constructor', 'for', 'if', 'while', 'switch', 'return', 'catch', 'try', 'function',
  'async', 'await', 'new', 'const', 'let', 'var', 'this', 'case', 'else', 'break',
  'continue', 'of', 'in', 'typeof', 'delete', 'throw', 'import', 'export', 'get', 'set',
]);

function main(): void {
  const files = readdirSync(REPORT_DIR).filter((f) => f.endsWith('.md')).sort();
  console.log(`分析 ${files.length} 份报告：${REPORT_DIR}/\n`);

  // ── 1. 解析所有报告的函数明细表 ──
  const stats = new Map<string, FnStat>();
  for (const file of files) {
    const text = readFileSync(join(REPORT_DIR, file), 'utf-8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\| (\d+) \| ([A-Za-z]+(?:\.[A-Za-z]+)+) \| (\d+) \| ([✅❌]) \|/);
      if (!m) continue;
      const fn = m[2];
      const calls = Number(m[3]);
      const ok = m[4];
      const s = stats.get(fn) ?? { reports: new Set(), calls: 0, fail: 0 };
      s.reports.add(file);
      s.calls += calls;
      if (ok === '❌') s.fail++;
      stats.set(fn, s);
    }
  }

  // ── 2. 高频 Top ──
  const sorted = [...stats.entries()].sort(
    (a, b) => b[1].reports.size - a[1].reports.size || b[1].calls - a[1].calls,
  );
  console.log('════════ 高频函数 Top 30（核心路径）════════');
  console.log('函数 | 出现报告数 | 总调用次数 | 失败次数');
  for (const [fn, s] of sorted.slice(0, 30)) {
    console.log(`  ${fn.padEnd(45)} ${String(s.reports.size).padStart(3)}   ${String(s.calls).padStart(8)}   ${s.fail}`);
  }

  // ── 3. 低频函数（出现 ≤2 份报告）──
  console.log('\n════════ 低频函数（出现 ≤2 份报告）════════');
  const lowFreq = sorted.filter(([, s]) => s.reports.size <= 2);
  for (const [fn, s] of lowFreq) {
    console.log(`  ${fn.padEnd(45)} ${String(s.reports.size).padStart(3)} 份 | ${s.calls} 次调用`);
  }
  if (lowFreq.length === 0) console.log('  （无——被调用函数都很稳定，每次任务调用同一批核心函数）');

  // ── 4. 从未被调用的函数（服务类方法 - 报告出现）──
  console.log('\n════════ 从未被调用的函数（服务类有方法但 50 次执行从未调用）════════');
  for (const [svc, file] of Object.entries(SERVICES)) {
    const classMethods = extractClassMethods(file);
    const calledMethods = new Set<string>();
    for (const fn of stats.keys()) {
      if (fn.startsWith(`${svc}.`)) calledMethods.add(fn.slice(svc.length + 1));
    }
    const never = classMethods.filter((m) => !calledMethods.has(m));
    if (never.length > 0) {
      console.log(`  [${svc}] 从未调用: ${never.join(', ')}`);
    } else {
      console.log(`  [${svc}] 全部方法均有调用 ✅`);
    }
  }
}

/** 从类文件提取类方法名（排除控制流噪音） */
function extractClassMethods(file: string): string[] {
  try {
    const src = readFileSync(file, 'utf-8');
    const methods = new Set<string>();
    const re = /^\s{2,}(?:private |protected |public )?(?:async |static )?(\w+)\s*\(/gm;
    for (const m of src.matchAll(re)) {
      if (!NOISE.has(m[1])) methods.add(m[1]);
    }
    return [...methods].sort();
  } catch {
    return [];
  }
}

main();
