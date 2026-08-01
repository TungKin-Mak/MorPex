import type { MissionState } from './MissionTypes.js';

export class ProgressTracker {
  static calculateProgress(
    teams: Array<{ members: Array<{ status: string }> }>,
    artifactsCompleted: number,
    totalExpectedArtifacts: number,
  ): number {
    const memberProgress = teams.flatMap(t => t.members).filter(m => m.status === 'COMPLETED').length
      / Math.max(1, teams.flatMap(t => t.members).length);
    const artifactProgress = totalExpectedArtifacts > 0 ? artifactsCompleted / totalExpectedArtifacts : 0;
    return Math.round((memberProgress * 0.6 + artifactProgress * 0.4) * 100);
  }

  static estimateTimeRemaining(mission: MissionState): number {
    const elapsed = Date.now() - mission.startTime;
    const rate = mission.progress > 0 ? elapsed / mission.progress : elapsed;
    return Math.max(0, rate * (100 - mission.progress));
  }

  static formatDuration(ms: number): string {
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
  }
}
