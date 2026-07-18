/**
 * EventBus — 事件总线 (v2: 支持领域作用域)
 *
 * 插件间唯一通信通道。
 * 所有事件必须携带 executionId。
 * 事件类型命名空间：{domain}.{action}（如 runtime.tool.called）
 *
 * Phase 11 新增：
 *   - emitToDomain(domainId, event) — 只发送到指定领域
 *   - onDomain(domainId, eventType, handler) — 只监听指定领域
 *   - broadcastCrossDomain(event) — 跨领域广播
 *
 * 设计约束：
 *   - 默认保留最近 1000 条历史事件（用于追溯）
 *   - 插件禁止直接调用其他插件（只能通过 EventBus）
 *   - 事件类型不规范（缺少点号）时发出警告
 */

import { config } from '../../config/MorPexConfig.js';
import type { MorPexEvent, EventHandler } from './types.js';

/** 默认历史事件最大保留数 */
const DEFAULT_MAX_HISTORY = config.eventBusMaxHistory;

/** AsyncLocalStorage 用于自动追踪当前领域上下文 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** ★ P1 优化: 事件可见性 — 标记是否应投射到前端 */
export type EventVisibility = 'internal' | 'projected';

/** ★ P1 优化: 前端可见事件白名单 */
const PROJECTED_EVENT_PREFIXES = [
  'kernel.',
  'artifact.',
  'cross_domain.',
  'dag.',
  'runtime.task.',
  'runtime.execution.',
  'message_update',
  'human.',
];

/** ★ P1 优化: 默认不可见事件前缀 (严格 internal) */
const INTERNAL_EVENT_PREFIXES = [
  'workflow.step_',
  'agent.',
  'gateway.',
];

/** ★ P1 优化: 判断事件是否应投射到前端 */
export function isProjectedEvent(type: string): boolean {
  for (const p of INTERNAL_EVENT_PREFIXES) {
    if (type.startsWith(p)) return false;
  }
  for (const p of PROJECTED_EVENT_PREFIXES) {
    if (type.startsWith(p)) return true;
  }
  return true; // 默认投射（安全: 宁可多推不可漏）
}

/**
 * EventBus — 事件总线 (v2)
 *
 * 职责：
 *   - 事件发布/订阅（emit/on/off）
 *   - 一次性监听（once）
 *   - 领域作用域（emitToDomain/onDomain）
 *   - 跨领域广播（broadcastCrossDomain）
 *   - 事件历史追溯（getHistory）
 *   - 监听器计数（listenerCount）
 */
export class EventBus {
  private listeners: Map<string, Set<EventHandler>> = new Map();
  private onceListeners: Map<string, Set<EventHandler>> = new Map();
  /** 领域作用域监听器: domainId → 事件类型 → handler */
  private domainListeners: Map<string, Map<string, Set<EventHandler>>> = new Map();
  private history: MorPexEvent[] = [];
  private maxHistory: number;

  /** ★ P1 优化: 独立投射历史 — 仅存前端可见事件 */
  private projectedHistory: MorPexEvent[] = [];
  private static readonly MAX_PROJECTED_HISTORY = 200;

  /** ★ P1 优化: 独立投射监听器 — 前端 SSE 专用通道 */
  private projectedListeners: Set<EventHandler> | null = null;

  /** Phase 5.1: 当前领域上下文（自动注入 zone） */
  private currentDomainStorage = new AsyncLocalStorage<string>();

  constructor(maxHistory: number = DEFAULT_MAX_HISTORY) {
    this.maxHistory = maxHistory;
  }

  /**
   * setCurrentDomain — 设置当前领域（影响 emitToDomain 的 zone 注入）
   *
   * 使用 AsyncLocalStorage 实现异步上下文传播。
   */
  setCurrentDomain(domainId: string | undefined): void {
    if (domainId) {
      this.currentDomainStorage.enterWith(domainId);
    }
  }

  /**
   * getCurrentDomain — 获取当前领域
   */
  private getCurrentDomain(): string | undefined {
    return this.currentDomainStorage.getStore();
  }

  /**
   * 发射事件
   */
  emit(event: MorPexEvent): void {
    // 验证事件必须携带 executionId
    if (!event.executionId) {
      console.warn(`[EventBus] 事件 "${event.type}" 缺少 executionId`);
    }

    // 检查事件类型命名空间
    if (!event.type.includes('.')) {
      console.warn(`[EventBus] 事件类型 "${event.type}" 不规范，建议使用 "domain.action" 格式`);
    }

    // 存入历史
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // ★ P1 优化: 独立投射历史
    if (isProjectedEvent(event.type)) {
      this.projectedHistory.push(event);
      if (this.projectedHistory.length > EventBus.MAX_PROJECTED_HISTORY) {
        this.projectedHistory.shift();
      }
    }

    // 触发普通监听器
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (err) {
          console.error(`[EventBus] handler 错误 (事件 "${event.type}"):`, err);
        }
      }
    }

    // 触发全局通配符 *（匹配所有事件）
    const globalHandlers = this.listeners.get('*');
    if (globalHandlers) {
      for (const handler of globalHandlers) {
        try {
          handler(event);
        } catch (err) {
          console.error(`[EventBus] 全局通配符 handler 错误 (事件 "${event.type}"):`, err);
        }
      }
    }

    // 触发通配符监听器（如监听 "runtime.*" 可以收到 "runtime.tool.called"）
    this.triggerWildcard(event, handlers);

    // 触发一次性监听器
    const onceHandlers = this.onceListeners.get(event.type);
    if (onceHandlers) {
      for (const handler of onceHandlers) {
        try {
          handler(event);
        } catch (err) {
          console.error(`[EventBus] once-handler 错误 (事件 "${event.type}"):`, err);
        }
      }
      this.onceListeners.delete(event.type);
    }

    // ★ P1 优化: 触发投射监听器 (前端 SSE 通道, 只收 projected 事件)
    if (this.projectedListeners && this.projectedListeners.size > 0) {
      for (const handler of this.projectedListeners) {
        try {
          handler(event);
        } catch (err) {
          console.error(`[EventBus] projected handler 错误 (事件 "${event.type}"):`, err);
        }
      }
    }
  }

  /**
   * 触发通配符监听器
   * 例如：监听 "runtime.*" 可以收到 "runtime.tool.called"
   */
  private triggerWildcard(event: MorPexEvent, _exactHandlers?: Set<EventHandler>): void {
    const dotIndex = event.type.lastIndexOf('.');
    if (dotIndex === -1) return;

    const namespace = event.type.substring(0, dotIndex);
    const wildcardType = `${namespace}.*`;

    const wildcardHandlers = this.listeners.get(wildcardType);
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          handler(event);
        } catch (err) {
          console.error(`[EventBus] 通配符 handler 错误 (事件 "${event.type}"):`, err);
        }
      }
    }
  }

  /**
   * 订阅事件
   * @returns 取消订阅函数
   */
  on(type: string, handler: EventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
    return () => this.off(type, handler);
  }

  /**
   * 一次性订阅
   * @returns 取消订阅函数
   */
  once(type: string, handler: EventHandler): () => void {
    if (!this.onceListeners.has(type)) {
      this.onceListeners.set(type, new Set());
    }
    this.onceListeners.get(type)!.add(handler);
    return () => this.off(type, handler);
  }

  /**
   * 取消订阅
   */
  off(type: string, handler: EventHandler): void {
    this.listeners.get(type)?.delete(handler);
    this.onceListeners.get(type)?.delete(handler);
  }

  /**
   * onProjected — 订阅前端可见事件 (自动过滤 internal 事件)
   *
   * 监听器只收到 isProjectedEvent()=true 的事件。
   * 适合: SSE 广播、前端状态更新。
   *
   * @param handler - 事件处理函数
   * @returns 取消订阅函数
   */
  onProjected(handler: EventHandler): () => void {
    if (!this.projectedListeners) {
      this.projectedListeners = new Set();
    }
    this.projectedListeners.add(handler);
    return () => {
      this.projectedListeners?.delete(handler);
    };
  }

  /**
   * getHistory — 获取历史事件
   * @param type - 可选，按事件类型过滤
   */
  getHistory(type?: string): MorPexEvent[] {
    if (type) {
      return this.history.filter(e => e.type === type || e.type.startsWith(type.replace('*', '')));
    }
    return [...this.history];
  }

  /**
   * 获取监听器数量
   * @param type - 可选，指定事件类型
   */
  listenerCount(type?: string): number {
    if (type) {
      return (this.listeners.get(type)?.size ?? 0) + (this.onceListeners.get(type)?.size ?? 0);
    }
    let total = 0;
    for (const handlers of this.listeners.values()) total += handlers.size;
    for (const handlers of this.onceListeners.values()) total += handlers.size;
    return total;
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase 11: 领域作用域事件
  // ═══════════════════════════════════════════════════════════════

  /**
   * emitToDomain — 只发送到指定领域
   *
   * 事件仅被通过 onDomain() 注册的领域监听器接收。
   * 普通监听器（on/once）不会收到此事件。
   *
   * @param domainId - 目标领域 ID
   * @param event - 事件对象
   */
  emitToDomain(domainId: string, event: MorPexEvent): void {
    // Phase 5.1: 自动注入 zone 元数据
    (event as any).sourceZone = this.getCurrentDomain();
    (event as any).targetZone = domainId;

    // 验证事件必须携带 executionId
    if (!event.executionId) {
      console.warn(`[EventBus] emitToDomain 事件 "${event.type}" 缺少 executionId`);
    }

    // 写入历史
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // ★ P1 优化: emitToDomain 也写投射历史
    if (isProjectedEvent(event.type)) {
      this.projectedHistory.push(event);
      if (this.projectedHistory.length > EventBus.MAX_PROJECTED_HISTORY) {
        this.projectedHistory.shift();
      }
    }

    // 只触发该领域的监听器
    const domainMap = this.domainListeners.get(domainId);
    if (!domainMap) return;

    const handlers = domainMap.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (err) {
          console.error(`[EventBus] domain handler 错误 (领域 "${domainId}", 事件 "${event.type}"):`, err);
        }
      }
    }

    // 领域通配符
    const wildcardHandlers = domainMap.get('*');
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          handler(event);
        } catch (err) {
          console.error(`[EventBus] domain wildcard handler 错误 (领域 "${domainId}"):`, err);
        }
      }
    }
  }

  /**
   * onDomain — 订阅指定领域的事件
   *
   * 只接收通过 emitToDomain() 发送到该领域的事件。
   *
   * @param domainId - 领域 ID
   * @param type - 事件类型
   * @param handler - 处理函数
   * @returns 取消订阅函数
   */
  onDomain(domainId: string, type: string, handler: EventHandler): () => void {
    if (!this.domainListeners.has(domainId)) {
      this.domainListeners.set(domainId, new Map());
    }
    const domainMap = this.domainListeners.get(domainId)!;
    if (!domainMap.has(type)) {
      domainMap.set(type, new Set());
    }
    domainMap.get(type)!.add(handler);

    return () => {
      domainMap.get(type)?.delete(handler);
      if (domainMap.get(type)?.size === 0) {
        domainMap.delete(type);
      }
      if (domainMap.size === 0) {
        this.domainListeners.delete(domainId);
      }
    };
  }

  /**
   * broadcastCrossDomain — 跨领域广播
   *
   * 向所有已注册领域的 onDomain('*') 和 onDomain(domainId, type) 广播事件。
   * 同时也会触发全局监听器（on('*')）。
   *
   * @param event - 事件对象
   */
  broadcastCrossDomain(event: MorPexEvent): void {
    // Phase 5.1: 自动注入 zone 元数据
    (event as any).sourceZone = this.getCurrentDomain();
    (event as any).targetZone = '*';

    // 先触发全局监听器
    this.emit(event);

    // 再向所有领域广播
    for (const [domainId, domainMap] of this.domainListeners) {
      const handlers = domainMap.get(event.type);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(event);
          } catch (err) {
            console.error(`[EventBus] 跨领域广播错误 (领域 "${domainId}", 事件 "${event.type}"):`, err);
          }
        }
      }

      // 领域通配符 '*/'
      const wildcardHandlers = domainMap.get('*');
      if (wildcardHandlers) {
        for (const handler of wildcardHandlers) {
          try {
            handler(event);
          } catch (err) {
            console.error(`[EventBus] 跨领域广播通配符错误 (领域 "${domainId}"):`, err);
          }
        }
      }
    }
  }

  /**
   * getDomainEventTypes — 获取指定领域注册的事件类型
   */
  getDomainEventTypes(domainId: string): string[] {
    const domainMap = this.domainListeners.get(domainId);
    if (!domainMap) return [];
    return [...domainMap.keys()].sort();
  }

  /**
   * getRegisteredDomains — 获取所有注册了监听器的领域
   */
  getRegisteredDomains(): string[] {
    return [...this.domainListeners.keys()].sort();
  }

  /**
   * 获取当前注册的所有事件类型
   */
  getEventTypes(): string[] {
    const types = new Set<string>();
    for (const key of this.listeners.keys()) types.add(key);
    for (const key of this.onceListeners.keys()) types.add(key);
    return [...types].sort();
  }

  /**
   * ★ P1 优化: 获取投射历史（仅前端可见事件）
   */
  getProjectedHistory(type?: string): MorPexEvent[] {
    if (type) {
      return this.projectedHistory.filter(e => e.type === type || e.type.startsWith(type.replace('*', '')));
    }
    return [...this.projectedHistory];
  }

  /**
   * 清空所有监听器和历史
   */
  clear(): void {
    this.listeners.clear();
    this.onceListeners.clear();
    this.domainListeners.clear();
    this.history = [];
    this.projectedHistory = [];
  }
}
