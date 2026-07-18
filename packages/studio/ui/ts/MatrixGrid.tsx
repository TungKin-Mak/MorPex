/* ═══════════════════════════════════════════════════════════════════════
   MatrixGrid.tsx — ASTROM KERNEL 主布局网格
   
   CSS Grid: 320px | 1fr | 340px  ×  56px | 1fr | 120px
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import ZoneA_TopBar from './ZoneA_TopBar';
import ZoneB_LeftPane from './ZoneB_LeftPane';
import ZoneC_CenterPane from './ZoneC_CenterPane';
import ZoneD_RightPane from './ZoneD_RightPane';
import ZoneE_BottomPane from './ZoneE_BottomPane';

const MatrixGrid: React.FC = () => {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '3fr 4fr 3fr',
      gridTemplateRows: '56px 1fr 120px',
      gridTemplateAreas: `
        "header header header"
        "left   middle right"
        "footer footer footer"
      `,
      width: '100vw',
      height: '100vh',
      overflow: 'hidden',
      background: '#000',
      color: '#d8dadc',
      fontFamily: "'Share Tech Mono', 'Courier New', monospace",
      letterSpacing: '0.5px',
      padding: '6px',
      gap: '2px',
      boxSizing: 'border-box',
    }}>
      {/* ═══ 顶部通栏 56px ═══ */}
      <div style={{ gridArea: 'header' }}>
        <ZoneA_TopBar />
      </div>

      {/* ═══ 左侧列 320px ═══ */}
      <div style={{ gridArea: 'left', overflow: 'hidden' }}>
        <ZoneB_LeftPane />
      </div>

      {/* ═══ 中间列 auto ═══ */}
      <div style={{ gridArea: 'middle', overflow: 'hidden' }}>
        <ZoneC_CenterPane />
      </div>

      {/* ═══ 右侧列 340px ═══ */}
      <div style={{ gridArea: 'right', overflow: 'hidden' }}>
        <ZoneD_RightPane />
      </div>

      {/* ═══ 底部通栏 120px ═══ */}
      <div style={{ gridArea: 'footer' }}>
        <ZoneE_BottomPane />
      </div>
    </div>
  );
};

export default MatrixGrid;
