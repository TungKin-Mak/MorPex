/**
 * FailureScenario — 故障场景定义 (v8.9)
 *
 * Chaos Testing 系统的基础单元。
 * 每个场景描述一种可注入的故障及其预期恢复策略。
 */

export interface FailureScenario {
  id: string
  name: string
  target: 'sandbox' | 'llm' | 'network' | 'database' | 'artifact' | 'budget'
  probability: number
  description: string
  action: (context: Record<string, unknown>) => Promise<void>
  expectedRecovery: string
  severity: 'low' | 'medium' | 'high' | 'critical'
}

export const BUILTIN_SCENARIOS: FailureScenario[] = [
  {
    id: 'sandbox-crash',
    name: 'Sandbox Crash',
    target: 'sandbox',
    probability: 0.2,
    description: 'Simulates sandbox process crash during execution',
    async action(ctx) { throw new Error('Sandbox crashed unexpectedly') },
    expectedRecovery: 'retry',
    severity: 'high',
  },
  {
    id: 'llm-timeout',
    name: 'LLM Timeout',
    target: 'llm',
    probability: 0.15,
    description: 'Simulates LLM API timeout',
    async action(ctx) { throw new Error('LLM request timed out after 30s') },
    expectedRecovery: 'fallback',
    severity: 'medium',
  },
  {
    id: 'network-partition',
    name: 'Network Partition',
    target: 'network',
    probability: 0.1,
    description: 'Simulates network connectivity loss',
    async action(ctx) { throw new Error('Network unreachable') },
    expectedRecovery: 'retry',
    severity: 'high',
  },
  {
    id: 'database-unavailable',
    name: 'Database Unavailable',
    target: 'database',
    probability: 0.1,
    description: 'Simulates database connection failure',
    async action(ctx) { throw new Error('Database connection refused') },
    expectedRecovery: 'retry',
    severity: 'critical',
  },
  {
    id: 'artifact-corruption',
    name: 'Artifact Corruption',
    target: 'artifact',
    probability: 0.08,
    description: 'Simulates corrupted artifact output',
    async action(ctx) { ctx.corrupted = true },
    expectedRecovery: 'compensation',
    severity: 'medium',
  },
  {
    id: 'budget-exhausted',
    name: 'Budget Exhausted',
    target: 'budget',
    probability: 0.12,
    description: 'Simulates token budget exhaustion mid-execution',
    async action(ctx) { ctx.budgetExhausted = true; throw new Error('Token budget exceeded') },
    expectedRecovery: 'escalation',
    severity: 'high',
  },
]
