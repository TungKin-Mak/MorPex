/** @deprecated 已合并到 capability/CapabilityRegistry.ts。所有能力数据统一存储在 CapabilityRegistry。 */
export interface CapabilityPattern {
  name: string;
  steps: string[];
  successRate: number;
  totalRuns: number;
  domains: string[];
  extractedFrom: string[];
}

/** @deprecated 已合并到 capability/CapabilityRegistry.ts — 所有能力数据统一存储在 CapabilityRegistry */
export class CapabilityStore {
  private static patterns: Map<string, CapabilityPattern> = new Map();

  static save(pattern: CapabilityPattern): void {
    const existing = CapabilityStore.patterns.get(pattern.name);
    if (existing) {
      existing.successRate = (existing.successRate * existing.totalRuns + pattern.successRate) / (existing.totalRuns + 1);
      existing.totalRuns += 1;
      existing.extractedFrom.push(...pattern.extractedFrom);
      existing.steps = pattern.steps;
    } else {
      pattern.totalRuns = 1;
      CapabilityStore.patterns.set(pattern.name, pattern);
    }
  }

  static get(name: string): CapabilityPattern | undefined {
    return CapabilityStore.patterns.get(name);
  }

  static search(domain: string): CapabilityPattern[] {
    return [...CapabilityStore.patterns.values()].filter(p => p.domains.includes(domain));
  }

  static getTopPatterns(limit: number = 5): CapabilityPattern[] {
    return [...CapabilityStore.patterns.values()]
      .sort((a, b) => b.successRate - a.successRate)
      .slice(0, limit);
  }

  static getAll(): CapabilityPattern[] {
    return [...CapabilityStore.patterns.values()];
  }

  static clear(): void {
    CapabilityStore.patterns.clear();
  }
}
