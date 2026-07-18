/**
 * WorkspaceIndexer — 工作区产物索引
 *
 * 解决 storage-comprehensive.md #1.4 / #1.5：
 *   - 生成物（代码/文档）不可搜索
 *   - 执行报告不可搜索
 *
 * 在产物生成时自动调用 index() 写入索引和向量库。
 *
 * 存储布局：
 *   data/workspace/
 *   ├── index.jsonl        ← 产物索引（一行一个）
 *   ├── projects/<id>/     ← 生成项目
 *   └── reports/*.md       ← 执行报告
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ── 类型 ──

export interface WorkspaceEntry {
  id: string;
  type: 'project_file' | 'report' | 'generated_artifact';
  filePath: string;           // 相对路径
  language?: string;          // .py / .ts / .js 等
  projectId?: string;
  executionId?: string;
  contentHash: string;
  contentPreview: string;     // 前 200 字符
  tags: string[];
  createdAt: number;
  metadata?: Record<string, any>;
}

export interface IndexStats {
  totalFiles: number;
  byType: Record<string, number>;
  byLanguage: Record<string, number>;
  totalProjects: number;
}

// ── WorkspaceIndexer ──

export class WorkspaceIndexer {
  private baseDir: string;
  private indexPath: string;
  private index: Map<string, WorkspaceEntry> = new Map();
  private _ready = false;

  constructor(baseDir?: string) {
    this.baseDir = path.resolve(baseDir ?? './data/workspace');
    this.indexPath = path.join(this.baseDir, 'index.jsonl');
  }

  get ready(): boolean { return this._ready; }

  async initialize(): Promise<void> {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }

    if (fs.existsSync(this.indexPath)) {
      try {
        const content = fs.readFileSync(this.indexPath, 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const entry: WorkspaceEntry = JSON.parse(line);
            this.index.set(entry.id, entry);
          } catch {}
        }
        console.log(`[Workspace] ✅ 已加载索引: ${this.index.size} 个产物`);
      } catch (err: any) {
        console.warn(`[Workspace] ⚠️ 索引加载失败: ${err.message}`);
      }
    }

    this._ready = true;
  }

  // ═══════════════════════════════════════════════════════════════
  // 索引
  // ═══════════════════════════════════════════════════════════════

  /**
   * 索引一个工作区文件
   *
   * @param filePath - 相对于 data/workspace 的路径
   * @param type - 文件类型
   * @param options - 额外元数据
   */
  indexFile(
    filePath: string,
    type: WorkspaceEntry['type'],
    options?: {
      projectId?: string;
      executionId?: string;
      tags?: string[];
      metadata?: Record<string, any>;
    },
  ): WorkspaceEntry {
    const fullPath = path.join(this.baseDir, filePath);

    // 读取内容
    let content = '';
    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      // 文件可能尚未写入或为二进制，跳过内容读取
    }

    const contentHash = crypto.createHash('md5').update(content).digest('hex');
    const ext = path.extname(filePath).toLowerCase();
    const language = this.inferLanguage(ext);

    const entry: WorkspaceEntry = {
      id: `ws_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      type,
      filePath,
      language,
      projectId: options?.projectId,
      executionId: options?.executionId,
      contentHash,
      contentPreview: content.substring(0, 200),
      tags: options?.tags ?? [],
      createdAt: Date.now(),
      metadata: options?.metadata,
    };

    this.index.set(entry.id, entry);
    this.appendEntry(entry);

    return entry;
  }

  /**
   * 索引执行报告
   */
  indexReport(reportPath: string, executionId: string): WorkspaceEntry {
    return this.indexFile(reportPath, 'report', {
      executionId,
      tags: ['report', 'execution'],
      metadata: { executionId },
    });
  }

  /**
   * 索引生成的项目文件
   */
  indexProjectFile(filePath: string, projectId: string): WorkspaceEntry {
    return this.indexFile(filePath, 'project_file', {
      projectId,
      tags: ['project', projectId],
      metadata: { projectId },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 查询
  // ═══════════════════════════════════════════════════════════════

  /** 按项目 ID 查询 */
  queryByProject(projectId: string): WorkspaceEntry[] {
    return [...this.index.values()]
      .filter(e => e.projectId === projectId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** 按语言/文件类型查询 */
  queryByLanguage(language: string): WorkspaceEntry[] {
    return [...this.index.values()]
      .filter(e => e.language === language)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** 按执行 ID 查询（关联报告 + 产物） */
  queryByExecution(executionId: string): WorkspaceEntry[] {
    return [...this.index.values()]
      .filter(e => e.executionId === executionId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** 文本搜索（简单关键词匹配） */
  search(text: string, limit: number = 20): WorkspaceEntry[] {
    const q = text.toLowerCase();
    return [...this.index.values()]
      .filter(e =>
        e.filePath.toLowerCase().includes(q) ||
        e.contentPreview.toLowerCase().includes(q) ||
        e.tags.some(t => t.toLowerCase().includes(q))
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  /** 列出所有项目 ID */
  listProjects(): string[] {
    const projects = new Set<string>();
    for (const [, entry] of this.index) {
      if (entry.projectId) projects.add(entry.projectId);
    }
    return [...projects];
  }

  // ═══════════════════════════════════════════════════════════════
  // 统计
  // ═══════════════════════════════════════════════════════════════

  getStats(): IndexStats {
    const byType: Record<string, number> = {};
    const byLanguage: Record<string, number> = {};
    const projects = new Set<string>();

    for (const [, entry] of this.index) {
      byType[entry.type] = (byType[entry.type] ?? 0) + 1;
      if (entry.language) {
        byLanguage[entry.language] = (byLanguage[entry.language] ?? 0) + 1;
      }
      if (entry.projectId) projects.add(entry.projectId);
    }

    return {
      totalFiles: this.index.size,
      byType,
      byLanguage,
      totalProjects: projects.size,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  private appendEntry(entry: WorkspaceEntry): void {
    try {
      fs.appendFileSync(this.indexPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (err: any) {
      console.warn(`[Workspace] ⚠️ 索引写入失败: ${err.message}`);
    }
  }

  private inferLanguage(ext: string): string | undefined {
    const map: Record<string, string> = {
      '.ts': 'typescript', '.tsx': 'typescript',
      '.js': 'javascript', '.jsx': 'javascript',
      '.py': 'python',
      '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
      '.md': 'markdown', '.mdx': 'markdown',
      '.html': 'html', '.css': 'css',
      '.rs': 'rust', '.go': 'go', '.java': 'java',
      '.c': 'c', '.cpp': 'cpp', '.h': 'c',
      '.sh': 'shell', '.bat': 'batch',
    };
    return map[ext];
  }
}
