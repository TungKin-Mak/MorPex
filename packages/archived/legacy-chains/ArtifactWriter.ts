/**
 * ArtifactWriter — 产物文件系统写入器
 *
 * 职责：
 *   ArtifactRegistry 回调触发的产物文件落盘。
 * 从 StudioServer 提取，消除文件 I/O 与 HTTP 路由的耦合。
 */

import * as fs from 'fs';
import * as path from 'path';

export class ArtifactWriter {
  private basePath: string;

  constructor(mirrorBasePath?: string) {
    this.basePath = path.resolve(mirrorBasePath || './data');
  }

  /**
   * saveArtifact — 将产物写入文件系统
   *
   * @param artifact - ArtifactRegistry 产物对象
   * @param dagExecId - 当前 DAG 执行 ID（用于目录命名）
   */
  async saveArtifact(artifact: any, dagExecId: string): Promise<void> {
    if (!artifact || !artifact.content) return;

    const workspaceProjects = path.join(this.basePath, 'workspace', 'projects');
    const execDir = artifact.metadata?.executionId || dagExecId || `art_${Date.now()}`;
    const artifactDir = path.join(workspaceProjects, execDir);

    try {
      if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });

      const safeName = artifact.name.replace(/[<>:"\/\\|?*\x00-\x1f]/g, '_');
      const hasExt = /\.[a-z0-9]+$/i.test(safeName);
      const extMap: Record<string, string> = {
        code: '.js', document: '.md', config: '.json',
        schema: '.json', report: '.md', plan: '.md', structured_data: '.json',
      };
      const ext = hasExt ? '' : (extMap[artifact.type] || '.txt');
      const fileName = `${safeName}${ext}`;
      const content = typeof artifact.content === 'string'
        ? artifact.content
        : JSON.stringify(artifact.content, null, 2);

      fs.writeFileSync(path.join(artifactDir, fileName), content, 'utf-8');
      console.log(`[Artifact] ✅ 已写入: ${path.join(artifactDir, fileName)} (${content.length} 字节)`);
    } catch (err) {
      console.error(`[Artifact] 写入失败: ${err.message}`);
    }
  }
}
