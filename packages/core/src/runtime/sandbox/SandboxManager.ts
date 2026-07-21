/**
 * SandboxManager — 沙箱执行管理器
 *
 * MorPex v8.8: 防止 Agent 执行破坏环境。
 * 每个任务在沙箱上下文中执行，限制 CPU/内存/网络/文件系统访问。
 */

// ── SandboxContext — 沙箱执行上下文 ──

export interface SandboxContext {
  cpuLimit: number
  memoryLimit: number
  network: boolean
  filesystem: 'readonly' | 'isolated' | 'full'
  timeout: number
  allowedCommands?: string[]
}

// ── SandboxExecutionResult — 沙箱执行结果 ──

export interface SandboxExecutionResult {
  success: boolean
  output: unknown
  error?: string
  duration: number
  resourceUsage: { cpuMs: number; memoryMb: number }
  sandboxed: boolean
}

// ── 默认沙箱配置 ──

const DEFAULT_CONTEXTS: Record<string, SandboxContext> = {
  coding:     { cpuLimit: 2,  memoryLimit: 2048, network: false, filesystem: 'isolated',  timeout: 300000 },
  finance:    { cpuLimit: 1,  memoryLimit: 512,  network: false, filesystem: 'readonly',  timeout: 120000 },
  deployment: { cpuLimit: 1,  memoryLimit: 1024, network: true,  filesystem: 'isolated',  timeout: 600000 },
  writing:    { cpuLimit: 1,  memoryLimit: 512,  network: true,  filesystem: 'readonly',  timeout: 120000 },
  research:   { cpuLimit: 2,  memoryLimit: 2048, network: true,  filesystem: 'readonly',  timeout: 300000 },
  general:    { cpuLimit: 1,  memoryLimit: 1024, network: true,  filesystem: 'isolated',  timeout: 300000 },
}

const RISKY_ACTIONS = ['delete', 'remove', 'destroy', 'terminate', 'exec', 'eval', 'write_system', 'modify_config']
const WARNING_ACTIONS = ['deploy', 'publish', 'release', 'email', 'payment', 'write_file']

// ═══════════════════════════════════════════════════════════════
// SandboxManager
// ═══════════════════════════════════════════════════════════════

export class SandboxManager {
  private stats = {
    totalExecutions: 0,
    totalFailures: 0,
    totalRejections: 0,
    totalDurationMs: 0,
  }

  /**
   * execute — 在沙箱上下文中执行任务
   *
   * @param task - 要执行的任务
   * @param context - 沙箱上下文
   * @returns SandboxExecutionResult
   */
  async execute(
    task: { id: string; action: string; params: Record<string, unknown> },
    context: SandboxContext,
  ): Promise<SandboxExecutionResult> {
    const startTime = Date.now()
    this.stats.totalExecutions++

    // 验证任务是否安全
    const validation = this.validateTask(task)
    if (!validation.safe) {
      this.stats.totalRejections++
      this.stats.totalFailures++
      return {
        success: false,
        output: null,
        error: `Sandbox rejection: ${validation.warnings.join('; ')}`,
        duration: Date.now() - startTime,
        resourceUsage: { cpuMs: 0, memoryMb: 0 },
        sandboxed: true,
      }
    }

    // 在沙箱上下文中执行（当前为模拟包装）
    try {
      const result = await this.runSandboxed(task, context)
      const duration = Date.now() - startTime
      this.stats.totalDurationMs += duration

      if (!result.success) {
        this.stats.totalFailures++
      }

      return {
        success: result.success,
        output: result.output,
        error: result.error,
        duration,
        resourceUsage: result.resourceUsage,
        sandboxed: true,
      }
    } catch (err: any) {
      this.stats.totalFailures++
      return {
        success: false,
        output: null,
        error: `[Sandbox] ${err?.message || String(err)}`,
        duration: Date.now() - startTime,
        resourceUsage: { cpuMs: 0, memoryMb: 0 },
        sandboxed: true,
      }
    }
  }

  /**
   * validateTask — 检查任务是否可以在沙箱中安全执行
   *
   * @param task - 待检查的任务
   * @returns { safe, warnings }
   */
  validateTask(task: { action: string; params: Record<string, unknown> }): { safe: boolean; warnings: string[] } {
    const warnings: string[] = []
    const action = (task.action || '').toLowerCase()

    for (const risky of RISKY_ACTIONS) {
      if (action.includes(risky)) {
        warnings.push(`Risky action detected: "${risky}" is blocked in sandbox`)
      }
    }

    for (const warn of WARNING_ACTIONS) {
      if (action.includes(warn)) {
        warnings.push(`Warning: "${warn}" action requires elevated permissions`)
      }
    }

    return { safe: warnings.length === 0 || !warnings.some(w => w.includes('blocked')), warnings }
  }

  /**
   * getDefaultContext — 获取指定领域的默认沙箱上下文
   *
   * @param domain - 领域名称
   * @returns SandboxContext
   */
  getDefaultContext(domain: string): SandboxContext {
    return { ...(DEFAULT_CONTEXTS[domain] || DEFAULT_CONTEXTS.general) }
  }

  /**
   * getStats — 获取沙箱执行统计
   */
  getStats(): { totalExecutions: number; totalFailures: number; totalRejections: number; avgDuration: number } {
    return {
      totalExecutions: this.stats.totalExecutions,
      totalFailures: this.stats.totalFailures,
      totalRejections: this.stats.totalRejections,
      avgDuration: this.stats.totalExecutions > 0
        ? Math.round(this.stats.totalDurationMs / this.stats.totalExecutions)
        : 0,
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════

  /**
   * runSandboxed — 在沙箱限制下执行实际任务
   *
   * 当前实现包装传入的执行函数。未来可对接容器/VM 运行时。
   */
  private async runSandboxed(
    task: { id: string; action: string; params: Record<string, unknown> },
    context: SandboxContext,
  ): Promise<{ success: boolean; output: unknown; error?: string; resourceUsage: { cpuMs: number; memoryMb: number } }> {
    const timeout = context.timeout
    const startCpu = process.cpuUsage()

    // 包装 Promise 带超时
    const result = await Promise.race([
      this.executeAction(task.action, task.params),
      new Promise<{ success: boolean; output: unknown; error: string; resourceUsage: { cpuMs: number; memoryMb: number } }>(
        (_, reject) => setTimeout(() => reject(new Error('Sandbox timeout')), timeout),
      ),
    ])

    const cpuUsage = process.cpuUsage(startCpu)
    const memUsage = process.memoryUsage()

    return {
      success: result.success,
      output: result.output,
      error: result.error,
      resourceUsage: {
        cpuMs: Math.round((cpuUsage.user + cpuUsage.system) / 1000),
        memoryMb: Math.round(memUsage.heapUsed / 1024 / 1024),
      },
    }
  }

  /**
   * executeAction — 执行具体操作（当前为模拟层）
   *
   * 未来替换为真实的 Agent/Runtime 调用。
   */
  private async executeAction(
    action: string,
    params: Record<string, unknown>,
  ): Promise<{ success: boolean; output: unknown; error?: string }> {
    // 模拟执行 — 默认成功
    return { success: true, output: { action, params, result: 'executed_in_sandbox' } }
  }
}
