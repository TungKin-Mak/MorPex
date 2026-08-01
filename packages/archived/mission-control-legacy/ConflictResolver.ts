import type { MissionState, BlockReason } from './MissionTypes.js';

export interface Conflict {
  type: 'RESOURCE' | 'SCHEDULE' | 'PRIORITY' | 'QUALITY';
  description: string;
  betweenTeams: string[];
  suggestedAction: string;
}

export class ConflictResolver {
  detectConflicts(mission: MissionState): Conflict[] {
    const conflicts: Conflict[] = [];
    if (mission.blocks.some(b => b.reason === 'RESOURCE_UNAVAILABLE')) {
      conflicts.push({ type: 'RESOURCE', description: '资源不可用', betweenTeams: mission.currentTeams, suggestedAction: '重新分配资源或等待' });
    }
    if (mission.risks.some(r => r.severity === 'HIGH' && r.probability > 0.7)) {
      conflicts.push({ type: 'QUALITY', description: '高质量风险需人工介入', betweenTeams: mission.currentTeams, suggestedAction: '升级到人工审批' });
    }
    if (mission.blocks.length > 3) {
      conflicts.push({ type: 'SCHEDULE', description: '阻塞过多影响进度', betweenTeams: mission.currentTeams, suggestedAction: '考虑重新规划' });
    }
    return conflicts;
  }

  suggestReplan(mission: MissionState): string[] {
    const suggestions: string[] = [];
    if (mission.blocks.length > 2) suggestions.push('当前阻塞过多，建议重新规划执行路径');
    const elapsedDays = (Date.now() - mission.startTime) / 86400000;
    if (mission.progress < 20 && elapsedDays > 1) {
      suggestions.push('进度严重滞后，考虑拆分为子任务并增加资源');
    }
    return suggestions;
  }
}
