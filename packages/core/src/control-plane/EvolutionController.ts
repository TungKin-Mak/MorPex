import { SelfImprovementLoop } from '../brain/SelfImprovementLoop.js';
import { OrganizationTwin } from '../cognition/twin/OrganizationTwin.js';

export class EvolutionController {
  private loop = new SelfImprovementLoop();
  private orgTwin = new OrganizationTwin();

  getOrganizationTwin(): OrganizationTwin {
    return this.orgTwin;
  }

  async simulateStrategy(product: string, market: string, budget: number) {
    return this.orgTwin.simulateGoToMarket(product, market, budget);
  }

  async analyze(metrics: { taskSuccessRate: number; avgLatency: number; failurePatterns: string[]; artifactQuality: number }): Promise<{ insights: any[]; proposals: any[] }> {
    return this.loop.runAnalysis(metrics);
  }
}
