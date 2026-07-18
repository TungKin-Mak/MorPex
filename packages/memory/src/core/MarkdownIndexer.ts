/**
 * MarkdownKnowledgeIndexer — Markdown 知识库索引器
 *
 * 扫描指定目录下的所有 .md 文件，解析 YAML frontmatter + 正文，
 * 通过 MemoryBus + DocumentIngestion 摄入三层记忆系统。
 *
 * 适用场景：
 *   - Obsidian vault 批量导入
 *   - 项目 docs/ 目录索引
 *   - 个人笔记自动同步
 *
 * 使用方式：
 *   const indexer = new MarkdownIndexer(bus, ingestion);
 *   const result = await indexer.indexDirectory('./my-notes');
 *   // → { files: 42, chunks: 156, entities: 89, relations: 34 }
 */

import * as fs from 'fs';
import * as path from 'path';
import { MemoryBus } from './MemoryBus.js';
import type { MemoryPayload } from './MemoryBus.js';
import { DocumentIngestion } from './DocumentIngestion.js';
import { ECLCognifyEngine } from './ECLCognifyEngine.js';

// ── 类型 ──

export interface MarkdownFile {
  /** 相对于扫描根目录的路径 */
  relativePath: string;
  /** 文件名（不含扩展名） */
  name: string;
  /** YAML frontmatter 解析结果 */
  frontmatter: Record<string, any>;
  /** 正文（去除 frontmatter） */
  body: string;
  /** 文件修改时间 */
  mtime: number;
  /** 文件大小 (bytes) */
  size: number;
}

export interface IndexResult {
  /** 扫描到的 .md 文件数 */
  files: number;
  /** 跳过的文件（已有索引、未修改） */
  skipped: number;
  /** 产生的 chunk 数 */
  chunks: number;
  /** Cognify 抽取的实体数 */
  entities: number;
  /** Cognify 抽取的关系数 */
  relations: number;
  /** 错误信息 */
  errors: string[];
}

export interface MarkdownIndexerConfig {
  /** 是否递归扫描子目录 */
  recursive?: boolean;
  /** 是否自动触发 Cognify (LLM 实体抽取) */
  enableCognify?: boolean;
  /** 最小文件大小 (bytes)，跳过过小的文件 */
  minSize?: number;
  /** 忽略的文件名模式 (glob) */
  ignorePatterns?: string[];
  /** 根目录标签（所有摄入记忆都会打上此标签） */
  rootTag?: string;
}

// ── YAML Frontmatter 解析 (轻量，无外部依赖) ──

function parseFrontmatter(raw: string): { frontmatter: Record<string, any>; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }

  const yamlBlock = match[1];
  const body = match[2];

  // 简易 YAML 解析（支持 tags: [a,b,c] / key: value / key: "value"）
  const fm: Record<string, any> = {};
  const lines = yamlBlock.split('\n');
  for (const line of lines) {
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1];
    let value: any = kv[2].trim();

    // 去掉引号
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // 数组: [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map((s: string) => s.trim().replace(/["']/g, ''));
    }

    fm[key] = value;
  }

  return { frontmatter: fm, body };
}

// ── MarkdownIndexer ──

export class MarkdownIndexer {
  private bus: MemoryBus;
  private ingestion: DocumentIngestion;
  private cognify: ECLCognifyEngine | null;
  private config: Required<MarkdownIndexerConfig>;

  constructor(
    bus: MemoryBus,
    ingestion: DocumentIngestion,
    cognify?: ECLCognifyEngine,
    config?: MarkdownIndexerConfig,
  ) {
    this.bus = bus;
    this.ingestion = ingestion;
    this.cognify = cognify ?? null;
    this.config = {
      recursive: config?.recursive ?? true,
      enableCognify: config?.enableCognify ?? true,
      minSize: config?.minSize ?? 50,
      ignorePatterns: config?.ignorePatterns ?? ['node_modules', '.git', '.obsidian', '.trash'],
      rootTag: config?.rootTag ?? 'markdown-knowledge',
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 扫描
  // ═══════════════════════════════════════════════════════════════

  /**
   * 扫描目录，返回所有 .md 文件的解析结果
   */
  scanDirectory(rootDir: string): MarkdownFile[] {
    const results: MarkdownFile[] = [];
    const absoluteRoot = path.resolve(rootDir);

    if (!fs.existsSync(absoluteRoot)) {
      console.warn(`[MarkdownIndexer] ⚠️ 目录不存在: ${absoluteRoot}`);
      return results;
    }

    this._scan(absoluteRoot, absoluteRoot, results);
    return results;
  }

  private _scan(dir: string, rootDir: string, results: MarkdownFile[]): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(rootDir, fullPath);

      // 跳过忽略模式
      if (this.config.ignorePatterns.some(p => relativePath.includes(p))) {
        continue;
      }

      if (entry.isDirectory()) {
        if (this.config.recursive) {
          this._scan(fullPath, rootDir, results);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size < this.config.minSize) continue;

          const raw = fs.readFileSync(fullPath, 'utf-8');
          const { frontmatter, body } = parseFrontmatter(raw);

          results.push({
            relativePath,
            name: entry.name.replace(/\.md$/, ''),
            frontmatter,
            body,
            mtime: stat.mtimeMs,
            size: stat.size,
          });
        } catch (err: any) {
          console.warn(`[MarkdownIndexer] ⚠️ 读取失败: ${relativePath}: ${err.message}`);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 索引
  // ═══════════════════════════════════════════════════════════════

  /**
   * 索引整个目录（扫描 + 摄入）
   *
   * @param rootDir - Markdown 文件根目录
   * @returns 索引统计
   */
  async indexDirectory(rootDir: string): Promise<IndexResult> {
    const result: IndexResult = {
      files: 0,
      skipped: 0,
      chunks: 0,
      entities: 0,
      relations: 0,
      errors: [],
    };

    // Step 1: 扫描
    const files = this.scanDirectory(rootDir);
    result.files = files.length;
    console.log(`[MarkdownIndexer] 📂 扫描到 ${files.length} 个 .md 文件`);

    // Step 2: 逐个文件摄入
    for (const file of files) {
      try {
        const fileResult = await this.indexFile(file, rootDir);
        result.chunks += fileResult.chunks;
        result.entities += fileResult.entities;
        result.relations += fileResult.relations;
        if (fileResult.skipped) result.skipped++;
      } catch (err: any) {
        result.errors.push(`${file.relativePath}: ${err.message}`);
      }
    }

    console.log(
      `[MarkdownIndexer] ✅ 索引完成: ${result.files} 文件, ${result.skipped} 跳过, ` +
      `${result.chunks} chunks, ${result.entities} 实体, ${result.relations} 关系`,
    );

    return result;
  }

  /**
   * 索引单个 .md 文件
   */
  async indexFile(file: MarkdownFile, rootDir: string): Promise<{
    chunks: number;
    entities: number;
    relations: number;
    skipped: boolean;
  }> {
    // 构建标签
    const tags = this.buildTags(file, rootDir);

    // 构建完整的索引内容 (frontmatter + body)
    const fullContent = this.buildContent(file);

    // 使用 DocumentIngestion 的三层写入管道
    const ingestionResult = await this.ingestion.ingest(fullContent, {
      fileName: file.relativePath,
      source: `markdown:${path.basename(rootDir)}`,
    });

    // 额外：将 frontmatter 中的关键字段作为独立记忆写入
    if (file.frontmatter.tags || file.frontmatter.title) {
      const title = file.frontmatter.title || file.name;
      await this.bus.remember({
        content: `📄 ${title}: ${file.frontmatter.description || file.body.substring(0, 100)}`,
        source: 'markdown',
        sourceId: file.relativePath,
        tags,
        importance: file.frontmatter.importance ?? this.estimateImportance(file),
        metadata: {
          filePath: file.relativePath,
          frontmatter: file.frontmatter,
          mtime: file.mtime,
        },
      });
    }

    // Cognify: LLM 实体抽取
    let entities = 0;
    let relations = 0;
    if (this.config.enableCognify && this.cognify) {
      const cognifyResult = await this.cognify.cognifyAndCommit(
        fullContent.substring(0, 4000), // 限制 token
        file.relativePath,
      );
      entities = cognifyResult.entities.length;
      relations = cognifyResult.relations.length;
    }

    return {
      chunks: ingestionResult.chunks,
      entities,
      relations,
      skipped: false,
    };
  }

  /**
   * 增量索引（仅处理新增/修改的文件）
   * 通过比较 mtime 和已有索引判断是否需要重新摄入
   */
  async incrementalIndex(rootDir: string): Promise<IndexResult> {
    const files = this.scanDirectory(rootDir);
    const result: IndexResult = {
      files: 0,
      skipped: 0,
      chunks: 0,
      entities: 0,
      relations: 0,
      errors: [],
    };

    for (const file of files) {
      // 检查是否已有索引（通过 sourceId 查询 MemoryBus 索引）
      // 简化方案：直接按文件路径 MD5 检查
      const fileHash = this.hashPath(file.relativePath);
      // TODO: 查询 index.jsonl 判断是否需要更新
      // 目前简化：全部摄入（MemoryBus.remember 内部有 MD5 去重）

      try {
        const fileResult = await this.indexFile(file, rootDir);
        result.chunks += fileResult.chunks;
        result.entities += fileResult.entities;
        result.relations += fileResult.relations;
        result.files++;
      } catch (err: any) {
        result.errors.push(`${file.relativePath}: ${err.message}`);
      }
    }

    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // 辅助
  // ═══════════════════════════════════════════════════════════════

  /** 从 frontmatter + 目录结构构建标签 */
  private buildTags(file: MarkdownFile, rootDir: string): string[] {
    const tags: string[] = [this.config.rootTag];

    // frontmatter 中的 tags
    if (Array.isArray(file.frontmatter.tags)) {
      tags.push(...file.frontmatter.tags);
    } else if (typeof file.frontmatter.tags === 'string') {
      tags.push(...file.frontmatter.tags.split(/[,;]/).map((t: string) => t.trim()));
    }

    // 目录名作为分类标签
    const dirParts = file.relativePath.split(path.sep);
    if (dirParts.length > 1) {
      tags.push(dirParts[0]); // 一级目录作为分类
    }

    // frontmatter 中的 category
    if (file.frontmatter.category) {
      tags.push(file.frontmatter.category);
    }

    return [...new Set(tags)]; // 去重
  }

  /** 构建完整索引内容 */
  private buildContent(file: MarkdownFile): string {
    const parts: string[] = [];

    if (file.frontmatter.title) {
      parts.push(`# ${file.frontmatter.title}`);
    } else {
      parts.push(`# ${file.name}`);
    }

    if (file.frontmatter.description) {
      parts.push(`> ${file.frontmatter.description}`);
    }

    if (file.frontmatter.tags) {
      const tagList = Array.isArray(file.frontmatter.tags)
        ? file.frontmatter.tags.join(', ')
        : file.frontmatter.tags;
      parts.push(`标签: ${tagList}`);
    }

    parts.push('');
    parts.push(file.body);

    return parts.join('\n');
  }

  /** 估算文件重要性 */
  private estimateImportance(file: MarkdownFile): number {
    let score = 2;

    // 有 frontmatter 的通常更重要
    if (Object.keys(file.frontmatter).length > 0) score = 3;

    // 长文通常更有价值
    if (file.body.length > 2000) score = Math.max(score, 4);
    else if (file.body.length > 500) score = Math.max(score, 3);

    // 包含关键标签
    const allTags = this.buildTags(file, '');
    if (allTags.some(t => ['architecture', 'design', 'decision', 'important'].includes(t))) {
      score = Math.max(score, 5);
    }

    return score;
  }

  private hashPath(p: string): string {
    const crypto = require('crypto') as typeof import('crypto');
    return crypto.createHash('md5').update(p).digest('hex');
  }
}
