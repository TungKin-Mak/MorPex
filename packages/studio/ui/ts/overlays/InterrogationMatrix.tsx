/* ═══════════════════════════════════════════════════════════════════════
   overlays/InterrogationMatrix.tsx — 全屏质询矩阵 (responsive)
   Full-screen overlay, red grid pixel-matrix, typewriter text,
   F1 [APPROVE/批准], F2 [REJECT/驳回]
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useState, useEffect } from 'react';

let _show = false;
let _ticket: any = null;
let _listeners: Array<(show: boolean, ticket: any) => void> = [];

export function setInterrogationTicket(ticket: any) {
  _ticket = ticket;
  _show = true;
  _listeners.forEach((fn) => fn(true, ticket));
}
export function dismissInterrogation() {
  _show = false;
  _ticket = null;
  _listeners.forEach((fn) => fn(false, null));
}

const InterrogationMatrix: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [ticket, setTicket] = useState<any>(null);
  const [displayText, setDisplayText] = useState('');
  const [showCursor, setShowCursor] = useState(true);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const updateScale = () => {
      const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--astrom-scale')) || 1;
      setScale(v);
    };
    updateScale();
    const obs = new ResizeObserver(updateScale);
    obs.observe(document.documentElement);
    return () => obs.disconnect();
  }, []);

  const s = (px: number) => Math.max(1, Math.round(px * scale));

  useEffect(() => {
    const handler = (show: boolean, t: any) => {
      setVisible(show);
      setTicket(t);
      if (show && t) {
        window.dispatchEvent(new CustomEvent('interrogation-active', { detail: { active: true } }));
        const text = t.description || t.message || `CROSS-DOMAIN CONFLICT DETECTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Severity: HIGH
Source: Reverse_Eng \u2194 RAG_Engine
Conflict: Resource contention on shared memory bus
Domain A (Reverse_Eng): Requires exclusive write access to sector 0x4F2A
Domain B (RAG_Engine): Requires read access to sector 0x4F2A for context build
Arbitration: Manual intervention required — automatic resolution failed
Timestamp: ${new Date().toISOString()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Select action to proceed \u2192`;
        let idx = 0;
        setDisplayText('');
        const iv = setInterval(() => {
          if (idx < text.length) { setDisplayText(text.slice(0, idx + 1)); idx++; }
          else clearInterval(iv);
        }, 12);
        return () => clearInterval(iv);
      } else {
        window.dispatchEvent(new CustomEvent('interrogation-active', { detail: { active: false } }));
      }
    };
    _listeners.push(handler);
    return () => { _listeners = _listeners.filter((fn) => fn !== handler); };
  }, []);

  useEffect(() => {
    const iv = setInterval(() => setShowCursor((v) => !v), 500);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F1') { dismissInterrogation(); window.dispatchEvent(new CustomEvent('interrogation-result', { detail: { verdict: 'approved' } })); }
      if (e.key === 'F2') { dismissInterrogation(); window.dispatchEvent(new CustomEvent('interrogation-result', { detail: { verdict: 'rejected' } })); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible]);

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, background: '#000000',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: '"JetBrains Mono", monospace', color: '#FFFFFF', padding: s(40),
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `linear-gradient(rgba(255,51,51,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,51,51,0.03) 1px, transparent 1px)`,
        backgroundSize: `${s(40)}px ${s(40)}px`, pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(ellipse at 50% 50%, rgba(255,51,51,0.06) 0%, transparent 60%)`,
        pointerEvents: 'none',
      }} />
      <div style={{ position: 'relative', zIndex: 1, maxWidth: s(700), width: '100%' }}>
        <div style={{
          fontSize: s(12), color: '#FF3333', fontWeight: 700, letterSpacing: '3px',
          marginBottom: s(12), textTransform: 'uppercase',
          textShadow: '0 0 20px rgba(255,51,51,0.5), 0 0 40px rgba(255,51,51,0.2)',
          animation: 'brain-alert-flash 1s ease-in-out infinite',
        }}>
          🚨 INTERROGATION MATRIX // 全屏质询矩阵
        </div>
        <div style={{
          height: 1, background: '#FF3333', marginBottom: s(16),
          boxShadow: '0 0 8px #FF3333',
        }} />
        <div style={{
          fontSize: s(10), color: 'rgba(255,255,255,0.7)', lineHeight: 1.8,
          minHeight: s(180), marginBottom: s(24), whiteSpace: 'pre-wrap',
          fontFamily: '"JetBrains Mono", monospace',
          border: '1px solid rgba(255,51,51,0.15)', padding: `${s(12)}px ${s(14)}px`,
          background: 'rgba(0,0,0,0.8)',
        }}>
          {displayText}
          <span style={{ opacity: showCursor ? 1 : 0, color: '#FF3333', fontWeight: 700 }}>_</span>
        </div>
        <div style={{ display: 'flex', gap: s(16), justifyContent: 'center' }}>
          <div onClick={() => { dismissInterrogation(); window.dispatchEvent(new CustomEvent('interrogation-result', { detail: { verdict: 'approved' } })); }}
            style={{ display: 'flex', alignItems: 'center', gap: s(8), padding: `${s(8)}px ${s(16)}px`,
              border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.03)', cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}>
            <span style={{ fontSize: s(9), padding: `2px ${s(6)}px`, border: '1px solid #FFFFFF', color: '#FFFFFF', fontWeight: 700 }}>
              F1
            </span>
            <span style={{ fontSize: s(10), color: '#FFFFFF', fontWeight: 600, letterSpacing: '1px' }}>
              [APPROVE / 批准]
            </span>
          </div>
          <div onClick={() => { dismissInterrogation(); window.dispatchEvent(new CustomEvent('interrogation-result', { detail: { verdict: 'rejected' } })); }}
            style={{ display: 'flex', alignItems: 'center', gap: s(8), padding: `${s(8)}px ${s(16)}px`,
              border: '1px solid #FF3333', background: 'rgba(255,51,51,0.05)', cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,51,51,0.15)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,51,51,0.05)'; }}>
            <span style={{ fontSize: s(9), padding: `2px ${s(6)}px`, border: '1px solid #FF3333', color: '#FF3333', fontWeight: 700 }}>
              F2
            </span>
            <span style={{ fontSize: s(10), color: '#FF3333', fontWeight: 700, letterSpacing: '1px' }}>
              [REJECT / 驳回]
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InterrogationMatrix;
