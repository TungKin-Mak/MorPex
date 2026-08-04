/**
 * ContextPersistence taskRef 召回测试（功能③ 身份 ID 贯穿：抽离带 ID → 按 ID 检索）
 *
 * 覆盖：
 *   - save 携带 taskRef（存入 session_data）
 *   - loadByTaskRef 按任务归属精确检索（身份 ID 主键召回）
 *   - 不匹配的 taskRef 检索不到（同会话多任务可分）
 */
import { describe, it, expect } from 'vitest';
import { ContextPersistence } from '../src/knowledge/context/ContextPersistence.js';

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS context_snapshots (
    context_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    mission_id TEXT NOT NULL,
    schema_version TEXT NOT NULL DEFAULT '1.0',
    base_data TEXT NOT NULL DEFAULT '{}',
    session_data TEXT NOT NULL DEFAULT '{}',
    ephemeral_data TEXT NOT NULL DEFAULT '{}',
    fragments_json TEXT NOT NULL DEFAULT '[]',
    change_description TEXT,
    assembled_at INTEGER NOT NULL,
    PRIMARY KEY (context_id, version)
  );
`;

function makeCtx(contextId: string, missionId: string) {
  return {
    contextId,
    version: 1,
    missionId,
    schemaVersion: '1.0',
    layers: { base: {}, session: {}, ephemeral: {} },
    fragments: [],
    assembledAt: Date.now(),
  };
}

describe('ContextPersistence taskRef 召回（功能③ 身份 ID 主键）', () => {
  it('save 带 taskRef → loadByTaskRef 精确检索；不匹配检索不到', async () => {
    const dbMod = await import('better-sqlite3');
    const Database = (dbMod as any).default ?? dbMod;
    const db = new Database(':memory:');
    db.exec(CREATE_TABLE_SQL);
    const persistence = new ContextPersistence(db);

    // 任务 B 的快照（带 taskRef='taskB'）
    persistence.save(makeCtx('ctxB', 'm1') as any, 'archived taskB', 'taskB');
    // 任务 A 的快照（带 taskRef='taskA'）
    persistence.save(makeCtx('ctxA', 'm1') as any, 'archived taskA', 'taskA');

    // 按 taskRef 精确召回（同会话多任务可分）
    const b = persistence.loadByTaskRef('taskB');
    expect(b.length).toBe(1);
    expect(b[0].contextId).toBe('ctxB');

    const a = persistence.loadByTaskRef('taskA');
    expect(a.length).toBe(1);
    expect(a[0].contextId).toBe('ctxA');

    // 不存在的任务检索不到
    expect(persistence.loadByTaskRef('taskC').length).toBe(0);
  });

  it('save 不带 taskRef → loadByTaskRef 检索不到该快照', async () => {
    const dbMod = await import('better-sqlite3');
    const Database = (dbMod as any).default ?? dbMod;
    const db = new Database(':memory:');
    db.exec(CREATE_TABLE_SQL);
    const persistence = new ContextPersistence(db);

    persistence.save(makeCtx('ctxNoRef', 'm1') as any, 'no task ref');

    expect(persistence.loadByTaskRef('taskB').length).toBe(0);
  });
});

describe('ContextPersistence loadRecent（近期摘要消费端数据源）', () => {
  async function newPersistence() {
    const dbMod = await import('better-sqlite3');
    const Database = (dbMod as any).default ?? dbMod;
    const db = new Database(':memory:');
    db.exec(CREATE_TABLE_SQL);
    return new ContextPersistence(db);
  }

  it('按 assembled_at 倒序返回最近 N 条（跨任务）', async () => {
    const persistence = await newPersistence();
    const base = 1_700_000_000_000;
    // 写入 3 条不同时间戳的快照（旧→新写入，验证排序不依赖写入顺序）
    persistence.save({ ...makeCtx('ctx_old', 'm_old'), assembledAt: base } as any);
    persistence.save({ ...makeCtx('ctx_new', 'm_new'), assembledAt: base + 5000 } as any);
    persistence.save({ ...makeCtx('ctx_mid', 'm_mid'), assembledAt: base + 2000 } as any);

    const recent = persistence.loadRecent(2);
    expect(recent.length).toBe(2);
    expect(recent[0].contextId).toBe('ctx_new'); // 最新在前
    expect(recent[1].contextId).toBe('ctx_mid');
  });

  it('limit 非法（0/负数/NaN）→ 空数组（不抛）', async () => {
    const persistence = await newPersistence();
    persistence.save(makeCtx('ctx_a', 'm_a') as any);

    expect(persistence.loadRecent(0).length).toBe(0);
    expect(persistence.loadRecent(-1).length).toBe(0);
    expect(persistence.loadRecent(Number.NaN).length).toBe(0);
  });

  it('无快照 → 空数组', async () => {
    const persistence = await newPersistence();
    expect(persistence.loadRecent(5).length).toBe(0);
  });
});
