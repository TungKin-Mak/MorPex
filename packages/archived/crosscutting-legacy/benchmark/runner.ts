import { GOLDEN_TASKS } from './golden-tasks.js';
import type { GoldenTask } from './golden-tasks.js';

export interface BenchmarkResult {
  task: GoldenTask;
  passed: boolean;
  duration: number;
  coverage: { capabilities: number; artifacts: number };
  error?: string;
}

export class BenchmarkRunner {
  async runAll(executor: (task: GoldenTask) => Promise<BenchmarkResult>): Promise<{ results: BenchmarkResult[]; summary: { total: number; passed: number; failed: number; avgDuration: number } }> {
    const results: BenchmarkResult[] = [];
    for (const task of GOLDEN_TASKS) {
      try {
        const result = await executor(task);
        results.push(result);
      } catch (e) {
        results.push({ task, passed: false, duration: 0, coverage: { capabilities: 0, artifacts: 0 }, error: (e as Error).message });
      }
    }
    const passed = results.filter(r => r.passed).length;
    const avgDuration = results.reduce((s, r) => s + r.duration, 0) / results.length;
    return { results, summary: { total: results.length, passed, failed: results.length - passed, avgDuration } };
  }
}
