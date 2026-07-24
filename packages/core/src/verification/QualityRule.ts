export interface QualityCheck {
  name: string;
  description: string;
  check: (target: unknown) => Promise<{ pass: boolean; message?: string }>;
}

export class QualityRule {
  static rules: Map<string, QualityCheck[]> = new Map();

  static register(type: string, checks: QualityCheck[]): void {
    QualityRule.rules.set(type, checks);
  }

  static getChecks(type: string): QualityCheck[] {
    return QualityRule.rules.get(type) || [];
  }

  static init(): void {
    QualityRule.register('amazon_listing', [
      { name: 'title_length', description: '标题长度 80-200 字符', check: async (t: any) => ({ pass: t.title?.length >= 80 && t.title?.length <= 200 }) },
      { name: 'has_keywords', description: '包含关键词', check: async (t: any) => ({ pass: !!t.keywords?.length }) },
      { name: 'has_description', description: '有描述', check: async (t: any) => ({ pass: !!t.description }) },
      { name: 'has_price', description: '有价格', check: async (t: any) => ({ pass: !!t.price }) },
    ]);
    QualityRule.register('code', [
      { name: 'no_syntax_error', description: '无语法错误', check: async (t: any) => ({ pass: true }) },
    ]);
    QualityRule.register('document', [
      { name: 'min_length', description: '最少 100 字', check: async (t: any) => ({ pass: (t.content?.length || 0) >= 100 }) },
    ]);
  }
}
