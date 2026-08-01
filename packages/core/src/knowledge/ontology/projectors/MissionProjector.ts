/**
 * MissionProjector — 将 Mission 存储投影到 Ontology
 *
 * 迭代2：从 MissionStore / Event 投影重建 Ontology 中的 Mission 对象。
 * 使 LLM 查询 ontology_queryObjects({type:'Mission'}) 能看到真实数据。
 */

import type { OntologyService } from '../OntologyService.js';

export interface MissionSource {
  listRecent?: (limit: number) => Promise<Array<Record<string, unknown>>>;
  getAll?: () => Promise<Array<Record<string, unknown>>>;
  getById?: (id: string) => Promise<Record<string, unknown> | null>;
}

export class MissionProjector {
  constructor(
    private readonly ontology: OntologyService,
    private readonly missionSource: MissionSource,
  ) {}

  /**
   * projectAll — 将所有 Mission 投影到 Ontology
   *
   * @param limit - 最大投影数量
   * @returns 投影的对象数量
   */
  async projectAll(limit = 200): Promise<number> {
    const list =
      (await this.missionSource.listRecent?.(limit)) ??
      (await this.missionSource.getAll?.()) ??
      [];

    let count = 0;
    for (const m of list) {
      try {
        await this.ontology.upsertObject({
          id: String(m.id ?? m.missionId ?? `mission_${Date.now()}_${count}`),
          type: 'Mission',
          status: String(m.status ?? m.phase ?? 'unknown'),
          properties: {
            title: String(m.title ?? m.name ?? m.goal ?? m.id ?? 'Unnamed Mission'),
            goal: m.goal ?? m.objective,
            departmentId: m.departmentId,
            priority: m.priority,
            phase: m.phase,
            rawStatus: m.status,
          },
        });
        count++;
      } catch (err) {
        console.warn(`[MissionProjector] ⚠️ 投影失败:`, (err as Error).message);
      }
    }

    if (count > 0) {
      console.log(`[MissionProjector] ✅ 已投影 ${count} 个 Mission`);
    }
    return count;
  }

  /**
   * projectOne — 投影单个 Mission
   */
  async projectOne(id: string): Promise<boolean> {
    if (!this.missionSource.getById) return false;
    const m = await this.missionSource.getById(id);
    if (!m) return false;

    await this.ontology.upsertObject({
      id: String(m.id ?? id),
      type: 'Mission',
      status: String(m.status ?? m.phase ?? 'unknown'),
      properties: {
        title: String(m.title ?? m.name ?? m.goal ?? id),
        goal: m.goal ?? m.objective,
        departmentId: m.departmentId,
        priority: m.priority,
        phase: m.phase,
      },
    });
    return true;
  }
}
