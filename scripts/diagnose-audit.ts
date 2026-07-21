/**
 * Diagnostic: 区分架构真问题 vs 检测系统误报
 */
import { ArchitectureAuditor } from '../packages/core/src/auditor/ArchitectureAuditor.js';

const auditor = new ArchitectureAuditor();
const report = await auditor.runFullAudit();

console.log('=== 诊断：架构问题 vs 检测系统问题 ===\n');

// 1. Event Connectivity: which 7 events are incomplete?
console.log('--- 1. Event Gaps (7 incomplete) ---');
const gapped = report.eventFlows.filter(e => e.gap);
for (const g of gapped) {
  console.log(`  ${g.eventType}: ${g.gap} | emitters=${g.emitters.length} listeners=${g.listeners.length}`);
  if (g.emitters.length) console.log(`    emitters: ${g.emitters.join(', ')}`);
  if (g.listeners.length) console.log(`    listeners: ${g.listeners.join(', ')}`);
}

// 2. Test count: why only 4?
console.log('\n--- 2. Test Detection ---');
const testModules = report.modules.filter(m => 
  m.path.includes('__tests__') || m.path.includes('verify-phase') || m.path.includes('.test.') || m.path.includes('.spec.')
);
console.log(`  Files matching test patterns: ${testModules.length}`);
for (const t of testModules) {
  console.log(`    ${t.path} (type=${t.type})`);
}

// 3. 2 dead modules: what are they really?
console.log('\n--- 3. Dead Modules ---');
for (const d of report.unusedModules) {
  console.log(`  ${d.path} | type=${d.type} | importers=${d.importers} | hasExport=${d.hasExport}`);
}

// 4. ModuleScanner: does it scan __tests__?
console.log('\n--- 4. Scanner coverage ---');
const allPaths = report.modules.map(m => m.path);
console.log(`  Total scanned: ${allPaths.length}`);
console.log(`  __tests__ files: ${allPaths.filter(p => p.includes('__tests__')).length}`);
console.log(`  verify-phase files: ${allPaths.filter(p => p.includes('verify-phase')).length}`);

// 5. Actual score breakdown
console.log('\n--- 5. Score Breakdown ---');
if (report.scoreBreakdown) {
  for (const d of report.scoreBreakdown) {
    console.log(`  ${d.name}: ${d.score}/${d.maxScore} (weight: ${d.weight})`);
  }
}
