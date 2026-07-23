/**
 * WebSocket Handler — 实时 Trace 事件 + Observation 推送
 *
 * 通过 WebSocket 将 TraceEvent 和 Observation 实时推送到 Debug 前端。
 * 连接建立后自动发送最近 100 条历史事件和模块状态快照。
 */

import { type IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { type Server as HttpServer } from 'http';
import { traceBus } from './event-bus';
import { ObservationCollector } from './observation.js';

export function setupWebSocket(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/api/observability/ws',
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    const clientId = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    console.log(`[ObsWS] 📡 Client connected: ${clientId}`);

    // Register with TraceBus for real-time events
    traceBus.addWsClient(ws);

    // Send historical events on connect
    try {
      const history = traceBus.getStore().getRecentEvents(100);
      if (history.length > 0) {
        ws.send(JSON.stringify({ type: 'history', count: history.length, events: history }));
      }
    } catch (e) {
      console.warn('[ObsWS] History send error:', e);
    }

    // ★ Phase 4: Send module state snapshot from ObservationCollector
    try {
      const modules = ObservationCollector.getModuleStates();
      const exercised = [...ObservationCollector.getExercisedModules()];
      const stats = ObservationCollector.getStats();
      ws.send(JSON.stringify({
        type: 'moduleSnapshot',
        timestamp: Date.now(),
        totalModules: stats.totalModules,
        exercisedCount: exercised.length,
        modules: modules.map(s => ({
          name: s.name,
          layer: s.layer,
          status: s.displayStatus,
          callCount: s.callCount,
          successCount: s.successCount,
          errorCount: s.errorCount,
          exercised: exercised.includes(s.name),
        })),
      }));
    } catch (e) {
      console.warn('[ObsWS] Module snapshot error:', e);
    }

    ws.on('close', () => {
      console.log(`[ObsWS] Client disconnected: ${clientId}`);
      traceBus.removeWsClient(ws);
    });

    ws.on('error', (err: Error) => {
      console.warn(`[ObsWS] Error ${clientId}:`, err.message);
      traceBus.removeWsClient(ws);
    });

    ws.on('message', (data) => {
      // Handle incoming commands from client
      try {
        const msg = JSON.parse(data.toString()) as { type: string; payload?: unknown };
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
      } catch {
        // Ignore malformed messages
      }
    });
  });

  console.log('[ObsWS] ✅ WebSocket server ready at /api/observability/ws');
  return wss;
}
