/**
 * T6 覆盖语义集成测试：批准 correction/clarification 工单时，
 * 自动失效同主题旧条目（invalidate 登记先于引擎写入）；profile/agreement 不触发。
 * 使用 MockEngine（内存），不依赖 cognee server。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryApi } from '../src/api/MemoryApi.js';
import { MockEngine } from '../src/engines/mock/MockEngine.js';

describe('MemoryApi T6 覆盖语义', () => {
  let engine: MockEngine;
  let api: MemoryApi;

  beforeEach(() => {
    engine = new MockEngine();
    api = new MemoryApi({ engine, confirmationDbPath: ':memory:', autoWriteConfidence: 0.8 });
  });

  /** 走与生产一致的链路：低置信 upsert → pending 工单 → approve */
  async function approveOf(input: { name: string; kind?: string }, factText?: string) {
    const r = await api.upsert({ ...input, entityType: 'Rule', facts: [factText ?? input.name], confidence: 0.6 });
    if (r.status !== 'pending_confirm') throw new Error(`期望 pending_confirm，实际 ${r.status}`);
    const pending = await api.listPendingConfirmations();
    const ticket = pending.find((t) => t.ticketId === r.ticketId);
    if (!ticket) throw new Error('工单未入队');
    await api.confirm(r.ticketId, 'accept');
    return ticket;
  }

  it('correction 批准 → 同主题旧条目失效登记 + 新事实入库', async () => {
    // 第一轮：旧的启动方式入库
    await approveOf({ name: '纠错:用 pm2 启动服务', kind: 'correction' }, '旧事实：pm2 启动');
    const before = api.listInvalidations().length;

    // 第二轮：用户纠正 → 新工单批准 → 旧条目应被 invalidate
    await approveOf({ name: '纠错:用 pm2 启动服务', kind: 'correction' }, '新事实：改用 maintenance 脚本');

    const logs = api.listInvalidations();
    expect(logs.length).toBe(before + 1);
    expect(logs.at(-1)?.entityName).toContain('纠错:用 pm2 启动服务');
    // 引擎确实收到了新事实
    const hits = await engine.recall('maintenance', { limit: 5 });
    expect(hits.some((h) => String(h.content ?? '').includes('maintenance'))).toBe(true);
  });

  it('clarification 批准 → 触发同主题失效', async () => {
    await approveOf({ name: '术语:部署', kind: 'clarification' }, '旧含义：全量发布');
    const before = api.listInvalidations().length;
    await approveOf({ name: '术语:部署', kind: 'clarification' }, '新含义：前端构建+上传CDN');
    expect(api.listInvalidations().length).toBe(before + 1);
  });

  it('profile/agreement 批准 → 不触发覆盖失效', async () => {
    const before = api.listInvalidations().length;
    await approveOf({ name: '张三' });                       // 无 kind → 不触发
    await approveOf({ name: '约定:简短汇报', kind: 'agreement' }); // 约定 → 不触发
    expect(api.listInvalidations().length).toBe(before);
  });

  it('重复 approve 同一工单：幂等，不产生第二次失效/写入', async () => {
    const r = await api.upsert({
      name: '纠错:重复批准测试', entityType: 'Rule', facts: ['f'], confidence: 0.6, kind: 'correction',
    });
    if (r.status !== 'pending_confirm') throw new Error('期望 pending_confirm');
    await api.confirm(r.ticketId, 'accept');
    const invAfterFirst = api.listInvalidations().length;
    await api.confirm(r.ticketId, 'accept'); // 二次批准（网络重试场景）
    expect(api.listInvalidations().length).toBe(invAfterFirst); // 无新增
  });
});
