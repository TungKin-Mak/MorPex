/**
 * T5 memory-extractor 单元测试：parseCandidates 容错解析（不依赖 LLM/网络）
 * 配套确定性链路验证见 data/tmp-t5v/verify23.mts（upsert→工单→批准→召回）
 */
import { describe, it, expect } from 'vitest';
import { parseCandidates, mapCandidateEntity } from '../transcript/memory-extractor.js';

describe('memory-extractor.parseCandidates', () => {
  it('解析标准 JSON 数组', () => {
    expect(parseCandidates('[{"name":"张三","fact":"用户姓名是张三"}]')).toEqual([
      { name: '张三', fact: '用户姓名是张三', type: 'profile' },
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
    expect(out[1]).toEqual({ name: '张三', fact: '用户姓名是张三', type: 'profile' });
  });

  it('最多取前 3 条候选', () => {
    const raw = JSON.stringify(
      Array.from({ length: 5 }, (_, i) => ({ name: `u${i}`, fact: `fact${i}` })),
    );
    expect(parseCandidates(raw)).toHaveLength(3);
  });
});

describe('memory-extractor.T6 分类扩展', () => {
  it('四类候选：type/trigger/term 正确解析', () => {
    const out = parseCandidates(JSON.stringify([
      { type: 'profile', name: '李雷', fact: '用户姓名是李雷' },
      { type: 'correction', name: '服务启动方式', trigger: '用 pm2 启动服务', fact: '要用 maintenance 脚本启动，pm2 会失败' },
      { type: 'clarification', name: '部署', term: '部署', fact: '用户说的部署指前端构建+上传 CDN' },
    ]));
    const agreement = parseCandidates(JSON.stringify([
      { type: 'agreement', name: '汇报风格', fact: '汇报要简短，先结论后细节' },
    ]));
    expect(out.map((c) => c.type)).toEqual(['profile', 'correction', 'clarification']);
    expect(out[1]?.trigger).toBe('用 pm2 启动服务');
    expect(out[2]?.term).toBe('部署');
    expect(agreement[0]?.type).toBe('agreement');
  });

  it('非法/缺失 type 回退 profile（向后兼容 T5 输出）', () => {
    const out = parseCandidates('[{"type":"unknown","name":"a","fact":"b"},{"name":"c","fact":"d"}]');
    expect(out.map((c) => c.type)).toEqual(['profile', 'profile']);
  });

  it('trigger/term 截断上限（80/40 字符）且非对应类型不携带', () => {
    const raw = JSON.stringify([
      { type: 'correction', name: 'x', trigger: 't'.repeat(120), fact: 'f' },
      { type: 'clarification', name: 'y', term: 'm'.repeat(60), fact: 'f' },
      { type: 'correction', name: 'z', fact: '无 trigger 字段' },
    ]);
    const out = parseCandidates(raw);
    expect(out[0]?.trigger?.length).toBe(80);
    expect(out[1]?.term?.length).toBe(40);
    expect(out[2]?.trigger).toBeUndefined();
  });

  it('mapCandidateEntity：实体名映射 + 本体类型分派', () => {
    expect(mapCandidateEntity({ name: '李雷', fact: 'f', type: 'profile' }))
      .toEqual({ name: '李雷', entityType: 'Person' });
    expect(mapCandidateEntity({ name: '启动', fact: 'f', type: 'correction', trigger: 'pm2 起服务' }))
      .toEqual({ name: '纠错:pm2 起服务', entityType: 'Rule' });
    expect(mapCandidateEntity({ name: '部署', fact: 'f', type: 'clarification', term: '部署' }))
      .toEqual({ name: '术语:部署', entityType: 'Rule' });
    expect(mapCandidateEntity({ name: '简短汇报', fact: 'f', type: 'agreement' }))
      .toEqual({ name: '约定:简短汇报', entityType: 'Rule' });
    // 缺 trigger/term 的兑底：退回原 name 前缀标记
    expect(mapCandidateEntity({ name: '神秘纠错', fact: 'f', type: 'correction' }).name)
      .toBe('纠错:神秘纠错');
  });
});
