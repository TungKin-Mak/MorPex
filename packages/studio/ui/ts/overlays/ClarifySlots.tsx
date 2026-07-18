/* ═══════════════════════════════════════════════════════════════════════
   overlays/ClarifySlots.tsx — ClarifySlots QA Matrix (responsive)
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useCallback } from 'react';

let _active = false;
let _question = '';
let _options: string[] = [];
let _listeners: Array<(active: boolean, q: string, opts: string[]) => void> = [];
let _resolve: ((answer: string) => void) | null = null;

export function showClarifySlots(question: string, options: string[] = ['YES_BUF', 'NO_BUF']): Promise<string> {
  _question = question;
  _options = options;
  _active = true;
  _listeners.forEach((fn) => fn(true, question, options));
  return new Promise((resolve) => { _resolve = resolve; });
}

export function isClarifyActive(): boolean { return _active; }

const ClarifySlots: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>([]);
  const [confidence, setConfidence] = useState(0.72);
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
    const handler = (active: boolean, q: string, opts: string[]) => {
      setVisible(active);
      setQuestion(q);
      setOptions(opts);
      if (active) setConfidence(0.65 + Math.random() * 0.2);
    };
    _listeners.push(handler);
    return () => { _listeners = _listeners.filter((fn) => fn !== handler); };
  }, []);

  const handleAnswer = useCallback((answer: string) => {
    _active = false;
    _listeners.forEach((fn) => fn(false, '', []));
    _resolve?.(answer);
    _resolve = null;
  }, []);

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', bottom: s(210), left: '50%', transform: 'translateX(-50%)',
      zIndex: 800, background: '#000000', border: '1px solid #FF3333',
      padding: `${s(10)}px ${s(14)}px`,
      display: 'flex', flexDirection: 'column', gap: s(8),
      fontFamily: '"JetBrains Mono", monospace', color: '#FFFFFF',
      minWidth: s(340),
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: s(9), color: '#FF3333', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase' }}>
          🧪 CLARIFICATION REQUIRED
        </span>
        <span style={{
          fontSize: s(8), padding: `1px ${s(4)}px`,
          border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.3)',
        }}>
          CONF: {(confidence * 100).toFixed(0)}%
        </span>
      </div>
      <div style={{
        fontSize: s(11), color: 'rgba(255,255,255,0.6)', lineHeight: 1.4,
        padding: `${s(4)}px ${s(6)}px`, border: '1px solid #222222',
        background: 'rgba(255,255,255,0.01)',
      }}>
        {question}
      </div>
      <div style={{ display: 'flex', gap: s(6) }}>
        {options.map((opt, i) => {
          const isYes = opt.includes('YES') || i === 0;
          return (
            <button key={i} onClick={() => handleAnswer(opt)} style={{
              flex: 1, padding: `${s(5)}px ${s(8)}px`,
              fontSize: s(10), fontFamily: '"JetBrains Mono", monospace',
              background: isYes ? 'rgba(255,51,51,0.08)' : 'transparent',
              border: `1px solid ${isYes ? '#FF3333' : 'rgba(255,255,255,0.15)'}`,
              color: isYes ? '#FF3333' : 'rgba(255,255,255,0.5)',
              cursor: 'pointer', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
            }}
              onMouseEnter={e => { e.currentTarget.style.background = isYes ? 'rgba(255,51,51,0.2)' : 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#FFFFFF'; }}
              onMouseLeave={e => { e.currentTarget.style.background = isYes ? 'rgba(255,51,51,0.08)' : 'transparent'; e.currentTarget.style.color = isYes ? '#FF3333' : 'rgba(255,255,255,0.5)'; }}
            >
              [{opt}]
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ClarifySlots;
