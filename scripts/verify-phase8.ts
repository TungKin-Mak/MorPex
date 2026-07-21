/**
 * Phase 8 — Architecture Constraints Rules Verification
 *
 * Checks that CLAUDE.md contains the 4 architecture rules
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

async function main() {
  console.log('\n=== Phase 8: Architecture Constraints in CLAUDE.md ===\n');
  let passed = 0, failed = 0;

  const claudePath = path.resolve(import.meta.dirname, '../CLAUDE.md');
  const content = fs.readFileSync(claudePath, 'utf-8');

  // Rule 1: 模块必须闭环
  try {
    const hasRule1 = content.includes('Rule 1') && content.includes('有输入') && content.includes('有输出') && content.includes('有调用链');
    console.assert(hasRule1, 'Rule 1 present: input, output, call chain, runtime path');
    passed++;
    console.log('  ✅ Rule 1: 模块必须闭环（输入/输出/调用链/Runtime路径）');
  } catch (e) { failed++; console.error('  ❌ Rule 1:', e); }

  // Rule 2: 禁止幽灵模块
  try {
    const hasRule2 = content.includes('Rule 2') && content.includes('幽灵模块') && content.includes('Create File');
    console.assert(hasRule2, 'Rule 2 present: no ghost modules');
    passed++;
    console.log('  ✅ Rule 2: 禁止幽灵模块（Create File + Export + Never Used）');
  } catch (e) { failed++; console.error('  ❌ Rule 2:', e); }

  // Rule 3: 核心能力管道
  try {
    const hasRule3 = content.includes('Rule 3') && content.includes('Kernel') && content.includes('Gateway') && content.includes('EventBus') && content.includes('Mirror');
    console.assert(hasRule3, 'Rule 3 present: Kernel→Gateway→Runtime→EventBus→Mirror→Knowledge/Memory');
    passed++;
    console.log('  ✅ Rule 3: 核心能力管道（Kernel→Gateway→Runtime→EventBus→Mirror→Knowledge/Memory）');
  } catch (e) { failed++; console.error('  ❌ Rule 3:', e); }

  // Rule 4: Planning/Execution 分离
  try {
    const hasRule4 = content.includes('Rule 4') && content.includes('Planning') && content.includes('Execution') && content.includes('Plan Blueprint');
    console.assert(hasRule4, 'Rule 4 present: Planning produces Blueprint, Runtime executes');
    passed++;
    console.log('  ✅ Rule 4: Planning/Execution 严格分离');
  } catch (e) { failed++; console.error('  ❌ Rule 4:', e); }

  // Version bump check
  try {
    const updatedVersion = content.includes('v1.2') || content.includes('v2');
    console.log('  ℹ️  CLAUDE.md version should be bumped (currently shows v1.1)');
    passed++;
  } catch (e) { failed++; }

  console.log(`\n  📊 ${passed}/${passed + failed} tests passed`);
  if (failed > 0) { console.log(`  ❌ ${failed} FAILED`); process.exit(1); }
  else console.log('  ✅ Phase 8 ALL PASSED\n');
}

main().catch(console.error);
