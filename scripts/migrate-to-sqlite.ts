#!/usr/bin/env tsx
/**
 * migrate-to-sqlite.ts — MemoryWiki JSONL → SQLite 迁移脚本
 *
 * 从 31 个 JSONL 文件读取历史数据，写入 MemoryWiki 的 SQLite 表。
 * JSONL 文件保留不变，不删除。
 *
 * 用法:
 *   npx tsx scripts/migrate-to-sqlite.ts
 */

import { MemoryWiki, migrateJSONLtoSQLite } from '../packages/memory/src/wiki/index.js';

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════');
  console.log('  MemoryWiki: JSONL → SQLite 迁移');
  console.log('═══════════════════════════════════════════\n');

  const wiki = new MemoryWiki({ dbPath: './data/memory.db' });
  await wiki.initialize();

  const startTime = Date.now();
  // 数据已备份至 backup，从备份目录迁移
  const dataDir = process.argv[2] || './data/backup/jsonl-20260713';
  console.log('数据目录:', dataDir, '\n');
  const results = await migrateJSONLtoSQLite(wiki, dataDir);
  const totalDuration = Date.now() - startTime;

  console.log('\n迁移结果:');
  let totalRead = 0;
  let totalWritten = 0;
  let totalErrors = 0;
  for (const r of results) {
    totalRead += r.rowsRead;
    totalWritten += r.rowsWritten;
    totalErrors += r.errors.length;
    const icon = r.errors.length === 0 ? '✅' : '⚠️';
    console.log(`  ${icon} ${r.table}: ${r.rowsWritten}/${r.rowsRead} rows (${r.durationMs}ms)`);
    if (r.errors.length > 0) {
      for (const e of r.errors.slice(0, 3)) {
        console.log(`     Error: ${e}`);
      }
      if (r.errors.length > 3) {
        console.log(`     ... and ${r.errors.length - 3} more errors`);
      }
    }
  }

  console.log(`\n总计: ${totalWritten}/${totalRead} rows written in ${totalDuration}ms`);
  if (totalErrors > 0) {
    console.log(`警告: ${totalErrors} 个解析错误`);
  }

  console.log('\n数据库统计:');
  const stats = wiki.getStats();
  for (const [key, val] of Object.entries(stats)) {
    console.log(`  ${key}: ${val}`);
  }

  wiki.close();
  console.log('\n✅ 迁移完成');
}

main().catch(err => {
  console.error('\n❌ 迁移失败:', err);
  process.exit(1);
});
