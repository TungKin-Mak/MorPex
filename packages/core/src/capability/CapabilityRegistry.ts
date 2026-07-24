/**
 * CapabilityRegistry — 统一能力注册中心 (v16 合并版)
 *
 * 合并自:
 *   - capability/CapabilityRegistry.ts (静态注册)
 *   - experience/CapabilityStore.ts (动态模式存储)
 *
 * 现在: 一个地方存所有能力数据，包括成功率/步骤/领域/提取来源。
 */
export interface Capability {
  name: string;
  description: string;
  /** 提供此能力的 workflow 名称 */
  provider: string;
  /** 移动平均成功率 (0-1) */
  successRate: number;
  /** 总运行次数 (用于成功率加权) */
  totalRuns: number;
  /** 所需工具 */
  requiredTools: string[];
  /** 预估执行时间 (ms) */
  estimatedDuration: number;
  /** 依赖的其他能力 */
  dependencies: string[];
  /** 所属领域 */
  domains: string[];
  /** 提取的步骤模板 */
  steps: string[];
  /** 提取来源的任务 ID */
  extractedFrom: string[];
  createdAt: number;
}

export class CapabilityRegistry {
  private static capabilities: Map<string, Capability> = new Map();

  static register(cap: Omit<Capability, 'createdAt'>): void {
    CapabilityRegistry.capabilities.set(cap.name, { ...cap, createdAt: Date.now() });
  }

  static get(name: string): Capability | undefined {
    return CapabilityRegistry.capabilities.get(name);
  }

  static search(query: string): Capability[] {
    const lower = query.toLowerCase();
    return [...CapabilityRegistry.capabilities.values()].filter(c =>
      c.name.toLowerCase().includes(lower) ||
      c.description.toLowerCase().includes(lower) ||
      c.domains.some(d => d.includes(lower)),
    );
  }

  static findByDomain(domain: string): Capability[] {
    return [...CapabilityRegistry.capabilities.values()].filter(c =>
      c.domains.includes(domain) || c.provider.includes(domain),
    );
  }

  static getTop(limit: number = 5): Capability[] {
    return [...CapabilityRegistry.capabilities.values()]
      .sort((a, b) => b.successRate - a.successRate)
      .slice(0, limit);
  }

  static updateSuccessRate(name: string, success: boolean): void {
    const cap = CapabilityRegistry.capabilities.get(name);
    if (!cap) return;
    cap.totalRuns += 1;
    cap.successRate = ((cap.successRate * (cap.totalRuns - 1)) + (success ? 1 : 0)) / cap.totalRuns;
  }

  static addStep(name: string, step: string): void {
    const cap = CapabilityRegistry.capabilities.get(name);
    if (cap && !cap.steps.includes(step)) cap.steps.push(step);
  }

  static addExtraction(name: string, taskId: string): void {
    const cap = CapabilityRegistry.capabilities.get(name);
    if (cap && !cap.extractedFrom.includes(taskId)) cap.extractedFrom.push(taskId);
  }

  static getAll(): Capability[] {
    return [...CapabilityRegistry.capabilities.values()];
  }

  static count(): number {
    return CapabilityRegistry.capabilities.size;
  }

  static clear(): void {
    CapabilityRegistry.capabilities.clear();
  }

  static init(): void {
    CapabilityRegistry.capabilities.clear();
    const defaults: Array<Omit<Capability, 'createdAt'>> = [
      { name: 'PCB Design', description: '印刷电路板设计', provider: 'hardware', successRate: 0.85, totalRuns: 100, requiredTools: ['eda-tool', 'simulation'], estimatedDuration: 172800000, dependencies: [], domains: ['hardware', 'electronics'], steps: ['原理图设计', 'PCB布局', 'DFM检查'], extractedFrom: [] },
      { name: 'Firmware Development', description: '嵌入式固件开发', provider: 'hardware', successRate: 0.82, totalRuns: 80, requiredTools: ['compiler', 'debugger'], estimatedDuration: 259200000, dependencies: ['PCB Design'], domains: ['hardware', 'embedded'], steps: ['驱动开发', '协议栈', '测试'], extractedFrom: [] },
      { name: 'Industrial Design', description: '工业设计/3D建模', provider: 'hardware', successRate: 0.78, totalRuns: 60, requiredTools: ['cad-tool'], estimatedDuration: 172800000, dependencies: [], domains: ['hardware', 'design'], steps: ['概念设计', '3D建模', '渲染'], extractedFrom: [] },
      { name: 'Amazon Listing', description: 'Amazon商品列表创建与优化', provider: 'ecommerce', successRate: 0.91, totalRuns: 200, requiredTools: ['keyword-tool', 'image-tool'], estimatedDuration: 86400000, dependencies: [], domains: ['ecommerce', 'marketing'], steps: ['关键词研究', '标题优化', '图片制作', '描述撰写'], extractedFrom: [] },
      { name: 'Keyword Research', description: 'Amazon关键词研究', provider: 'ecommerce', successRate: 0.88, totalRuns: 150, requiredTools: ['keyword-tool'], estimatedDuration: 43200000, dependencies: [], domains: ['ecommerce', 'marketing'], steps: ['竞品分析', '关键词提取', '搜索量评估'], extractedFrom: [] },
      { name: 'Image Generation', description: '商品图片生成', provider: 'ecommerce', successRate: 0.85, totalRuns: 120, requiredTools: ['image-tool'], estimatedDuration: 43200000, dependencies: ['Amazon Listing'], domains: ['ecommerce', 'design'], steps: ['拍摄规划', '图片编辑', '尺寸适配'], extractedFrom: [] },
      { name: 'Backend Development', description: '后端API开发', provider: 'software', successRate: 0.90, totalRuns: 300, requiredTools: ['ide', 'database'], estimatedDuration: 259200000, dependencies: [], domains: ['software', 'engineering'], steps: ['架构设计', 'API开发', '数据库设计', '测试'], extractedFrom: [] },
      { name: 'Frontend Development', description: '前端UI开发', provider: 'software', successRate: 0.88, totalRuns: 250, requiredTools: ['ide'], estimatedDuration: 172800000, dependencies: ['Backend Development'], domains: ['software', 'design'], steps: ['UI设计', '组件开发', '集成测试'], extractedFrom: [] },
      { name: 'Video Production', description: '营销视频制作', provider: 'marketing', successRate: 0.80, totalRuns: 40, requiredTools: ['video-tool'], estimatedDuration: 86400000, dependencies: [], domains: ['marketing', 'media'], steps: ['脚本策划', '拍摄', '剪辑', '发布'], extractedFrom: [] },
    ];
    defaults.forEach(c => CapabilityRegistry.register(c));
  }
}
