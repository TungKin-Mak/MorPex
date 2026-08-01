/**
 * Sandbox — 类型定义
 *
 * MorPex v8.8: 沙箱隔离执行上下文。
 */

export interface SandboxContext {
  cpuLimit: number
  memoryLimit: number
  network: boolean
  filesystem: 'readonly' | 'isolated' | 'full'
  timeout: number
  allowedCommands?: string[]
}

export interface SandboxExecutionResult {
  success: boolean
  output: unknown
  error?: string
  duration: number
  resourceUsage: { cpuMs: number; memoryMb: number }
  sandboxed: boolean
}
