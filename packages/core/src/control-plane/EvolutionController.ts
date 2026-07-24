import { SelfImprovementLoop } from '../brain/SelfImprovementLoop.js';

export class EvolutionController {
  private loop = new SelfImprovementLoop();

  async analyze(metrics: { taskSuccessRate: number; avgLatency: number; failurePatterns: string[]; artifactQuality: number }): Promise<{ insights: any[]; proposals: any[] }> {
    return this.loop.runAnalysis(metrics);
  }
}
