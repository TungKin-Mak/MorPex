import type { GoalContext } from '../../infrastructure/protocol/contracts/goal.js';
import type { MissionState } from './mission/MissionTypes.js';
import type { DynamicTeam } from '../../execution/types.js';
import type { Capability } from '../../governance/capability/CapabilityRegistry.js';

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
