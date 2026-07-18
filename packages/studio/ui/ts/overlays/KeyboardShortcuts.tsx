/* ═══════════════════════════════════════════════════════════════════════
   overlays/KeyboardShortcuts.tsx — 全局键盘快捷键
   Ctrl+` = toggle terminal
   Ctrl+K = clear temp pool
   Shift+Space = emergency abort
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect } from 'react';

interface Props {
  onToggleTerminal: () => void;
  onClearTemp: () => void;
  onAbort: () => void;
}

const KeyboardShortcuts: React.FC<Props> = ({ onToggleTerminal, onClearTemp, onAbort }) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        onToggleTerminal();
      }
      if (e.ctrlKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        onClearTemp();
      }
      if (e.shiftKey && e.key === ' ') {
        e.preventDefault();
        onAbort();
        window.dispatchEvent(new CustomEvent('brain-emergency-stop'));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onToggleTerminal, onClearTemp, onAbort]);

  return null;
};

export default KeyboardShortcuts;
