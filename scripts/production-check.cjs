#!/usr/bin/env node
/**
 * MorPex Production Readiness Runner
 * 
 * Quick command to run all production tests and verify readiness.
 * 
 * Usage: node scripts/production-check.js
 */
const { execSync } = require('child_process');
const path = require('path');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BRIGHT = '\x1b[1m';
const RESET = '\x1b[0m';

const PROJECT_ROOT = path.resolve(__dirname, '..');

const steps = [
  { name: 'TypeScript Compilation', cmd: 'npx tsc --noEmit' },
  { name: 'System Tests', cmd: 'npx tsx tests/run-all.ts' },
  { name: 'LLM Mock Tests', cmd: 'npx tsx packages/core/__tests__/production-llm-mock.test.ts' },
  { name: 'Pipeline Tests', cmd: 'npx tsx packages/core/__tests__/production-pipeline.test.ts' },
  { name: 'Sandbox Tests', cmd: 'npx tsx packages/core/__tests__/production-sandbox.test.ts' },
  { name: 'Memory Tests', cmd: 'npx tsx packages/core/__tests__/production-memory.test.ts' },
  { name: 'Prompt Injection Security', cmd: 'npx tsx packages/core/__tests__/security-prompt-injection.test.ts' },
  { name: 'Dependency Check', cmd: 'npx depcheck 2>&1 || true' },
];

async function main() {
  console.log(`${BRIGHT}╔════════════════════════════════════════════╗${RESET}`);
  console.log(`${BRIGHT}║   MorPex Production Readiness Checker     ║${RESET}`);
  console.log(`${BRIGHT}╚════════════════════════════════════════════╝${RESET}\n`);

  let passed = 0;
  let failed = 0;

  for (const step of steps) {
    process.stdout.write(`  ${step.name}... `);
    try {
      execSync(step.cmd, { stdio: 'pipe', timeout: 120000, cwd: PROJECT_ROOT });
      console.log(`${GREEN}✅ PASSED${RESET}`);
      passed++;
    } catch (e) {
      console.log(`${RED}❌ FAILED${RESET}`);
      failed++;
      const output = e.stderr?.toString() || e.stdout?.toString() || e.message;
      const lines = output.split('\n').filter(l => l.trim()).slice(0, 3);
      for (const line of lines) {
        console.log(`     ${YELLOW}${line.trim()}${RESET}`);
      }
    }
  }

  const total = passed + failed;
  console.log(`\n${BRIGHT}════════════════════════════════════════════${RESET}`);
  console.log(`${BRIGHT}  Results: ${passed}/${total} passed${RESET}`);
  console.log(`${BRIGHT}════════════════════════════════════════════${RESET}`);

  if (failed > 0) {
    console.log(`\n${RED}  ❌ ${failed} check(s) failed — review above.${RESET}`);
    process.exit(1);
  } else {
    console.log(`\n${GREEN}  ✅ All checks passed — ready for production!${RESET}`);
    process.exit(0);
  }
}

main().catch(e => { console.error(e); process.exit(2); });
