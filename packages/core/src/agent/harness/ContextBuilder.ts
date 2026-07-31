import type { MemoryRecord, ArtifactRef, Experience } from './types.js';
import type { HarnessContext, IntentContext, PlanContext, MemoryContext, ArtifactContext, ExecutionState, PermissionContext, ExperienceContext } from './HarnessContext.js';

export class ContextBuilder {
  private intent: IntentContext = { goal: '', constraints: [], priority: 5, risk: [] };
  private plan: PlanContext = { planId: '', dag: null, currentPhase: 'init', progress: 0 };
  private memory: MemoryContext = { relevantMemories: [], contextBias: '', activationScore: 0 };
  private artifact: ArtifactContext = { availableArtifacts: [], currentArtifact: null };
  private executionState: ExecutionState = { status: 'idle', step: 0, attempt: 0, startedAt: Date.now() };
  private permission: PermissionContext = { requiredPermissions: [], granted: true, restrictions: [] };
  private experience: ExperienceContext = { similarExperiences: [], patterns: [], recommendations: [] };

  setIntent(goal: string, constraints?: string[]): this { this.intent = { ...this.intent, goal, constraints: constraints || [] }; return this; }
  setIntentPriority(priority: number): this { this.intent.priority = priority; return this; }
  addRisk(risk: string): this { this.intent.risk.push(risk); return this; }

  setPlan(planId: string, dag: any): this { this.plan = { ...this.plan, planId, dag }; return this; }
  setPlanPhase(phase: string): this { this.plan.currentPhase = phase; return this; }
  setProgress(progress: number): this { this.plan.progress = Math.max(0, Math.min(1, progress)); return this; }

  injectMemory(memories: MemoryRecord[]): this { this.memory = { ...this.memory, relevantMemories: [...this.memory.relevantMemories, ...memories] }; return this; }
  setContextBias(bias: string): this { this.memory.contextBias = bias; return this; }
  setActivationScore(score: number): this { this.memory.activationScore = score; return this; }

  attachArtifact(artifact: ArtifactRef): this {
    this.artifact = { ...this.artifact, availableArtifacts: [...this.artifact.availableArtifacts, artifact] };
    return this;
  }
  setCurrentArtifact(id: string | null): this { this.artifact.currentArtifact = id; return this; }

  setExecutionState(status: ExecutionState['status']): this { this.executionState = { ...this.executionState, status }; return this; }
  incrementStep(): this { this.executionState.step++; return this; }
  incrementAttempt(): this { this.executionState.attempt++; return this; }

  setPermissions(required: string[]): this { this.permission = { ...this.permission, requiredPermissions: [...required] }; return this; }
  grantPermissions(): this { this.permission = { ...this.permission, granted: true }; return this; }
  denyPermissions(restrictions: string[]): this { this.permission = { ...this.permission, restrictions: [...restrictions] }; return this; }
  addRestriction(restriction: string): this { this.permission.restrictions.push(restriction); return this; }

  loadExperience(experiences: Experience[]): this {
    this.experience = { ...this.experience, similarExperiences: [...experiences] };
    const allPatterns = new Set(experiences.flatMap(e => e.patterns));
    this.experience.patterns = [...allPatterns];
    const allLessons = experiences.flatMap(e => e.lessons);
    this.experience.recommendations = [...new Set(allLessons)];
    return this;
  }

  build(): HarnessContext {
    const now = Date.now();
    return {
      intent: { ...this.intent },
      plan: { ...this.plan },
      memory: { ...this.memory },
      artifact: { ...this.artifact },
      executionState: { ...this.executionState },
      permission: { ...this.permission },
      experience: { ...this.experience },
      createdAt: now,
      updatedAt: now,
    };
  }
}
