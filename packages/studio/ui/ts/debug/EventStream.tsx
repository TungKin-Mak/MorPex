/* ═══════════════════════════════════════════════════════════════════════
   debug/EventStream.tsx — 事件流面板（右侧）
   
   实时显示 TraceEvent 流，按时间倒序排列。
   可点击跳转到对应 Task 的运行时图。
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useRef, useEffect, useMemo } from 'react';
import type { TraceEvent } from './types';

interface Props {
  events: TraceEvent[];
  onSelectEvent: (event: TraceEvent) => void;
}

const EVENT_COLORS: Record<string, string> = {
  MODULE_START: '#58a6ff',
  MODULE_END: '#3fb950',
  DATA_FLOW: '#bc8cff',
  ERROR: '#f85149',
  STATE_CHANGE: '#d29922',
  TOOL_CALL: '#f0883e',
};

const EVENT_LABELS: Record<string, string> = {
  MODULE_START: 'START',
  MODULE_END: 'END',
  DATA_FLOW: 'FLOW',
  ERROR: 'ERROR',
  STATE_CHANGE: 'STATE',
  TOOL_CALL: 'TOOL',
};

export default function EventStream({ events, onSelectEvent }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Auto-scroll when new events arrive
  useEffect(() => {
    if (autoScrollRef.current && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [events.length]);

  const handleScroll = () => {
    if (!listRef.current) return;
    const el = listRef.current;
    autoScrollRef.current = el.scrollTop < 50;
  };

  // Reverse so newest is on top
  const sortedEvents = useMemo(() => {
    return [...events].reverse().slice(0, 500);
  }, [events]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '10px 12px',
        borderBottom: '1px solid var(--border)',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: 1,
        color: 'var(--text-secondary)',
        fontWeight: 600,
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>Event Stream</span>
        <span style={{ color: 'var(--text-muted)' }}>{events.length}</span>
      </div>

      <div
        ref={listRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 0,
        }}
      >
        {sortedEvents.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
            No events yet. Generate tasks to see trace events.
          </div>
        ) : (
          sortedEvents.map(event => {
            const color = EVENT_COLORS[event.eventType] || 'var(--text-muted)';
            const label = EVENT_LABELS[event.eventType] || event.eventType;
            const time = new Date(event.timestamp).toLocaleTimeString();

            return (
              <div
                key={event.id}
                onClick={() => onSelectEvent(event)}
                style={{
                  padding: '5px 12px',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                  fontSize: 10,
                  fontFamily: "'JetBrains Mono', monospace",
                  lineHeight: 1.6,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    color,
                    fontSize: 9,
                    fontWeight: 600,
                    padding: '1px 4px',
                    borderRadius: 2,
                    background: `${color}15`,
                    border: `1px solid ${color}30`,
                    minWidth: 40,
                    textAlign: 'center',
                  }}>
                    {label}
                  </span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                    {event.module.name}
                  </span>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 'auto', fontSize: 9 }}>
                    {time}
                  </span>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 9, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  task: {event.taskId}{event.executionId ? ` | exec: ${event.executionId.slice(0, 16)}` : ''}
                  {event.metadata?.latency ? ` | ${event.metadata.latency}ms` : ''}
                </div>
                {event.eventType === 'ERROR' && event.output && (
                  <div style={{ color: 'var(--accent-red)', fontSize: 9, marginTop: 1 }}>
                    {(event.output as { error?: string })?.error || JSON.stringify(event.output).slice(0, 80)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Filter hint */}
      <div style={{
        padding: '4px 12px',
        borderTop: '1px solid var(--border)',
        color: 'var(--text-muted)',
        fontSize: 9,
        fontFamily: "'JetBrains Mono', monospace",
        textAlign: 'center',
      }}>
        Click an event to view its task graph
      </div>
    </div>
  );
}
