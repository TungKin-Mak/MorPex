/**
 * T5 memory-extractor 单元测试：parseCandidates 容错解析（不依赖 LLM/网络）
 * 配套确定性链路验证见 data/tmp-t5v/verify23.mts（upsert→工单→批准→召回）
 */
import { describe, it, expect } from 'vitest';
import { parseCandidates } from '../transcript/memory-extractor.js';

describe('memory-extractor.parseCandidates', () => {
  it('解析标准 JSON 数组', () => {
    expect(parseCandidates('[{"name":"张三","fact":"用户姓名是张三"}]')).toEqual([
      { name: '张三', fact: '用户姓名是张三' },
    ]);
  });

  it('容忍 code fence 包裹', () => {
    const raw = '```json\n[{"name":"李雷","fact":"用户喜欢美式"}]\n```';
    expect(parseCandidates(raw)).toHaveLength(1);
  });

  it('容忍前后闲聊文本（截取首个 JSON 数组）', () => {
    const raw = '好的，提取结果如下：[{"name":"李雷","fact":"用户姓名是李雷"}] 以上。';
    expect(parseCandidates(raw)).toHaveLength(1);
  });

  it('空数组/无数组/非法 JSON → 空结果（静默跳过语义）', () => {
    expect(parseCandidates('[]')).toEqual([]);
    expect(parseCandidates('我没有看到值得记的信息')).toEqual([]);
    expect(parseCandidates('[{broken]')).toEqual([]);
  });

  it('逐项校验：缺 name/fact 或类型不对的条目被丢弃，超长截断', () => {
    const raw = JSON.stringify([
      { name: 'x', fact: '' },                       // 空 fact → 丢
      { name: 123, fact: 'y' },                      // 类型错 → 丢
      { name: 'a'.repeat(50), fact: 'f'.repeat(300) }, // 截断到 40/200
      { name: '张三', fact: '用户姓名是张三' },
    ]);
    const out = parseCandidates(raw);
    expect(out).toHaveLength(2);
    expect(out[0].name.length).toBe(40);
    expect(out[0].fact.length).toBe(200);
    expect(out[1]).toEqual({ name: '张三', fact: '用户姓名是张三' });
  });

  it('最多取前 3 条候选', () => {
    const raw = JSON.stringify(
      Array.from({ length: 5 }, (_, i) => ({ name: `u${i}`, fact: `fact${i}` })),
    );
    expect(parseCandidates(raw)).toHaveLength(3);
  });
});
