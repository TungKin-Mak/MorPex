/**
 * MorPx System Test Runner — discovers & runs all test categories
 */
import { ReportGenerator } from './framework.js';

const categories = ['architecture', 'unit', 'integration', 'scenarios', 'chaos', 'performance'];

const results = [];
for (const cat of categories) {
  try {
    const files = await import('node:fs').then(fs => fs.readdirSync(new URL(cat, import.meta.url)));
    for (const file of files.filter(f => f.endsWith('.ts'))) {
      try {
        const mod = await import(`./${cat}/${file}`);
        const runFn = mod.default || mod.run;
        if (typeof runFn === 'function') {
          console.log(`  ▶ ${cat}/${file}...`);
          results.push(await runFn());
        }
      } catch (e) {
        results.push({ name: file, category: cat, passed: false, duration: 0, assertions: 0, assertionsPassed: 0, errors: [e.message] });
      }
    }
  } catch { /* dir may not exist */ }
}

const report = ReportGenerator.generate(results);
console.log(ReportGenerator.format(report));
ReportGenerator.save(report, './data');
process.exit(results.filter(r => r.passed).length < results.length ? 1 : 0);
