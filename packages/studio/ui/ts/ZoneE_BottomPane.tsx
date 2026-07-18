/* ═══════════════════════════════════════════════════════════════════════
   ZoneE_BottomPane.tsx — 底部资源监控条（中文 + 真实数据）
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useAstroStore } from './stores';
import './BottomBars.css';

const ZoneE_BottomPane: React.FC = () => {
  const memoryKb = useAstroStore((s) => s.memoryKb);
  const memoryTotalKb = useAstroStore((s) => s.memoryTotalKb);
  const memMainPool = useAstroStore((s) => s.memMainPool);
  const memArchivePool = useAstroStore((s) => s.memArchivePool);
  const memTempPool = useAstroStore((s) => s.memTempPool);
  const memGateRejectRate = useAstroStore((s) => s.memGateRejectRate);
  const vectorCount = useAstroStore((s) => s.vectorCount);
  const backpressure = useAstroStore((s) => s.backpressure);
  const runningTasks = useAstroStore((s) => s.runningTasks);
  const pendingTasks = useAstroStore((s) => s.pendingTasks);
  const fsmPhase = useAstroStore((s) => s.fsmPhase);

  const memPercent = memoryTotalKb > 0 ? Math.round((memoryKb / memoryTotalKb) * 100) : 0;
  const memAlert = memPercent > 90;
  const bpAlert = backpressure > 80;

  const items = [
    {
      title: '系统内存',
      value: `${memPercent}%`,
      pct: `${memPercent}%`,
      alert: memAlert,
      footer: `${memoryKb}MB / ${memoryTotalKb}MB`,
    },
    {
      title: '主内存池',
      value: `${memMainPool}`,
      pct: `${Math.min(100, Math.round((memMainPool / (memMainPool + memArchivePool + 1)) * 100))}%`,
      alert: false,
      footer: `归档 ${memArchivePool} | 临时 ${memTempPool}`,
    },
    {
      title: '向量存储',
      value: `${vectorCount}`,
      pct: `${Math.min(100, Math.round((vectorCount / 5000) * 100))}%`,
      alert: vectorCount > 4000,
      footer: `拒绝率 ${memGateRejectRate}`,
    },
    {
      title: '任务队列',
      value: `${runningTasks}运行`,
      pct: `${Math.min(100, Math.round((runningTasks / (runningTasks + pendingTasks + 1)) * 100))}%`,
      alert: pendingTasks > 5,
      footer: `等待 ${pendingTasks} | 阶段 ${fsmPhase}`,
    },
    {
      title: '网关节流',
      value: `${backpressure}%`,
      pct: `${backpressure}%`,
      alert: bpAlert,
      footer: bpAlert ? '⚠ 需要关注' : '正常',
    },
  ];

  return (
    <div className="footer-layout">
      {items.map((item, idx) => (
        <div key={idx} className={`res-item ${item.alert ? 'alert' : ''}`}>
          <div className="res-header">
            <span className="res-title">{item.title}</span>
            <span className={`res-value ${item.alert ? 'red' : ''}`}>{item.value}</span>
          </div>
          {item.alert && <div className="res-alert-sign">告警 ▲</div>}
          <div className="progress-track">
            <div className="progress-fill" style={{ width: item.pct }} />
          </div>
          <div className="res-footer">{item.footer}</div>
        </div>
      ))}
    </div>
  );
};

export default ZoneE_BottomPane;
