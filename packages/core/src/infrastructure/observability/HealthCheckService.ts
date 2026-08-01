/**
 * HealthCheckService — 健康检查聚合器
 *
 * v9.2 Phase 4: 注册多个健康检查，并行运行并汇总状态。
 * 支持超时、熔断降级语义 (healthy/degraded/unhealthy)。
 */

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy'
  checks: Record<string, { status: string; detail?: string; latencyMs: number }>
  version: string
  uptimeMs: number
  timestamp: number
}

export interface HealthCheck {
  name: string
  check: () => Promise<{ status: string; detail?: string }>
  timeoutMs?: number
}

export class HealthCheckService {
  private checks = new Map<string, HealthCheck>()
  private startTime = Date.now()
  private version: string

  constructor(version?: string) {
    this.version = version ?? '0.0.0'
  }

  register(check: HealthCheck): void {
    this.checks.set(check.name, check)
  }

  unregister(name: string): boolean {
    return this.checks.delete(name)
  }

  async run(): Promise<HealthStatus> {
    const result: HealthStatus['checks'] = {}
    const promises = Array.from(this.checks.values()).map(async (check) => {
      const start = Date.now()
      try {
        const timeoutMs = check.timeoutMs ?? 5000
        const checkResult = await Promise.race([
          check.check(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), timeoutMs)
          ),
        ])
        return { name: check.name, status: checkResult.status, detail: checkResult.detail, latencyMs: Date.now() - start }
      } catch (err: any) {
        const status = err.message === 'timeout' ? 'timeout' : 'error';
        return { name: check.name, status, detail: err.message, latencyMs: Date.now() - start }
      }
    })

    const settled = await Promise.allSettled(promises)
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        result[r.value.name] = { status: r.value.status, detail: r.value.detail, latencyMs: r.value.latencyMs }
      }
    }

    const statuses = Object.values(result).map(r => r.status)
    const allOk = statuses.every(s => s === 'ok')
    const anyOk = statuses.some(s => s === 'ok')
    const anyError = statuses.some(s => s === 'error')
    const anyTimeout = statuses.some(s => s === 'timeout')

    let overall: 'healthy' | 'degraded' | 'unhealthy'
    if (allOk) {
      overall = 'healthy'
    } else if (anyError && !anyOk) {
      overall = 'unhealthy'
    } else {
      overall = 'degraded'
    }

    return {
      status: overall,
      checks: result,
      version: this.version,
      uptimeMs: Date.now() - this.startTime,
      timestamp: Date.now(),
    }
  }
}
