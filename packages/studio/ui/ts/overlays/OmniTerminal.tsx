/* ═══════════════════════════════════════════════════════════════════════
   overlays/OmniTerminal.tsx — OmniTerminal (responsive)
   Xterm.js Canvas terminal. Ctrl+` toggles, SSE log stream.
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { CanvasAddon } from '@xterm/addon-canvas';
import '@xterm/xterm/css/xterm.css';

let _term: Terminal | null = null;
let _disposed = false;

export function writeToOmniTerminal(text: string): void {
  if (_term && !_disposed) _term.writeln(text);
}

interface Props { visible: boolean; onClose: () => void; }

const OmniTerminal: React.FC<Props> = ({ visible, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
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
    if (!visible || !containerRef.current) return;
    if (_term && !_disposed) { _term.focus(); return; }

    _disposed = false;
    const term = new Terminal({
      theme: {
        background: '#000000', foreground: '#FFFFFF', cursor: '#FF3333',
        selectionBackground: 'rgba(255,51,51,0.3)',
        black: '#000000', red: '#FF3333', green: '#FFFFFF',
        yellow: '#FFFFFF', blue: '#FFFFFF', magenta: '#FFFFFF',
        cyan: '#FFFFFF', white: '#FFFFFF',
      },
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: s(11),
      lineHeight: 1.3,
      convertEol: true,
      cursorBlink: true,
      scrollback: 500,
    });

    term.loadAddon(new CanvasAddon());
    term.open(containerRef.current);
    term.focus();
    _term = term;

    term.onKey((e) => { if (e.key === '\x1b') onClose(); });
    term.writeln('\x1b[31m[OMNI TERMINAL]\x1b[0m — AstroM Kernel v3.0');
    term.writeln('\x1b[31m────────────────────────────────────────\x1b[0m');

    return () => {};
  }, [visible, onClose, scale]);

  useEffect(() => {
    if (!visible && _term && !_disposed) _term.clear();
  }, [visible]);

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', bottom: s(200), left: 0, right: 0, height: s(300),
      zIndex: 1000, background: '#000000',
      borderTop: `${s(2)}px solid #FF3333`,
      display: 'flex', flexDirection: 'column',
      fontFamily: '"JetBrains Mono", monospace',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: `${s(2)}px ${s(8)}px`,
        background: 'rgba(255,51,51,0.08)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        fontSize: s(10), color: 'rgba(255,255,255,0.4)',
      }}>
        <span>
          <span style={{ color: '#FF3333', fontWeight: 700 }}>OMNI TERMINAL</span>
          <span style={{ color: 'rgba(255,255,255,0.15)' }}> — SSE log stream</span>
        </span>
        <span onClick={onClose} style={{
          cursor: 'pointer', color: '#FF3333', fontSize: s(10),
          border: `1px solid #FF3333`, padding: `0 ${s(4)}px`, fontWeight: 700,
        }}>
          [ESC ✕]
        </span>
      </div>
      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }} />
    </div>
  );
};

export default OmniTerminal;
