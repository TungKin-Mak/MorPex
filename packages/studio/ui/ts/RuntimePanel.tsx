/* ═══════════════════════════════════════════════════════════════════════
   RuntimePanel.tsx — v7 运行时 FSM 执行面板
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useEffect, useState, useCallback } from 'react';
import { useAstroStore } from './stores';
import { fetchRuntimeExecutions, fetchRuntimeExecution } from './api';
import type { Execution, ExecutionDetail } from './types';

const RuntimePanel: React.FC = () => {
  const [execs, setExecs] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchRuntimeExecutions();
      setExecs(res.executions);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const selectExec = useCallback(async (id: string) => {
    if (selected === id) { setSelected(null); setDetail(null); return; }
    setSelected(id);
    try {
      const d = await fetchRuntimeExecution(id);
      setDetail(d);
    } catch { setDetail(null); }
  }, [selected]);

  // 初始加载 + 10 秒轮询
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);

  const transitions = (exec: Execution) => {
    const t = exec.transitions || [];
    return t.length > 0 ? t.join(' → ') : '—';
  };

  return (
    <div style={{
      background: '#0d0d0d', border: '1px solid #1a1a1a',
      fontFamily: '"JetBrains Mono", monospace', fontSize: 11,
      color: '#b0b0b0', marginBottom: 4,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '4px 8px', background: 'rgba(255,51,51,0.04)',
        borderBottom: '1px solid #1a1a1a',
      }}>
        <span style={{ color: '#FF3333', fontWeight: 700, fontSize: 10, letterSpacing: '1px' }}>
          [FSM EXECUTIONS]
        </span>
        <span style={{ color: '#555', fontSize: 9, cursor: 'pointer' }} onClick={load}>
          {loading ? '⟳' : '↻'}
        </span>
      </div>

      {execs.length === 0 && (
        <div style={{ padding: '8px 12px', color: '#555' }}>
          {loading ? '加载中...' : '暂无执行记录'}
        </div>
      )}

      {execs.map((exec) => (
        <div key={exec.id} style={{ borderBottom: '1px solid #111' }}>
          <div
            onClick={() => selectExec(exec.id)}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '5px 8px', cursor: 'pointer',
              background: selected === exec.id ? 'rgba(255,51,51,0.06)' : 'transparent',
            }}
            onMouseEnter={e => { if (selected !== exec.id) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
            onMouseLeave={e => { if (selected !== exec.id) e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ color: '#ccc' }}>{exec.id.slice(0, 12)}</span>
            <span style={{
              color: exec.state === 'completed' ? '#44bb44' : exec.state === 'running' ? '#4488ff' : '#ff8800',
              fontSize: 9, background: 'rgba(0,0,0,0.3)', padding: '1px 4px',
            }}>
              {exec.state}
            </span>
          </div>

          {selected === exec.id && (
            <div style={{ padding: '4px 12px 6px', background: 'rgba(0,0,0,0.3)', fontSize: 10 }}>
              <div style={{ color: '#888', marginBottom: 2 }}>
                <span style={{ color: '#555' }}>FSM: </span>{transitions(exec)}
              </div>
              {detail?.execution && (
                <div style={{ marginTop: 4, borderTop: '1px solid #1a1a1a', paddingTop: 4 }}>
                  <div style={{ color: '#888' }}>
                    <span style={{ color: '#555' }}>DAG: </span>
                    <span style={{ color: '#666' }}>
                      {detail.execution.dagResult
                        ? JSON.stringify(detail.execution.dagResult).substring(0, 120)
                        : '—'}
                    </span>
                  </div>
                  <div style={{ color: '#555', marginTop: 2 }}>
                    快照: {detail.execution.snapshots?.length ?? 0}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default RuntimePanel;
