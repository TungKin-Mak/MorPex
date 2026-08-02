/**
 * PersonalBrain 个人记忆测试（L4 Cognition/memory）— 此前零覆盖（171 stmt / 0%）
 *
 * 覆盖：working/episodic/semantic/preference 四层记忆读写 + 统一 recall/query
 *       + 条目管理（getEntry/removeEntry/getLayerSize/getStats）+ 序列化/恢复
 */
import { describe, it, expect, afterAll } from 'vitest';
import { PersonalBrain } from '../src/cognition/memory/PersonalBrain.js';
import type { MemoryLayer } from '../src/cognition/memory/types.js';

describe('PersonalBrain — 分层记忆读写', () => {
  it('rememberWorking/recallWorking/clearWorking', async () => {
    const b = new PersonalBrain();
    await b.rememberWorking('当前正在处理定价模块', { taskId: 't1' });
    const hits = b.recallWorking('定价');
    expect(hits.length).toBe(1);
    expect(hits[0].content).toContain('定价');
    expect(b.getLayerSize('working')).toBe(1);
    b.clearWorking();
    expect(b.getLayerSize('working')).toBe(0);
  });

  it('recordEpisode/recallEpisodes 情景记忆', async () => {
    const b = new PersonalBrain();
    const id = await b.recordEpisode('用户要求 899 元/月', { source: 'chat' }, ['pricing']);
    expect(id).toBeTruthy();
    const hits = b.recallEpisodes('899');
    expect(hits.length).toBe(1);
    expect(b.getEntry(id)?.tags).toContain('pricing');
  });

  it('storeFact/recallFacts 语义事实 + getPreferences 偏好', async () => {
    const b = new PersonalBrain();
    await b.storeFact('公司名 MorPex', ['brand']);
    await b.storeFact('总部在深圳', ['location']);
    const facts = b.recallFacts('MorPex');
    expect(facts.length).toBe(1);

    await b.storePreference('communication', '简洁', 0.9);
    const prefs = b.getPreferences('communication');
    expect(prefs.length).toBe(1);
  });

  it('getStats 报告各层大小', async () => {
    const b = new PersonalBrain();
    await b.rememberWorking('w');
    await b.recordEpisode('e1');
    await b.storeFact('f1');
    const stats = b.getStats();
    expect(stats.totalEntries).toBe(3);
  });
});

describe('PersonalBrain — 统一检索与条目管理', () => {
  it('recall 跨层检索（关键词匹配）', async () => {
    const b = new PersonalBrain();
    await b.rememberWorking('工作记忆：预算 10000');
    await b.recordEpisode('情景：预算审批通过');
    await b.storeFact('事实：预算上限 50000');
    const hits = b.recall('预算');
    // 三层都应命中
    expect(hits.some(h => h.layer === 'working')).toBe(true);
    expect(hits.some(h => h.layer === 'episodic')).toBe(true);
    expect(hits.some(h => h.layer === 'semantic')).toBe(true);
  });

  it('query 按 text/layers/limit 过滤', async () => {
    const b = new PersonalBrain();
    await b.recordEpisode('ep_1 关于定价');
    await b.storeFact('fact_1 关于定价');
    const r = b.query({ text: '定价', layers: ['semantic'], limit: 5 } as any);
    expect(r.entries.length).toBe(1);
    expect(r.entries[0].layer).toBe('semantic');
  });

  it('getEntry/removeEntry', async () => {
    const b = new PersonalBrain();
    const id = await b.recordEpisode('临时情景');
    expect(b.getEntry(id)?.content).toContain('临时');
    expect(b.removeEntry(id)).toBe(true);
    expect(b.getEntry(id)).toBeUndefined();
    expect(b.removeEntry(id)).toBe(false);
  });

  it('clear 清空全部 + destroy 停清理器', async () => {
    const b = new PersonalBrain();
    await b.rememberWorking('x');
    await b.recordEpisode('y');
    b.clear();
    expect(b.getStats().totalEntries).toBe(0);
    b.destroy(); // 不应抛错
  });
});

describe('PersonalBrain — 序列化与恢复', () => {
  it('toJSON/fromJSON 往返保留数据（episodic/semantic；working 层有意不持久化）', async () => {
    const b = new PersonalBrain();
    await b.recordEpisode('情景A：用户反馈');
    await b.storeFact('事实A：定价 899');
    const json = b.toJSON();
    expect(json.working).toBeUndefined(); // working 层不序列化（设计）
    const b2 = new PersonalBrain();
    b2.fromJSON(json as any);
    expect(b2.recallEpisodes('情景A')).toHaveLength(1);
    expect(b2.recallFacts('定价')).toHaveLength(1);
  });

  it('getLayerSize 未知层安全返回', () => {
    const b = new PersonalBrain();
    expect(b.getLayerSize('workflow' as MemoryLayer)).toBe(0);
  });
});

afterAll(() => { /* PersonalBrain 内存态，无外部清理 */ });
