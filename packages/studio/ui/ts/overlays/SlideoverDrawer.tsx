/* ═══════════════════════════════════════════════════════════════════════
   overlays/SlideoverDrawer.tsx — Code Auditor (responsive 45vw)
   Slides from right, line-numbered read-only code viewer, red close btn
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useState, useEffect } from 'react';

let _open = false;
let _data: { title: string; type: string; data?: string; uuid?: string } = { title: '', type: 'code' };
let _listeners: Array<(v: boolean, d: any) => void> = [];

export function openDrawer(data: { title: string; type: string; data?: string; uuid?: string }) {
  _data = data;
  _open = true;
  _listeners.forEach((fn) => fn(true, data));
}
export function closeDrawer() {
  _open = false;
  _listeners.forEach((fn) => fn(false, null));
}

const MOCK_CODE: Record<string, string> = {
  'main.ts': `// main.ts — Entry point
import { Kernel } from './kernel';
import { FSMController } from './fsm';

const kernel = new Kernel({
  phase: 'RUNNING',
  memory: { pool: 500, total: 4096 },
});

kernel.on('transition', (state: string) => {
  console.log(\`[FSM] → \${state}\`);
});

kernel.boot();`,
  'schema.json': `{
  "domain": "Reverse_Eng",
  "version": "1.0.0",
  "capabilities": ["BIN_EXTRACT","SIG_SCAN","XREF_BUILD"],
  "token_quota": 50000
}`,
  'analysis.md': `# Binary Analysis Report\n## Summary\n- File: firmware_v3.bin\n- Architecture: ARM Cortex-M4\n- Status: Extraction complete\n## Findings\n1. Entry point at 0x0800_0000\n2. Vector table: 42 entries\n3. CRC mismatch at offset 0x4F2A`,
};

const SlideoverDrawer: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [data, setData] = useState(_data);
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
    const handler = (v: boolean, d: any) => { setVisible(v); if (d) setData(d); };
    _listeners.push(handler);
    const ceHandler = (e: Event) => { const detail = (e as CustomEvent).detail; openDrawer(detail); };
    window.addEventListener('open-drawer', ceHandler);
    return () => { _listeners = _listeners.filter((fn) => fn !== handler); window.removeEventListener('open-drawer', ceHandler); };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDrawer(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible]);

  const codeContent = MOCK_CODE[data.title] || `// ${data.title}\n// Type: ${data.type}\n// UUID: ${data.uuid || '—'}\n// [Read-only auditor view]`;

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: '45vw',
      zIndex: 500,
      transform: visible ? 'translateX(0)' : 'translateX(100%)',
      transition: 'transform 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
      background: '#0a0a0a', borderLeft: '2px solid #FF3333',
      display: 'flex', flexDirection: 'column',
      fontFamily: '"JetBrains Mono", monospace', color: '#FFFFFF',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: `${s(6)}px ${s(10)}px`,
        background: 'rgba(255,51,51,0.05)', borderBottom: '1px solid #222222',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: s(6) }}>
          <span style={{ fontSize: s(9), color: '#FF3333', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>
            [CODE AUDITOR]
          </span>
          <span style={{ width: 1, height: s(12), background: '#222222' }} />
          <span style={{ fontSize: s(10), color: 'rgba(255,255,255,0.5)' }}>{data.title}</span>
        </div>
        <span onClick={closeDrawer} style={{
          cursor: 'pointer', color: '#FF3333', fontSize: s(11),
          border: '1px solid #FF3333', padding: `1px ${s(6)}px`, fontWeight: 700,
        }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,51,51,0.2)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
          [ESC ✕ CLOSE]
        </span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        <div style={{ display: 'flex', height: '100%' }}>
          <div style={{
            padding: `${s(8)}px ${s(6)}px`, textAlign: 'right',
            color: 'rgba(255,255,255,0.1)', fontSize: s(10),
            borderRight: '1px solid #222222', minWidth: s(36),
            userSelect: 'none', fontFamily: '"JetBrains Mono", monospace', lineHeight: 1.5,
          }}>
            {codeContent.split('\n').map((_, i) => <div key={i}>{i + 1}</div>)}
          </div>
          <pre style={{
            flex: 1, padding: `${s(8)}px ${s(10)}px`, margin: 0,
            fontSize: s(10), lineHeight: 1.5, color: 'rgba(255,255,255,0.7)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            fontFamily: '"JetBrains Mono", monospace', overflow: 'auto',
          }}>
            {codeContent}
          </pre>
        </div>
      </div>
    </div>
  );
};

export default SlideoverDrawer;
