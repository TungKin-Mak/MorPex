/**
 * Architecture: Event Graph — event connectivity verification
 */
import { ModuleScanner } from '../../packages/core/src/auditor/ModuleScanner.js';
import { EventFlowAnalyzer } from '../../packages/core/src/auditor/EventFlowAnalyzer.js';
import { AssertionContext, type TestResult } from '../framework.js';

export async function run(): Promise<TestResult> {
  const start = Date.now();
  const assert = new AssertionContext();

  const scanner = new ModuleScanner();
  const modules = await scanner.scanAll();
  const analyzer = new EventFlowAnalyzer();
  const flows = analyzer.analyze(modules, scanner.coreSrcPath);

  const used = flows.filter(f => f.emitters.length > 0 || f.listeners.length > 0);
  const connected = used.filter(f => !f.gap);

  assert.assert(flows.length > 10, `Events detected: ${flows.length}`);
  assert.assert(used.length > 5, `Used events: ${used.length}`);
  const rate = used.length > 0 ? connected.length / used.length : 0;
  assert.assert(rate >= 0.6, `Event connectivity >= 60%: ${(rate*100).toFixed(0)}%`);
  assert.assert(scanner.coreSrcPath !== '', 'Scanner src path set');
  assert.assert(modules.length > 0, 'Modules scanned');

  return {
    name: 'Architecture: Event Graph', category: 'architecture',
    passed: assert.errors.length === 0, duration: Date.now() - start,
    assertions: assert.total, assertionsPassed: assert.passed, errors: assert.errors,
  };
}
