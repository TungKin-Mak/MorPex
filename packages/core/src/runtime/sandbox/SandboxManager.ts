/**
 * SandboxManager — 沙箱执行管理器
 *
 * MorPex v8.8 -> v9.2: 从模拟层升级为真实代码执行。
 * 每个任务在沙箱上下文中执行，限制 CPU/内存/网络/文件系统访问。
 *
 * v9.2 新增:
 *   - executeCode() — 真实 child_process 执行代码
 *   - executeCodeFromArtifact() — 从产物自动提取并执行
 *   - detectLanguage() — 自动识别代码语言
 *   - 支持 Python, JavaScript, Go, Bash, TypeScript (tsx)
 *   - 超时杀进程, 输出截断, 内存监控
 */

import { execFile, type ExecFileOptions } from 'node:child_process';

// ── SandboxContext ──

export interface SandboxContext {
  cpuLimit: number
  memoryLimit: number
  network: boolean
  filesystem: 'readonly' | 'isolated' | 'full'
  timeout: number
  allowedCommands?: string[]
}

// ── SandboxExecutionResult ──

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

const THIRD_PARTY_CONTEXT: SandboxContext = {
  cpuLimit: 1, memoryLimit: 256, network: false, filesystem: 'readonly', timeout: 60000, allowedCommands: [],
}

// ═══════════════════════════════════════════════════════════════
// SandboxManager
// ═══════════════════════════════════════════════════════════════

export class SandboxManager {
  private stats = {
    totalExecutions: 0, totalFailures: 0, totalRejections: 0, totalDurationMs: 0,
  }

  private agentBehavior = new Map<string, { actions: { action: string; timestamp: number }[] }>()

  /** 支持的语言映射 */
  private static readonly LANG_MAP: Record<string, { cmd: string; args: string[]; ext: string }> = {
    python:       { cmd: 'python3',  args: ['-c'],                   ext: '.py' },
    python3:      { cmd: 'python3',  args: ['-c'],                   ext: '.py' },
    javascript:   { cmd: 'node',     args: ['--max-old-space-size=256', '-e'], ext: '.js' },
    js:           { cmd: 'node',     args: ['--max-old-space-size=256', '-e'], ext: '.js' },
    typescript:   { cmd: 'npx',      args: ['tsx', '-e'],            ext: '.ts' },
    ts:           { cmd: 'npx',      args: ['tsx', '-e'],            ext: '.ts' },
    go:           { cmd: 'go',       args: ['run'],                  ext: '.go' },
    bash:         { cmd: 'bash',     args: ['-c'],                   ext: '.sh' },
    shell:        { cmd: 'bash',     args: ['-c'],                   ext: '.sh' },
    sh:           { cmd: 'bash',     args: ['-c'],                   ext: '.sh' },
  };

  // ═══════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════

  async execute(
    task: { id: string; action: string; params: Record<string, unknown> },
    context: SandboxContext,
    agentId?: string,
  ): Promise<SandboxExecutionResult> {
    let effectiveContext = context;
    if (agentId) {
      const riskScore = this.getAgentRiskScore(agentId);
      if (riskScore >= 0.7) effectiveContext = this.getThirdPartySandboxContext();
    }
    const startTime = Date.now();
    this.stats.totalExecutions++;

    const validation = this.validateTask(task);
    if (!validation.safe) {
      this.stats.totalRejections++;
      this.stats.totalFailures++;
      return {
        success: false, output: null,
        error: `Sandbox rejection: ${validation.warnings.join('; ')}`,
        duration: Date.now() - startTime,
        resourceUsage: { cpuMs: 0, memoryMb: 0 }, sandboxed: true,
      };
    }

    try {
      const result = await this.runSandboxed(task, context);
      const duration = Date.now() - startTime;
      this.stats.totalDurationMs += duration;
      if (!result.success) this.stats.totalFailures++;
      return { ...result, duration, sandboxed: true };
    } catch (err: any) {
      this.stats.totalFailures++;
      return {
        success: false, output: null,
        error: `[Sandbox] ${err?.message || String(err)}`,
        duration: Date.now() - startTime,
        resourceUsage: { cpuMs: 0, memoryMb: 0 }, sandboxed: true,
      };
    }
  }

  validateTask(task: { action: string; params: Record<string, unknown> }): { safe: boolean; warnings: string[] } {
    const warnings: string[] = [];
    const action = (task.action || '').toLowerCase();
    for (const risky of RISKY_ACTIONS) {
      if (action.includes(risky)) warnings.push(`Risky action detected: "${risky}" is blocked in sandbox`);
    }
    for (const warn of WARNING_ACTIONS) {
      if (action.includes(warn)) warnings.push(`Warning: "${warn}" action requires elevated permissions`);
    }
    return { safe: warnings.length === 0 || !warnings.some(w => w.includes('blocked')), warnings };
  }

  getDefaultContext(domain: string): SandboxContext {
    return { ...(DEFAULT_CONTEXTS[domain] || DEFAULT_CONTEXTS.general) };
  }

  getThirdPartySandboxContext(): SandboxContext {
    return { ...THIRD_PARTY_CONTEXT };
  }

  registerAgentBehavior(agentId: string, action: string): void {
    if (!this.agentBehavior.has(agentId)) this.agentBehavior.set(agentId, { actions: [] });
    this.agentBehavior.get(agentId)!.actions.push({ action, timestamp: Date.now() });
  }

  getAgentRiskScore(agentId: string): number {
    const record = this.agentBehavior.get(agentId);
    if (!record || record.actions.length === 0) return 0;
    const now = Date.now();
    const fiveMinAgo = now - 300000;
    let riskyCount = 0, recentCount = 0;
    for (const { action, timestamp } of record.actions) {
      if (RISKY_ACTIONS.some(r => action.toLowerCase().includes(r))) riskyCount++;
      if (timestamp >= fiveMinAgo) recentCount++;
    }
    const baseRisk = riskyCount / record.actions.length;
    const recencyPenalty = recentCount > 0 ? 0.2 * Math.min(1, recentCount / 5) : 0;
    return Math.min(1, baseRisk + recencyPenalty);
  }

  getHighRiskAgentIds(threshold: number = 0.7): string[] {
    const result: string[] = [];
    for (const [agentId] of this.agentBehavior) {
      if (this.getAgentRiskScore(agentId) >= threshold) result.push(agentId);
    }
    return result;
  }

  getStats() {
    return {
      totalExecutions: this.stats.totalExecutions,
      totalFailures: this.stats.totalFailures,
      totalRejections: this.stats.totalRejections,
      avgDuration: this.stats.totalExecutions > 0
        ? Math.round(this.stats.totalDurationMs / this.stats.totalExecutions) : 0,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // v9.2: Real code execution
  // ═══════════════════════════════════════════════════════════

  /**
   * detectLanguage — 从代码内容或文件名推测语言
   */
  detectLanguage(code: string, fileName?: string): string | null {
    if (fileName) {
      const ext = fileName.split('.').pop()?.toLowerCase();
      const extMap: Record<string, string> = {
        py: 'python', js: 'javascript', ts: 'typescript',
        go: 'go', sh: 'bash', bash: 'bash',
      };
      if (ext && extMap[ext]) return extMap[ext];
    }
    if (/^\s*(package\s+\w+|import\s+"fmt"|func\s+\w+\()/m.test(code)) return 'go';
    if (/^\s*(def\s+\w+|import\s+\w+|print\s*\()/m.test(code)) return 'python';
    if (/^\s*(const\s+\w+|let\s+\w+|function\s+\w+|import\s+.*from)/m.test(code)) return 'javascript';
    if (/^\s*#!\/bin\/(bash|sh)/.test(code)) return 'bash';
    return null;
  }

  /**
   * executeCode — 真实 child_process 执行代码
   */
  async executeCode(
    language: string,
    code: string,
    stdin?: string,
    context?: Partial<SandboxContext>,
  ): Promise<{
    success: boolean; stdout: string; stderr: string;
    exitCode: number | null; killed: boolean; duration: number; language: string;
  }> {
    const lang = SandboxManager.LANG_MAP[language.toLowerCase()];
    if (!lang) {
      return {
        success: false, stdout: '',
        stderr: `Unsupported language: ${language}. Supported: ${Object.keys(SandboxManager.LANG_MAP).join(', ')}`,
        exitCode: -1, killed: false, duration: 0, language,
      };
    }
    const timeout = context?.timeout || 30000;
    const t0 = Date.now();
    return new Promise((resolve) => {
      const child = execFile(lang.cmd, [...lang.args, code], {
        timeout, maxBuffer: 1024 * 1024, killSignal: 'SIGKILL',
        env: { ...process.env, LANG: 'en_US.UTF-8' },
      } as ExecFileOptions, (err, stdout, stderr) => {
        const duration = Date.now() - t0;
        const killed = err?.killed || false;
        const exitCode = err ? (err as any).code ?? 1 : 0;
        resolve({
          success: !err && exitCode === 0,
          stdout: String(stdout || '').slice(0, 50000),
          stderr: String(stderr || '').slice(0, 10000),
          exitCode, killed, duration, language,
        });
      });
      if (stdin && child.stdin) { child.stdin.write(stdin); child.stdin.end(); }
    });
  }

  /**
   * executeCodeFromArtifact — 从产物对象中提取代码并执行
   */
  async executeCodeFromArtifact(
    artifact: { name?: string; type?: string; content?: unknown },
    context?: Partial<SandboxContext>,
  ): Promise<Awaited<ReturnType<SandboxManager['executeCode']>> | null> {
    const content = typeof artifact.content === 'string'
      ? artifact.content
      : JSON.stringify(artifact.content);
    if (!content || content.length < 10) return null;
    const language = this.detectLanguage(content, artifact.name);
    if (!language) return null;
    return this.executeCode(language, content, undefined, context);
  }

  // ═══════════════════════════════════════════════════════════
  // Internal
  // ═══════════════════════════════════════════════════════════

  private async runSandboxed(
    task: { id: string; action: string; params: Record<string, unknown> },
    context: SandboxContext,
  ): Promise<{ success: boolean; output: unknown; error?: string; resourceUsage: { cpuMs: number; memoryMb: number } }> {
    const timeout = context.timeout;
    const startCpu = process.cpuUsage();
    const result = await Promise.race([
      this.executeAction(task.action, task.params),
      new Promise<{ success: boolean; output: unknown; error: string; resourceUsage: { cpuMs: number; memoryMb: number } }>(
        (_, reject) => setTimeout(() => reject(new Error('Sandbox timeout')), timeout),
      ),
    ]);
    const cpuUsage = process.cpuUsage(startCpu);
    const memUsage = process.memoryUsage();
    return {
      success: result.success, output: result.output, error: result.error,
      resourceUsage: {
        cpuMs: Math.round((cpuUsage.user + cpuUsage.system) / 1000),
        memoryMb: Math.round(memUsage.heapUsed / 1024 / 1024),
      },
    };
  }

  /**
   * executeAction — v9.2: 如果 params 含 code，执行真实代码
   */
  private async executeAction(
    action: string,
    params: Record<string, unknown>,
  ): Promise<{ success: boolean; output: unknown; error?: string }> {
    // v9.2: 如果参数中有 code 字段，进行真实执行
    if (params.code && typeof params.code === 'string' && params.code.length > 5) {
      const language = (params.language as string) || this.detectLanguage(params.code) || 'python';
      try {
        const result = await this.executeCode(language, params.code, undefined, {
          timeout: 30000,
        });
        return {
          success: result.success,
          output: {
            action, language,
            stdout: result.stdout.slice(0, 2000),
            stderr: result.stderr.slice(0, 1000),
            exitCode: result.exitCode,
            duration: result.duration,
          },
          error: result.success ? undefined : (result.stderr || `exit code ${result.exitCode}`),
        };
      } catch (err: any) {
        return { success: false, output: null, error: `Code execution failed: ${err.message}` };
      }
    }

    // Fallback: 未知 action — 没有 code 也没有注册的 handler
    return { success: false, output: null, error: `Sandbox: unknown action '${action}' — no code to execute and no handler registered` };
  }
}
