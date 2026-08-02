/**
 * EventStore 事件存储测试（L8 Infrastructure/protocol/events）— 此前零覆盖（171 stmt / 0%）
 *
 * 覆盖：append/appendMany 索引（executionId/type/timeRange）+ 决策事件流与统计
 *       + replay/replayAll 投影 + persist/load 持久化往返 + maxInMemory 裁剪
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventStore } from '../src/infrastructure/protocol/events/store/EventStore.js';
import type { BaseEvent } from '../src/infrastructure/protocol/events/BaseEvent.js';
import { EventType } from '../src/infrastructure/protocol/events/EventType.js';

const TMP = path.join(os.tmpdir(), `morpex-eventstore-${Date.now()}`);

function ev(id: string, type: string, executionId: string, n = 1, ts = Date.now()): BaseEvent {
  return { id, type, timestamp: ts, executionId, source: 'test', payload: { n } } as BaseEvent;
}

afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('EventStore — 追加与索引', () => {
  it('append → getStream/getByExecutionId/getByType', async () => {
    const s = new EventStore({ dataDir: path.join(TMP, 'a') });
    await s.append(ev('e1', EventType.ARTIFACT_CREATED, 'exe1'));
    await s.append(ev('e2', EventType.MISSION_CREATED, 'exe1'));
    await s.append(ev('e3', EventType.MISSION_CREATED, 'exe2'));
    expect(s.getStream()).toHaveLength(3);
    expect(s.getByExecutionId('exe1')).toHaveLength(2);
    expect(s.getByType(EventType.MISSION_CREATED)).toHaveLength(2);
    expect(s.getByExecutionId('missing')).toHaveLength(0);
  });

  it('appendMany 批量追加', async () => {
    const s = new EventStore({ dataDir: path.join(TMP, 'b') });
    await s.appendMany([ev('m1', 't1', 'x'), ev('m2', 't2', 'x')]);
    expect(s.getStream()).toHaveLength(2);
  });

  it('getByTimeRange 时间窗口过滤', async () => {
    const s = new EventStore({ dataDir: path.join(TMP, 'c') });
    const t0 = Date.now();
    await s.append(ev('r1', 't', 'x', 1, t0 - 10000));
    await s.append(ev('r2', 't', 'x', 1, t0));
    await s.append(ev('r3', 't', 'x', 1, t0 + 10000));
    expect(s.getByTimeRange(t0 - 5000, t0 + 5000)).toHaveLength(1);
  });
});

describe('EventStore — 决策事件流', () => {
  it('appendDecision → 决策流/按执行查询/统计', async () => {
    const s = new EventStore({ dataDir: path.join(TMP, 'd') });
    await s.appendDecision({ id: 'd1', type: 'decision.recorded', timestamp: Date.now(), executionId: 'exe_d', source: 'twin', confidence: 0.9, payload: { action: 'approve' } } as any);
    await s.appendDecision({ id: 'd2', type: 'decision.recorded', timestamp: Date.now(), executionId: 'exe_d', source: 'twin', confidence: 0.7, payload: { action: 'reject' } } as any);
    expect(s.getDecisionStream()).toHaveLength(2);
    expect(s.getDecisionsByExecution('exe_d')).toHaveLength(2);
    const stats = s.getDecisionStats();
    expect(stats.totalDecisions).toBe(2);
    expect(stats.uniqueExecutions).toBe(1);
    expect(stats.avgConfidence).toBeCloseTo(0.8, 1);
  });
});

describe('EventStore — 回放与持久化', () => {
  it('replay 按 executionId 投影 + replayAll 全量投影', async () => {
    const s = new EventStore({ dataDir: path.join(TMP, 'e') });
    await s.append(ev('p1', 'count', 'exe1', 1));
    await s.append(ev('p2', 'count', 'exe1', 2));
    await s.append(ev('p3', 'count', 'exe2', 3));
    const sum = await s.replay('exe1', (acc, e) => acc + (e.payload?.n ?? 0), 0);
    expect(sum).toBe(3); // exe1: 1+2
    const all = await s.replayAll((acc, e) => acc + (e.payload?.n ?? 0), 0);
    expect(all).toBe(6); // 1+2+3
  });

  it('persist → load 持久化往返恢复全部事件', async () => {
    const dir = path.join(TMP, 'f');
    const s1 = new EventStore({ dataDir: dir });
    await s1.append(ev('persist_1', 't1', 'exe_p'));
    await s1.append(ev('persist_2', 't2', 'exe_p'));
    await s1.persist();

    const s2 = new EventStore({ dataDir: dir });
    await s2.load();
    expect(s2.getStream()).toHaveLength(2);
    expect(s2.getByExecutionId('exe_p')).toHaveLength(2);
  }, 15000);

  it('maxInMemory 裁剪超限事件', async () => {
    const s = new EventStore({ dataDir: path.join(TMP, 'g'), maxInMemory: 3 });
    for (let i = 0; i < 5; i++) await s.append(ev(`cap_${i}`, 't', 'exe_cap'));
    expect(s.getStream().length).toBeLessThanOrEqual(3);
  });
});
