/**
 * EvolutionController — 进化控制器
 *
 * ═══ v16 重构 ═══
 * - 整合 SelfImprovementLoop + OrganizationTwin
 * - 提供进化分析和策略模拟
 */

import { SelfImprovementLoop } from '../brain/SelfImprovementLoop.js';
import { OrganizationTwin } from '../cognition/twin/OrganizationTwin.js';
import { SafetyMonitor } from '../brain/SafetyMonitor.js';

export interface EvolutionMetrics {
  taskSuccessRate: number;
  avgLatency: number;
  failurePatterns: string[];
  artifactQuality: number;
}

export class EvolutionController {
  private loop: SelfImprovementLoop;
  private safetyMonitor: SafetyMonitor;
  private orgTwin = new OrganizationTwin();

  constructor() {
    this.safetyMonitor = new SafetyMonitor();
    this.loop = new SelfImprovementLoop(this.safetyMonitor);
  }

  getOrganizationTwin(): OrganizationTwin {
    return this.orgTwin;
  }

  async simulateStrategy(product: string, market: string, budget: number) {
    return this.orgTwin.simulateGoToMarket(product, market, budget);
  }

  async analyze(metrics: EvolutionMetrics): Promise<{ insights: any[]; proposals: any[] }> {
    return this.loop.runAnalysis(metrics);
  }

  /**
   * observe — 观察系统健康状态
   */
  observe(metrics: EvolutionMetrics): void {
    this.safetyMonitor.observe({
      taskSuccessRate: metrics.taskSuccessRate,
      avgLatency: metrics.avgLatency,
      retryRate: 0,
      artifactQuality: metrics.artifactQuality,
    });
  }
}
