/**
 * DocWatcher — 文档自维护系统
 *
 * 监听 docs/ 目录的 md 文件变更，自动索引到 MemoryWiki。
 * 由 StudioServer 在闲时启动，Agent 无需手动维护知识库。
 *
 * 用法:
 *   const watcher = new DocWatcher(wiki, { dir: './docs' });
 *   await watcher.start();  // 开始监听
 *   // ...
 *   watcher.stop();         // 停止监听
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MemoryWiki } from './MemoryWiki.js';

// ═══════════════════════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════════════════════

export interface DocWatcherConfig {
  /** 监听目录 */
  dir: string;
  /** 防抖延迟 ms */
  debounceMs?: number;
  /** 分块大小 */
  chunkSize?: number;
  /** 是否自动索引启动时已有的文件 */
  indexOnStart?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// DocWatcher
// ═══════════════════════════════════════════════════════════════

export class DocWatcher {
  private wiki: MemoryWiki;
  private config: Required<DocWatcherConfig>;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFiles = new Set<string>();

  constructor(wiki: MemoryWiki, config: DocWatcherConfig) {
    this.wiki = wiki;
    this.config = {
      dir: path.resolve(config.dir),
      debounceMs: config.debounceMs ?? 5000,
      chunkSize: config.chunkSize ?? 2000,
      indexOnStart: config.indexOnStart ?? false,
    };
  }

  // ═════════════════════════════════════════════════════════════
  // 生命周期
  // ═════════════════════════════════════════════════════════════

  async start(): Promise<void> {
    // 确保目录存在
    if (!fs.existsSync(this.config.dir)) {
      fs.mkdirSync(this.config.dir, { recursive: true });
    }

    // 启动时索引所有已有文件
    if (this.config.indexOnStart) {
      console.log('[DocWatcher] 📂 初始索引已有文件...');
      await this.indexAll();
    }

    // 监听变更
    try {
      this.watcher = fs.watch(this.config.dir, { recursive: true }, (eventType, filename) => {
        if (!filename || !filename.endsWith('.md')) return;
        if (filename.includes('node_modules') || filename.includes('.git') || filename.includes('_archive')) return;

        this.pendingFiles.add(path.join(this.config.dir, filename));

        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.processPending(), this.config.debounceMs);
      });

      console.log(`[DocWatcher] 👁️ 监听 ${this.config.dir} (防抖 ${this.config.debounceMs}ms)`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[DocWatcher] ⚠️ 监听失败: ${msg}`);
    }
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    console.log('[DocWatcher] 🛑 已停止');
  }

  // ═════════════════════════════════════════════════════════════
  // 全量索引
  // ═════════════════════════════════════════════════════════════

  async indexAll(): Promise<number> {
    const files = this.findAllMdFiles(this.config.dir);
    for (const f of files) {
      await this.indexFile(f);
    }
    console.log(`[DocWatcher] ✅ 全量索引完成: ${files.length} 文件`);
    return files.length;
  }

  // ═════════════════════════════════════════════════════════════
  // 内部
  // ═════════════════════════════════════════════════════════════

  private async processPending(): Promise<void> {
    const files = [...this.pendingFiles];
    this.pendingFiles.clear();

    for (const filePath of files) {
      try {
        if (fs.existsSync(filePath)) {
          await this.indexFile(filePath);
        } else {
          await this.unindexFile(filePath);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[DocWatcher] ⚠️ ${path.basename(filePath)}: ${msg}`);
      }
    }
  }

  private async indexFile(filePath: string): Promise<void> {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (content.trim().length < 50) return;

    const relativePath = path.relative(this.config.dir, filePath);

    // 先删除旧索引
    await this.unindexFile(filePath);

    // 写入新 chunks
    const chunks = this.chunkMarkdown(relativePath, content);
    for (const chunk of chunks) {
      const safeName = relativePath.replace(/[\/\\]/g, '_').replace(/\.md$/, '');
      const chunkId = `wiki_${safeName}_${chunk.chunkIndex}`;

      await this.wiki.remember({
        id: chunkId,
        type: 'MemoryEntry',
        name: chunk.section,
        data: {
          mem_type: 'knowledge',
          content: chunk.content,
          source: 'doc-watcher',
          source_id: relativePath,
          tags: JSON.stringify([
            'wiki',
            'markdown',
            relativePath.split(/[\/\\]/)[0] ?? 'root',
            ...this.extractTags(chunk.content),
          ]),
          importance: 4,
          score: 10,
          pool: 'main',
          created_at: Math.floor(Date.now() / 1000),
        },
      }).catch(() => {});
    }

    console.log(`[DocWatcher] 📄 ${relativePath}: ${chunks.length} chunks`);
  }

  private async unindexFile(filePath: string): Promise<void> {
    const relativePath = path.relative(this.config.dir, filePath);
    const safePrefix = `wiki_${relativePath.replace(/[\/\\]/g, '_').replace(/\.md$/, '')}%`;

    // 使用 wiki.run() 删除
    this.wiki.run(
      "DELETE FROM memory_entries WHERE source_id = ? AND source = 'doc-watcher'",
      relativePath
    );
    this.wiki.run(
      "DELETE FROM memory_entries WHERE id LIKE ?",
      safePrefix
    );
  }

  /** 从内容中提取关键词作为标签 */
  private extractTags(content: string): string[] {
    const tags: string[] = [];
    // 提取 #tag 格式
    const hashtagRegex = /#([a-zA-Z0-9\u4e00-\u9fff_-]+)/g;
    let match;
    while ((match = hashtagRegex.exec(content)) !== null) {
      const tag = match[1].toLowerCase();
      if (!tags.includes(tag) && tag.length < 30) {
        tags.push(tag);
      }
    }
    return tags.slice(0, 10);
  }

  /** 将 md 分块 */
  private chunkMarkdown(relativePath: string, content: string): Array<{ section: string; content: string; chunkIndex: number }> {
    const chunks: Array<{ section: string; content: string; chunkIndex: number }> = [];
    const lines = content.split('\n');
    let currentSection = path.basename(relativePath, '.md');
    let buffer = '';
    let idx = 0;

    for (const line of lines) {
      if (/^#{1,3}\s/.test(line)) {
        currentSection = line.replace(/^#+\s*/, '').trim();
      }
      buffer += line + '\n';
      if (buffer.length >= this.config.chunkSize) {
        chunks.push({ section: currentSection, content: buffer.trim(), chunkIndex: idx++ });
        buffer = buffer.slice(-200); // overlap
      }
    }
    if (buffer.trim().length > 0) {
      chunks.push({ section: currentSection, content: buffer.trim(), chunkIndex: idx });
    }
    return chunks;
  }

  private findAllMdFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!['node_modules', '.git', '_archive', 'backup'].includes(entry.name)) {
            results.push(...this.findAllMdFiles(path.join(dir, entry.name)));
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          results.push(path.join(dir, entry.name));
        }
      }
    } catch { /* skip unreadable */ }
    return results;
  }
}
