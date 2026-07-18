#!/usr/bin/env tsx
/**
 * query-wiki.ts — 查询已索引的 Markdown 知识库
 *
 * 用法:
 *   npx tsx scripts/query-wiki.ts "如何接入新模块"
 *   npx tsx scripts/query-wiki.ts --tags wiki,architecture
 *   npx tsx scripts/query-wiki.ts --recent 10
 */

import { MemoryWiki } from '../packages/memory/src/wiki/index.js';

const DB_PATH = process.env.MEMORY_DB || './data/memory.db';

async function main(): Promise<void> {
  const wiki = new MemoryWiki({ dbPath: DB_PATH });
  await wiki.initialize();

  const args = process.argv.slice(2);

  if (args.includes('--recent')) {
    // 最近索引的文档
    const idx = args.indexOf('--recent');
    const limit = parseInt(args[idx + 1] ?? '10', 10);
    const entries = wiki.getMemoryEntries('main', limit);
    console.log(`最近 ${entries.length} 条:\n`);
    for (const e of entries) {
      const src = (e as any).source_id ?? (e as any).id;
      const preview = ((e as any).content as string)?.slice(0, 120) ?? '';
      console.log(`📄 ${src}`);
      console.log(`   ${preview.replace(/\n/g, ' ')}...`);
      console.log();
    }

  } else if (args.includes('--tags')) {
    // 按标签查询
    const idx = args.indexOf('--tags');
    const tags = (args[idx + 1] ?? '').split(',').map(t => t.trim());
    const entries = wiki.queryByTags('memory_entries', tags, { limit: 10 });
    console.log(`标签 [${tags.join(', ')}] 匹配 ${entries.length} 条:\n`);
    for (const e of entries) {
      const src = (e as any).source_id ?? (e as any).id;
      const preview = ((e as any).content as string)?.slice(0, 150) ?? '';
      console.log(`📄 ${src}`);
      console.log(`   ${preview.replace(/\n/g, ' ')}...`);
      console.log();
    }

  } else if (args.includes('--stats')) {
    // 统计
    const stats = wiki.getStats();
    console.log('知识库统计:');
    for (const [key, val] of Object.entries(stats)) {
      console.log(`  ${key}: ${val}`);
    }

  } else if (args.includes('--sql')) {
    // 原始 SQL
    const idx = args.indexOf('--sql');
    const sql = args.slice(idx + 1).join(' ');
    const rows = wiki.sql(sql);
    console.log(JSON.stringify(rows, null, 2));

  } else if (args.length > 0 && !args[0].startsWith('--')) {
    // 关键词搜索（全文字段匹配）
    const keyword = args.join(' ');
    console.log(`🔍 搜索: "${keyword}"\n`);

    // 在 memory_entries 中搜索 content
    const rows = wiki.sql(
      "SELECT mem_type, source_id, substr(content, 1, 300) as preview FROM memory_entries WHERE content LIKE ? OR source_id LIKE ? LIMIT 5",
      `%${keyword}%`, `%${keyword}%`
    ) as Array<{ mem_type: string; source_id: string; preview: string }>;

    if (rows.length === 0) {
      // 尝试在 kg_entities 中搜索（name 列在那里）
      const kgRows = wiki.sql(
        "SELECT name, type, substr(data_json, 1, 300) as preview FROM kg_entities WHERE name LIKE ? OR data_json LIKE ? LIMIT 5",
        `%${keyword}%`, `%${keyword}%`
      ) as Array<{ name: string; type: string; preview: string }>;
      if (kgRows.length === 0) {
        console.log('  未找到匹配结果');
      } else {
        for (const r of kgRows) {
          console.log(`📄 ${r.name} [${r.type}]`);
          console.log(`   ${(r.preview || '').replace(/\n/g, ' ').slice(0, 200)}...`);
          console.log();
        }
      }
    } else {
      for (const r of rows) {
        console.log(`📄 ${r.source_id} [${r.mem_type}]`);
        console.log(`   ${r.preview.replace(/\n/g, ' ').slice(0, 200)}...`);
        console.log();
      }
    }

  } else {
    console.log('用法:');
    console.log('  npx tsx scripts/query-wiki.ts "关键词"          全文搜索');
    console.log('  npx tsx scripts/query-wiki.ts --tags wiki,api    标签查询');
    console.log('  npx tsx scripts/query-wiki.ts --recent 10        最近条目');
    console.log('  npx tsx scripts/query-wiki.ts --stats            统计信息');
    console.log('  npx tsx scripts/query-wiki.ts --sql "SELECT ..."  原始SQL');
  }

  wiki.close();
}

main().catch(err => {
  console.error('❌ 查询失败:', err);
  process.exit(1);
});
