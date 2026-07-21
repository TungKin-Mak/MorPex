/* ═══════════════════════════════════════════════════════════════════════
   ZoneA_TopBar.tsx — 顶部通栏 56px（中文 + 真实数据）
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAstroStore } from './stores';
import { fetchArchitectureHealth } from './api';
import './Header.css';
import MemoryIndicator from './MemoryIndicator';

const ZoneA_TopBar: React.FC = () => {
  const clockRef = useRef<HTMLDivElement>(null);
  const phase = useAstroStore((s) => s.phase);
  const sseConnected = useAstroStore((s) => s.sseConnected);
  const pluginCount = useAstroStore((s) => s.pluginCount);
  const activeExecutions = useAstroStore((s) => s.activeExecutions);
  const aiEngineReady = useAstroStore((s) => s.aiEngineReady);
  const execCount = useAstroStore((s) => s.execCount);
  const uptime = useAstroStore((s) => s.uptime);

  // v7 指标轮询
  const [v7Score, setV7Score] = useState<{ score: number; runtimeActive: number; runtimeTotal: number; dead: number } | null>(null);

  const toggleHealthOverlay = useCallback(() => {
    window.dispatchEvent(new CustomEvent('toggle-health-overlay'));
  }, []);
  const fetchV7 = useCallback(async () => {
    try {
      const h = await fetchArchitectureHealth();
      setV7Score({
        score: h.score,
        runtimeActive: h.runtimeCoverage.active,
        runtimeTotal: h.runtimeCoverage.total,
        dead: h.deadModules,
      });
    } catch { /* backend unreachable */ }
  }, []);
  useEffect(() => {
    fetchV7();
    const id = setInterval(fetchV7, 10000);
    return () => clearInterval(id);
  }, [fetchV7]);

  useEffect(() => {
    const tick = () => {
      if (clockRef.current) {
        const d = new Date();
        clockRef.current.textContent =
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
          `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const phaseLabel = phase === 'IDLE' ? '空闲' : phase === 'RUNNING' ? '运行中' : phase === 'ERROR' ? '异常' : phase;
  const sseLabel = sseConnected ? '已连接' : '断开';
  const sseClass = sseConnected ? 'status-ok' : 'status-critical';
  const aiLabel = aiEngineReady ? '就绪' : '离线';
  const uptimeStr = uptime > 86400
    ? `${Math.floor(uptime / 86400)}天${Math.floor((uptime % 86400) / 3600)}小时`
    : uptime > 3600
      ? `${Math.floor(uptime / 3600)}小时${Math.floor((uptime % 3600) / 60)}分`
      : `${Math.floor(uptime / 60)}分${Math.floor(uptime % 60)}秒`;

  const runtimePct = v7Score && v7Score.runtimeTotal > 0
    ? Math.round((v7Score.runtimeActive / v7Score.runtimeTotal) * 100)
    : null;

  return (
    <header className="header-container">
      <div className="header-left">MORPEX 遥测面板</div>
      <div className="header-center">
        <span className="status-txt">系统阶段：{phaseLabel}</span>
        <span className="status-txt">SSE：</span>
        <span className={sseClass}>[{sseLabel}]</span>
        <span className="status-txt">插件数：{pluginCount}</span>
        <span className="status-txt">任务数：{activeExecutions}</span>
        <span className="status-txt">AI引擎：{aiLabel}</span>
        <span className="status-txt">已执行：{execCount}</span>
        <span className="status-txt">运行时间：{uptimeStr}</span>
        <MemoryIndicator />
      </div>
      <div className="header-right" ref={clockRef} />
      {/* v7 指标第二行 — 点击弹出 HealthOverlay */}
      {v7Score && (
        <div onClick={toggleHealthOverlay} style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          display: 'flex', justifyContent: 'center', gap: 16,
          fontSize: 9, color: '#666', fontFamily: '"JetBrains Mono", monospace',
          borderTop: '1px solid #1a1a1a', padding: '1px 0', background: '#0a0a0a',
          cursor: 'pointer',
        }}>
          <span>Score <span style={{ color: v7Score.score >= 90 ? '#44bb44' : '#ff8800' }}>{v7Score.score}</span></span>
          <span>Runtime <span style={{ color: runtimePct !== null && runtimePct >= 90 ? '#44bb44' : '#ff8800' }}>{runtimePct !== null ? runtimePct + '%' : '—'}</span></span>
          <span>Dead <span style={{ color: v7Score.dead > 0 ? '#FF3333' : '#44bb44' }}>{v7Score.dead}</span></span>
        </div>
      )}
    </header>
  );
};

export default ZoneA_TopBar;
