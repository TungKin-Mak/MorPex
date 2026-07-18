/* ═══════════════════════════════════════════════════════════════════════
   BrainMatrix.tsx — 大脑矩阵容器（3px 白边）
   ═══════════════════════════════════════════════════════════════════════ */

import React, { type ReactNode } from 'react';
import './BrainMatrix.css';

interface Props {
  children?: ReactNode;
}

const BrainMatrix: React.FC<Props> = ({ children }) => {
  return (
    <div className="brain-box">
      {children}
    </div>
  );
};

export default BrainMatrix;
