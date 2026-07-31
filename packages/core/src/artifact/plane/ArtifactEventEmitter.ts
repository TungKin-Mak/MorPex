/**
 * ArtifactEventEmitter — 产物事件发射器
 *
 * v9.1: 管理与 Artifact 相关的事件发射。
 * 与 EventBus 集成，在产物生命周期关键点发射事件。
 */

import type { ArtifactEvent, ArtifactEventType, ArtifactRecord } from './types.js'

// ── EventCallback — 事件回调 ──

export type EventCallback = (event: ArtifactEvent) => void

// ── ArtifactEventEmitter ──

export class ArtifactEventEmitter {
  private listeners = new Map<ArtifactEventType, EventCallback[]>()
  private globalListeners: EventCallback[] = []

  /**
   * on — 监听特定类型的事件
   *
   * @returns 取消监听的函数
   */
  on(type: ArtifactEventType, callback: EventCallback): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, [])
    }
    this.listeners.get(type)!.push(callback)
    return () => this.off(type, callback)
  }

  /**
   * off — 取消监听
   */
  off(type: ArtifactEventType, callback: EventCallback): void {
    const list = this.listeners.get(type)
    if (!list) return
    const index = list.indexOf(callback)
    if (index >= 0) list.splice(index, 1)
  }

  /**
   * onAny — 监听所有事件
   *
   * @returns 取消监听的函数
   */
  onAny(callback: EventCallback): () => void {
    this.globalListeners.push(callback)
    return () => {
      const index = this.globalListeners.indexOf(callback)
      if (index >= 0) this.globalListeners.splice(index, 1)
    }
  }

  /**
   * emit — 发射事件
   */
  emit(
    type: ArtifactEventType,
    record: ArtifactRecord,
    actor: string,
    data?: Record<string, unknown>
  ): void {
    const event: ArtifactEvent = {
      type,
      artifactId: record.id,
      version: record.version,
      timestamp: Date.now(),
      actor,
      data,
    }

    // 通知类型特定监听器
    const typeListeners = this.listeners.get(type)
    if (typeListeners) {
      for (const cb of typeListeners) {
        try { cb(event) } catch (err) { console.warn(`[ArtifactEventEmitter] Listener error for ${type}:`, err) }
      }
    }

    // 通知全局监听器
    for (const cb of this.globalListeners) {
      try { cb(event) } catch (err) { console.warn(`[ArtifactEventEmitter] Global listener error:`, err) }
    }
  }

  /**
   * emitCreated — 发射 created 事件
   */
  emitCreated(record: ArtifactRecord, actor: string): void {
    this.emit('artifact.created', record, actor, { name: record.meta.name, type: record.meta.type })
  }

  /**
   * emitStaged — 发射 staged 事件
   */
  emitStaged(record: ArtifactRecord, actor: string, stageId: string): void {
    this.emit('artifact.staged', record, actor, { stageId, version: record.version + 1 })
  }

  /**
   * emitCommitted — 发射 committed 事件
   */
  emitCommitted(record: ArtifactRecord, actor: string): void {
    this.emit('artifact.committed', record, actor, { version: record.version })
  }

  /**
   * emitArchived — 发射 archived 事件
   */
  emitArchived(record: ArtifactRecord, actor: string): void {
    this.emit('artifact.archived', record, actor)
  }

  /**
   * emitDeprecated — 发射 deprecated 事件
   */
  emitDeprecated(record: ArtifactRecord, actor: string): void {
    this.emit('artifact.deprecated', record, actor)
  }

  /**
   * emitRolledBack — 发射 rolled_back 事件
   */
  emitRolledBack(record: ArtifactRecord, actor: string, stageId: string): void {
    this.emit('artifact.rolled_back', record, actor, { stageId })
  }

  /**
   * clear — 清空所有监听器
   */
  clear(): void {
    this.listeners.clear()
    this.globalListeners = []
  }
}
