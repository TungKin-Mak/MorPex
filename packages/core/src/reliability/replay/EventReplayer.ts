/**
 * EventReplayer — 批量事件重放器 (v8.9)
 *
 * 支持时间范围重放和批量重放，用于回归测试。
 */

import { ReplayEngine } from './ReplayEngine.js'
import type { ReplayState } from './ReplayEngine.js'

export class EventReplayer {
  constructor(private engine: ReplayEngine) {}

  async replayRange(start: number, end: number): Promise<ReplayState[]> {
    const eventStore = (this.engine as any).eventStore
    if (!eventStore?.getByTimeRange) return []

    const events = eventStore.getByTimeRange(start, end)
    const missionIds = new Set<string>(
      events.map((e: any) => e.executionId || e.payload?.missionId).filter(Boolean),
    )

    const results: ReplayState[] = []
    for (const id of missionIds) {
      const state = await this.engine.replay(id)
      results.push(state)
    }

    return results
  }

  async batchReplay(missionIds: string[]): Promise<Map<string, ReplayState>> {
    const results = new Map<string, ReplayState>()
    for (const id of missionIds) {
      const state = await this.engine.replay(id)
      results.set(id, state)
    }
    return results
  }
}
