/**
 * TraceBus — 全局事件总线（单例）
 *
 * 所有模块统一通过 traceBus.emit() 上报 TraceEvent。
 * 事件同时写入 TraceStore（SQLite 持久化）并广播到 WebSocket 客户端。
 */

import { type TraceEvent } from './types';
import { TraceStore } from './trace-store';

class TraceBus {
  private static instance: TraceBus;
  private _store: TraceStore;
  private wsClients: Set<{ send: (data: string) => void }> = new Set();
  private listeners: Array<(event: TraceEvent) => void> = [];
  private _initialized = false;

  private constructor() {
    this._store = new TraceStore();
  }

  static getInstance(): TraceBus {
    if (!TraceBus.instance) {
      TraceBus.instance = new TraceBus();
    }
    return TraceBus.instance;
  }

  init(): void {
    if (this._initialized) return;
    this._initialized = true;
    console.log('[TraceBus] ✅ Initialized');
  }

  emit(event: TraceEvent): void {
    if (!this._initialized) {
      this._initialized = true;
    }

    // 1. Persist to SQLite
    try {
      this._store.append(event);
    } catch (e) {
      console.warn('[TraceBus] Store append error:', e);
    }

    // 2. Broadcast to WebSocket clients
    const payload = JSON.stringify(event);
    for (const client of this.wsClients) {
      try {
        client.send(payload);
      } catch {
        this.wsClients.delete(client);
      }
    }

    // 3. Notify local listeners
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.warn('[TraceBus] Listener error:', e);
      }
    }
  }

  addWsClient(ws: { send: (data: string) => void }): void {
    this.wsClients.add(ws);
  }

  removeWsClient(ws: { send: (data: string) => void }): void {
    this.wsClients.delete(ws);
  }

  onEvent(listener: (event: TraceEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  getStore(): TraceStore {
    return this._store;
  }

  getWsClientCount(): number {
    return this.wsClients.size;
  }

  /** 注入外部 store（用于生产环境共享实例） */
  setStore(store: TraceStore): void {
    this._store = store;
  }
}

export const traceBus = TraceBus.getInstance();
export { TraceBus };
