/* ═══════════════════════════════════════════════════════════════════════
   ZoneC_CenterPane.tsx — 中央列（图表 40% + 3D 大脑 60%）
   ═══════════════════════════════════════════════════════════════════════ */

import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import MiddleCharts from './MiddleCharts';
import BrainMatrix from './BrainMatrix';
import BrainScene from './BrainScene';
import './MiddlePanel.css';

/** Canvas 占位 fallback */
const BrainFallback: React.FC = () => (
  <div style={{
    width: '100%', height: '100%',
    display: 'flex', justifyContent: 'center', alignItems: 'center',
    color: '#3a3c42', fontFamily: 'Consolas, monospace', fontSize: '12px',
  }}>
    LOADING BRAIN...
  </div>
);

const ZoneC_CenterPane: React.FC = () => {
  return (
    <div className="middle-column-wrapper">
      {/* 1. 上半部分：折线图（~40%） */}
      <div className="charts-container-section">
        <MiddleCharts />
      </div>

      {/* 2. 下半部分：3D 大脑（~60%） */}
      <div className="brain-container-section">
        <BrainMatrix>
          <Suspense fallback={<BrainFallback />}>
            <Canvas
              camera={{ fov: 38, position: [2.2, 0.5, 0], near: 0.1, far: 10 }}
              style={{ width: '100%', height: '100%', background: '#000' }}
              gl={{ antialias: true, alpha: false }}
            >
              <BrainScene />
            </Canvas>
          </Suspense>
        </BrainMatrix>
      </div>
    </div>
  );
};

export default ZoneC_CenterPane;
