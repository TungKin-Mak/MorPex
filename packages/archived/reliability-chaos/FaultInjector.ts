/**
 * FaultInjector — 故障注入器 (v8.9)
 *
 * 注册故障场景并按概率注入。
 */

import { BUILTIN_SCENARIOS } from './FailureScenario.js'
import type { FailureScenario } from './FailureScenario.js'

export interface InjectionResult {
  injected: boolean
  scenarioId: string
  target: string
  error?: string
  timestamp: number
}

export class FaultInjector {
  private scenarios: FailureScenario[] = [...BUILTIN_SCENARIOS]
  private enabled = true
  private injectionLog: InjectionResult[] = []

  register(scenario: FailureScenario): void {
    this.scenarios.push(scenario)
  }

  unregister(scenarioId: string): boolean {
    const idx = this.scenarios.findIndex(s => s.id === scenarioId)
    if (idx === -1) return false
    this.scenarios.splice(idx, 1)
    return true
  }

  enable(): void { this.enabled = true }
  disable(): void { this.enabled = false }
  isEnabled(): boolean { return this.enabled }

  async inject(target: string, context: Record<string, unknown>): Promise<InjectionResult[]> {
    if (!this.enabled) return []
    const candidates = this.scenarios.filter(s => s.target === target)
    const results: InjectionResult[] = []

    for (const scenario of candidates) {
      if (Math.random() < scenario.probability) {
        try {
          await scenario.action(context)
        } catch (err: any) {
          const result: InjectionResult = {
            injected: true,
            scenarioId: scenario.id,
            target: scenario.target,
            error: err?.message || String(err),
            timestamp: Date.now(),
          }
          this.injectionLog.push(result)
          results.push(result)
        }
      }
    }

    return results
  }

  getHistory(): InjectionResult[] {
    return [...this.injectionLog]
  }

  getHistoryByTarget(target: string): InjectionResult[] {
    return this.injectionLog.filter(r => r.target === target)
  }

  resetHistory(): void {
    this.injectionLog = []
  }
}
