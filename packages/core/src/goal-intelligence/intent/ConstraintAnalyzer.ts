/**
 * ConstraintAnalyzer — 约束分析器
 *
 * 从用户请求中提取各种约束条件：
 * - 技术约束 (tech stack, frameworks)
 * - 时间约束 (deadlines, time estimates)
 * - 质量约束 (performance, security, testing)
 * - 资源约束 (budget, team size)
 * - 业务约束 (compliance, domain rules)
 */

export interface Constraints {
  technical: string[];
  time: string[];
  quality: string[];
  resource: string[];
  business: string[];
  other: string[];
}

export class ConstraintAnalyzer {
  private readonly patterns: Array<{ category: keyof Constraints; patterns: RegExp[] }> = [
    { category: 'technical', patterns: [
      /(?:using|with|in)\s+([A-Za-z#+.0-9]+)/gi,
      /(?:tech|technology|stack|framework|language|platform)[:\s]+(.+?)(?=[,.]|$)/gi,
      /(?:run on|deploy to|target)\s+(.+?)(?=[,.]|$)/gi,
    ]},
    { category: 'time', patterns: [
      /(?:by|before|within|in)\s+(\d+\s*(?:day|week|hour|minute|month)s?)/gi,
      /(?:deadline|due|timeframe|by when)[:\s]+(.+?)(?=[,.]|$)/gi,
      /(?:urgent|asap|quickly|immediately)/gi,
    ]},
    { category: 'quality', patterns: [
      /(?:performance|fast|responsive|scalable|reliable)/gi,
      /(?:secure|security|auth|permission)/gi,
      /(?:test|testing|coverage|unit test|e2e)/gi,
      /(?:quality|standard|best practice|clean|maintainable)/gi,
    ]},
    { category: 'resource', patterns: [
      /(?:budget|cost|price|spend)[:\s]+(.+?)(?=[,.]|$)/gi,
      /(?:team|people|developer|headcount)[:\s]+(.+?)(?=[,.]|$)/gi,
      /(?:server|infra|infrastructure|resource)[:\s]+(.+?)(?=[,.]|$)/gi,
    ]},
    { category: 'business', patterns: [
      /(?:compliance|regulation|gdpr|hipaa|pci|sox)/gi,
      /(?:business|domain|industry|vertical)[:\s]+(.+?)(?=[,.]|$)/gi,
      /(?:stakeholder|customer|user|client)[:\s]+(.+?)(?=[,.]|$)/gi,
    ]},
  ];

  /** 分析输入文本中的约束 */
  analyze(input: string): Constraints {
    const result: Constraints = { technical: [], time: [], quality: [], resource: [], business: [], other: [] };

    for (const { category, patterns } of this.patterns) {
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(input)) !== null) {
          const value = (match[1] || match[0]).trim();
          if (value && !result[category].includes(value)) {
            result[category].push(value);
          }
        }
      }
    }

    // Deduplicate across categories
    const allValues = new Set(Object.values(result).flat());
    result.other = result.other.filter(v => !allValues.has(v));

    return result;
  }

  /** 约束数量统计 */
  count(constraints: Constraints): number {
    return Object.values(constraints).reduce((sum, arr) => sum + arr.length, 0);
  }

  /** 检查是否有严重约束 */
  hasSevereConstraints(constraints: Constraints): boolean {
    // Time urgency
    if (constraints.time.some(t => /urgent|asap|immediately/.test(t))) return true;
    // Security requirements
    if (constraints.quality.some(q => /secure|security|auth/.test(q))) return true;
    // Compliance
    if (constraints.business.some(b => /compliance|gdpr|hipaa|pci/.test(b))) return true;
    return false;
  }
}
