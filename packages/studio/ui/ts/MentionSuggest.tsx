/* ═══════════════════════════════════════════════════════════════════════
   MentionSuggest.tsx — @ 提及建议面板
   类似 Slack / Notion 的 mention 体验。
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { type AgentOption, AGENT_LIST, filterAgents } from './agents';

interface MentionSuggestProps {
  /** 是否显示面板 */
  show: boolean;
  /** 用户在 @ 后输入的关键词（用于过滤） */
  search: string;
  /** 用户选择一个 Agent */
  onSelect: (agent: AgentOption) => void;
  /** 关闭面板 */
  onClose: () => void;
}

const MentionSuggest: React.FC<MentionSuggestProps> = ({ show, search, onSelect, onClose }) => {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const results = filterAgents(search);

  // 重置高亮
  useEffect(() => {
    setSelectedIdx(0);
  }, [search, show]);

  // 点击外部关闭
  useEffect(() => {
    if (!show) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [show, onClose]);

  // 暴露键盘导航方法给父组件
  const handleKeyDown = useCallback((e: KeyboardEvent): boolean => {
    if (!show || results.length === 0) return false;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((prev) => (prev + 1) % results.length);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((prev) => (prev - 1 + results.length) % results.length);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (results[selectedIdx]) {
        onSelect(results[selectedIdx]);
      }
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return true;
    }
    return false;
  }, [show, results, selectedIdx, onSelect, onClose]);

  // 将 handleKeyDown 挂到 window 上供父组件调用
  useEffect(() => {
    if (!show) return;
    const handler = (e: KeyboardEvent) => {
      // 只拦截面板显示时的键盘事件
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape') {
        handleKeyDown(e);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [show, handleKeyDown]);

  if (!show || results.length === 0) return null;

  return (
    <div className="mention-suggest-panel" ref={panelRef}>
      <div className="mention-panel-header">选择 Agent</div>
      {results.map((agent, idx) => (
        <div
          key={agent.key}
          className={`mention-item${idx === selectedIdx ? ' mention-item-active' : ''}`}
          onClick={() => onSelect(agent)}
          onMouseEnter={() => setSelectedIdx(idx)}
        >
          <span className="mention-item-name">{agent.name}</span>
          <span className="mention-item-desc">{agent.desc}</span>
        </div>
      ))}
    </div>
  );
};

export default MentionSuggest;
