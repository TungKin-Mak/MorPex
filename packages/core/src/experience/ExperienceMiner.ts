import { PatternExtractor } from './PatternExtractor.js';
import type { CapabilityPattern } from './CapabilityStore.js';

export class ExperienceMiner {
  async mineFromCompletedTask(task: { goal: string; taskId: string; result: string; capabilities?: string[]; departmentId?: string }): Promise<CapabilityPattern> {
    return PatternExtractor.extract(task);
  }
}
