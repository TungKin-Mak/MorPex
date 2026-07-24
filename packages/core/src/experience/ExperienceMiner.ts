/**
 * ExperienceMiner — 经验挖掘器
 * v16: 任务完成后自动挖掘经验，更新 CapabilityRegistry
 */
import { PatternExtractor } from './PatternExtractor.js';

export class ExperienceMiner {
  async mineFromCompletedTask(task: {
    goal: string;
    taskId: string;
    result: string;
    capabilities?: string[];
    departmentId?: string;
  }): Promise<void> {
    await PatternExtractor.extract(task);
  }
}
