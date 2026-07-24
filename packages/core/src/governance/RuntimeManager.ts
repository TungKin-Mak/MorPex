import { EventBus } from '../common/EventBus.js';

export interface RuntimeContext {
  executionId: string;
  source: string;
  departmentId?: string;
  operation: string;
}

export class RuntimeManager {
  private static instance: RuntimeManager;
  private eventBus?: EventBus;
  private activeContexts: Map<string, RuntimeContext> = new Map();
  private resourceUsage: Map<string, number> = new Map();

  static getInstance(): RuntimeManager {
    if (!RuntimeManager.instance) RuntimeManager.instance = new RuntimeManager();
    return RuntimeManager.instance;
  }

  init(eventBus: EventBus): void {
    this.eventBus = eventBus;
    eventBus.on('execution.engine.started', (e: any) => {
      const p = e.payload;
      this.activeContexts.set(e.executionId, {
        executionId: e.executionId, source: 'execution',
        departmentId: p?.departmentId, operation: p?.goal?.substring(0, 60) || 'unknown',
      });
    });
    eventBus.on('execution.engine.completed', (e: any) => { this.activeContexts.delete(e.executionId); });
    eventBus.on('execution.engine.failed', (e: any) => { this.activeContexts.delete(e.executionId); });
  }

  getActiveCount(): number { return this.activeContexts.size; }
  getActiveContexts(): RuntimeContext[] { return [...this.activeContexts.values()]; }

  isResourceAvailable(resource: string, required: number): boolean {
    return (this.resourceUsage.get(resource) || 0) + required <= 100;
  }
  allocateResource(resource: string, amount: number): void {
    this.resourceUsage.set(resource, (this.resourceUsage.get(resource) || 0) + amount);
  }
  releaseResource(resource: string, amount: number): void {
    this.resourceUsage.set(resource, Math.max(0, (this.resourceUsage.get(resource) || 0) - amount));
  }

  getStatus(): { activeExecutions: number; resources: Record<string, number> } {
    return { activeExecutions: this.activeContexts.size, resources: Object.fromEntries(this.resourceUsage) };
  }
}
