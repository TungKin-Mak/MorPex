/**
 * ExperienceExtractor — 经验提取器
 *
 * 从执行记录中提取可复用的经验、模式和教训。
 */
export interface ExecutionRecord {
  executionId: string;
  goal: string;
  planId: string;
  nodes: Array<{ id: string; name: string; status: string; duration: number; error?: string }>;
  success: boolean;
  duration: number;
  errors: string[];
  startTime: number;
  endTime: number;
}

export interface Experience {
  id: string;
  goal: string;
  goalType: string;
  outcome: 'success' | 'failure' | 'partial';
  duration: number;
  patterns: string[];
  lessons: string[];
  nodeCount: number;
  errorCount: number;
  successRate: number;
  timestamp: number;
}

export class ExperienceExtractor {
  /** Phase E: 历史经验缓存（用于去重） */
  private recentExperiences: Array<{ goal: string; outcome: string; patterns: string[]; timestamp: number }> = [];
  private readonly MAX_CACHE = 50;

  /** Phase E: 检查是否与近期经验重复 */
  isDuplicate(goal: string, outcome: string, patterns: string[]): boolean {
    const patternSet = new Set(patterns);
    return this.recentExperiences.some(exp => {
      if (exp.goal !== goal || exp.outcome !== outcome) return false;
      // 至少 50% 的模式重叠才算重复
      const overlap = exp.patterns.filter(p => patternSet.has(p)).length;
      const minOverlap = Math.min(patterns.length, exp.patterns.length) * 0.5;
      return overlap >= minOverlap;
    });
  }

  /** 从执行记录中提取经验 */
  extract(record: ExecutionRecord): Experience | null {
    const patterns = this.extractPatterns(record);
    const lessons = this.extractLessons(record);

    const outcome: 'success' | 'failure' | 'partial' = record.success ? 'success' : record.errors.length > 2 ? 'failure' : 'partial';

    // Phase E: 去重检查
    if (this.isDuplicate(record.goal, outcome, patterns)) {
      return null; // 跳过重复经验
    }

    // 缓存
    this.recentExperiences.push({ goal: record.goal, outcome, patterns, timestamp: Date.now() });
    if (this.recentExperiences.length > this.MAX_CACHE) {
      this.recentExperiences.shift();
    }

    const nodeCount = record.nodes.length;
    const errorCount = record.errors.length;
    const successRate = nodeCount > 0
      ? record.nodes.filter(n => n.status === 'success').length / nodeCount
      : 0;

    return {
      id: `exp_${record.executionId}`,
      goal: record.goal,
      goalType: this.detectGoalType(record.goal),
      outcome,
      duration: record.duration,
      patterns,
      lessons,
      nodeCount,
      errorCount,
      successRate,
      timestamp: Date.now(),
    };
  }

  /** 从执行记录中提取成功模式 */
  private extractPatterns(record: ExecutionRecord): string[] {
    const patterns: string[] = [];

    // Successful node sequences
    const successfulNodes = record.nodes.filter(n => n.status === 'success');
    if (successfulNodes.length >= 2) {
      const seq = successfulNodes.slice(0, 3).map(n => n.name).join(' → ');
      patterns.push(`Successful sequence: ${seq}`);
    }

    // Fast nodes
    const fastNodes = record.nodes.filter(n => n.duration < 1000);
    if (fastNodes.length > 0) {
      patterns.push(`Fast operations: ${fastNodes.map(n => n.name).join(', ')}`);
    }

    // Goal type patterns
    const goalLower = record.goal.toLowerCase();
    if (/api|rest|endpoint/.test(goalLower)) patterns.push('Domain:API');
    if (/database|db|sql|schema/.test(goalLower)) patterns.push('Domain:Database');
    if (/ui|frontend|react|component/.test(goalLower)) patterns.push('Domain:UI');
    if (/test|testing|coverage/.test(goalLower)) patterns.push('Domain:Testing');
    if (/deploy|ci|cd|pipeline/.test(goalLower)) patterns.push('Domain:DevOps');

    return patterns;
  }

  /** 从错误中提取教训 */
  private extractLessons(record: ExecutionRecord): string[] {
    const lessons: string[] = [];

    if (record.errors.length > 0) {
      lessons.push(`Encountered ${record.errors.length} errors during "${record.goal}"`);
      const uniqueErrors = [...new Set(record.errors)];
      lessons.push(`Common errors: ${uniqueErrors.join('; ')}`);
    }

    // Duration-based lessons
    if (record.duration > 60000) {
      lessons.push(`Task took ${Math.round(record.duration / 1000)}s — consider breaking into smaller steps`);
    }

    // Success lessons
    if (record.success) {
      lessons.push(`Successful execution: ${record.nodes?.length || 0} nodes completed in ${Math.round(record.duration / 1000)}s`);
    }

    return lessons;
  }

  private detectGoalType(goal: string): string {
    const lower = goal.toLowerCase();
    if (/build|create|develop/.test(lower)) return 'build';
    if (/analyze|review|audit/.test(lower)) return 'analyze';
    if (/fix|debug|repair/.test(lower)) return 'fix';
    if (/test|validate|verify/.test(lower)) return 'test';
    if (/deploy|release|publish/.test(lower)) return 'deploy';
    return 'general';
  }
}
