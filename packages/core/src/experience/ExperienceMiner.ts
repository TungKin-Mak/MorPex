import { PatternExtractor } from './PatternExtractor.js';
import { CapabilityStore } from './CapabilityStore.js';
import type { CapabilityPattern } from './CapabilityStore.js';
import { CapabilityRegistry } from '../capability/CapabilityRegistry.js';

export class ExperienceMiner {
  async mineFromCompletedTask(task: {
    goal: string;
    taskId: string;
    result: string;
    capabilities?: string[];
    departmentId?: string;
  }): Promise<CapabilityPattern> {
    const pattern = await PatternExtractor.extract(task);

    // v15 Integration: 更新 CapabilityRegistry 的成功率
    if (task.capabilities) {
      for (const capName of task.capabilities) {
        CapabilityRegistry.updateSuccessRate(capName, task.result === 'success');
      }
    }

    return pattern;
  }
}
