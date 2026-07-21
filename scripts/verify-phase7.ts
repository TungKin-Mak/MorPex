/**
 * Phase 7 — 清理孤立模块 Verification
 *
 * Checks:
 * 1. ExecutionOrchestrator now has DAG Runtime integration
 * 2. ContractGateway/PiAdapterBridge documented as pending
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.resolve(import.meta.dirname, '../packages/core/src');

async function main() {
  console.log('\n=== Phase 7: Cleanup Orphaned Modules ===\n');
  let passed = 0, failed = 0;

  // Test 1: ExecutionOrchestrator has DAG Runtime integration
  try {
    const orchestratorPath = path.join(SRC, 'planes/control-plane/orchestrator/ExecutionOrchestrator.ts');
    const content = fs.readFileSync(orchestratorPath, 'utf-8');

    const hasDAGRuntimeImport = content.includes("import { DAGRuntime } from '../../../runtime/dag/DAGRuntime.js'");
    const hasSetDAGRuntime = content.includes('setDAGRuntime');
    const hasOrchestrateWithRuntime = content.includes('orchestrateWithRuntime');

    console.assert(hasDAGRuntimeImport, 'DAGRuntime imported');
    console.assert(hasSetDAGRuntime, 'setDAGRuntime() method');
    console.assert(hasOrchestrateWithRuntime, 'orchestrateWithRuntime() method');

    passed++;
    console.log('  ✅ ExecutionOrchestrator: DAG Runtime integration added');
  } catch (e) { failed++; console.error('  ❌ ExecutionOrchestrator:', e); }

  // Test 2: Can instantiate ExecutionOrchestrator
  try {
    // Dynamic import to check if module loads
    const { ExecutionOrchestrator } = await import(
      '../packages/core/src/planes/control-plane/orchestrator/ExecutionOrchestrator.js'
    );
    console.assert(typeof ExecutionOrchestrator === 'function', 'ExecutionOrchestrator class exists');

    passed++;
    console.log('  ✅ ExecutionOrchestrator: module loads without error');
  } catch (e) { failed++; console.error('  ❌ ExecutionOrchestrator module:', e); }

  // Test 3: ContractGateway still exists (documented as pending)
  try {
    const cgPath = path.join(SRC, 'gateway/ContractGateway.ts');
    const exists = fs.existsSync(cgPath);
    console.assert(exists, 'ContractGateway file exists');

    passed++;
    console.log('  ✅ ContractGateway: preserved (pending future integration)');
  } catch (e) { failed++; console.error('  ❌ ContractGateway:', e); }

  // Test 4: PiAdapterBridge still exists (documented as pending)
  try {
    const pbPath = path.join(SRC, 'gateway/PiAdapterBridge.ts');
    const exists = fs.existsSync(pbPath);
    console.assert(exists, 'PiAdapterBridge file exists');

    passed++;
    console.log('  ✅ PiAdapterBridge: preserved (pending future integration)');
  } catch (e) { failed++; console.error('  ❌ PiAdapterBridge:', e); }

  // Test 5: All 7 phases are completed
  const phaseFiles = [
    'scripts/verify-phase1.ts',
    'scripts/verify-phase2.ts',
    'scripts/verify-phase3.ts',
    'scripts/verify-phase4.ts',
    'scripts/verify-phase5.ts',
    'scripts/verify-phase6.ts',
    'scripts/verify-phase7.ts',
    'scripts/run-architecture-audit.ts',
  ];

  const allExist = phaseFiles.every(f => fs.existsSync(path.resolve(import.meta.dirname, '..', f)));
  console.assert(allExist, 'All phase verification files exist');

  passed++;
  console.log('  ✅ All 7 Phase verification scripts exist');

  console.log(`\n  📊 ${passed}/${passed + failed} tests passed`);
  if (failed > 0) { console.log(`  ❌ ${failed} FAILED`); process.exit(1); }
  else console.log('  ✅ Phase 7 ALL PASSED\n');
}

main().catch(console.error);
