/* ═══════════════════════════════════════════════════════════════════════
   main.tsx — AstroM 入口
   ═══════════════════════════════════════════════════════════════════════ */

import '../style.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './shared/ErrorBoundary';

// Hide loading screen immediately — even if React crashes, user sees a blank page rather than stuck loader
const loading = document.getElementById('loading-screen');
if (loading) loading.classList.add('hidden');

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
}

export {};
