#!/usr/bin/env tsx
/**
 * build-wiki.ts — 将 docs/*.md 索引到 MemoryWiki，让 Agent 能检索架构文档
 *
 * 用法:
 *   npx tsx scripts/build-wiki.ts
 *   npx tsx scripts/build-wiki.ts --dir docs   # 指定目录
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { MemoryWiki } from '../packages/memory/src/wiki/index.js';

// ═══════════════════════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════════════════════

const DB_PATH = process.env.MEMORY_DB || './data/memory.db';
const DOCS_DIR = process.argv.includes('--dir')
  ? process.argv[process.argv.indexOf('--dir') + 1]
  : 'docs';
const CHUNK_SIZE = 2000; // 每块字符数
const CHUNK_OVERLAP = 200; // 块间重叠

// ═══════════════════════════════════════════════════════════════
// Markdown 分块
// ═══════════════════════════════════════════════════════════════

interface Chunk {
  sourceFile: string;
  section: string;
  content: string;
  chunkIndex: number;
}

function chunkMarkdown(filePath: string, content: string): Chunk[] {
  const chunks: Chunk[] = [];
  const lines = content.split('\n');
  let currentSection = path.basename(filePath, '.md');
  let buffer = '';
  let chunkIndex = 0;

  for (const line of lines) {
    // 检测标题作为分段标记
    if (/^#{1,3}\s/.test(line)) {
      currentSection = line.replace(/^#+\s*/, '').trim();
    }

    buffer += line + '\n';

    if (buffer.length >= CHUNK_SIZE) {
      chunks.push({
        sourceFile: filePath,
        section: currentSection,
        content: buffer.trim(),
        chunkIndex: chunkIndex++,
      });
      // 重叠：保留最后一段
      buffer = buffer.slice(-CHUNK_OVERLAP);
    }
  }

  // 最后一块
  if (buffer.trim().length > 0) {
    chunks.push({
      sourceFile: filePath,
      section: currentSection,
      content: buffer.trim(),
      chunkIndex: chunkIndex,
    });
  }

  return chunks;
}

// ═══════════════════════════════════════════════════════════════
// 索引
// ═══════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════');
  console.log('  MemoryWiki: Markdown 知识库构建');
  console.log('═══════════════════════════════════════════\n');

  // 1. 初始化 MemoryWiki
  const wiki = new MemoryWiki({ dbPath: DB_PATH });
  await wiki.initialize();

  // 2. 扫描 .md 文件
  const absoluteDir = path.resolve(DOCS_DIR);
  if (!fs.existsSync(absoluteDir)) {
    console.error(`❌ 目录不存在: ${absoluteDir}`);
    wiki.close();
    process.exit(1);
  }

  const mdFiles = findAllMdFiles(absoluteDir);
  console.log(`📂 扫描到 ${mdFiles.length} 个 .md 文件\n`);

  // 3. 分块 + 写入
  let totalChunks = 0;
  const fileResults: Array<{ file: string; chunks: number; status: string }> = [];

  for (const filePath of mdFiles) {
    const relativePath = path.relative(absoluteDir, filePath);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.trim().length < 50) {
        fileResults.push({ file: relativePath, chunks: 0, status: '⊘ 太短跳过' });
        continue;
      }

      const chunks = chunkMarkdown(relativePath, content);

      for (const chunk of chunks) {
        const chunkId = `wiki_${relativePath.replace(/[\/\\]/g, '_').replace(/\.md$/, '')}_${chunk.chunkIndex}`;

        await wiki.remember({
          id: chunkId,
          type: 'MemoryEntry',
          name: `${chunk.section} (${relativePath}#${chunk.chunkIndex})`,
          data: {
            mem_type: 'knowledge',
            content: chunk.content,
            source: 'markdown-indexer',
            source_id: relativePath,
            tags: JSON.stringify([
              'wiki',
              'markdown',
              relativePath.split('/')[0] ?? 'root',
              chunk.section.toLowerCase().replace(/\s+/g, '-'),
            ]),
            importance: 4,
            score: 10,
            pool: 'main',
            created_at: Math.floor(Date.now() / 1000),
          },
        }).catch(() => {});
      }

      totalChunks += chunks.length;
      fileResults.push({ file: relativePath, chunks: chunks.length, status: '✅' });
      console.log(`  ✅ ${relativePath}: ${chunks.length} chunks`);
    } catch (err: any) {
      fileResults.push({ file: relativePath, chunks: 0, status: `❌ ${err.message}` });
      console.log(`  ❌ ${relativePath}: ${err.message}`);
    }
  }

  // 4. 汇总
  console.log('\n═══════════════════════════════════════════');
  console.log('  索引结果');
  console.log('═══════════════════════════════════════════');
  for (const r of fileResults) {
    console.log(`  ${r.status} ${r.file}: ${r.chunks} chunks`);
  }
  console.log(`\n📊 总计: ${totalChunks} chunks 写入 memory_entries`);

  const stats = wiki.getStats();
  console.log(`📊 memory_entries: ${stats.memoryEntries} 条`);
  console.log(`📊 kg_entities: ${stats.kgEntities} 条`);

  wiki.close();
  console.log('✅ 知识库构建完成\n');
}

// ═══════════════════════════════════════════════════════════════
// 工具
// ═══════════════════════════════════════════════════════════════

function findAllMdFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    // 跳过忽略目录
    if (entry.isDirectory()) {
      if (['node_modules', '.git', '.obsidian', '.trash', 'data', '_archive'].includes(entry.name)) {
        continue;
      }
      results.push(...findAllMdFiles(path.join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(path.join(dir, entry.name));
    }
  }

  return results;
}

main().catch(err => {
  console.error('❌ 构建失败:', err);
  process.exit(1);
});
