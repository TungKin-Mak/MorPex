/**
 * ResultAggregator — 多 Agent 结果聚合器 (v9.0)
 *
 * 协作完成后，根据模式合并多个 Agent 的输出。
 */

export class ResultAggregator {
  sequential(results: unknown[]): unknown {
    if (results.length === 0) return null
    return results[results.length - 1]
  }

  parallel(results: unknown[]): Record<string, unknown> {
    // Merge all objects into one
    const merged: Record<string, unknown> = {}
    for (const r of results) {
      if (r && typeof r === 'object') {
        Object.assign(merged, r as Record<string, unknown>)
      }
    }
    return merged
  }

  voting(results: { value: unknown; confidence: number }[]): {
    winner: unknown
    voteCount: number
    totalVotes: number
  } {
    const counts = new Map<string, number>()
    for (const r of results) {
      const key = JSON.stringify(r.value)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }

    let maxCount = 0
    let winnerValue: unknown = null
    for (const [key, count] of counts) {
      if (count > maxCount) {
        maxCount = count
        winnerValue = JSON.parse(key)
      }
    }

    return { winner: winnerValue, voteCount: maxCount, totalVotes: results.length }
  }

  pipeline(initialInput: unknown, stages: ((input: unknown) => unknown)[]): unknown {
    let result = initialInput
    for (const stage of stages) {
      result = stage(result)
    }
    return result
  }
}
