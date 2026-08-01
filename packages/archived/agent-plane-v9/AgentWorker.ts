/**
 * AgentWorker — v9 Agent 执行器
 *
 * 桥接 MessageBus 和 AgentHarness。
 * 每个 Agent 拥有一个 Worker，监听 MessageBus 并执行任务。
 *
 * 生命周期:
 *   1. 注册到 MessageBus
 *   2. 收到 REQUEST → 通过 AgentHarness 执行
 *   3. 返回 RESULT 到 MessageBus
 *   4. 记录到 AgentProfile
 */

import type { AgentMessageBus } from './communication/AgentMessageBus.js'
import type { AgentRegistry } from './registry/AgentRegistry.js'

export interface AgentWorkerConfig {
  agentId: string
  messageBus: AgentMessageBus
  registry: AgentRegistry
  harness?: any
  memoryIsolation?: any
  onResult?: (taskId: string, success: boolean, output: unknown, duration: number) => void
}

export class AgentWorker {
  readonly agentId: string
  private messageBus: AgentMessageBus
  private registry: AgentRegistry
  private harness: any
  private memoryIsolation: any = null
  private onResult?: AgentWorkerConfig['onResult']
  private active: boolean = false
  private processedCount: number = 0

  constructor(config: AgentWorkerConfig & { memoryIsolation?: any }) {
    this.agentId = config.agentId
    this.messageBus = config.messageBus
    this.registry = config.registry
    this.harness = config.harness ?? null
    this.memoryIsolation = (config as any).memoryIsolation ?? null
    this.onResult = config.onResult
  }

  /**
   * start — 启动 Worker，订阅 MessageBus
   */
  start(): void {
    if (this.active) return
    this.active = true

    this.messageBus.subscribe(this.agentId, async (msg) => {
      if (!this.active) return
      if (msg.type !== 'REQUEST') return

      const startTime = Date.now()
      try {
        // 通过 Harness 执行任务
        let output: unknown = null
        if (this.harness && typeof this.harness.executeTask === 'function') {
          // 注入 Agent 私有内存到上下文
          const agentMemory = this.memoryIsolation
            ? { read: (k: string) => this.memoryIsolation.readPrivate(this.agentId, k), write: (k: string, v: unknown) => this.memoryIsolation.writePrivate(this.agentId, k, v) }
            : null
          output = await this.harness.executeTask({ ...msg.payload, agentMemory })
        } else {
          output = { agent: this.agentId, taskId: msg.payload?.taskId, status: 'completed', message: `Executed by ${this.agentId}` }
        }

        // 存储执行结果到私有内存
        if (this.memoryIsolation) {
          try {
            this.memoryIsolation.writePrivate(this.agentId, `task:${msg.payload?.taskId || msg.id}`, output)
            this.memoryIsolation.writePrivate(this.agentId, `task:${msg.payload?.taskId || msg.id}:ts`, Date.now())
          } catch {}
        }

        const duration = Date.now() - startTime
        this.processedCount++

        // 发送结果 (correlationId 匹配 request id)
        this.messageBus.send({
          id: `resp_${msg.id}`,
          from: this.agentId,
          to: msg.from,
          type: 'RESULT',
          payload: { result: output },
          correlationId: msg.id,
          timestamp: Date.now(),
        })

        // 记录到 Profile
        if (this.onResult) {
          this.onResult(String(msg.payload?.taskId || msg.id), true, output, duration)
        }

        // 更新 Registry 中的统计
        const profile = this.registry.getAgent(this.agentId)
        if (profile) {
          profile.totalTasks++
          profile.completedTasks++
          profile.lastActiveAt = Date.now()
        }
      } catch (err: any) {
        const duration = Date.now() - startTime

        // 发送错误
        this.messageBus.send({
          id: `err_${msg.id}`,
          from: this.agentId,
          to: msg.from,
          type: 'ERROR',
          payload: { error: err?.message || String(err) },
          correlationId: msg.id,
          timestamp: Date.now(),
        })

        // 记录失败
        const profile = this.registry.getAgent(this.agentId)
        if (profile) {
          profile.totalTasks++
          profile.failedTasks++
          profile.failureHistory.push({
            taskId: String(msg.payload?.taskId || msg.id),
            reason: err?.message || String(err),
            timestamp: Date.now(),
          })
        }

        if (this.onResult) {
          this.onResult(String(msg.payload?.taskId || msg.id), false, null, duration)
        }
      }
    })
  }

  /**
   * stop — 停止 Worker
   */
  stop(): void {
    this.active = false
    // Note: unsubscribe not implemented in current MessageBus
  }

  /**
   * isActive — 是否活跃
   */
  isActive(): boolean {
    return this.active
  }

  /**
   * getStats — 获取处理统计
   */
  getStats(): { agentId: string; processedCount: number; active: boolean } {
    return { agentId: this.agentId, processedCount: this.processedCount, active: this.active }
  }
}

/**
 * AgentWorkerPool — 管理所有 AgentWorker
 */
export class AgentWorkerPool {
  private workers: Map<string, AgentWorker> = new Map()

  /**
   * createWorker — 为 Agent 创建并启动 Worker
   */
  createWorker(config: AgentWorkerConfig): AgentWorker {
    const worker = new AgentWorker(config)
    this.workers.set(config.agentId, worker)
    worker.start()
    return worker
  }

  /**
   * shutdown — 停止所有 Worker
   */
  shutdown(): void {
    for (const worker of this.workers.values()) {
      worker.stop()
    }
    this.workers.clear()
  }

  /**
   * getWorker — 获取指定 Agent 的 Worker
   */
  getWorker(agentId: string): AgentWorker | undefined {
    return this.workers.get(agentId)
  }

  /**
   * getStats — 获取所有 Worker 统计
   */
  getStats(): { agentId: string; processedCount: number; active: boolean }[] {
    return [...this.workers.values()].map(w => w.getStats())
  }
}
