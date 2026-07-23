/* ═══════════════════════════════════════════════════════════════════════
   debug/DebugPage.tsx — 主布局 v9.1.1
   
   布局：
     ┌──────────────────────────────────────────────────────────────┐
     │              TaskGenerator (顶部) + connection status       │
     ├──────────┬────────────────────────────┬─────────────────────┤
     │  Module  │      Runtime Graph         │   Event Stream      │
     │ Coverage │      (中间)                │   (右侧)            │
     │ (左侧)   │                            │                     │
     ├──────────┴────────────────────────────┴─────────────────────┤
     │                     StatsPanel (底部)                       │
     └──────────────────────────────────────────────────────────────┘
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import TaskGenerator from './TaskGenerator';
import ModuleCoveragePanel from './ModuleCoverage';
import RuntimeGraph from './RuntimeGraph';
import EventStream from './EventStream';
import StatsPanel from './StatsPanel';
import { obsApi, connectObsWebSocket, type ConnectionStatus } from './api';
import type { TraceEvent, SystemStats, ModuleCoverage, GraphNode, ModuleHealthReport } from './types';

const DEBUG_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  background: 'var(--bg-primary)',
  overflow: 'hidden',
};

const MIDDLE_STYLE: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  borderTop: '1px solid var(--border)',
};

const LEFT_STYLE: React.CSSProperties = {
  width: 260,
  minWidth: 260,
  borderRight: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-secondary)',
  overflow: 'hidden',
};

const CENTER_STYLE: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  background: 'var(--bg-primary)',
};

const RIGHT_STYLE: React.CSSProperties = {
  width: 340,
  minWidth: 340,
  borderLeft: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-secondary)',
  overflow: 'hidden',
};

const BOTTOM_HEIGHT = 100;

const STATUS_COLORS: Record<ConnectionStatus, string> = {
  connecting: 'var(--accent-yellow)',
  connected: 'var(--accent-green)',
  disconnected: 'var(--accent-red)',
  error: 'var(--accent-red)',
};

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connecting: 'CONNECTING...',
  connected: 'LIVE',
  disconnected: 'RECONNECTING',
  error: 'ERROR',
};

export default function DebugPage() {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [coverage, setCoverage] = useState<ModuleCoverage | null>(null);
  const [heartbeatReport, setHeartbeatReport] = useState<ModuleHealthReport | null>(null);
  const [graphs, setGraphs] = useState<Map<string, GraphNode[]>>(new Map());
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [v8Sending, setV8Sending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [wsStatus, setWsStatus] = useState<ConnectionStatus>('connecting');
  const [backendError, setBackendError] = useState<string | null>(null);
  const generateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch initial data — each call independent
  const refresh = useCallback(async () => {
    let hasError = false;

    // Events
    try {
      const evRes = await obsApi.getEvents(500);
      setEvents(evRes.events);
    } catch (e) {
      console.warn('[Debug] Events fetch failed:', e);
      hasError = true;
    }

    // Stats
    try {
      const statsRes = await obsApi.getStats();
      setStats(statsRes.stats);
    } catch (e) {
      console.warn('[Debug] Stats fetch failed:', e);
    }

    // Coverage
    try {
      const covRes = await obsApi.getCoverage();
      setCoverage(covRes.coverage);
    } catch (e) {
      console.warn('[Debug] Coverage fetch failed:', e);
    }

    // Graphs
    try {
      const graphRes = await obsApi.getGraphs();
      const gMap = new Map<string, GraphNode[]>();
      for (const g of graphRes.graphs) {
        gMap.set(g.taskId, g.nodes);
      }
      setGraphs(gMap);

      if (!selectedTask && gMap.size > 0) {
        setSelectedTask(Array.from(gMap.keys())[0]);
      }
    } catch (e) {
      console.warn('[Debug] Graphs fetch failed:', e);
    }

    // Heartbeats
    try {
      const hbRes = await obsApi.getHeartbeats();
      setHeartbeatReport(hbRes.report);
    } catch (e) {
      console.warn('[Debug] Heartbeats fetch failed:', e);
    }

    if (hasError) {
      setBackendError('Some API calls failed. Check that the server is running and route order is correct (/api/observability must be before SPA fallback).');
    } else {
      setBackendError(null);
    }

    setLoading(false);
  }, [selectedTask]);

  useEffect(() => {
    refresh();
  }, []);

  // WebSocket connection with polling fallback
  useEffect(() => {
    const disconnect = connectObsWebSocket(
      (event) => {
        setEvents(prev => [...prev.slice(-999), event]);
        // Throttled refresh of stats/coverage on new events
        obsApi.getStats().then(r => setStats(r.stats)).catch(() => {});
        obsApi.getCoverage().then(r => setCoverage(r.coverage)).catch(() => {});
      },
      (history) => {
        setEvents(history);
        // Also trigger a full refresh for graphs on first history load
        refresh();
      },
      (status) => {
        setWsStatus(status);
        if (status === 'error' || status === 'disconnected') {
          // Polling fallback handles data, but we note the status
        }
      },
    );
    return disconnect;
  }, []);

  // Heartbeat polling (every 5s)
  useEffect(() => {
    const poll = async () => {
      try {
        const hbRes = await obsApi.getHeartbeats();
        setHeartbeatReport(hbRes.report);
      } catch {}
    };
    poll();
    heartbeatTimerRef.current = setInterval(poll, 5000);
    return () => {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
    };
  }, []);

  // Cleanup intervals on unmount
  useEffect(() => {
    return () => {
      if (generateTimerRef.current) clearInterval(generateTimerRef.current);
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
    };
  }, []);

  // Handle task generation
  const handleGenerate = useCallback(async (count: number, concurrency: number, mode: string) => {
    setGenerating(true);
    try {
      await obsApi.generateTasks(count, concurrency, mode);
      // Poll for completion
      if (generateTimerRef.current) clearInterval(generateTimerRef.current);
      generateTimerRef.current = setInterval(async () => {
        try {
          const status = await obsApi.getGenerateStatus();
          await refresh();
          if (!status.running) {
            if (generateTimerRef.current) clearInterval(generateTimerRef.current);
            generateTimerRef.current = null;
            setGenerating(false);
            await refresh();
          }
        } catch {
          if (generateTimerRef.current) clearInterval(generateTimerRef.current);
          generateTimerRef.current = null;
          setGenerating(false);
        }
      }, 800);
    } catch (err) {
      console.error('[Debug] Generate error:', err);
      setBackendError(`Generate failed: ${err instanceof Error ? err.message : String(err)}`);
      setGenerating(false);
    }
  }, [refresh]);

  const handleAbort = useCallback(async () => {
    try {
      await obsApi.abortGenerate();
      setGenerating(false);
      if (generateTimerRef.current) {
        clearInterval(generateTimerRef.current);
        generateTimerRef.current = null;
      }
    } catch {}
  }, []);

  const handleClear = useCallback(async () => {
    try {
      await obsApi.clear();
      setEvents([]);
      setStats(null);
      setCoverage(null);
      setGraphs(new Map());
      setSelectedTask(null);
    } catch {}
  }, []);

  const handleV8Mission = useCallback(async () => {
    setV8Sending(true);
    try {
      const res = await fetch('/api/v8/mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Trace this pipeline from Observability Debug Panel.',
          session_id: `debug_${Date.now()}`,
        }),
      });
      console.log('[V8] Response:', await res.json());
      setTimeout(() => refresh(), 600);
      setTimeout(() => refresh(), 2000);
    } catch (err) {
      console.error('[V8] Error:', err);
    } finally {
      setV8Sending(false);
    }
  }, [refresh]);

  // ── Render ──

  if (loading) {
    return (
      <div style={{
        ...DEBUG_STYLE,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
      }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--text-muted)' }}>
          INITIALIZING OBSERVABILITY PLANE...
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--text-muted)' }}>
          Checking API: /api/observability
        </div>
      </div>
    );
  }

  return (
    <div style={DEBUG_STYLE}>
      {/* Top: Task Generator + Connection Status */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        borderBottom: '1px solid var(--border)',
      }}>
        <TaskGenerator
          onGenerate={handleGenerate}
          onAbort={handleAbort}
          onClear={handleClear}
          onRefresh={refresh}
          onV8Mission={handleV8Mission}
          generating={generating}
          v8Sending={v8Sending}
          totalEvents={events.length}
        />

        {/* Connection status bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '2px 16px',
          background: 'var(--bg-tertiary)',
          fontSize: 9,
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          <span style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: STATUS_COLORS[wsStatus],
            display: 'inline-block',
            boxShadow: wsStatus === 'connected' ? `0 0 6px ${STATUS_COLORS[wsStatus]}` : 'none',
          }} />
          <span style={{ color: STATUS_COLORS[wsStatus], fontWeight: 600 }}>
            {STATUS_LABELS[wsStatus]}
          </span>
          {/* Data source indicator */}
          {events.length > 0 && (() => {
            const realCount = events.filter(e => !e.taskId.startsWith('task_')).length;
            const mockCount = events.filter(e => e.taskId.startsWith('task_')).length;
            return (
              <>
                <span style={{ color: 'var(--text-muted)' }}>|</span>
                {realCount > 0 && (
                  <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>
                    ● KERNEL {realCount}
                  </span>
                )}
                {mockCount > 0 && (
                  <span style={{ color: 'var(--accent-yellow)' }}>
                    ◉ MOCK {mockCount}
                  </span>
                )}
                {realCount === 0 && mockCount === 0 && (
                  <span style={{ color: 'var(--text-muted)' }}>No events</span>
                )}
              </>
            );
          })()}
          {backendError && (
            <span style={{ color: 'var(--accent-red)', marginLeft: 8, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              ⚠ {backendError}
            </span>
          )}
          <button
            onClick={refresh}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              borderRadius: 3,
              cursor: 'pointer',
              padding: '1px 8px',
              fontSize: 9,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            ↻ REFRESH
          </button>
        </div>
      </div>

      {/* Middle: 3-panel layout */}
      <div style={MIDDLE_STYLE}>
        {/* Left: Module Coverage + Heartbeat */}
        <div style={LEFT_STYLE}>
          <ModuleCoveragePanel coverage={coverage} heartbeatReport={heartbeatReport} />
        </div>

        {/* Center: Runtime Graph */}
        <div style={CENTER_STYLE}>
          <RuntimeGraph
            graphs={graphs}
            selectedTask={selectedTask}
            onSelectTask={setSelectedTask}
          />
        </div>

        {/* Right: Event Stream */}
        <div style={RIGHT_STYLE}>
          <EventStream events={events} onSelectEvent={(e) => {
            if (e.taskId) setSelectedTask(e.taskId);
          }} />
        </div>
      </div>

      {/* Bottom: Stats */}
      <div style={{
        height: BOTTOM_HEIGHT,
        minHeight: BOTTOM_HEIGHT,
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
      }}>
        <StatsPanel stats={stats} />
      </div>
    </div>
  );
}
