/* ═══════════════════════════════════════════════════════════════════════
   debug/StatsPanel.tsx — 底部统计面板
   
   显示：Total Tasks, Success, Failed, Average Latency, Module Coverage
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import type { SystemStats } from './types';

interface Props {
  stats: SystemStats | null;
}

const STAT_ITEM: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 16px',
  borderRight: '1px solid var(--border)',
  height: '100%',
};

const STAT_VALUE: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  fontFamily: "'JetBrains Mono', monospace",
  lineHeight: 1,
};

const STAT_LABEL: React.CSSProperties = {
  fontSize: 9,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  fontFamily: "'JetBrains Mono', monospace",
};

export default function StatsPanel({ stats }: Props) {
  if (!stats) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--text-muted)',
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        No statistics available. Generate tasks to see results.
      </div>
    );
  }

  const coveragePct = `${Math.round(stats.moduleCoverage * 100) / 100}%`;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      height: '100%',
      overflow: 'hidden',
    }}>
      <div style={STAT_ITEM}>
        <div>
          <div style={{ ...STAT_VALUE, color: 'var(--text-primary)' }}>{stats.totalTasks}</div>
          <div style={STAT_LABEL}>Total Tasks</div>
        </div>
      </div>

      <div style={STAT_ITEM}>
        <div>
          <div style={{ ...STAT_VALUE, color: 'var(--accent-green)' }}>{stats.successCount}</div>
          <div style={STAT_LABEL}>Success</div>
        </div>
      </div>

      <div style={STAT_ITEM}>
        <div>
          <div style={{ ...STAT_VALUE, color: stats.failedCount > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
            {stats.failedCount}
          </div>
          <div style={STAT_LABEL}>Failed</div>
        </div>
      </div>

      <div style={STAT_ITEM}>
        <div>
          <div style={{ ...STAT_VALUE, color: 'var(--accent-blue)' }}>{stats.avgLatency}ms</div>
          <div style={STAT_LABEL}>Avg Latency</div>
        </div>
      </div>

      <div style={STAT_ITEM}>
        <div>
          <div style={{ ...STAT_VALUE, color: 'var(--accent-purple)' }}>{coveragePct}</div>
          <div style={STAT_LABEL}>Module Coverage</div>
        </div>
      </div>

      <div style={STAT_ITEM}>
        <div>
          <div style={{ ...STAT_VALUE, color: 'var(--accent-yellow)' }}>{stats.pathCoverage}</div>
          <div style={STAT_LABEL}>Paths</div>
        </div>
      </div>

      <div style={{ ...STAT_ITEM, borderRight: 'none' }}>
        <div>
          <div style={{ ...STAT_VALUE, color: stats.unusedModules?.length > 0 ? 'var(--accent-red)' : 'var(--accent-green)', fontSize: 14 }}>
            {stats.unusedModules?.length || 0}
          </div>
          <div style={STAT_LABEL}>Unused Modules</div>
        </div>
      </div>
    </div>
  );
}
