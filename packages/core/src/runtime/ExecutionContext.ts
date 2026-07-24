import type { GoalContext } from '../contracts/goal.js';
import type { MissionState } from '../mission-control/MissionTypes.js';
import type { DynamicTeam } from '../organization/types.js';
import type { Capability } from '../capability/CapabilityRegistry.js';

export interface WorkflowContext {
  name: string;
  version: string;
  actions: string[];
}

export interface ExecutionContext {
  executionId: string;
  goal: GoalContext;
  mission: MissionState;
  team: DynamicTeam;
  workflow: WorkflowContext;
  capabilities: Capability[];
  budget: { allocated: number; spent: number };
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  artifacts: string[];
  startedAt: number;
}
