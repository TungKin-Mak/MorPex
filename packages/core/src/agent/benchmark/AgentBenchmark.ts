/**
 * AgentBenchmark — v9 Agent 能力基准测试
 *
 * 标准化测试评估 Agent 的各项能力。
 * 用于: Agent 评级、能力退化检测、新旧 Agent 对比。
 *
 * 测试分类:
 *   - latency: 响应延迟
 *   - accuracy: 输出准确率
 *   - robustness: 异常输入处理
 *   - recovery: 故障恢复能力
 */

import type { AgentProfile } from '../identity/AgentProfile.js'
import type { AgentRegistry } from '../registry/AgentRegistry.js'

export interface BenchmarkCase {
  name: string
  category: 'latency' | 'accuracy' | 'robustness' | 'recovery'
  capability: string                    // 测试的能力
  input: Record<string, unknown>
  expectedOutput: Record<string, unknown>
  maxLatencyMs: number
  weight: number                        // 在总分中的权重
}

export interface BenchmarkResult {
  agentId: string
  totalScore: number                    // 0-1
  categoryScores: {
    latency: number
    accuracy: number
    robustness: number
    recovery: number
  }
  cases: {
    name: string
    passed: boolean
    score: number
    latencyMs: number
    errors: string[]
  }[]
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F'
  timestamp: number
}

const DEFAULT_BENCHMARK: BenchmarkCase[] = [
  // Latency tests
  { name: 'simple_response', category: 'latency', capability: 'task_execution', input: { task: 'echo hello' }, expectedOutput: { result: 'hello' }, maxLatencyMs: 1000, weight: 10 },
  { name: 'complex_response', category: 'latency', capability: 'task_execution', input: { task: 'process large payload', size: 1000 }, expectedOutput: { processed: true }, maxLatencyMs: 5000, weight: 5 },
  // Accuracy tests
  { name: 'exact_match', category: 'accuracy', capability: 'coding', input: { task: 'write function: add(a,b) return a+b' }, expectedOutput: { code: 'function add(a,b){return a+b}' }, maxLatencyMs: 5000, weight: 15 },
  { name: 'schema_match', category: 'accuracy', capability: 'output_validation', input: { task: 'validate json', data: '{"name":"test"}' }, expectedOutput: { valid: true }, maxLatencyMs: 2000, weight: 15 },
  // Robustness tests
  { name: 'empty_input', category: 'robustness', capability: 'error_handling', input: { task: '' }, expectedOutput: { error: 'invalid_input' }, maxLatencyMs: 1000, weight: 10 },
  { name: 'malformed_input', category: 'robustness', capability: 'error_handling', input: { task: null }, expectedOutput: { error: 'invalid_input' }, maxLatencyMs: 1000, weight: 10 },
  // Recovery tests
  { name: 'timeout_recovery', category: 'recovery', capability: 'error_handling', input: { task: 'slow_operation', timeout: 100 }, expectedOutput: { recovered: true, fallback: true }, maxLatencyMs: 3000, weight: 10 },
  { name: 'error_recovery', category: 'recovery', capability: 'error_handling', input: { task: 'throw_error' }, expectedOutput: { recovered: true, error_handled: true }, maxLatencyMs: 2000, weight: 10 },
]

export class AgentBenchmark {
  private cases: BenchmarkCase[]

  constructor(cases?: BenchmarkCase[]) {
    this.cases = cases ?? DEFAULT_BENCHMARK
  }

  /**
   * run — 对单个 Agent 运行基准测试
   *
   * @param agentId - Agent ID
   * @param registry - AgentRegistry
   * @param executor - 执行函数 (接收 input, 返回 output + latency)
   */
  async run(
    agentId: string,
    registry: AgentRegistry,
    executor: (input: Record<string, unknown>) => Promise<{ output: unknown; latencyMs: number }>,
  ): Promise<BenchmarkResult> {
    const profile = registry.getAgent(agentId)
    if (!profile) {
      return { agentId, totalScore: 0, categoryScores: { latency: 0, accuracy: 0, robustness: 0, recovery: 0 }, cases: [], grade: 'F', timestamp: Date.now() }
    }

    const agentCaps = profile.identity.capabilities
    const relevantCases = this.cases.filter(c => agentCaps.includes(c.capability))

    const caseResults: BenchmarkResult['cases'] = []
    const categoryTotals: Record<string, { weight: number; score: number }> = {
      latency: { weight: 0, score: 0 },
      accuracy: { weight: 0, score: 0 },
      robustness: { weight: 0, score: 0 },
      recovery: { weight: 0, score: 0 },
    }

    for (const testCase of relevantCases) {
      const errors: string[] = []
      let score = 0
      let latencyMs = 0

      try {
        const { output, latencyMs: actualLatency } = await executor(testCase.input)
        latencyMs = actualLatency

        // Latency check
        if (actualLatency <= testCase.maxLatencyMs) {
          score += 0.4
        } else {
          errors.push(`Latency ${actualLatency}ms > max ${testCase.maxLatencyMs}ms`)
        }

        // Output check
        if (this.matchOutput(output, testCase.expectedOutput)) {
          score += 0.6
        } else {
          errors.push('Output mismatch')
        }

        caseResults.push({ name: testCase.name, passed: score >= 0.6, score, latencyMs, errors })
      } catch (err: any) {
        caseResults.push({ name: testCase.name, passed: false, score: 0, latencyMs, errors: [err.message] })
      }

      categoryTotals[testCase.category].weight += testCase.weight
      categoryTotals[testCase.category].score += score * testCase.weight
    }

    // Compute category scores
    const categoryScores = {
      latency: categoryTotals.latency.weight > 0 ? categoryTotals.latency.score / categoryTotals.latency.weight : 1,
      accuracy: categoryTotals.accuracy.weight > 0 ? categoryTotals.accuracy.score / categoryTotals.accuracy.weight : 1,
      robustness: categoryTotals.robustness.weight > 0 ? categoryTotals.robustness.score / categoryTotals.robustness.weight : 1,
      recovery: categoryTotals.recovery.weight > 0 ? categoryTotals.recovery.score / categoryTotals.recovery.weight : 1,
    }

    // Total score: weighted by category importance
    const totalScore = categoryScores.latency * 0.15 + categoryScores.accuracy * 0.40 + categoryScores.robustness * 0.25 + categoryScores.recovery * 0.20

    const grade = totalScore >= 0.95 ? 'S' : totalScore >= 0.85 ? 'A' : totalScore >= 0.70 ? 'B' : totalScore >= 0.50 ? 'C' : totalScore >= 0.30 ? 'D' : 'F'

    return { agentId, totalScore: Math.round(totalScore * 1000) / 1000, categoryScores, cases: caseResults, grade, timestamp: Date.now() }
  }

  /**
   * runAll — 对 Registry 中所有 Agent 运行基准测试
   */
  async runAll(
    registry: AgentRegistry,
    executor: (agentId: string, input: Record<string, unknown>) => Promise<{ output: unknown; latencyMs: number }>,
  ): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = []
    const agents = registry.listAgents('ACTIVE')

    for (const profile of agents) {
      const result = await this.run(profile.identity.id, registry, (input) => executor(profile.identity.id, input))
      results.push(result)
    }

    return results.sort((a, b) => b.totalScore - a.totalScore)
  }

  /**
   * addCase — 添加自定义测试用例
   */
  addCase(testCase: BenchmarkCase): void {
    this.cases.push(testCase)
  }

  private matchOutput(actual: unknown, expected: Record<string, unknown>): boolean {
    if (!actual || typeof actual !== 'object') return false
    const act = actual as Record<string, unknown>
    let matched = 0
    const keys = Object.keys(expected)
    for (const key of keys) {
      if (key === '*' || act[key] === expected[key]) matched++
    }
    return keys.length > 0 && matched / keys.length >= 0.7
  }
}
