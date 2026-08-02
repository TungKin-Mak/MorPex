/**
 * gate/rules KeywordDetector 测试 — 通用两级模型·第一级（关键词确定性扫名）
 *
 * 验证：命中/不命中/大小写/整个输出/多关键词任一/无 keywords 安全/多行业通用。
 * 注意：第一级只标记"关键词出现"（violation.keyword），是否违规由管道层
 * 第二级 LLM 语义判断决定——本文件只测纯函数第一级，不涉及 LLM。
 */
import { describe, it, expect } from 'vitest';
import { KeywordDetector } from '../../../src/gate/rules/detectors.js';
import type { RuleEntity } from '../../../src/gate/rules/types.js';

function makeKeywordRule(id: string, keywords: string[], severity: 'ERROR' | 'WARNING' = 'ERROR'): RuleEntity {
  return {
    id,
    tier: 'tier-1',
    domain: 'test',
    severity,
    ruleType: 'keyword',
    target: 'proposal.payload',
    keywords,
    priority: 100,
    status: 'active',
    source: 'manual',
    description: '语义要求（第二级 LLM 按此判定）',
  };
}

function proposalOf(text: string): { referenced_object_ids: string[]; proposal: { content: string } } {
  return { referenced_object_ids: [], proposal: { content: text } };
}

describe('KeywordDetector（第一级扫名）', () => {
  it('输出包含关键词 → 命中并记录 keyword', () => {
    const v = KeywordDetector.check(
      proposalOf('isr_interrupt 必须关中断后操作'),
      makeKeywordRule('r1', ['isr_interrupt']),
    );
    expect(v).not.toBeNull();
    expect(v!.keyword).toBe('isr_interrupt');
    expect(v!.severity).toBe('ERROR');
  });

  it('不包含关键词 → 不命中', () => {
    const v = KeywordDetector.check(
      proposalOf('普通文案内容'),
      makeKeywordRule('r1', ['价格']),
    );
    expect(v).toBeNull();
  });

  it('大小写不敏感（规范化后包含）', () => {
    const v = KeywordDetector.check(
      proposalOf('ISR_INTERRUPT 处理流程'),
      makeKeywordRule('r1', ['isr_interrupt']),
    );
    expect(v).not.toBeNull();
  });

  it('整个输出含说明文字也命中（不限于代码部分）', () => {
    const v = KeywordDetector.check(
      proposalOf('说明：以下实现涉及 价格 计算与展示。'),
      makeKeywordRule('r1', ['价格']),
    );
    expect(v).not.toBeNull();
  });

  it('多关键词任一命中即可', () => {
    const v = KeywordDetector.check(
      proposalOf('年化 利率 5%'),
      makeKeywordRule('r1', ['价格', '利率']),
    );
    expect(v).not.toBeNull();
    expect(v!.keyword).toBe('利率');
  });

  it('无 keywords → 不命中不抛错', () => {
    const v = KeywordDetector.check(proposalOf('任意内容'), makeKeywordRule('r1', []));
    expect(v).toBeNull();
  });

  it('多行业关键词通用（编程/电商/金融）', () => {
    expect(
      KeywordDetector.check(proposalOf('void isr_interrupt(void) {}'), makeKeywordRule('a', ['isr_interrupt'])),
    ).not.toBeNull();
    expect(
      KeywordDetector.check(proposalOf('本店 价格 全网最低'), makeKeywordRule('b', ['价格'])),
    ).not.toBeNull();
    expect(
      KeywordDetector.check(proposalOf('年化 利率 5%，无隐藏费用'), makeKeywordRule('c', ['利率'])),
    ).not.toBeNull();
  });
});
