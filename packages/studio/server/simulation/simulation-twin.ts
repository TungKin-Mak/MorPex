/**
 * SimulationTwin — 仿真孪生
 *
 * MorPex v10: 基于历史执行数据构建 Mission 的仿真孪生。
 * 孪生包含相似 Mission 的历史表现数据，用于预测当前 Mission 的执行质量。
 *
 * 输入: Mission goal + context
 * 输出: SimulationTwinProfile（含相似 Mission、历史成功率、建议风险等级）
 */

import type { SimulationTwinProfile, SimilarMission } from './types.js';

// ── SimulationTwin ──

export class SimulationTwin {
  private similarityThreshold: number;
  private maxReferenceMissions: number;

  constructor(config?: { similarityThreshold?: number; maxReferenceMissions?: number }) {
    this.similarityThreshold = config?.similarityThreshold ?? 0.3;
    this.maxReferenceMissions = config?.maxReferenceMissions ?? 10;
  }

  /**
   * buildProfile — 构建仿真孪生画像
   *
   * @param twinId - 孪生 ID
   * @param missionId - Mission ID
   * @param goal - 用户目标
   * @param history - 历史 Mission 记录（用于计算相似度）
   * @returns SimulationTwinProfile
   */
  buildProfile(
    twinId: string,
    missionId: string,
    goal: string,
    history: Array<{
      missionId: string;
      goal: string;
      success: boolean;
      duration: number;
      score: number;
    }>
  ): SimulationTwinProfile {
    // 1. 计算相似度
    const similarMissions = this.findSimilar(goal, history);

    // 2. 计算历史指标
    const successful = similarMissions.filter(m => m.success);
    const successRate = similarMissions.length > 0
      ? successful.length / similarMissions.length
      : 0.5; // 无历史数据时默认 50%

    const avgDuration = similarMissions.length > 0
      ? Math.round(similarMissions.reduce((s, m) => s + m.duration, 0) / similarMissions.length)
      : 0;

    const avgCost = similarMissions.length > 0
      ? Math.round(similarMissions.reduce((s, m) => s + (m.score > 0 ? m.duration * 0.01 : 0), 0) / similarMissions.length)
      : 100;

    // 3. 确定风险等级
    const suggestedRiskLevel = this.determineRiskLevel(successRate, avgDuration, similarMissions.length);

    // 4. 最近执行时间
    const lastExecuted = similarMissions.length > 0
      ? Math.max(...similarMissions.map(m => Date.now())) // 实际应从数据中获取
      : undefined;

    return {
      twinId,
      missionId,
      goal,
      similarMissions: similarMissions.slice(0, this.maxReferenceMissions),
      historicalSuccessRate: Math.round(successRate * 100) / 100,
      historicalAvgDuration: avgDuration,
      historicalAvgCost: avgCost,
      suggestedRiskLevel,
      lastExecutedAt: lastExecuted,
    };
  }

  /**
   * health — 健康检查
   */
  health(): { ok: boolean; name: string; uptime: number } {
    return {
      ok: true,
      name: 'SimulationTwin',
      uptime: Date.now(),
    };
  }

  // ── 私有方法 ──

  /**
   * findSimilar — 基于关键词相似度查找历史 Mission
   */
  private findSimilar(
    goal: string,
    history: Array<{ missionId: string; goal: string; success: boolean; duration: number; score: number }>
  ): SimilarMission[] {
    const goalKeywords = this.extractKeywords(goal);

    return history
      .map(h => {
        const histKeywords = this.extractKeywords(h.goal);
        const similarity = this.calculateSimilarity(goalKeywords, histKeywords);

        return {
          missionId: h.missionId,
          goal: h.goal,
          similarity,
          success: h.success,
          duration: h.duration,
          score: h.score,
        };
      })
      .filter(m => m.similarity >= this.similarityThreshold)
      .sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * extractKeywords — 从目标文本提取关键词
   */
  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
      'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
      'this', 'that', 'these', 'those', 'it', 'its',
      '我', '的', '是', '了', '在', '和', '就', '不', '人', '都', '一',
      '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会',
      '着', '没有', '看', '好', '自己', '这',
    ]);

    return text
      .toLowerCase()
      .split(/[\s,，。；;：:！!？?（）()【】\[\]{}""'']+/)
      .filter(w => w.length > 1 && !stopWords.has(w));
  }

  /**
   * calculateSimilarity — Jaccard 相似度计算
   */
  private calculateSimilarity(a: string[], b: string[]): number {
    if (a.length === 0 && b.length === 0) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    const setA = new Set(a);
    const setB = new Set(b);

    let intersection = 0;
    for (const item of setA) {
      if (setB.has(item)) intersection++;
    }

    const union = new Set([...setA, ...setB]).size;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * determineRiskLevel — 基于历史数据确定风险等级
   */
  private determineRiskLevel(
    successRate: number,
    avgDuration: number,
    historyCount: number
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (historyCount === 0) return 'medium'; // 无历史数据 → 中等风险
    if (successRate >= 0.8 && avgDuration < 300_000) return 'low';
    if (successRate >= 0.6 && avgDuration < 600_000) return 'medium';
    if (successRate >= 0.3) return 'high';
    return 'critical';
  }
}
