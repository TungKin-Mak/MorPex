/**
 * ArchitectureAuditor v3 — Architecture Governance Layer
 *
 * Uses hybrid analysis (static + dynamic) to produce accurate architecture reports.
 * No longer penalizes dynamic/plugin/event patterns as dead code.
 */
import type { ArchitectureReport, ClassifiedModule, ClassificationContext } from './types.js';
import { ModuleStatus } from './types.js';
import { ModuleScanner } from './ModuleScanner.js';
import { DependencyAnalyzer } from './DependencyAnalyzer.js';
import { EventFlowAnalyzer } from './EventFlowAnalyzer.js';
import { RuntimePathAnalyzer } from './RuntimePathAnalyzer.js';
import { DeadModuleDetector } from './DeadModuleDetector.js';
import { CapabilityRegistryAnalyzer } from './CapabilityRegistryAnalyzer.js';
import { ScoringEngine } from './ScoringEngine.js';
import { ModuleClassifier } from './ModuleClassifier.js';
import { DIAnalyzer } from './DIAnalyzer.js';
import { PublicAPIAnalyzer } from './PublicAPIAnalyzer.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

export class ArchitectureAuditor {
  private sc = new ModuleScanner();
  private da = new DependencyAnalyzer();
  private ea = new EventFlowAnalyzer();
  private ra = new RuntimePathAnalyzer();
  private dd = new DeadModuleDetector();
  private ca = new CapabilityRegistryAnalyzer();
  private scoreEngine = new ScoringEngine();
  private classifier = new ModuleClassifier();
  private diAnalyzer = new DIAnalyzer();
  private apiAnalyzer = new PublicAPIAnalyzer();

  async runFullAudit(): Promise<ArchitectureReport> {
    const all = await this.sc.scanAll();
    const mods = this.da.analyze(all, this.sc.coreSrcPath);
    const srcRoot = this.sc.coreSrcPath;

    // ── v3: DI Analysis ──
    const diEdges = this.diAnalyzer.scan(srcRoot, mods);

    // ── v3: Public API Analysis ──
    const { apiModules: _apiMods, apiPaths } = this.apiAnalyzer.scan(srcRoot, mods);

    // ── v3: Event Subscriber Map ──
    const eventSubscribers = this.ea.buildSubscriberMap(mods, srcRoot);

    // ── v3: Build Classification Context ──
    let bootstrapContent = '';
    let kernelContent = '';
    let barrelContent = '';
    try { bootstrapContent = fs.readFileSync(path.join(srcRoot, '../bootstrap.ts'), 'utf-8'); } catch {}
    try { kernelContent = fs.readFileSync(path.join(srcRoot, 'common/Kernel.ts'), 'utf-8'); } catch {}
    try { barrelContent = fs.readFileSync(path.join(srcRoot, 'index.ts'), 'utf-8'); } catch {}

    const classContext: ClassificationContext = {
      bootstrapContent, kernelContent, barrelContent,
      modules: mods, diEdges, publicApiSet: apiPaths,
      eventSubscribers,
    };

    // ── v3: Module Classification ──
    const classified = this.classifier.classify(mods, classContext);
    const deadModules = classified.filter(c => c.status === 'DEAD');

    // ── Traditional analysis (keep for backward compat) ──
    const unused = this.dd.detect(mods);
    const edges = this.da.detectMissingEdges(mods);
    const flows = this.ea.analyze(mods, srcRoot);
    const rpaths = this.ra.analyze(mods);
    const missCap = this.ca.detectMissingCapabilities(mods);

    // ── v3 Scoring ──
    const scoreResult = this.scoreEngine.computeV3(mods, classified, rpaths, flows);
    const s = scoreResult.overall;

    // ── Issues ──
    const ci: string[] = [];
    for (const e of edges) if (e.severity === 'critical') ci.push('[CRITICAL] ' + e.reason);
    for (const p of rpaths) if (!p.isComplete) ci.push('[PATH] ' + p.pathName + ': ' + p.gap);
    for (const c of missCap) ci.push('[CAP] 缺少: ' + c);

    // ── v3 False Positive Reduction Report ──
    const oldDead = unused.length;
    const newDead = deadModules.length;
    const falsePositiveReduction = {
      oldDead,
      nowDead: newDead,
      reduction: oldDead - newDead,
    };

    // ── Recommendations ──
    const recs: string[] = [];
    if (falsePositiveReduction.reduction > 0) {
      recs.push(`[v3] 误报减少: ${falsePositiveReduction.reduction} 个模块(${oldDead}→${newDead})`);
    }
    const trulyDead = deadModules.filter(d => d.status === 'DEAD');
    if (trulyDead.length > 0) {
      recs.push(`[Cleanup] ${trulyDead.length} 个真正死代码: ${trulyDead.slice(0, 5).map(d => d.name).join(', ')}`);
    }
    recs.push('[Test] 提升核心链路测试覆盖率');
    recs.push('[Dormant] ' + classified.filter(c => c.status === 'DORMANT_CAPABILITY').map(c => c.name).join(', ') + ' — future capability');

    const classificationSummary = this.classifier.summarize(classified);

    return {
      timestamp: Date.now(),
      modules: mods,
      classifiedModules: classified,
      unusedModules: deadModules.map(d => {
        const mod = mods.find(m => m.path === d.path);
        return mod || { path: d.path, name: d.name, type: 'unknown', lines: 0, hasExport: false, importers: 0, dependencies: [] };
      }),
      missingEdges: edges,
      runtimeCoverage: {
        total: rpaths.length,
        complete: rpaths.filter(p => p.isComplete).length,
        incomplete: rpaths.filter(p => !p.isComplete).length,
        coverage: rpaths.length ? rpaths.filter(p => p.isComplete).length / rpaths.length : 0,
        paths: rpaths,
      },
      eventFlows: flows,
      duplicateCapabilities: [],
      architectureScore: s,
      scoreBreakdown: scoreResult.dimensions,
      criticalIssues: ci,
      recommendations: recs,
      classificationSummary,
      falsePositiveReduction,
    };
  }

  formatReport(r: ArchitectureReport): string {
    const S = '='.repeat(78);
    const l: string[] = [
      S,
      '  MorPex Architecture Health Report v3',
      '  生成: ' + new Date(r.timestamp).toISOString(),
      S,
      '',
      `  Score: ${r.architectureScore}/100 | Issues: ${r.criticalIssues.length} | Runtime: ${Math.round(r.runtimeCoverage.coverage * 100)}%`,
      '',
    ];

    // Score breakdown
    if (r.scoreBreakdown.length) {
      l.push('  -- Score Breakdown --');
      for (const d of r.scoreBreakdown) {
        const pct = d.maxScore > 0 ? Math.round((d.score / d.maxScore) * 100) : 0;
        const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
        l.push(`    ${bar} ${d.name}: ${pct}% (weight: ${(d.weight * 100).toFixed(0)}%)`);
        l.push(`       ${d.details}`);
      }
      l.push('');
    }

    // Classification summary
    if (r.classificationSummary) {
      l.push('  -- Module Classification --');
      const order = ['ACTIVE_RUNTIME', 'ACTIVE_PUBLIC_API', 'PLUGIN_CAPABILITY', 'DI_CREATED', 'EVENT_LISTENER', 'DORMANT_CAPABILITY', 'TEST_ONLY', 'DEAD'];
      for (const status of order) {
        const count = r.classificationSummary[status] || 0;
        if (count > 0) {
          l.push(`    ${status.padEnd(20)} ${count}`);
        }
      }
      l.push('');
    }

    // False positive reduction
    if (r.falsePositiveReduction) {
      l.push(`  -- False Positive Reduction --`);
      l.push(`    Old dead modules: ${r.falsePositiveReduction.oldDead}`);
      l.push(`    Now truly dead:   ${r.falsePositiveReduction.nowDead}`);
      l.push(`    Reduction:        ${r.falsePositiveReduction.reduction} (+${Math.round(r.falsePositiveReduction.reduction / Math.max(1, r.falsePositiveReduction.oldDead) * 100)}% accuracy)`);
      l.push('');
    }

    // Critical issues
    if (r.criticalIssues.length) {
      l.push('  -- 关键问题 --');
      for (const i of r.criticalIssues) l.push('    ' + i);
      l.push('');
    }

    // Runtime paths
    if (r.runtimeCoverage.paths.length) {
      l.push('  -- Runtime 路径 --');
      for (const p of r.runtimeCoverage.paths) {
        l.push('    ' + (p.isComplete ? 'OK' : 'MISS') + ' ' + p.pathName + (p.gap ? ' - ' + p.gap : ''));
      }
      l.push('');
    }

    // Dead modules (truly)
    const trulyDead = r.unusedModules.filter(m => {
      const cls = r.classifiedModules?.find(c => c.path === m.path);
      return cls?.status === 'DEAD';
    });
    if (trulyDead.length > 0) {
      l.push('  -- 真正死代码 --');
      for (const m of trulyDead) l.push('    ' + m.name + ' (' + m.path + ')');
      l.push('');
    }

    // Recommendations
    if (r.recommendations.length) {
      l.push('  -- 修复建议 --');
      for (const rec of r.recommendations) l.push('    -> ' + rec);
      l.push('');
    }

    l.push(S);
    return l.join('\n');
  }
}
