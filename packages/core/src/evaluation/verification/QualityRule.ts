/**
 * QualityRule — 质量检查规则接口（QualityCheck）与规则注册（L6）
 */
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
    // ═══ No Domain Logic in Core ═══
    // 领域质检规则已移至对应 Workflow 插件注册
    // （packages/workflows/<domain>/src/rules/），core 仅保留通用规则。
    QualityRule.register('code', [
      { name: 'no_syntax_error', description: '无语法错误', check: async (_t: any) => ({ pass: true }) },
    ]);
    QualityRule.register('document', [
      { name: 'min_length', description: '最少 100 字', check: async (t: any) => ({ pass: (t.content?.length || 0) >= 100 }) },
    ]);
  }
}
