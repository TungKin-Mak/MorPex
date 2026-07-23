/* ═══════════════════════════════════════════════════════════════════════
   debug/TaskGenerator.tsx — 任务生成器控件
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useState } from 'react';

interface Props {
  onGenerate: (count: number, concurrency: number, mode: string) => void;
  onAbort: () => void;
  onClear: () => void;
  onRefresh: () => void;
  onV8Mission: () => void;
  generating: boolean;
  v8Sending: boolean;
  totalEvents: number;
}

const STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 16px',
  background: 'var(--bg-secondary)',
  borderBottom: '1px solid var(--border)',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 12,
  flexWrap: 'wrap',
};

const LABEL: React.CSSProperties = {
  color: 'var(--text-secondary)',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginRight: 4,
};

const INPUT: React.CSSProperties = {
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: 4,
  padding: '4px 8px',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 12,
  width: 50,
};

const SELECT: React.CSSProperties = {
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: 4,
  padding: '4px 8px',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 12,
};

const BTN_BASE: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '4px 12px',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 11,
  cursor: 'pointer',
  transition: 'all 0.15s',
  fontWeight: 500,
};

export default function TaskGenerator({ onGenerate, onAbort, onClear, onRefresh, onV8Mission, generating, v8Sending, totalEvents }: Props) {
  const [count, setCount] = useState(50);
  const [concurrency, setConcurrency] = useState(5);
  const [mode, setMode] = useState('random');

  const handleGenerate = () => onGenerate(count, concurrency, mode);

  return (
    <div style={STYLE}>
      <span style={{ color: 'var(--accent-blue)', fontWeight: 600, fontSize: 13 }}>
        ⚡ TASK GENERATOR
      </span>

      <span style={LABEL}>Count</span>
      <input
        style={INPUT}
        type="number"
        value={count}
        onChange={e => setCount(Math.max(1, parseInt(e.target.value) || 1))}
        min={1}
        max={10000}
      />

      <span style={LABEL}>Concurrency</span>
      <input
        style={{ ...INPUT, width: 40 }}
        type="number"
        value={concurrency}
        onChange={e => setConcurrency(Math.max(1, parseInt(e.target.value) || 1))}
        min={1}
        max={50}
      />

      <span style={LABEL}>Mode</span>
      <select style={SELECT} value={mode} onChange={e => setMode(e.target.value)}>
        <option value="random">Random</option>
        <option value="standard">Standard</option>
        <option value="stress">Stress</option>
      </select>

      {generating ? (
        <button
          style={{ ...BTN_BASE, background: 'var(--accent-red)', color: '#fff', borderColor: 'var(--accent-red)' }}
          onClick={onAbort}
        >
          ⏹ ABORT
        </button>
      ) : (
        <button
          style={{ ...BTN_BASE, background: 'var(--accent-green)', color: '#fff', borderColor: 'var(--accent-green)' }}
          onClick={handleGenerate}
        >
          ▶ GENERATE
        </button>
      )}

      <button
        style={{ ...BTN_BASE, background: 'transparent', color: 'var(--text-secondary)' }}
        onClick={onClear}
      >
        ✕ CLEAR
      </button>

      {/* v8 Mission: exercises full Cognitive Pipeline */}
      <button
        style={{
          ...BTN_BASE,
          background: v8Sending ? 'var(--accent-yellow)' : 'transparent',
          color: v8Sending ? '#000' : 'var(--accent-purple)',
          borderColor: 'var(--accent-purple)',
        }}
        onClick={onV8Mission}
        disabled={v8Sending}
      >
        {v8Sending ? '⏳ SENDING...' : '🚀 V8 MISSION'}
      </button>

      <div style={{ flex: 1 }} />

      <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
        Events: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{totalEvents}</span>
      </span>
    </div>
  );
}
