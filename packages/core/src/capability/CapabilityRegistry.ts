export interface Capability {
  name: string;
  description: string;
  provider: string;
  successRate: number;
  totalRuns: number;
  requiredTools: string[];
  estimatedDuration: number;
  dependencies: string[];
}

export class CapabilityRegistry {
  private static capabilities: Map<string, Capability> = new Map();

  static register(cap: Capability): void {
    CapabilityRegistry.capabilities.set(cap.name, cap);
  }

  static get(name: string): Capability | undefined {
    return CapabilityRegistry.capabilities.get(name);
  }

  static search(query: string): Capability[] {
    const lower = query.toLowerCase();
    return [...CapabilityRegistry.capabilities.values()]
      .filter(c => c.name.toLowerCase().includes(lower) || c.description.toLowerCase().includes(lower));
  }

  static findByDomain(domain: string): Capability[] {
    return [...CapabilityRegistry.capabilities.values()]
      .filter(c => c.provider.toLowerCase().includes(domain));
  }

  static getAll(): Capability[] {
    return [...CapabilityRegistry.capabilities.values()];
  }

  static updateSuccessRate(name: string, success: boolean): void {
    const cap = CapabilityRegistry.capabilities.get(name);
    if (!cap) return;
    const total = cap.totalRuns;
    cap.totalRuns = total + 1;
    cap.successRate = ((cap.successRate * total) + (success ? 1 : 0)) / (total + 1);
  }

  static init(): void {
    const defaults: Capability[] = [
      { name: 'PCB Design', description: '印刷电路板设计', provider: 'hardware', successRate: 0.85, totalRuns: 20, requiredTools: ['eda-tool', 'simulation'], estimatedDuration: 172800000, dependencies: [] },
      { name: 'Firmware Development', description: '嵌入式固件开发', provider: 'hardware', successRate: 0.82, totalRuns: 15, requiredTools: ['compiler', 'debugger'], estimatedDuration: 259200000, dependencies: ['PCB Design'] },
      { name: 'Industrial Design', description: '工业设计/3D建模', provider: 'hardware', successRate: 0.78, totalRuns: 10, requiredTools: ['cad-tool'], estimatedDuration: 172800000, dependencies: [] },
      { name: 'Amazon Listing', description: 'Amazon商品列表创建与优化', provider: 'ecommerce', successRate: 0.91, totalRuns: 50, requiredTools: ['keyword-tool', 'image-tool'], estimatedDuration: 86400000, dependencies: [] },
      { name: 'Keyword Research', description: 'Amazon关键词研究', provider: 'ecommerce', successRate: 0.88, totalRuns: 40, requiredTools: ['keyword-tool'], estimatedDuration: 43200000, dependencies: [] },
      { name: 'Image Generation', description: '商品图片生成', provider: 'ecommerce', successRate: 0.85, totalRuns: 30, requiredTools: ['image-tool'], estimatedDuration: 43200000, dependencies: ['Amazon Listing'] },
      { name: 'Backend Development', description: '后端API开发', provider: 'software', successRate: 0.90, totalRuns: 100, requiredTools: ['ide', 'database'], estimatedDuration: 259200000, dependencies: [] },
      { name: 'Frontend Development', description: '前端UI开发', provider: 'software', successRate: 0.88, totalRuns: 80, requiredTools: ['ide'], estimatedDuration: 172800000, dependencies: ['Backend Development'] },
      { name: 'Video Production', description: '营销视频制作', provider: 'marketing', successRate: 0.80, totalRuns: 15, requiredTools: ['video-tool'], estimatedDuration: 86400000, dependencies: [] },
    ];
    defaults.forEach(c => CapabilityRegistry.register(c));
  }
}
