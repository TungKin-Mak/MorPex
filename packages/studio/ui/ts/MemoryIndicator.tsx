/* ═══════════════════════════════════════════════════════════════════════
   MemoryIndicator.tsx — v7 记忆激活小挂件（ZoneA_TopBar 用）
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useState, useCallback } from 'react';
import { useAstroStore } from './stores';
import { activateMemory } from './api';
import type { MemoryResult } from './types';

const MemoryIndicator: React.FC = () => {
  const activationResult = useAstroStore((s) => s.memoryActivationResult);
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(async () => {
    setLoading(true);
    try {
      const res = await activateMemory({
        executionStatus: 'active',
        goal: 'frontend_status_check',
      });
      useAstroStore.getState().activateMemory({
        executionStatus: 'active',
        goal: 'frontend_status_check',
      });
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const score = activationResult?.activationScore ?? null;
  const bias = activationResult?.contextBias ?? null;

  return (
    <span
      onClick={handleClick}
      style={{
        cursor: 'pointer', fontSize: 10, color: '#888',
        border: '1px solid #222', padding: '0 6px', marginLeft: 8,
        fontFamily: '"JetBrains Mono", monospace',
      }}
      title={loading ? '激活中...' : `记忆激活: ${score !== null ? (score * 100).toFixed(0) + '%' : '未激活'} | 偏向: ${bias || '—'}`}
    >
      {loading ? '⟳' : '🧠'}
      {score !== null && (
        <span style={{ marginLeft: 4, color: score > 0.7 ? '#44bb44' : score > 0.4 ? '#ff8800' : '#888' }}>
          {(score * 100).toFixed(0)}%
        </span>
      )}
    </span>
  );
};

export default MemoryIndicator;
