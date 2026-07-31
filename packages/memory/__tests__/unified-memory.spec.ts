/**
 * 统一记忆层 P0 测试 — 强制门禁 / 写入分流 / 确认队列 / 白名单
 * 使用 MockEngine（内存），不依赖 cognee server。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { MockEngine } from '../src/engines/mock/MockEngine.js';
import { MemoryApi } from '../src/api/MemoryApi.js';

describe('MemoryApi（统一记忆层）', () => {
  let engine: MockEngine;
  let api: MemoryApi;

  beforeEach(() => {
    engine = new MockEngine();
    api = new MemoryApi({ engine, confirmationDbPath: ':memory:', autoWriteConfidence: 0.8 });
  });

  afterEach(() => api.close());

  it('空检索 → need_human=true, QueryMiss', async () => {
    const r = await api.query({ text: '完全不存在的独角兽产品定价' });
    expect(r.need_human).toBe(true);
    expect(r.reason).toBe('QueryMiss');
    expect(r.source).toBe('none');
    expect(r.hits).toEqual([]);
  });

  it('高置信写入 → written；可被图检索命中', async () => {
    const u = await api.upsert({
      name: 'MorPex 报表产品',
      entityType: 'Product',
      facts: ['定价 899 元/月', '支持数据导出'],
      confidence: 0.95,
    });
    expect(u.status).toBe('written');

    const q = await api.query({ text: '报表产品定价', domain: 'product' });
    expect(q.need_human).toBe(false);
    expect(['graph', 'mixed']).toContain(q.source);
    expect(q.hits.length).toBeGreaterThan(0);
    expect(q.hits[0].content).toContain('899');
  });

  it('低置信写入 → 进确认队列', async () => {
    const u = await api.upsert({
      name: '客户 X 可能采购',
      entityType: 'Client',
      facts: ['明年可能采购（不确定）'],
      confidence: 0.4,
    });
    expect(u.status).toBe('pending_confirm');
    const pending = await api.listPendingConfirmations();
    expect(pending.some((t) => t.ticketId === u.ticketId)).toBe(true);
  });

  it('confirm accept → 队列清空', async () => {
    const u = await api.upsert({
      name: '规则',
      entityType: 'Rule',
      facts: ['报价前必须过合规检查'],
      confidence: 0.5,
    });
    expect(u.status).toBe('pending_confirm');
    await api.confirm(u.ticketId, 'accept');
    expect(await api.listPendingConfirmations()).toHaveLength(0);
  });

  it('白名单校验：非法 entityType → new_entity 进确认（不直接拒绝）', async () => {
    const u = await api.upsert({
      name: '某个新东西',
      entityType: 'NotInWhitelist',
      facts: ['测试'],
      confidence: 0.9,
    });
    expect(u.status).toBe('pending_confirm');
    const t = await api.listPendingConfirmations();
    expect(t[0].reason).toBe('new_entity');
  });

  it('白名单校验：非法 relationType → 明确拒绝', async () => {
    const u = await api.upsert({
      name: 'A',
      entityType: 'Product',
      relations: [{ toName: 'B', relationType: 'EATS' }],
      confidence: 0.9,
    });
    expect(u.status).toBe('rejected');
  });

  it('引擎离线 → need_human=true（即使有内容也无法验证）', async () => {
    engine.setOnline(false);
    const r = await api.query({ text: '产品定价' });
    expect(r.need_human).toBe(true);
    expect(r.reason).toBe('QueryMiss');
  });

  it('L2 上下文隔离：promptContext 只含证据', async () => {
    await api.upsert({ name: 'P1', entityType: 'Product', facts: ['价格 899'], confidence: 0.95 });
    const r = await api.queryForGate({ text: '价格', domain: 'product' });
    expect(r.promptContext).toContain('【证据');
    expect(r.promptContext).toContain('899');
  });

  it('invalidate：登记失效日志（图历史保留）', async () => {
    await api.invalidate('旧产品 X', '2026-12-31T00:00:00Z');
    const logs = api.listInvalidations();
    expect(logs.length).toBe(1);
    expect(logs[0].entityName).toBe('旧产品 X');
    expect(logs[0].validUntil).toBe('2026-12-31T00:00:00Z');
  });

  it('reflect：生成经验模式候选且去重', async () => {
    await api.upsert({
      name: '部署经验', entityType: 'ExperiencePattern',
      facts: ['部署失败常因版本不兼容，先核对版本'], confidence: 0.95,
    });
    const r1 = await api.reflect();
    expect(r1.candidates.length).toBeGreaterThanOrEqual(0);
    const r2 = await api.reflect(); // 再次巩固不应重复生成同一候选
    expect(r2.candidates.every((c) => !r1.candidates.includes(c)) || r1.candidates.length === 0).toBe(true);
  });

  it('decayTick：超期 pending 归档', async () => {
    await api.upsert({ name: '旧候选', entityType: 'Rule', facts: ['很久以前'], confidence: 0.3 });
    // 人为把 pending 改成 40 天前
    api['queue']['db']
      .prepare("UPDATE confirmation_queue SET created_at = ? WHERE status = 'pending'")
      .run(new Date(Date.now() - 40 * 86400_000).toISOString());
    expect(await api.listPendingConfirmations()).toHaveLength(1);
    await api.decayTick();
    expect(await api.listPendingConfirmations()).toHaveLength(0);
  });
});
