/**
 * FeedbackService — Ontology 反馈服务
 *
 * 迭代3：将用户/评估反馈写入 Ontology
 *   - submit：创建 Feedback 对象 + corrects 关系
 *   - listTestCases：列出标记为测试用例的反馈
 */

import type { OntologyService } from './OntologyService.js';
import type { OntologyObject } from './types.js';

export interface FeedbackInput {
  /** 被反馈的目标 ID（Artifact / Proposal / Mission） */
  targetId: string;
  /** 评分：'up' | 'down' | 0-1 数值 */
  rating: 'up' | 'down' | number;
  /** 期望的正确输出（用于纠正） */
  expected?: string;
  /** 评论文本 */
  comment?: string;
  /** 来源：human | evaluation | agent */
  source?: string;
  /** 是否标记为测试用例（默认 rating=down 自动标记） */
  markAsTestCase?: boolean;
}

export class FeedbackService {
  constructor(private readonly ontology: OntologyService) {}

  /**
   * submit — 提交一条反馈
   *
   * 1. 创建 Feedback 类型 Ontology 对象
   * 2. 建立 corrects 关系到目标对象
   * 3. 自动标记 isTestCase（如果 rating=down）
   *
   * @returns 创建的 Ontology 对象
   */
  async submit(input: FeedbackInput): Promise<OntologyObject> {
    const id = `feedback_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const ratingValue =
      typeof input.rating === 'number'
        ? input.rating
        : input.rating === 'up'
          ? 1
          : 0;
    const isTestCase =
      input.markAsTestCase ?? (ratingValue === 0 || ratingValue < 0.5);

    const obj = await this.ontology.upsertObject({
      id,
      type: 'Feedback',
      status: 'recorded',
      properties: {
        targetId: input.targetId,
        rating: ratingValue,
        ratingLabel: typeof input.rating === 'string' ? input.rating : String(ratingValue),
        expected: input.expected,
        comment: input.comment,
        source: input.source ?? 'human',
        isTestCase,
      },
    });

    // 建立 corrects 关系
    await this.ontology.ensureRelation(id, input.targetId, 'corrects', {
      rating: ratingValue,
      source: input.source ?? 'human',
    });

    console.log(
      `[FeedbackService] ✅ 反馈已记录: ${id} → ${input.targetId} (rating=${ratingValue})`,
    );
    return obj;
  }

  /**
   * listTestCases — 列出标记为测试用例的反馈
   *
   * 用于 Evolution / MetaLearner 消费：分析失败模式、生成改进提案。
   *
   * @param limit - 最大条数
   * @returns Ontology 对象列表
   */
  async listTestCases(limit = 50): Promise<OntologyObject[]> {
    const facts = await this.ontology.queryObjects({
      type: 'Feedback',
      properties: { isTestCase: true },
      limit,
    });
    return facts.map((f) => f.object);
  }

  /**
   * listByTarget — 列出针对某目标的所有反馈
   */
  async listByTarget(targetId: string): Promise<OntologyObject[]> {
    const facts = await this.ontology.queryObjects({
      type: 'Feedback',
      properties: { targetId },
    });
    return facts.map((f) => f.object);
  }

  /**
   * getStats — 获取反馈统计
   */
  async getStats(): Promise<{
    total: number;
    up: number;
    down: number;
    testCases: number;
  }> {
    const allFacts = await this.ontology.queryObjects({ type: 'Feedback' });
    const all = allFacts.map((f) => f.object);
    const testCases = all.filter(
      (o) => o.properties.isTestCase === true,
    );
    const up = all.filter(
      (o) => Number(o.properties.rating ?? 0) >= 0.5,
    );
    const down = all.filter(
      (o) => Number(o.properties.rating ?? 0) < 0.5,
    );
    return {
      total: all.length,
      up: up.length,
      down: down.length,
      testCases: testCases.length,
    };
  }
}
