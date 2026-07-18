/**
 * DocumentIngestion — 文档摄入管道
 *
 * 将用户上传的文档（PDF/MD/TXT）切分为 chunks，
 * 写入 Provenance + Vector + Graph 三层，并触发 Cognify 实体抽取。
 *
 * 流程：
 *   1. MD5 去重
 *   2. 段落级切分（~500 chars/chunk）
 *   3. 保存 original + chunks.jsonl
 *   4. 逐块调用 MemoryBus.remember() → 三层写入
 *   5. 逐块调用 ECLCognifyEngine.cognifyAndCommit() → 图谱实体
 *
 * 存储布局：
 *   data/documents/<md5-hash>/
 *   ├── original.txt          ← 原始文件
 *   └── chunks.jsonl          ← 切片（一行一个）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { MemoryBus } from './MemoryBus.js';
import type { MemoryPayload } from './MemoryBus.js';
import { ECLCognifyEngine } from './ECLCognifyEngine.js';
import { EmbeddingClient } from '../vector/EmbeddingClient.js';

// ── 类型 ──

export interface IngestionResult {
  docId: string;
  contentHash: string;
  fileName: string;
  totalChars: number;
  chunks: number;
  entities: number;
  relations: number;
  errors: string[];
}

export interface ChunkRecord {
  chunkIndex: number;
  content: string;
  charCount: number;
  memoryEntryId?: string;
}

// ── DocumentIngestion ──

export class DocumentIngestion {
  private bus: MemoryBus;
  private cognify: ECLCognifyEngine;
  private embedder: EmbeddingClient;
  private docsDir: string;

  constructor(
    bus: MemoryBus,
    cognify: ECLCognifyEngine,
    embedder: EmbeddingClient,
    docsDir: string = './data/documents',
  ) {
    this.bus = bus;
    this.cognify = cognify;
    this.embedder = embedder;
    this.docsDir = path.resolve(docsDir);
  }

  /**
   * 摄入一份文档
   *
   * @param content    文档文本内容
   * @param metadata   文档元数据
   * @returns 摄入结果统计
   */
  async ingest(
    content: string,
    metadata: { fileName: string; source?: string; tags?: string[] },
  ): Promise<IngestionResult> {
    const errors: string[] = [];

    // Step 1: MD5 去重
    const contentHash = crypto.createHash('md5').update(content).digest('hex');
    const docDir = path.join(this.docsDir, contentHash);

    if (fs.existsSync(docDir)) {
      console.log(`[DocIngest] 🔄 文档已存在: ${metadata.fileName} (${contentHash.slice(0, 12)}...)`);
      // 重新计算已有 chunks
      const existingChunks = this.loadChunks(docDir);
      return {
        docId: contentHash,
        contentHash,
        fileName: metadata.fileName,
        totalChars: content.length,
        chunks: existingChunks.length,
        entities: 0,
        relations: 0,
        errors: ['文档已存在，跳过重复摄入'],
      };
    }

    // Step 2: 创建目录 + 保存原始文件
    if (!fs.existsSync(docDir)) {
      fs.mkdirSync(docDir, { recursive: true });
    }
    const ext = path.extname(metadata.fileName) || '.txt';
    fs.writeFileSync(path.join(docDir, `original${ext}`), content, 'utf-8');

    // Step 3: 切分
    const chunks = this.chunkText(content, 500);
    const chunkRecords: ChunkRecord[] = chunks.map((c, i) => ({
      chunkIndex: i,
      content: c,
      charCount: c.length,
    }));

    // 保存 chunks.jsonl
    const chunksFile = path.join(docDir, 'chunks.jsonl');
    for (const cr of chunkRecords) {
      fs.appendFileSync(chunksFile, JSON.stringify(cr) + '\n', 'utf-8');
    }

    // Step 4: 逐块写入 MemoryBus（Provenance + Vector + Graph）
    let totalEntities = 0;
    let totalRelations = 0;

    for (const cr of chunkRecords) {
      try {
        const payload: MemoryPayload = {
          content: cr.content,
          source: 'document',
          sourceId: contentHash,
          tags: [
            'document',
            `chunk:${cr.chunkIndex}`,
            `file:${metadata.fileName}`,
            ...(metadata.tags ?? []),
          ],
          importance: 3,
          metadata: {
            fileName: metadata.fileName,
            docHash: contentHash,
            chunkIndex: cr.chunkIndex,
            totalChunks: chunkRecords.length,
          },
        };

        const entry = await this.bus.remember(payload);
        if (entry) {
          cr.memoryEntryId = entry.id;
        }
      } catch (err: any) {
        errors.push(`Chunk ${cr.chunkIndex} 写入失败: ${err.message}`);
      }
    }

    // Step 5: 逐块 Cognify（LLM 实体抽取）
    for (const cr of chunkRecords) {
      try {
        const result = await this.cognify.cognifyAndCommit(cr.content, contentHash);
        totalEntities += result.entities.length;
        totalRelations += result.relations.length;
      } catch (err: any) {
        errors.push(`Chunk ${cr.chunkIndex} Cognify 失败: ${err.message}`);
      }
    }

    console.log(
      `[DocIngest] ✅ 摄入完成: ${metadata.fileName} → ${chunkRecords.length} chunks, ` +
      `${totalEntities} 实体, ${totalRelations} 关系`,
    );

    return {
      docId: contentHash,
      contentHash,
      fileName: metadata.fileName,
      totalChars: content.length,
      chunks: chunkRecords.length,
      entities: totalEntities,
      relations: totalRelations,
      errors,
    };
  }

  /**
   * 批量摄入（多个文档并发处理）
   */
  async ingestBatch(
    docs: Array<{ content: string; fileName: string; tags?: string[] }>,
  ): Promise<IngestionResult[]> {
    const results: IngestionResult[] = [];
    for (const doc of docs) {
      const result = await this.ingest(doc.content, {
        fileName: doc.fileName,
        tags: doc.tags,
      });
      results.push(result);
    }
    return results;
  }

  /**
   * 列出已摄入的文档
   */
  listDocuments(): Array<{ docId: string; fileName: string; chunks: number }> {
    if (!fs.existsSync(this.docsDir)) return [];

    const docs: Array<{ docId: string; fileName: string; chunks: number }> = [];
    const entries = fs.readdirSync(this.docsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const docDir = path.join(this.docsDir, entry.name);
      const originalFiles = fs.readdirSync(docDir).filter(f => f.startsWith('original.'));
      const fileName = originalFiles[0]?.replace('original.', '') ?? 'unknown';
      const chunks = this.loadChunks(docDir).length;

      docs.push({ docId: entry.name, fileName, chunks });
    }

    return docs;
  }

  /**
   * 删除一份文档（从磁盘移除，但不影响已写入图谱的实体）
   */
  deleteDocument(docId: string): boolean {
    const docDir = path.join(this.docsDir, docId);
    if (!fs.existsSync(docDir)) return false;

    try {
      fs.rmSync(docDir, { recursive: true, force: true });
      console.log(`[DocIngest] 🗑️ 已删除文档: ${docId}`);
      return true;
    } catch (err: any) {
      console.warn(`[DocIngest] ⚠️ 删除失败: ${err.message}`);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * 段落级文本切分
   *
   * 策略：
   *   1. 先按空行（段落）切分
   *   2. 短段落合并到邻居（目标 ~500 chars）
   *   3. 过长段落再次按句子切分
   */
  private chunkText(content: string, maxChars: number = 500): string[] {
    // Step 1: 按空行切分段落
    const rawParagraphs = content
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length > 0);

    if (rawParagraphs.length === 0) {
      return [content.substring(0, maxChars)];
    }

    // Step 2: 合并短段落
    const chunks: string[] = [];
    let buffer = '';

    for (const para of rawParagraphs) {
      if (buffer.length + para.length <= maxChars) {
        buffer = buffer ? buffer + '\n\n' + para : para;
      } else {
        if (buffer.length > 0) {
          chunks.push(buffer);
        }
        // 处理过长段落：按句子切分
        if (para.length > maxChars) {
          const subChunks = this.splitLongParagraph(para, maxChars);
          // 最后一段放入 buffer（可能和后续合并）
          buffer = subChunks.pop() ?? '';
          chunks.push(...subChunks);
        } else {
          buffer = para;
        }
      }
    }

    if (buffer.length > 0) {
      chunks.push(buffer);
    }

    return chunks;
  }

  /**
   * 将过长段落按句子边界切分
   */
  private splitLongParagraph(text: string, maxChars: number): string[] {
    const sentences = text.split(/(?<=[。！？.!?\n])\s*/);
    const chunks: string[] = [];
    let buffer = '';

    for (const sent of sentences) {
      if (buffer.length + sent.length <= maxChars) {
        buffer += sent;
      } else {
        if (buffer.length > 0) chunks.push(buffer);
        buffer = sent;
      }
    }

    if (buffer.length > 0) chunks.push(buffer);
    return chunks;
  }

  /**
   * 从磁盘加载已有 chunks
   */
  private loadChunks(docDir: string): ChunkRecord[] {
    const chunksFile = path.join(docDir, 'chunks.jsonl');
    if (!fs.existsSync(chunksFile)) return [];

    try {
      const content = fs.readFileSync(chunksFile, 'utf-8');
      return content
        .split('\n')
        .filter(Boolean)
        .map(line => {
          try { return JSON.parse(line) as ChunkRecord; }
          catch { return null; }
        })
        .filter(Boolean) as ChunkRecord[];
    } catch {
      return [];
    }
  }
}
