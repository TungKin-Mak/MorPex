/**
 * MorPex Architecture Auditor v1 — Self-contained script
 * Usage: node scripts/morpex-audit.mjs
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_SRC = path.resolve(__dirname, '../packages/core/src');

function scanAllFiles(dir) {
  const files = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules')
          files.push(...scanAllFiles(full));
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        files.push({ path: path.relative(CORE_SRC, full).replace(/\\/g, '/'), fullPath: full });
      }
    }
  } catch {}
  return files;
}

function analyzeFile(filePath, relPath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').length;
  const name = path.basename(relPath, '.ts');
  const isBarrel = relPath.endsWith('/index.ts') || relPath === 'index.ts';
  const isTypes = relPath.endsWith('/types.ts') || relPath === 'types.ts';
  const isPlugin = relPath.endsWith('/plugin.ts') || content.includes('MorPexPlugin');
  const hasExport = /export\s+(const|function|class|interface|type|default|enum|abstract\s+class)/.test(content);
  const deps = [];
  const re = /from\s+['"](\..+?)['"]/g;
  let m;
  while ((m = re.exec(content)) !== null) deps.push(m[1]);
  let type = 'implementation';
  if (relPath.includes('__tests__') || relPath.includes('.test.')) type = 'test';
  else if (isTypes) type = 'types';
  else if (isBarrel) type = 'barrel';
  else if (isPlugin) type = 'plugin';
  return { path: relPath, name, type, lines, hasExport, importers: 0, dependencies: deps };
}

function findImporters(mod, all) {
  let count = 0;
  const modPath = mod.path.replace(/\.ts$/, '');
  for (const other of all) {
    if (other.path === mod.path) continue;
    for (const dep of other.dependencies) {
      const resolved = path.normalize(path.join(path.dirname(other.path), dep)).replace(/\\/g, '/');
      if (resolved === modPath || resolved === modPath.replace(/\/index$/, '')) count++;
    }
  }
  return count;
}

// ════ MAIN ════
console.log('\n' + '='.repeat(62));
console.log('  MorPex Architecture Auditor v1 — Phase 0');
console.log('='.repeat(62));

const allFiles = scanAllFiles(CORE_SRC);
console.log(`\n  📁 Scanned ${allFiles.length} files in packages/core/src/\n`);

const modules = allFiles.map(f => analyzeFile(f.fullPath, f.path));
for (const mod of modules) {
  if (mod.type !== 'barrel' && mod.type !== 'types' && mod.type !== 'test')
    mod.importers = findImporters(mod, modules);
}

// Dead modules
const dead = modules.filter(m => m.type === 'implementation' && m.importers === 0 && m.hasExport);

// Missing Runtime Components
const names = new Set(modules.map(m => m.name));
const paths = new Set(modules.map(m => m.path));
const issues = [];

if (!names.has('ExecutionFSM'))
  issues.push('[CRITICAL] ExecutionFSM 不存在 — 需要创建 runtime/state-machine/ExecutionFSM.ts');
if (!modules.some(m => m.path.includes('runtime-kernel/dag') && m.type === 'implementation'))
  issues.push('[CRITICAL] Runtime DAG Executor 不存在 — dag/ 仅有 types.ts');
if (!names.has('CheckpointManager') && !names.has('RecoveryManager'))
  issues.push('[CRITICAL] Checkpoint/Recovery 不存在 — 无法暂停/恢复');

const execOrch = modules.find(m => m.name === 'ExecutionOrchestrator');
if (execOrch) {
  let inst = false;
  for (const f of allFiles)
    if (fs.readFileSync(f.fullPath, 'utf-8').includes('new ExecutionOrchestrator(') && !f.path.includes('ExecutionOrchestrator'))
      { inst = true; break; }
  if (!inst) issues.push('[CRITICAL] ExecutionOrchestrator 被 barrel-export 但从未被 new 实例化');
}

if (!modules.some(m => m.path.includes('planes/agent-plane') && m.type === 'implementation'))
  issues.push('[WARNING] Agent Harness v2 未实现 — planes/agent-plane/ 为空');

// Runtime Paths
const rtPaths = [
  { name: 'User → Intent → Plan', steps: ['IntentResolver', 'MetaPlanner', 'PipelineExecutor'], critical: true },
  { name: 'Plan → Runtime DAG', steps: ['MetaPlanner', 'DAGRuntime'], critical: true },
  { name: 'Execution FSM Chain', steps: ['ExecutionFSM', 'CheckpointManager', 'RecoveryManager'], critical: true },
  { name: 'Kernel Bootstrap', steps: ['bootstrap', 'Kernel', 'EventBus', 'Mirror', 'PluginSystem'], critical: false },
  { name: 'Event → Store → Mirror', steps: ['EventBus', 'EngineSubscriber', 'EventStore', 'ExecutionMirror'], critical: false },
];

console.log('  🛤️  Runtime Paths:\n');
let rtOk = 0;
for (const rp of rtPaths) {
  const missing = rp.steps.filter(s => !names.has(s));
  const ok = missing.length === 0;
  if (ok) rtOk++;
  console.log(`    ${ok ? '✅' : '❌'} ${rp.name}`);
  for (const s of rp.steps) {
    const found = names.has(s);
    console.log(`       ${found ? '  └─' : '🔴 MISSING:'} ${s}`);
  }
  if (!ok && rp.critical) issues.push(`[PATH] ${rp.name}: 缺少 ${missing.join(', ')}`);
  console.log();
}

// Dead modules
console.log('  💀 Dead Modules:\n');
for (const m of dead) console.log(`    - ${m.name} (${m.path}, ${m.lines} lines)`);

// Stats
const impl = modules.filter(m => m.type === 'implementation');
const connected = impl.filter(m => m.importers > 0).length;
const connPct = Math.round((connected / impl.length) * 100);
const rtPct = Math.round((rtOk / rtPaths.length) * 100);
const deadPct = Math.round((dead.length / impl.length) * 100);
const score = Math.round(connPct * 0.35 + rtPct * 0.35 + (100 - deadPct) * 0.30);

console.log(`\n  📊 Architecture Score: ${score}/100`);
console.log(`    Module Connectivity: ${connPct}% (${connected}/${impl.length})`);
console.log(`    Runtime Path Cov:    ${rtPct}% (${rtOk}/${rtPaths.length})`);
console.log(`    Dead Code Rate:      ${deadPct}% (${dead.length}/${impl.length})\n`);

console.log('  📋 Critical Issues:\n');
for (const i of issues) console.log(`    ${i}`);

console.log(`\n  📋 Phase Recommendations:\n`);
console.log(`    Phase 0 ✅  Architecture Auditor (已建立)`);
if (issues.some(i => i.includes('ExecutionFSM') || i.includes('DAG') || i.includes('Checkpoint')))
  console.log('    Phase 1 🔴  Runtime Kernel v2: ExecutionFSM + DAG Runtime + Checkpoint/Recovery');
console.log('    Phase 2 🔴  Agent Harness v2: 7 Context Types');
console.log('    Phase 3 🔴  Knowledge Plane: Artifact Intelligence');
console.log('    Phase 4 🔴  Memory Intelligence: MemoryActivationEngine');
console.log('    Phase 5 🔴  Intent Layer: GoalExtractor + ConstraintAnalyzer');
console.log('    Phase 6 🔴  Autonomous Learning Loop');
if (dead.length) console.log(`    Phase 7 🔴  Clean up: ${dead.length} dead modules`);
console.log('    Phase 8 🔴  Architecture constraints to CLAUDE.md');

console.log('\n' + '='.repeat(62) + '\n');
