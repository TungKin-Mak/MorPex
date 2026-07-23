/**
 * auto-analyze.ts — 一键启动→触发→分析
 * npx tsx scripts/auto-analyze.ts
 */
import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

const BASE = 'http://localhost:8080';

async function fetchJSON(path: string): Promise<any> {
  const r = await fetch(`${BASE}${path}`);
  return r.json();
}

async function waitForServer(maxSec = 60): Promise<boolean> {
  for (let i = 0; i < maxSec; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) { console.log(`✅ Server ready after ${i}s`); return true; }
    } catch {}
    await setTimeout(1000);
  }
  return false;
}

async function main() {
  console.log('🚀 Starting StudioServer...');
  const server = spawn('npx', ['tsx', 'packages/studio/server/StudioServer.ts'], {
    stdio: 'pipe',
    shell: true,
  });
  
  server.stdout.on('data', (d: Buffer) => {
    const line = d.toString().trim();
    if (line) console.log(`  ${line.slice(0, 150)}`);
  });
  server.stderr.on('data', (d: Buffer) => {
    const line = d.toString().trim();
    if (line && !line.includes('Warning') && !line.includes('warn')) {
      console.log(`  [stderr] ${line.slice(0, 120)}`);
    }
  });

  const ready = await waitForServer(120);
  if (!ready) { console.error('❌ Server failed to start'); server.kill(); process.exit(1); }

  // Get baseline
  const before = await fetchJSON('/api/observability/exercise-status');
  console.log(`\n📊 Baseline: ${before.exercisedCount}/${before.totalModules} (${before.coverage})`);

  // Trigger coverage
  console.log('⚡ Triggering 50-task suite...');
  await fetch(`${BASE}/api/observability/generate?mode=full-coverage`);

  // Wait and poll
  console.log('⏳ Waiting for tasks to complete...');
  let lastCount = before.exercisedCount;
  for (let i = 0; i < 30; i++) {
    await setTimeout(5000);
    try {
      const status = await fetchJSON('/api/observability/exercise-status');
      if (status.exercisedCount !== lastCount) {
        console.log(`  ${i * 5}s: ${status.exercisedCount}/${status.totalModules} (+${status.exercisedCount - lastCount})`);
        lastCount = status.exercisedCount;
      }
      if (i >= 4 && status.exercisedCount === lastCount) break; // stabilized
    } catch { break; }
  }

  // Final analysis
  const after = await fetchJSON('/api/observability/exercise-status');
  const gained = after.exercisedModules.filter((m: string) => !before.exercisedModules.includes(m));
  const stillMissing = after.exercisedModules.length < after.totalModules;

  console.log(`\n═══ Analysis ═══`);
  console.log(`Before: ${before.exercisedCount} exercised`);
  console.log(`After:  ${after.exercisedCount} exercised`);
  console.log(`Gained: ${gained.length} — ${gained.sort().join(', ') || 'none'}`);

  if (stillMissing) {
    const allMods = new Set([...after.exercisedModules, ...(before.exercisedModules)]);
    // We don't have the full module list from exercise-status, get from heartbeats
    const hb = await fetchJSON('/api/observability/heartbeats');
    const allNames = hb.report.heartbeats.map((h: any) => h.name);
    const missing = allNames.filter((n: string) => !allMods.has(n));
    console.log(`\nStill missing (${missing.length}):`);
    // Group by layer
    const byStatus: Record<string, string[]> = {};
    for (const m of missing) {
      const h = hb.report.heartbeats.find((x: any) => x.name === m);
      const key = h?.status || 'unknown';
      (byStatus[key] ||= []).push(m);
    }
    for (const [status, mods] of Object.entries(byStatus)) {
      console.log(`  [${status}] ${mods.sort().join(', ')}`);
    }
  }

  console.log(`\nCoverage: ${after.coverage}`);
  server.kill();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
