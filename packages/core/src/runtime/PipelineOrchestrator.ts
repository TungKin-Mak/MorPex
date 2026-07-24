import { EventBus } from '../common/EventBus.js';
import { GoalIntelligenceFacade } from '../goal-intelligence/GoalIntelligenceFacade.js';
import { MissionController } from '../mission-control/MissionController.js';
import { DynamicTeamOrchestrator } from '../organization/DynamicTeamOrchestrator.js';
import { CapabilityRegistry } from '../capability/CapabilityRegistry.js';
import type { ExecutionContext, WorkflowContext } from './ExecutionContext.js';

export class PipelineOrchestrator {
  private eventBus: EventBus;
  private missionController: MissionController;
  private teamOrchestrator: DynamicTeamOrchestrator;
  private workflowRegistry?: { findForGoal: (goal: string) => Array<{ name: string; description: string }> };

  constructor(
    eventBus: EventBus,
    missionController: MissionController,
    teamOrchestrator: DynamicTeamOrchestrator,
  ) {
    this.eventBus = eventBus;
    this.missionController = missionController;
    this.teamOrchestrator = teamOrchestrator;
  }

  setWorkflowRegistry(registry: { findForGoal: (goal: string) => Array<{ name: string; description: string }> }): void {
    this.workflowRegistry = registry;
  }

  async orchestrate(rawGoal: string): Promise<{
    context: ExecutionContext;
    steps: Array<{ phase: string; result: unknown }>;
  }> {
    const steps: Array<{ phase: string; result: unknown }> = [];
    const executionId = `exec_${Date.now()}`;

    CapabilityRegistry.init();

    // 1. Goal Understanding
    const goalContext = await GoalIntelligenceFacade.understandGoal(rawGoal);
    steps.push({ phase: 'goal', result: goalContext });

    // 2. Mission Creation
    const mission = this.missionController.createMission(goalContext.goalId, goalContext.objective);
    this.missionController.updateMission({ missionId: mission.missionId, phase: 'PLANNING' });
    steps.push({ phase: 'mission', result: mission });

    // 3. Workflow Selection
    let workflow: WorkflowContext = { name: 'generic', version: '1.0.0', actions: [] };
    if (this.workflowRegistry) {
      const matched = this.workflowRegistry.findForGoal(rawGoal);
      if (matched.length > 0) {
        workflow = { name: matched[0].name, version: '1.0.0', actions: [] };
      }
    }
    steps.push({ phase: 'workflow', result: workflow });

    // 4. Capability Discovery + Team Formation
    const { teams, graph, capabilities } = await this.teamOrchestrator.orchestrate(goalContext);
    steps.push({ phase: 'team', result: { teams, graph } });
    const team = teams[0] || {
      id: 'default-team', goalId: goalContext.goalId, name: 'default',
      members: [], departments: [], dependencies: { edges: [], nodes: [] },
      lifecycle: 'CREATED' as const, createdAt: Date.now(),
    };

    // 5. Build ExecutionContext
    const context: ExecutionContext = {
      executionId,
      goal: goalContext,
      mission,
      team,
      workflow,
      capabilities,
      budget: { allocated: 100, spent: 0 },
      risk: goalContext.riskLevel,
      artifacts: [],
      startedAt: Date.now(),
    };

    this.eventBus.emit({
      id: `evt_${Date.now()}`, type: 'pipeline.orchestrated', timestamp: Date.now(),
      executionId, source: 'pipeline-orchestrator',
      payload: { missionId: mission.missionId, teamId: team.id, workflowName: workflow.name },
    });

    return { context, steps };
  }
}
