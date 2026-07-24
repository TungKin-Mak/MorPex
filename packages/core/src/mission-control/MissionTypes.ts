export type MissionStatus = 'ACTIVE' | 'PAUSED' | 'BLOCKED' | 'COMPLETED' | 'FAILED';
export type MissionPhase = 'DISCOVERY' | 'PLANNING' | 'EXECUTING' | 'VERIFYING' | 'RELEASING' | 'MONITORING';
export type BlockReason = 'RESOURCE_UNAVAILABLE' | 'EXTERNAL_DEPENDENCY' | 'QUALITY_FAILED' | 'COMPLIANCE_BLOCKED' | 'HUMAN_WAITING' | 'COST_LIMIT';

export interface MissionState {
  missionId: string;
  goalId: string;
  objective: string;
  status: MissionStatus;
  phase: MissionPhase;
  progress: number;
  startTime: number;
  estimatedCompletion: number;
  blocks: Array<{ reason: BlockReason; description: string; raisedAt: number; resolvedAt?: number }>;
  risks: Array<{ description: string; severity: 'LOW' | 'MEDIUM' | 'HIGH'; probability: number; mitigation?: string }>;
  timeline: Array<{ timestamp: number; event: string; detail?: string }>;
  currentTeams: string[];
  artifacts: string[];
}

export interface MissionUpdate {
  missionId: string;
  phase?: MissionPhase;
  progress?: number;
  status?: MissionStatus;
  blocks?: MissionState['blocks'];
  risks?: MissionState['risks'];
  timeline?: MissionState['timeline'];
}
