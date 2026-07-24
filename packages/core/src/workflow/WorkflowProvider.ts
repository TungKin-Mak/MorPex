/**
 * WorkflowProvider — 工作流插件接口
 * v15: 核心通过此接口发现和加载外部 workflow 包
 */
export interface WorkflowAction {
  name: string;
  description: string;
  execute(params: Record<string, unknown>, context?: Record<string, unknown>): Promise<{ success: boolean; data?: unknown; error?: string }>;
}

export interface WorkflowProvider {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  getActions(): WorkflowAction[];
  getArtifactTypes(): string[];
  getValidators(): string[];
  matchGoal(goal: string): boolean;
}

export class WorkflowRegistry {
  private static providers: Map<string, WorkflowProvider> = new Map();

  static register(provider: WorkflowProvider): void {
    WorkflowRegistry.providers.set(provider.name, provider);
  }

  static get(name: string): WorkflowProvider | undefined {
    return WorkflowRegistry.providers.get(name);
  }

  static findForGoal(goal: string): WorkflowProvider[] {
    return [...WorkflowRegistry.providers.values()].filter(p => p.matchGoal(goal));
  }

  static getAll(): WorkflowProvider[] {
    return [...WorkflowRegistry.providers.values()];
  }
}
