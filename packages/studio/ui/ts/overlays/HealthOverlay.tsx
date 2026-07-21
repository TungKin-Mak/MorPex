/* ═══════════════════════════════════════════════════════════════════════
   overlays/HealthOverlay.tsx — v7 架构健康报告覆盖层
   通过 window.dispatchEvent(new CustomEvent('toggle-health-overlay'))
   触发显示
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useEffect, useState, useCallback } from 'react';
import { fetchArchitectureHealth, validateSystem, fetchSystemHealth, fetchLearningStats } from '../api';
import type { HealthReport, SystemHealth, LearningStats } from '../types';

const DIMENSION_LABELS: Record<string, string> = {
  module_coverage: '模块覆盖率',
  runtime_health: '运行时健康',
  api_integrity: 'API 完整性',
  event_consistency: '事件一致性',
  memory_coherence: '记忆一致性',
  error_rate: '错误率',
};

const HealthOverlay: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [sysHealth, setSysHealth] = useState<SystemHealth | null>(null);
  const [learning, setLearning] = useState<LearningStats | null>(null);
  const [validation, setValidation] = useState<{ passed: boolean; healthScore: number } | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setHealth(await fetchArchitectureHealth()); } catch {}
    try { setSysHealth(await fetchSystemHealth()); } catch {}
    try { setLearning(await fetchLearningStats()); } catch {}
    try { setValidation(await validateSystem()); } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    const handler = () => {
      setVisible(v => !v);
      if (!visible) load();
    };
    window.addEventListener('toggle-health-overlay', handler);
    return () => window.removeEventListener('toggle-health-overlay', handler);
  }, [visible, load]);

  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setVisible(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible]);

  if (!visible) return null;

  const s = (px: number) => Math.max(1, Math.round(px));

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 600,
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)',
    }} onClick={() => setVisible(false)}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '70vw', maxWidth: 800, maxHeight: '80vh',
        background: '#0a0a0a', border: '2px solid #FF3333',
        display: 'flex', flexDirection: 'column',
        fontFamily: '"JetBrains Mono", monospace', color: '#d0d0d0',
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: `${s(8)}px ${s(12)}px`,
          borderBottom: '1px solid #222',
        }}>
          <span style={{ fontSize: s(11), color: '#FF3333', fontWeight: 700, letterSpacing: '1px' }}>
            [ARCHITECTURE HEALTH REPORT]
          </span>
          <span onClick={() => setVisible(false)} style={{
            cursor: 'pointer', color: '#FF3333', fontSize: s(10),
            border: '1px solid #FF3333', padding: `1px ${s(6)}px`,
          }}>
            [ESC]
          </span>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: s(12) }}>
          {loading && !health && <div style={{ color: '#555' }}>加载中...</div>}

          {/* 总分 */}
          {health && (
            <div style={{ marginBottom: s(12) }}>
              <div style={{
                fontSize: s(24), fontWeight: 700, color: health.score >= 90 ? '#44bb44' : health.score >= 70 ? '#ff8800' : '#FF3333',
                textAlign: 'center',
              }}>
                {health.score}/100
              </div>
              <div style={{ textAlign: 'center', color: '#555', fontSize: s(9), marginTop: 2 }}>
                架构健康评分
              </div>
            </div>
          )}

          {/* 6 维度 breakdown */}
          {health?.breakdown && (
            <div style={{ marginBottom: s(12) }}>
              <div style={{ color: '#888', fontSize: s(9), marginBottom: 4, textTransform: 'uppercase', letterSpacing: '1px' }}>
                维度 Breakdown
              </div>
              {health.breakdown.map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', marginBottom: 3, fontSize: s(9) }}>
                  <span style={{ width: 140, color: '#aaa' }}>
                    {DIMENSION_LABELS[d.dimension] || d.dimension}
                  </span>
                  <div style={{
                    flex: 1, height: s(6), background: '#1a1a1a', margin: '0 8px', position: 'relative',
                  }}>
                    <div style={{
                      width: `${(d.score / d.max) * 100}%`, height: '100%',
                      background: d.status === 'healthy' ? '#44bb44' : d.status === 'degraded' ? '#ff8800' : '#FF3333',
                    }} />
                  </div>
                  <span style={{ width: 40, textAlign: 'right', color: '#666' }}>
                    {d.score}/{d.max}
                  </span>
                  <span style={{
                    width: 60, textAlign: 'right', fontSize: 8,
                    color: d.status === 'healthy' ? '#44bb44' : d.status === 'degraded' ? '#ff8800' : '#FF3333',
                    marginLeft: 4,
                  }}>
                    [{d.status}]
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Runtime Coverage */}
          {health?.runtimeCoverage && (
            <div style={{ marginBottom: s(12), borderTop: '1px solid #1a1a1a', paddingTop: s(8) }}>
              <div style={{ color: '#888', fontSize: s(9), marginBottom: 4, textTransform: 'uppercase', letterSpacing: '1px' }}>
                模块分类统计
              </div>
              <div style={{ display: 'flex', gap: s(16), fontSize: s(9), flexWrap: 'wrap' }}>
                <div><span style={{ color: '#44bb44' }}>{health.runtimeCoverage.active} ACTIVE_RUNTIME</span></div>
                <div><span style={{ color: '#4488ff' }}>{health.runtimeCoverage.publicApi} PUBLIC_API</span></div>
                <div><span style={{ color: '#FF3333' }}>{health.runtimeCoverage.dead} DEAD</span></div>
                <div><span style={{ color: '#888' }}>{health.runtimeCoverage.total} TOTAL</span></div>
              </div>
            </div>
          )}

          {/* Events */}
          {health && (
            <div style={{ marginBottom: s(12), borderTop: '1px solid #1a1a1a', paddingTop: s(8) }}>
              <div style={{ fontSize: s(9), color: '#888' }}>
                <span style={{ color: '#555' }}>事件总数: </span>{health.events}
                <span style={{ marginLeft: 16, color: '#555' }}>死亡模块: </span>
                <span style={{ color: health.deadModules > 0 ? '#FF3333' : '#44bb44' }}>{health.deadModules}</span>
              </div>
            </div>
          )}

          {/* System Health */}
          {sysHealth && (
            <div style={{ marginBottom: s(12), borderTop: '1px solid #1a1a1a', paddingTop: s(8) }}>
              <div style={{ color: '#888', fontSize: s(9), marginBottom: 4, textTransform: 'uppercase', letterSpacing: '1px' }}>
                系统健康
              </div>
              <div style={{ display: 'flex', gap: s(16), fontSize: s(9), flexWrap: 'wrap' }}>
                <div>架构覆盖率: <span style={{ color: sysHealth.architectureCoverage >= 0.9 ? '#44bb44' : '#ff8800' }}>
                  {(sysHealth.architectureCoverage * 100).toFixed(0)}%
                </span></div>
                <div>场景成功率: <span style={{ color: sysHealth.scenarioSuccessRate >= 0.9 ? '#44bb44' : '#ff8800' }}>
                  {(sysHealth.scenarioSuccessRate * 100).toFixed(0)}%
                </span></div>
                <div>测试通过: <span style={{ color: sysHealth.testsPassed > 0 ? '#44bb44' : '#FF3333' }}>
                  {sysHealth.testsPassed}
                </span></div>
              </div>
            </div>
          )}

          {/* Learning Stats */}
          {learning && (
            <div style={{ marginBottom: s(12), borderTop: '1px solid #1a1a1a', paddingTop: s(8) }}>
              <div style={{ color: '#888', fontSize: s(9), marginBottom: 4, textTransform: 'uppercase', letterSpacing: '1px' }}>
                模板演化
              </div>
              <div style={{ fontSize: s(9), color: '#888' }}>
                模板总数: <span style={{ color: '#ccc' }}>{learning.templateEvolution.totalTemplates}</span>
                <span style={{ marginLeft: 16 }}>平均成功率: <span style={{ color: '#44bb44' }}>
                  {(learning.templateEvolution.avgSuccessRate * 100).toFixed(1)}%
                </span></span>
              </div>
            </div>
          )}

          {/* Validation */}
          {validation && (
            <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: s(8) }}>
              <div style={{ color: '#888', fontSize: s(9), marginBottom: 4, textTransform: 'uppercase', letterSpacing: '1px' }}>
                验证结果
              </div>
              <div style={{ fontSize: s(9) }}>
                <span style={{ color: validation.passed ? '#44bb44' : '#FF3333' }}>
                  {validation.passed ? '✓ PASSED' : '✗ FAILED'}
                </span>
                <span style={{ marginLeft: 16, color: '#555' }}>
                  健康分数: {validation.healthScore}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HealthOverlay;
