/* ═══════════════════════════════════════════════════════════════════════
   debug/main.tsx — Observability Debug 入口 v9.1
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { createRoot } from 'react-dom/client';
import DebugPage from './DebugPage';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <DebugPage />
    </React.StrictMode>,
  );
}

export {};
