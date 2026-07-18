/* ═══════════════════════════════════════════════════════════════════════
   shared/ErrorBoundary.tsx
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';

interface Props { children: React.ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100vh', background: '#000', color: '#FF3333',
          fontFamily: '"JetBrains Mono", monospace', flexDirection: 'column', gap: 8,
        }}>
          <span style={{ fontSize: 48 }}>⚡</span>
          <span style={{ fontSize: 14 }}>FATAL ERROR</span>
          <pre style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', maxWidth: 500 }}>
            {this.state.error?.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
