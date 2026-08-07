#!/usr/bin/env node
/**
 * compact-entity-events.cjs — 一次性数据治理脚本（会话 16l P0-1）
 *
 * 清理 system.entity.registered 重复事件：每 entityId 只保留最新一条（sequence 最大）。
 * restoreFromEvents 语义是「最新覆盖」，中间重复事件对状态恢复零价值
 * （实测 44,377 条 → 唯一 3,900，重复率 91%；删后 restore 结果不变）。
 *
 * 为什么不用 CompactionService：它的 30 天保留会误删活跃实体注册事件；
 * 本脚本按「同 key 去重」而非「按时间」，保留每个实体的最新状态快照。
 *
 * 用法：node scripts/compact-entity-events.cjs [--db=<path>] [--vacuum]
 * 注意：会直接改写数据库（建议先备份）。
 */
const Database = require('better-sqlite3');
const path = require('node:path');

// 支持 --db 指定数据库路径（默认生产库）
const dbArg = process.argv.find((a, i) => i > 0 && a.startsWith('--db='));
const DB_PATH = dbArg ? dbArg.slice('--db='.length) : path.resolve(__dirname, '../data/morpex-events.db');
const doVacuum = process.argv.includes('--vacuum');

const db = new Database(DB_PATH);

const before = db.prepare(`SELECT COUNT(*) AS c FROM events WHERE type='system.entity.registered'`).get().c;

// 找出重复的 entityId（出现次数 > 1）
const dupRows = db.prepare(`
  SELECT json_extract(payload, '$.entityId') AS eid, COUNT(*) AS cnt
  FROM events
  WHERE type = 'system.entity.registered' AND json_extract(payload, '$.entityId') IS NOT NULL
  GROUP BY eid HAVING cnt > 1
`).all();

let removed = 0;
const del = db.prepare(`
  DELETE FROM events
  WHERE type = 'system.entity.registered'
    AND json_extract(payload, '$.entityId') = ?
    AND sequence NOT IN (
      SELECT MAX(sequence) FROM events
      WHERE type = 'system.entity.registered'
        AND json_extract(payload, '$.entityId') = ?
    )
`);

const tx = db.transaction(() => {
  for (const r of dupRows) {
    const info = del.run(r.eid, r.eid);
    removed += info.changes;
  }
});
tx();

const after = db.prepare(`SELECT COUNT(*) AS c FROM events WHERE type='system.entity.registered'`).get().c;

console.log(`[compact-entity-events] 重复 entityId 数: ${dupRows.length}`);
console.log(`[compact-entity-events] 删除重复事件: ${removed} 条`);
console.log(`[compact-entity-events] system.entity.registered: ${before} → ${after}`);

if (doVacuum) {
  db.exec('VACUUM');
  console.log('[compact-entity-events] VACUUM 完成');
}

db.close();
