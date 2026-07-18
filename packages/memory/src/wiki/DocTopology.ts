/**
 * DocTopology — 文档关系拓扑构建
 *
 * 解析 docs/ 中所有 md 文件的交叉引用（[text](path.md)），
 * 为文档间的引用关系创建 kg_relations，建立可图遍历的知识拓扑。
 *
 * 用法:
 *   const topo = new DocTopology(wiki, './docs');
 *   const { nodes, edges } = await topo.buildTopology();
 *   // WIKI.md → 查询引用了哪些文档
 *   wiki.getFullEntity('doc_WIKI', 2)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MemoryWiki } from './MemoryWiki.js';

// ═══════════════════════════════════════════════════════════════
// DocTopology
// ═══════════════════════════════════════════════════════════════

export class DocTopology {
  private wiki: MemoryWiki;
  private dir: string;

  constructor(wiki: MemoryWiki, dir: string) {
    this.wiki = wiki;
    this.dir = path.resolve(dir);
  }

  // ═════════════════════════════════════════════════════════════
  // 拓扑构建
  // ═════════════════════════════════════════════════════════════

  /**
   * 分析所有 md 文件的交叉引用，构建关系图
   */
  async buildTopology(): Promise<{ nodes: number; edges: number }> {
    const files = this.findAllMd(this.dir);
    const docIds = new Map<string, string>(); // relativePath → kg_entity_id

    // 1. 为每个文档创建 kg_entity
    for (const filePath of files) {
      const relativePath = path.relative(this.dir, filePath);
      const safeName = relativePath.replace(/[\/\\]/g, '_').replace(/\.md$/, '');
      const entityId = `doc_${safeName}`;
      docIds.set(relativePath, entityId);

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const stat = fs.statSync(filePath);
        const title = this.extractTitle(content) ?? path.basename(filePath, '.md');

        await this.wiki.remember({
          id: entityId,
          type: 'KgEntity',
          name: title,
          data: {
            domain: 'documentation',
            tags: JSON.stringify([
              'doc',
              'markdown',
              relativePath.split(/[\/\\]/)[0] ?? 'root',
            ]),
            importance: 0.8,
            source_file: relativePath,
            size: stat.size,
            mtime: Math.floor(stat.mtimeMs / 1000),
          },
        }).catch(() => {});
      } catch {
        // 跳过不可读的文件
      }
    }
    console.log(`[DocTopology] 📄 ${docIds.size} 文档节点已注册`);

    // 2. 解析交叉引用，创建关系边
    let edgeCount = 0;
    for (const filePath of files) {
      const relativePath = path.relative(this.dir, filePath);
      const fromId = docIds.get(relativePath);
      if (!fromId) continue;

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const links = this.extractMarkdownLinks(content);

        for (const link of links) {
          const target = this.resolveLink(relativePath, link);
          const toId = docIds.get(target);
          if (toId && toId !== fromId) {
            const relId = `rel_${fromId}_${toId}`;
            await this.wiki.remember({
              id: relId,
              type: 'KgEntity',
              name: `${path.basename(relativePath)} → ${path.basename(target)}`,
              data: { domain: 'doc-topology' },
              relations: [{
                toId,
                type: 'REFERENCES',
                properties: { linkText: link },
              }],
            }).catch(() => {});
            edgeCount++;
          }
        }
      } catch {
        // 跳过不可读的文件
      }
    }

    console.log(`[DocTopology] 🕸️ 拓扑构建完成: ${docIds.size} 节点, ${edgeCount} 边`);
    return { nodes: docIds.size, edges: edgeCount };
  }

  // ═════════════════════════════════════════════════════════════
  // 工具方法
  // ═════════════════════════════════════════════════════════════

  /** 提取 H1 标题 */
  private extractTitle(content: string): string | null {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
  }

  /** 提取所有 [text](path.md) 链接 */
  private extractMarkdownLinks(content: string): string[] {
    const links: string[] = [];
    const regex = /\[([^\]]*)\]\(([^)]+\.md)\)/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      links.push(match[2]); // 取路径部分，不含锚点
    }
    return [...new Set(links)];
  }

  /** 解析相对链接为相对于 doc 根的路径 */
  private resolveLink(fromFile: string, link: string): string {
    const cleanLink = link.split('#')[0]; // 去掉锚点
    if (cleanLink.startsWith('/')) return cleanLink.slice(1);
    const fromDir = path.dirname(fromFile);
    return path.normalize(path.join(fromDir, cleanLink)).replace(/\\/g, '/');
  }

  private findAllMd(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!['node_modules', '.git', '_archive', 'backup'].includes(entry.name)) {
            results.push(...this.findAllMd(path.join(dir, entry.name)));
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          results.push(path.join(dir, entry.name));
        }
      }
    } catch { /* skip */ }
    return results;
  }
}
