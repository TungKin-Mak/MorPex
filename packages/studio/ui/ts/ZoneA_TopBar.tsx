/* ═══════════════════════════════════════════════════════════════════════
   ZoneA_TopBar.tsx — 顶部通栏 56px（中文 + 真实数据）
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useEffect, useRef } from 'react';
import { useAstroStore } from './stores';
import './Header.css';

const ZoneA_TopBar: React.FC = () => {
  const clockRef = useRef<HTMLDivElement>(null);
  const phase = useAstroStore((s) => s.phase);
  const sseConnected = useAstroStore((s) => s.sseConnected);
  const pluginCount = useAstroStore((s) => s.pluginCount);
  const activeExecutions = useAstroStore((s) => s.activeExecutions);
  const aiEngineReady = useAstroStore((s) => s.aiEngineReady);
  const execCount = useAstroStore((s) => s.execCount);
  const uptime = useAstroStore((s) => s.uptime);

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
      </div>
      <div className="header-right" ref={clockRef} />
    </header>
  );
};

export default ZoneA_TopBar;
