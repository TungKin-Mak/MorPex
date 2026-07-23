/* ═══════════════════════════════════════════════════════════════════════
   debug/ModuleCoverage.tsx — 模块覆盖率 + 心跳自检 (v9.2)
   
   两层信息：
     1. SYSTEM MODULES — 每个已注册模块的心跳状态 + 是否被调用
     2. Coverage Bars — 总体覆盖率 / 数据流覆盖率 / 路径统计
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import type { ModuleCoverage, ModuleHealthReport } from './types';

interface Props {
  coverage: ModuleCoverage | null;
  heartbeatReport: ModuleHealthReport | null;
}

const H: React.CSSProperties = {
  padding: '7px 12px',
  borderBottom: '1px solid var(--border)',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 1,
  color: 'var(--text-secondary)',
  fontWeight: 600,
};

const LAYER_TAG: Record<string, { bg: string; fg: string }> = {
  'control-plane': { bg: 'rgba(88,166,255,0.12)', fg: '#58a6ff' },
  'runtime':       { bg: 'rgba(63,185,80,0.12)',  fg: '#3fb950' },
  'knowledge':     { bg: 'rgba(188,140,255,0.12)', fg: '#bc8cff' },
  'evolution':     { bg: 'rgba(210,153,34,0.12)',  fg: '#d29922' },
  'interaction':   { bg: 'rgba(248,81,73,0.12)',   fg: '#f85149' },
};

export default function ModuleCoveragePanel({ coverage, heartbeatReport }: Props) {
  const modules = heartbeatReport?.heartbeats || [];
  const onlineButUnused = heartbeatReport?.onlineButUnused || [];
  const exercisedSet = new Set(heartbeatReport?.exercisedModules || []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Header ── */}
      <div style={H}>
        SYSTEM MODULES
        <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6 }}>
          {modules.length > 0 ? `${heartbeatReport?.onlineCount ?? 0} online / ${modules.length} total` : ''}
        </span>
      </div>

      {/* ── Online but Unused alert ── */}
      {onlineButUnused.length > 0 && (
        <div style={{
          padding: '6px 12px',
          background: 'rgba(248,81,73,0.08)',
          borderBottom: '1px solid rgba(248,81,73,0.2)',
        }}>
          <div style={{
            color: 'var(--accent-red)',
            fontSize: 10,
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 600,
            marginBottom: 3,
          }}>
            ⚠ ONLINE BUT UNUSED ({onlineButUnused.length})
          </div>
          {onlineButUnused.slice(0, 15).map(m => (
            <div key={m.name} style={{
              fontSize: 9,
              fontFamily: "'JetBrains Mono', monospace",
              color: 'var(--text-muted)',
              padding: '1px 0',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}>
              <span style={{
                width: 5, height: 5, borderRadius: '50%',
                background: 'var(--accent-green)', display: 'inline-block',
              }} />
              <span style={{ color: 'var(--accent-red)', fontSize: 9 }}>⚠</span>
              {m.name}
              <span style={{ color: 'var(--text-muted)', fontSize: 8 }}>
                {m.layer ? `[${m.layer}]` : ''}
              </span>
            </div>
          ))}
          {onlineButUnused.length > 15 && (
            <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 2 }}>
              ...and {onlineButUnused.length - 15} more
            </div>
          )}
        </div>
      )}

      {/* ── Module list ── */}
      <div style={{ flex: '1 1 auto', overflow: 'auto' }}>
        {modules.length === 0 ? (
          <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 10 }}>
            No modules registered.
          </div>
        ) : (
          modules
            .sort((a, b) => {
              // Sort: unknown first (needs attention), then alphabetically
              if (a.status === 'unknown' && b.status !== 'unknown') return -1;
              if (b.status === 'unknown' && a.status !== 'unknown') return 1;
              return a.name.localeCompare(b.name);
            })
            .map(m => {
              const exercised = exercisedSet.has(m.name);
              const tag = LAYER_TAG[m.layer] || { bg: 'rgba(255,255,255,0.05)', fg: '#8b949e' };
              const isUnknown = m.status === 'unknown';
              const isOffline = m.status === 'offline';

              return (
                <div key={m.name} style={{
                  padding: '4px 12px',
                  borderBottom: '1px solid rgba(48,54,61,0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 10,
                  fontFamily: "'JetBrains Mono', monospace",
                  opacity: isUnknown ? 0.55 : 1,
                }}>
                  {/* Status dot */}
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: isUnknown ? 'var(--text-muted)'
                      : m.status === 'online' ? 'var(--accent-green)'
                      : m.status === 'degraded' ? 'var(--accent-yellow)'
                      : 'var(--accent-red)',
                    boxShadow: m.status === 'online' ? '0 0 4px rgba(63,185,80,0.5)' : 'none',
                    flexShrink: 0,
                  }} />
                  {/* Name */}
                  <span style={{ color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.name}
                  </span>
                  {/* Layer tag */}
                  <span style={{
                    padding: '0 4px', borderRadius: 2,
                    background: tag.bg, color: tag.fg,
                    fontSize: 8, flexShrink: 0,
                  }}>
                    {m.layer}
                  </span>
                  {/* Status badge */}
                  {isUnknown ? (
                    <span style={{ color: 'var(--text-muted)', fontSize: 8, flexShrink: 0 }}>?</span>
                  ) : exercised ? (
                    <span style={{ color: 'var(--accent-green)', fontSize: 10, flexShrink: 0 }}>✓</span>
                  ) : (
                    <span style={{ color: 'var(--accent-yellow)', fontSize: 10, flexShrink: 0 }}>⚠</span>
                  )}
                </div>
              );
            })
        )}
      </div>

      {/* ── Coverage section (keep existing) ── */}
      {coverage && (
        <>
          <div style={{
            borderTop: '1px solid var(--border)',
            padding: '6px 12px',
          }}>
            {/* Overall coverage bar */}
            <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginBottom: 1 }}>
              Module Coverage
            </div>
            <div style={{
              height: 4, borderRadius: 2, background: 'var(--bg-tertiary)',
              overflow: 'hidden', marginBottom: 2,
            }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${Math.round(coverage.moduleCoverage * 100)}%`,
                background: coverage.moduleCoverage > 0.8 ? 'var(--accent-green)'
                  : coverage.moduleCoverage > 0.5 ? 'var(--accent-yellow)'
                  : 'var(--accent-red)',
              }} />
            </div>
            <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 4 }}>
              {coverage.activatedModules}/{coverage.totalModules}
              {heartbeatReport && ` | ${heartbeatReport.onlineCount} online`}
            </div>

            {/* Data flow coverage */}
            <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginBottom: 1 }}>
              Data Flow
            </div>
            <div style={{
              height: 4, borderRadius: 2, background: 'var(--bg-tertiary)',
              overflow: 'hidden', marginBottom: 2,
            }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${Math.round(coverage.dataFlowCoverage * 100)}%`,
                background: coverage.dataFlowCoverage > 0.8 ? 'var(--accent-green)'
                  : coverage.dataFlowCoverage > 0.5 ? 'var(--accent-yellow)'
                  : 'var(--accent-red)',
              }} />
            </div>
          </div>

          {/* Path Coverage */}
          <div style={H}>Paths ({Object.keys(coverage.pathCoverage).length})</div>
          <div style={{ flex: '0 0 auto', maxHeight: 120, overflow: 'auto', fontSize: 9 }}>
            {Object.keys(coverage.pathCoverage).length === 0 ? (
              <div style={{ padding: '4px 12px', color: 'var(--text-muted)' }}>
                No paths recorded.
              </div>
            ) : (
              Object.entries(coverage.pathCoverage)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 20)
                .map(([path, count]) => (
                  <div key={path} style={{
                    padding: '2px 12px',
                    borderBottom: '1px solid rgba(48,54,61,0.3)',
                    display: 'flex', gap: 4,
                  }}>
                    <span style={{ color: 'var(--text-muted)', minWidth: 20 }}>{count}x</span>
                    <span style={{ color: 'var(--accent-blue)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{path}</span>
                  </div>
                ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
