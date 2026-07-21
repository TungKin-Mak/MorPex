/**
 * run-test.ts — Run a single test by path
 * Usage: npx tsx tests/run-test.ts tests/integration/intent-to-planning.test.ts
 */
const testPath = process.argv[2];
if (!testPath) {
  console.error('Usage: npx tsx tests/run-test.ts <test-file-path>');
  process.exit(1);
}

// Normalize path: relative to tests/ dir or absolute
const cleanPath = testPath.replace(/^tests\//, '').replace(/\\/g, '/');
const mod = await import('./' + cleanPath);
const runFn = mod.default || mod.run;
if (typeof runFn !== 'function') {
  console.error(`No default export or run() found in ${testPath}`);
  process.exit(1);
}

const result = await runFn();
const icon = result.passed ? 'PASS' : 'FAIL';
console.log(`${icon} ${result.name} (${result.assertionsPassed}/${result.assertions}) ${result.duration}ms`);
if (result.errors.length > 0) {
  for (const e of result.errors) console.error(`  Error: ${e}`);
}
process.exit(result.passed ? 0 : 1);
