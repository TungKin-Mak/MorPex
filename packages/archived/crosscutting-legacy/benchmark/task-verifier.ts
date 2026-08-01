/**
 * TaskVerifier — Golden Benchmark 验证引擎
 *
 * 对照每个任务的 verification checkpoints（答案标准），
 * 验证执行产出的质量和正确性。
 *
 * 类似 GAIA 的 ground-truth 匹配、SWE-bench 的测试套件、
 * Inspect AI 的 scorer 体系。
 *
 * 验证流程:
 *   1. 接收执行结果（RunResult）
 *   2. 遍历任务的 checkpoints
 *   3. 按 checkpoint type 调用对应验证器
 *   4. 汇总加权得分 → VerificationScore
 */

import type { GoldenTask, VerificationCheckpoint } from './golden-tasks.js';

// ── 验证结果类型 ──

export interface CheckpointResult {
  /** 对应的检查点 */
  checkpoint: VerificationCheckpoint;
  /** 是否通过 */
  passed: boolean;
  /** 通过比例 0-1（对于多关键词匹配） */
  score: number;
  /** 匹配详情 */
  details: {
    matched: string[];
    missing: string[];
  };
}

export interface VerificationScore {
  /** 加权总分 0-100 */
  total: number;
  /** 每个检查点的结果 */
  checkpoints: CheckpointResult[];
  /** 通过率 (通过的检查点 / 总检查点) */
  passRate: number;
}

// ── 执行结果上下文（benchmark 传入） ──

export interface ExecutionContext {
  /** 执行是否成功（未抛异常） */
  ok: boolean;
  /** 产出 artifacts */
  artifacts: Array<{
    type: string;
    status: string;
    /** 产物内容（如有） */
    content?: string;
    metadata?: Record<string, unknown>;
  }>;
  /** 执行过程中使用的能力 */
  capabilitiesUsed: string[];
  /** 执行错误 */
  errors: string[];
}

// ═══════════════════════════════════════════════════════════════
// 验证器实现
// ═══════════════════════════════════════════════════════════════

export class TaskVerifier {
  /**
   * 对单个任务执行验证
   *
   * @param task   - GoldenTask（含 verification checkpoints）
   * @param result - 执行结果上下文
   * @returns VerificationScore
   */
  verify(task: GoldenTask, result: ExecutionContext): VerificationScore {
    const checkpoints: CheckpointResult[] = [];

    for (const cp of task.verification.checkpoints) {
      const cr = this.runCheckpoint(cp, result);
      checkpoints.push(cr);
    }

    const totalWeight = checkpoints.reduce((s, c) => s + c.checkpoint.weight, 0);
    const weightedSum = checkpoints.reduce(
      (s, c) => s + c.score * c.checkpoint.weight,
      0,
    );

    const total = totalWeight > 0
      ? Math.round((weightedSum / totalWeight) * 100)
      : 0;

    const passedCount = checkpoints.filter(c => c.passed).length;
    const passRate = checkpoints.length > 0
      ? passedCount / checkpoints.length
      : 0;

    return { total, checkpoints, passRate };
  }

  /**
   * 执行单个检查点
   */
  private runCheckpoint(
    cp: VerificationCheckpoint,
    result: ExecutionContext,
  ): CheckpointResult {
    switch (cp.type) {
      case 'artifact':
        return this.verifyArtifact(cp, result);
      case 'capability':
        return this.verifyCapability(cp, result);
      case 'keyword':
        return this.verifyKeyword(cp, result);
      case 'function':
        return this.verifyFunction(cp, result);
      default:
        return {
          checkpoint: cp,
          passed: false,
          score: 0,
          details: { matched: [], missing: [`Unknown checkpoint type: ${(cp as any).type}`] },
        };
    }
  }

  /**
   * Artifact 验证 — 检查产出物类型是否匹配预期
   */
  private verifyArtifact(
    cp: VerificationCheckpoint,
    result: ExecutionContext,
  ): CheckpointResult {
    const expectedTypes = (cp.params as { artifactTypes: string[] }).artifactTypes || [];
    const minMatch = (cp.params as { minMatch?: number }).minMatch ?? 1;
    const producedTypes = result.artifacts.map(a => a.type.toLowerCase());

    const matched = expectedTypes.filter(t => producedTypes.includes(t.toLowerCase()));
    const missing = expectedTypes.filter(t => !producedTypes.includes(t.toLowerCase()));

    const score = expectedTypes.length > 0
      ? matched.length / expectedTypes.length
      : 0;

    return {
      checkpoint: cp,
      passed: matched.length >= minMatch,
      score: Math.min(1, score),
      details: { matched, missing },
    };
  }

  /**
   * Capability 验证 — 检查是否使用了预期能力
   */
  private verifyCapability(
    cp: VerificationCheckpoint,
    result: ExecutionContext,
  ): CheckpointResult {
    const expectedCaps = (cp.params as { capabilities: string[] }).capabilities || [];
    const minMatch = (cp.params as { minMatch?: number }).minMatch ?? 1;
    const usedCaps = result.capabilitiesUsed.map(c => c.toLowerCase());

    const matched = expectedCaps.filter(c => usedCaps.includes(c.toLowerCase()));
    const missing = expectedCaps.filter(c => !usedCaps.includes(c.toLowerCase()));

    const score = expectedCaps.length > 0
      ? matched.length / expectedCaps.length
      : 0;

    return {
      checkpoint: cp,
      passed: matched.length >= minMatch,
      score: Math.min(1, score),
      details: { matched, missing },
    };
  }

  /**
   * Keyword 验证 — 检查产出物内容中是否包含关键词
   *
   * 验证范围:
   *   1. artifact metadata.output（执行输出文本）
   *   2. artifact content（如果有）
   *   3. artifact type/name 等字段
   */
  private verifyKeyword(
    cp: VerificationCheckpoint,
    result: ExecutionContext,
  ): CheckpointResult {
    const keywords = (cp.params as { keywords: string[] }).keywords || [];
    const minMatch = (cp.params as { minMatch?: number }).minMatch ?? keywords.length;

    // 收集所有可搜索文本
    const searchText = this.collectSearchText(result).toLowerCase();

    const matched = keywords.filter(kw => searchText.includes(kw.toLowerCase()));
    const missing = keywords.filter(kw => !searchText.includes(kw.toLowerCase()));

    const score = keywords.length > 0
      ? matched.length / keywords.length
      : 0;

    return {
      checkpoint: cp,
      passed: matched.length >= minMatch,
      score: Math.min(1, score),
      details: { matched, missing },
    };
  }

  /**
   * Function 验证 — 检查代码产出中是否包含特定函数/类/API
   */
  private verifyFunction(
    cp: VerificationCheckpoint,
    result: ExecutionContext,
  ): CheckpointResult {
    const functions = (cp.params as { functions: string[] }).functions || [];
    const minMatch = (cp.params as { minMatch?: number }).minMatch ?? functions.length;

    const searchText = this.collectSearchText(result);

    const matched = functions.filter(fn => {
      const pattern = new RegExp(
        `\\b${fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
        'i',
      );
      return pattern.test(searchText);
    });
    const missing = functions.filter(fn => !matched.includes(fn));

    const score = functions.length > 0
      ? matched.length / functions.length
      : 0;

    return {
      checkpoint: cp,
      passed: matched.length >= minMatch,
      score: Math.min(1, score),
      details: { matched, missing },
    };
  }

  /**
   * 从执行结果中收集所有可搜索文本
   */
  private collectSearchText(result: ExecutionContext): string {
    const parts: string[] = [];

    for (const art of result.artifacts) {
      // metadata.output（执行引擎的输出文本）
      if (art.metadata?.output) {
        parts.push(String(art.metadata.output));
      }
      // 直接 content
      if (art.content) {
        parts.push(art.content);
      }
      // type 和 status
      parts.push(art.type);
      parts.push(art.status);
      // metadata 中其他字符串字段
      if (art.metadata) {
        for (const [, v] of Object.entries(art.metadata)) {
          if (typeof v === 'string') parts.push(v);
        }
      }
    }

    // 错误信息也纳入搜索（部分成功场景的错误包含关键信息）
    for (const err of result.errors) {
      parts.push(err);
    }

    return parts.join('\n');
  }
}
