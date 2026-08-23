#!/usr/bin/env node
/**
 * maintenance.mjs — 会话存储维护（T4 管理面，按一人规模裁剪）
 *
 * 用法：
 *   node scripts/maintenance.mjs [--sessions-root data/sessions] [--days 30] [--apply]
 *
 * 职责：
 *   1. 归档：archived 且 updated_at 超 N 天（默认 30）的窗口 → jsonl gzip 到 _archive/，
 *      库内 file_path 改指 .gz（幂等标记：已是 .gz 则跳过）
 *   2. 孤儿检测报告（只报告不自动修）：无 events 的窗口 / 无 windows 的 events
 *
 * 幂等：重复执行结果一致；未加 --apply 时只打印计划（dry-run）。
 */
import { createGzip } from 'node:zlib';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';

// ── 参数 ──
const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(name);
const SESSIONS_ROOT = resolve(argOf('--sessions-root') ?? 'data/sessions');
const DAYS = Number(argOf('--days') ?? 30);
const APPLY = hasFlag('--apply');
const DB_PATH = join(SESSIONS_ROOT, 'transcript.db');
const ARCHIVE_DIR = join(SESSIONS_ROOT, '_archive');
const CUTOFF = Date.now() - DAYS * 24 * 60 * 60 * 1000;

if (!existsSync(DB_PATH)) {
  console.log(`[maintenance] 无库文件 ${DB_PATH}，无事可做`);
  process.exit(0);
}

const db = new Database(DB_PATH, { readonly: !APPLY });
db.pragma('journal_mode = WAL');

// ── 1. 归档过期 archived 窗口 ──
const stale = db
  .prepare(
    `SELECT session_id, file_path, display_name, updated_at FROM transcript_windows
     WHERE status = 'archived' AND updated_at < ? AND file_path NOT LIKE '%.gz'`,
  )
  .all(CUTOFF);

console.log(`[maintenance] 归档候选（archived 且超 ${DAYS} 天）: ${stale.length} 个${APPLY ? '' : '（dry-run，加 --apply 执行）'}`);
for (const w of stale) {
  const src = resolve(SESSIONS_ROOT, w.file_path);
  if (!existsSync(src)) {
    console.log(`  ⚠️ 跳过 ${w.session_id}: 文件不存在 ${w.file_path}`);
    continue;
  }
  const gzPath = join(ARCHIVE_DIR, `${w.session_id}.jsonl.gz`);
  console.log(`  📦 ${w.session_id} (${(statSync(src).size / 1024).toFixed(1)}KB) → ${gzPath}`);
  if (!APPLY) continue;
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  await new Promise((done, fail) => {
    const stream = createReadStream(src).pipe(createGzip()).pipe(createWriteStream(gzPath));
    stream.on('finish', done);
    stream.on('error', fail);
  }).then(() => {
      db.prepare('UPDATE transcript_windows SET file_path = ? WHERE session_id = ?').run(gzPath, w.session_id);
      console.log(`    ✅ 已归档，file_path → ${gzPath}`);
      return undefined;
    }, (err) => {
      console.log(`    ❌ gzip 失败: ${String(err).slice(0, 200)}`);
      return undefined;
    });
}

// ── 2. 孤儿检测（只报告） ──
const emptyWindows = db
  .prepare(
    `SELECT w.session_id, w.session_key FROM transcript_windows w
     LEFT JOIN transcript_events e ON e.session_id = w.session_id
     GROUP BY w.session_id HAVING COUNT(e.seq) = 0`,
  )
  .all();
const ghostEvents = db
  .prepare(
    `SELECT DISTINCT e.session_id AS sid FROM transcript_events e
     LEFT JOIN transcript_windows w ON w.session_id = e.session_id
     WHERE w.session_id IS NULL`,
  )
  .all();

console.log(`[maintenance] 孤儿检测:`);
console.log(`  空 windows（有登记无内容）: ${emptyWindows.length}${emptyWindows.length ? '\n    ' + emptyWindows.map((w) => `${w.session_id}(${w.session_key})`).join('\n    ') : ''}`);
console.log(`  游离 events（有内容无登记）: ${ghostEvents.length}${ghostEvents.length ? '\n    ' + ghostEvents.map((g) => g.sid).join('\n    ') : ''}`);

db.close();
console.log(`[maintenance] 完成${APPLY ? '' : '（dry-run）'}`);
