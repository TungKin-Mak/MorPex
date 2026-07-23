/* ═══════════════════════════════════════════════════════════════════════
   debug/api.ts — Observability API 客户端 (v9.1.1)
   
   双重通道：
     1. REST API — 查询历史、触发操作
     2. WebSocket — 实时事件流（自动降级到轮询）
   ═══════════════════════════════════════════════════════════════════════ */

import type { TraceEvent, GraphNode, ModuleCoverage, SystemStats, TaskTimelineEntry, ModuleHealthReport } from './types';

const BASE = '/api/observability';

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  // Check if we got HTML instead of JSON (common when route not matched)
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    if (!data.ok) throw new Error(data.error || 'API error');
    return data as T;
  } catch (e) {
    if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
      throw new Error(`Backend returned HTML — API route not matched. Check server route order.`);
    }
    throw new Error(`API parse error: ${text.slice(0, 100)}`);
  }
}

export const obsApi = {
  // Events
  getEvents: (limit = 200) =>
    fetchJSON<{ ok: boolean; count: number; events: TraceEvent[] }>(`${BASE}/events?limit=${limit}`),

  getEventsByTask: (taskId: string) =>
    fetchJSON<{ ok: boolean; taskId: string; count: number; events: TraceEvent[] }>(`${BASE}/events/${encodeURIComponent(taskId)}`),

  // Modules & Coverage
  getModules: () =>
    fetchJSON<{ ok: boolean; count: number; modules: Array<{ id: string; name: string; layer: string }> }>(`${BASE}/modules`),

  getCoverage: () =>
    fetchJSON<{ ok: boolean; coverage: ModuleCoverage }>(`${BASE}/coverage`),

  // Graph
  getGraph: (taskId: string) =>
    fetchJSON<{ ok: boolean; taskId: string; nodes: GraphNode[] }>(`${BASE}/graph/${encodeURIComponent(taskId)}`),

  getGraphs: () =>
    fetchJSON<{ ok: boolean; graphs: Array<{ taskId: string; nodes: GraphNode[] }> }>(`${BASE}/graphs`),

  getTimeline: () =>
    fetchJSON<{ ok: boolean; timeline: TaskTimelineEntry[] }>(`${BASE}/timeline`),

  // Task Generator
  generateTasks: (count: number, concurrency: number, mode: string) =>
    fetchJSON<{ ok: boolean; message: string }>(`${BASE}/generate`, {
      method: 'POST',
      body: JSON.stringify({ count, concurrency, mode }),
    }),

  abortGenerate: () =>
    fetchJSON<{ ok: boolean; message: string }>(`${BASE}/generate/abort`, { method: 'POST' }),

  getGenerateStatus: () =>
    fetchJSON<{ ok: boolean; running: boolean }>(`${BASE}/generate/status`),

  // Stats
  getStats: () =>
    fetchJSON<{ ok: boolean; stats: SystemStats }>(`${BASE}/stats`),

  // Clear (events only)
  clear: () =>
    fetchJSON<{ ok: boolean; message: string }>(`${BASE}/clear`, { method: 'POST' }),

  // Hard reset (everything)
  reset: () =>
    fetchJSON<{ ok: boolean; message: string }>(`${BASE}/reset`, { method: 'POST' }),

  // Health check
  health: () =>
    fetchJSON<{ ok: boolean }>(`${BASE}/modules`).then(() => true).catch(() => false),

  // Module Heartbeat
  getHeartbeats: () =>
    fetchJSON<{ ok: boolean; report: ModuleHealthReport }>(`${BASE}/heartbeats`),
};

// ════════════════════════════════════════════════════════════════
// WebSocket (with auto-fallback to polling)
// ════════════════════════════════════════════════════════════════

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export function connectObsWebSocket(
  onEvent: (event: TraceEvent) => void,
  onHistory: (events: TraceEvent[]) => void,
  onStatusChange: (status: ConnectionStatus) => void,
): () => void {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const url = `${protocol}//${host}${BASE}/ws`;

  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let lastEventId = '';

  onStatusChange('connecting');

  function startPolling() {
    if (pollTimer) return;
    console.log('[ObsWS] Falling back to HTTP polling (every 2s)');
    pollTimer = setInterval(async () => {
      if (closed) return;
      try {
        const res = await obsApi.getEvents(200);
        const newEvents = res.events.filter(e => e.id > lastEventId);
        for (const ev of newEvents) {
          if (ev.id > lastEventId) lastEventId = ev.id;
          onEvent(ev);
        }
        if (res.events.length > 0 && !lastEventId) {
          lastEventId = res.events[res.events.length - 1].id;
          // Don't replay all — just set the cursor
          onHistory(res.events.slice(-50));
        }
      } catch {
        // silent — polling will retry
      }
    }, 2000);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function connect() {
    if (closed) return;
    try {
      ws = new WebSocket(url);
    } catch {
      // WebSocket not supported — go straight to polling
      onStatusChange('error');
      startPolling();
      return;
    }

    ws.onopen = () => {
      console.log('[ObsWS] ✅ Connected');
      stopPolling();
      onStatusChange('connected');
    };

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === 'history') {
          const events = data.events || [];
          if (events.length > 0) lastEventId = events[events.length - 1].id;
          onHistory(events);
        } else if (data.type === 'pong') {
          // heartbeat response
        } else {
          const event = data as TraceEvent;
          if (event.id > lastEventId) lastEventId = event.id;
          onEvent(event);
        }
      } catch {
        // ignore malformed
      }
    };

    ws.onclose = () => {
      console.log('[ObsWS] Disconnected — will retry in 3s');
      onStatusChange('disconnected');
      if (!closed) {
        reconnectTimer = setTimeout(connect, 3000);
        // Start polling as fallback while reconnecting
        startPolling();
      }
    };

    ws.onerror = () => {
      onStatusChange('error');
      ws?.close();
    };
  }

  connect();

  return () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pollTimer) clearInterval(pollTimer);
    ws?.close();
  };
}
