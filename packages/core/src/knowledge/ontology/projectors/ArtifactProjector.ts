/**
 * ArtifactProjector — 将 Artifact 存储投影到 Ontology
 *
 * 迭代2：从 ArtifactFacade / ArtifactStore 投影到 Ontology。
 * 使 LLM 能查询到已创建的 Artifact 对象。
 */

import type { OntologyService } from '../OntologyService.js';

export interface ArtifactSource {
  listRecent?: (limit: number) => Promise<Array<Record<string, unknown>>>;
  getAll?: () => Promise<Array<Record<string, unknown>>>;
  getById?: (id: string) => Promise<Record<string, unknown> | null>;
}

export class ArtifactProjector {
  constructor(
    private readonly ontology: OntologyService,
    private readonly artifactSource: ArtifactSource,
  ) {}

  /**
   * projectAll — 将所有 Artifact 投影到 Ontology
   *
   * @param limit - 最大投影数量
   * @returns 投影的对象数量
   */
  async projectAll(limit = 200): Promise<number> {
    const list =
      (await this.artifactSource.listRecent?.(limit)) ??
      (await this.artifactSource.getAll?.()) ??
      [];

    // 17i.20：批量投影模式（跳过逐条 Deblackbox 审计；bootstrap 回放非用户动作）
    const ontology = this.ontology as OntologyService & { setBulkProjection?: (v: boolean) => void };
    ontology.setBulkProjection?.(true);
    let count = 0;
    try {
      for (const a of list) {
        try {
          await this.ontology.upsertObject({
            id: String(a.id ?? a.artifactId ?? `artifact_${Date.now()}_${count}`),
            type: 'Artifact',
            status: String(a.status ?? a.state ?? 'draft'),
            properties: {
              title: String(a.title ?? a.name ?? a.type ?? 'Unnamed Artifact'),
              missionId: String(a.missionId ?? a.executionId ?? ''),
              kind: a.kind ?? a.type,
              version: a.version ?? 1,
              contentRef: a.contentRef ?? a.source,
              tags: a.tags,
            },
          });
          count++;
        } catch (err) {
          console.warn(`[ArtifactProjector] ⚠️ 投影失败:`, (err as Error).message);
        }
      }
    } finally {
      ontology.setBulkProjection?.(false);
    }

    if (count > 0) {
      console.log(`[ArtifactProjector] ✅ 已投影 ${count} 个 Artifact`);
    }
    return count;
  }

  /**
   * projectOne — 投影单个 Artifact
   */
  async projectOne(id: string): Promise<boolean> {
    if (!this.artifactSource.getById) return false;
    const a = await this.artifactSource.getById(id);
    if (!a) return false;

    await this.ontology.upsertObject({
      id: String(a.id ?? id),
      type: 'Artifact',
      status: String(a.status ?? a.state ?? 'draft'),
      properties: {
        title: String(a.title ?? a.name ?? 'Unnamed'),
        missionId: String(a.missionId ?? a.executionId ?? ''),
        kind: a.kind ?? a.type,
        version: a.version ?? 1,
      },
    });
    return true;
  }
}
