/* ═════════════════════════════════════════════════════════════════
   BloomEffect.tsx — Bloom 占位（postprocessing 未安装时 fallback）
   ═════════════════════════════════════════════════════════════════ */

import React from 'react';

interface BloomPassProps {
  strength?: number;
  radius?: number;
  threshold?: number;
}

/** 占位：安装 @react-three/postprocessing 后自动启用 Bloom */
const BloomPass: React.FC<BloomPassProps> = () => {
  return null;
};

export default BloomPass;
