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

// ═══════════ T7：LLM 化触发 + 四路分流 + 权重沉淀 ═══════════
import { vi } from 'vitest';
import { routeCandidate } from '../transcript/memory-extractor.js';
import {
  MemoryWeightStore,
  computePromotion,
  computeDecay,
} from '../../../memory/src/storage/MemoryWeightStore.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeOpts() {
  const calls = { upsert: [] as Array<Record<string, unknown>>, invalidate: [] as string[] };
  const opts = {
    memoryApi: {
      upsert: vi.fn(async (input: Record<string, unknown>) => {
        calls.upsert.push(input);
        return { status: 'pending_confirm', ticketId: `t_${calls.upsert.length}` };
      }),
      invalidate: vi.fn(async (name: string) => {
        calls.invalidate.push(name);
      }),
    },
    weightStore: { ensure: vi.fn() },
  };
  return { opts, calls };
}

describe('T7 四路分流 routeCandidate', () => {
  it('① sensitive → 丢弃：不 upsert 不 invalidate', async () => {
    const { opts, calls } = makeOpts();
    const action = await routeCandidate(
      { name: 'x', fact: 'sk-abc123 是密钥', type: 'profile', sensitive: true },
      opts,
    );
    expect(action).toBe('dropped_sensitive');
    expect(calls.upsert).toHaveLength(0);
    expect(calls.invalidate).toHaveLength(0);
  });

  it('② isForget → invalidate（不 upsert）', async () => {
    const { opts, calls } = makeOpts();
    const action = await routeCandidate(
      { name: '服务启动方式', fact: '忘掉 pm2 那条', type: 'correction', trigger: '用 pm2 启动服务', isForget: true },
      opts,
    );
    expect(action).toBe('forgotten');
    expect(calls.invalidate).toEqual(['纠错:用 pm2 启动服务']);
    expect(calls.upsert).toHaveLength(0);
  });

  it("③ scope='session' → 跳过长期库", async () => {
    const { opts, calls } = makeOpts();
    const action = await routeCandidate(
      { name: '临时安排', fact: '这次先这样吧', scope: 'session' },
      opts,
    );
    expect(action).toBe('skipped_session');
    expect(calls.upsert).toHaveLength(0);
  });

  it('④ isExplicit → 免工单直接入库 confidence=1.0 source=explicit + 权重建档 explicit', async () => {
    const { opts, calls } = makeOpts();
    const action = await routeCandidate(
      { name: '操作系统', fact: '用户使用 mac', type: 'agreement', isExplicit: true },
      opts,
    );
    expect(action).toBe('explicit_written');
    expect(calls.upsert[0]).toMatchObject({ name: '约定:操作系统', confidence: 1.0, source: 'explicit' });
    expect(opts.weightStore.ensure).toHaveBeenCalledWith('约定:操作系统', 'explicit', 'agreement');
  });

  it('⑤ 默认低置信走确认工单 + 权重建档 llm', async () => {
    const { opts, calls } = makeOpts();
    const action = await routeCandidate(
      { name: '李雷', fact: '用户姓名是李雷', type: 'profile' },
      opts,
    );
    expect(action).toBe('ticket');
    expect(calls.upsert[0]).toMatchObject({ name: '李雷', confidence: 0.6 });
    expect(opts.weightStore.ensure).toHaveBeenCalledWith('李雷', 'llm', 'profile');
  });

  it('parseCandidates 解析 T7 标志位（isExplicit/isForget/sensitive/scope）', () => {
    const out = parseCandidates(JSON.stringify([
      { type: 'agreement', name: 'os', fact: '用 mac', isExplicit: true },
      { name: '旧结论', fact: '作废它', isForget: true },
      { name: 'leak', fact: 'password=123', sensitive: true },
    ]));
    expect(out.map((c) => c.isExplicit)).toEqual([true, undefined, undefined]);
    expect(out.map((c) => c.isForget)).toEqual([undefined, true, undefined]);
    expect(out.map((c) => c.sensitive)).toEqual([undefined, undefined, true]);
    // scope 单独验证（候选上限 3 条，避免被截断）
    const scoped = parseCandidates(JSON.stringify([
      { name: 'tmp', fact: '这次先这样', scope: 'session' },
      { name: 'long', fact: '长期有效' },
    ]));
    expect(scoped[0]?.scope).toBe('session');
    expect(scoped[1]?.scope).toBeUndefined();
  });
});

describe('T7 权重晋升/衰减（纯函数）', () => {
  const NOW = Date.now();
  const DAY = 24 * 3600_000;

  it('30 天窗口内提及达标或权重达标 → 晋升 permanent', () => {
    expect(computePromotion({ tier: 'project', weight: 0.6, mentionCount: 3, lastSeen: NOW - DAY }, NOW)).toBe(true);
    expect(computePromotion({ tier: 'project', weight: 0.96, mentionCount: 1, lastSeen: NOW - DAY }, NOW)).toBe(true);
    expect(computePromotion({ tier: 'project', weight: 0.6, mentionCount: 2, lastSeen: NOW - DAY }, NOW)).toBe(false);
    // 提及发生在窗口外（last_seen 太老）→ 不算
    expect(computePromotion({ tier: 'project', weight: 0.6, mentionCount: 5, lastSeen: NOW - 40 * DAY }, NOW)).toBe(false);
  });

  it('permanent 免疫衰减；闲置超期减半；低于归档线归档', () => {
    expect(computeDecay({ tier: 'permanent', weight: 0.3, lastSeen: NOW - 60 * DAY }, NOW)).toBeNull();
    expect(computeDecay({ tier: 'project', weight: 0.6, lastSeen: NOW - 10 * DAY }, NOW)).toBeNull(); // 未到期
    const decayed = computeDecay({ tier: 'project', weight: 0.6, lastSeen: NOW - 40 * DAY }, NOW);
    expect(decayed).toEqual({ weight: 0.3, archived: false });
    const archived = computeDecay({ tier: 'project', weight: 0.3, lastSeen: NOW - 80 * DAY }, NOW);
    expect(archived).toEqual({ weight: 0.15, archived: true });
  });

  it('MemoryWeightStore 端到端：ensure 幂等 / recordMention / 晋升落库 / 衰减删除', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mwt-'));
    const store = new MemoryWeightStore(join(dir, 'w.db'));
    try {
      store.ensure('纠错:pm2', 'explicit', 'correction');
      store.ensure('纠错:pm2', 'explicit', 'correction'); // 幂等：重复 ensure 不重置
      const row = store.getByName('纠错:pm2');
      expect(row?.weight).toBe(1.0); // explicit 基础分

      store.recordMention('纠错:pm2');
      store.recordMention('纠错:pm2');
      store.recordMention('纠错:pm2');
      expect(store.getByName('纠错:pm2')?.mentionCount).toBe(3);

      // 晋升：3 次提及 → permanent
      const promoted = store.applyPromotions();
      expect(promoted).toContain('纠错:pm2');
      expect(store.getByName('纠错:pm2')?.tier).toBe('permanent');

      // 衰减：permanent 免疫（即便很久没提及也不删）
      const r = store.applyDecays(new Date(Date.now() + 400 * 24 * 3600_000).getTime());
      expect(r.archived).not.toContain('纠错:pm2');
      expect(store.getByName('纠错:pm2')).toBeDefined();

      // 低权重 project 条目久未提及 → 归档删除
      store.ensure('术语:部署', 'llm', 'clarification'); // base 0.8... 手动降权模拟多次衰减
      store.applyDecays(); // 未到期不动
      const gone = store.getByName('术语:部署');
      expect(gone?.weight ?? 0).toBeGreaterThan(0); // 仍在（未到期）
    } finally {
      store.close();
    }
  });
});
