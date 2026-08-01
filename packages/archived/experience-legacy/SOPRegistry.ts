export interface SOP {
  id: string;
  title: string;
  category: string;
  taskType: string;
  steps: Array<{ action: string; description: string }>;
  avgDuration: number;
  successRate: number;
  createdAt: number;
}

export class SOPRegistry {
  private static sops: Map<string, SOP> = new Map();

  static save(sop: SOP): void {
    SOPRegistry.sops.set(sop.id, sop);
  }

  static findRelevant(goal: string): SOP[] {
    const lower = goal.toLowerCase();
    return [...SOPRegistry.sops.values()].filter(s =>
      lower.includes(s.category) || lower.includes(s.taskType)
    );
  }

  static getAll(): SOP[] {
    return [...SOPRegistry.sops.values()];
  }
}
