import { ArchitectureAuditor } from '../packages/core/src/auditor/ArchitectureAuditor.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function main() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  MorPex Architecture Audit v1');
  console.log('═══════════════════════════════════════════════\n');

  const auditor = new ArchitectureAuditor();
  const report = await auditor.runFullAudit();

  // Score
  console.log(`🏗️  Architecture Health Score: ${report.architectureScore}/100\n`);

  // Runtime Paths
  console.log('═══ Runtime Paths ═══\n');
  for (const p of report.runtimeCoverage.paths) {
    console.log(`${p.isComplete ? '✅' : '❌'} ${p.pathName}`);
    if (p.gap) console.log(`   🔴 Gap: ${p.gap}`);
    console.log();
  }

  // Critical Issues
  console.log('═══ Critical Issues ═══\n');
  if (report.criticalIssues.length === 0) {
    console.log('   ✅ None\n');
  } else {
    for (const issue of report.criticalIssues) {
      console.log(`   🔴 ${issue}\n`);
    }
  }

  // Missing Edges
  console.log('═══ Missing Edges ═══\n');
  if (report.missingEdges.length === 0) {
    console.log('   ✅ None\n');
  } else {
    for (const e of report.missingEdges) {
      const icons: Record<string, string> = { critical: '🔴', major: '🟠', warning: '🟡', info: 'ℹ️' };
      console.log(`   ${icons[e.severity] || '🟡'} [${e.severity}] ${e.from} → ${e.to}`);
      console.log(`       ${e.reason}\n`);
    }
  }

  // Module Stats
  console.log('═══ Module Stats ═══\n');
  console.log(`   Total modules: ${report.modules.length}`);
  console.log(`   Unused: ${report.unusedModules.length}`);
  console.log(`   Runtime coverage: ${(report.runtimeCoverage.coverage * 100).toFixed(0)}%\n`);

  // Unused modules
  if (report.unusedModules.length > 0) {
    console.log('═══ Unused/Dead Modules ═══\n');
    for (const m of report.unusedModules) {
      console.log(`   💀 ${m.name} (${m.path})`);
    }
    console.log();
  }

  // Recommendations
  console.log('═══ Recommendations ═══\n');
  if (report.recommendations.length > 0) {
    for (const rec of report.recommendations) {
      console.log(`   → ${rec}`);
    }
    console.log();
  }

  // Summary
  console.log('═══════════════════════════════════════════════');
  console.log('  Summary');
  console.log('═══════════════════════════════════════════════\n');
  console.log(`  Score: ${report.architectureScore}/100`);
  console.log(`  Critical Issues: ${report.criticalIssues.length}`);
  console.log(`  Missing Edges: ${report.missingEdges.length}`);
  console.log(`  Dead Modules: ${report.unusedModules.length}`);
  console.log(`  Runtime Coverage: ${report.runtimeCoverage.complete}/${report.runtimeCoverage.total} paths\n`);

  // Save
  const outPath = path.resolve(import.meta.dirname, '../data/architecture-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`📄 Full report saved to ${outPath}`);
}

main().catch(console.error);
