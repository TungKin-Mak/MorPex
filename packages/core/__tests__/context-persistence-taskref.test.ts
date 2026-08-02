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
