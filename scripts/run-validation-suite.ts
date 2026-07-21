// @ts-nocheck
/**
 * Phase 9 — Runtime Validation Suite Runner
 */
import { RuntimeValidator } from '../packages/core/src/validation/RuntimeValidator.js';

async function main() {
  const validator = new RuntimeValidator();
  const report = await validator.runAll();
  
  // Save report
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dataDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'validation-report.json'),
    JSON.stringify(report, null, 2),
    'utf-8'
  );
  
  console.log('\n📄 Report saved to data/validation-report.json');
  
  if (!report.allPassed) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Validation suite error:', err);
  process.exit(2);
});
