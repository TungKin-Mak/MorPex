/* ═══════════════════════════════════════════════════════════════════════
   ArtifactPanel.tsx — v7 产物列表 + 血缘图面板
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useEffect, useState, useCallback } from 'react';
import { fetchArtifactsV7, fetchArtifactLineage } from './api';
import type { ArtifactV7, LineageData } from './types';

const TYPE_FILTERS = ['all', 'code', 'document', 'config', 'schema', 'report', 'plan', 'structured_data'];

const ArtifactPanel: React.FC = () => {
  const [artifacts, setArtifacts] = useState<ArtifactV7[]>([]);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [lineage, setLineage] = useState<LineageData | null>(null);
  const [loading, setLoading] = useState(false);

  const loadArtifacts = useCallback(async () => {
    try {
      const res = await fetchArtifactsV7();
      setArtifacts(res.artifacts);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadArtifacts(); }, [loadArtifacts]);

  const selectArtifact = useCallback(async (id: string) => {
    if (selected === id) { setSelected(null); setLineage(null); return; }
    setSelected(id);
    setLoading(true);
    try {
      const l = await fetchArtifactLineage(id);
      setLineage(l);
    } catch { setLineage(null); }
    setLoading(false);
  }, [selected]);

  const filtered = filter === 'all' ? artifacts : artifacts.filter(a => a.type === filter);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex', gap: 2, padding: '4px 6px',
        borderBottom: '1px solid #1a1a1a', flexWrap: 'wrap',
      }}>
        {TYPE_FILTERS.map(f => (
          <span key={f} onClick={() => setFilter(f)}
            style={{
              fontSize: 9, padding: '1px 5px', cursor: 'pointer',
              color: filter === f ? '#FF3333' : '#666',
              background: filter === f ? 'rgba(255,51,51,0.08)' : 'transparent',
              border: '1px solid', borderColor: filter === f ? '#FF3333' : '#222',
            }}>
            {f === 'all' ? '全部' : f}
          </span>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {filtered.length === 0 && (
          <div style={{ padding: 12, color: '#555', fontSize: 10 }}>无产物记录</div>
        )}
        {filtered.map(a => (
          <div key={a.id}>
            <div onClick={() => selectArtifact(a.id)}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '4px 8px', cursor: 'pointer', fontSize: 10,
                background: selected === a.id ? 'rgba(255,51,51,0.06)' : 'transparent',
                borderBottom: '1px solid #111',
              }}
              onMouseEnter={e => { if (selected !== a.id) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
              onMouseLeave={e => { if (selected !== a.id) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ color: '#ccc' }}>{a.name}</span>
              <span style={{ color: '#555', fontSize: 9 }}>
                {a.type} v{a.version}
              </span>
            </div>

            {selected === a.id && lineage && (
              <div style={{ padding: '6px 12px', background: 'rgba(0,0,0,0.3)', fontSize: 9 }}>
                <div style={{ color: '#888', marginBottom: 4 }}>
                  <span style={{ color: '#555' }}>上游: </span>
                  {lineage.ancestors.length > 0
                    ? lineage.ancestors.map(id => id.slice(0, 10)).join(', ')
                    : '无'}
                </div>
                <div style={{ color: '#888', marginBottom: 4 }}>
                  <span style={{ color: '#555' }}>下游: </span>
                  {lineage.descendants.length > 0
                    ? lineage.descendants.map(id => id.slice(0, 10)).join(', ')
                    : '无'}
                </div>
                {lineage.ancestorNodes.length > 0 && (
                  <div style={{ color: '#666' }}>
                    祖先节点: {lineage.ancestorNodes.map(n => n.name).join(', ')}
                  </div>
                )}
                {loading && <div style={{ color: '#555' }}>加载中...</div>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ArtifactPanel;
