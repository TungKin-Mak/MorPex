/**
 * GoalExtractor — 目标提取器
 *
 * 从用户请求中提取结构化目标，包括：
 * - 主要目标 (primary goal)
 * - 子目标 (sub-goals)
 * - 目标类型 (build/analyze/learn/create/optimize)
 * - 验收标准
 */
export interface StructuredGoal {
  primary: string;
  subGoals: string[];
  type: 'build' | 'analyze' | 'learn' | 'create' | 'optimize' | 'maintain' | 'unknown';
  acceptanceCriteria: string[];
  scope: string;
}

export class GoalExtractor {
  /** 从文本中提取结构化目标 */
  extract(input: string): StructuredGoal {
    const goal = this.parseGoal(input);
    return goal;
  }

  /** 解析目标类型 */
  detectType(input: string): StructuredGoal['type'] {
    const lower = input.toLowerCase();
    if (/build|create|develop|implement|make|generate/.test(lower)) return 'build';
    if (/analyze|analyze|review|audit|inspect|evaluate/.test(lower)) return 'analyze';
    if (/learn|understand|explain|what is|how does/.test(lower)) return 'learn';
    if (/design|draft|write|compose|outline/.test(lower)) return 'create';
    if (/optimize|improve|enhance|refactor|speed.up/.test(lower)) return 'optimize';
    if (/fix|repair|debug|patch|update|maintain/.test(lower)) return 'maintain';
    return 'unknown';
  }

  private parseGoal(input: string): StructuredGoal {
    const type = this.detectType(input);
    const sentences = input.split(/[.。!！?？\n]/).filter(s => s.trim().length > 0);

    // Primary goal: first substantive sentence
    const primary = sentences[0]?.trim() || input;

    // Sub-goals: remaining sentences
    const subGoals = sentences.slice(1).map(s => s.trim()).filter(s => s.length > 10);

    // Acceptance criteria: look for keywords
    const acceptanceCriteria: string[] = [];
    const acPatterns = [
      /should\s+(.+?)(?=[,.]|$)/gi,
      /must\s+(.+?)(?=[,.]|$)/gi,
      /need\s+(.+?)(?=[,.]|$)/gi,
      /require\s+(.+?)(?=[,.]|$)/gi,
      /expected\s+(.+?)(?=[,.]|$)/gi,
    ];
    for (const pattern of acPatterns) {
      let match;
      while ((match = pattern.exec(input)) !== null) {
        acceptanceCriteria.push(match[1].trim());
      }
    }

    // Scope: extract scope indicators
    const scopeMatch = input.match(/scope[:\s]+(.+?)(?=[,.]|$)/i);
    const scope = scopeMatch ? scopeMatch[1].trim() : 'full';

    return { primary, subGoals, type, acceptanceCriteria, scope };
  }
}
