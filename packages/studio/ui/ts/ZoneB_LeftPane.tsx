/* ═══════════════════════════════════════════════════════════════════════
   ZoneB_LeftPane.tsx — 左侧面板（日志 + 节点详情 tab）
   ★ v3.2 改造：支持节点 tab 切换，NodeShell 组件替代内联 TaskShell
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAstroStore } from './stores';
import { api } from './api';
import './LeftTerminal.css';
import ArtifactPanel from './ArtifactPanel';

const TYPE_ICONS: Record<string, string> = {
  code: '{}', document: '¶', config: '⚙',
  schema: '◈', report: '◉', plan: '◎', structured_data: '◫',
};

/* ── NodeShell: 节点详情面板 ── */
const NodeShell: React.FC<{ taskId: string; executionId: string }> = ({ taskId, executionId }) => {
  const task = useAstroStore((s) => {
    for (const flow of s.flows) {
      if (flow.id !== executionId) continue;
      const found = flow.tasks.find((t) => t.taskId === taskId);
      if (found) return found;
    }
    return null;
  });

  const [replyInput, setReplyInput] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const allMsgs = task?.messages ?? [];
  const st = task?.status || 'pending';

  // 过滤状态消息
  const STATUS_PREFIXES = ['▶ 开始执行', '⏳ 执行中', '✓ 执行完成', '▶ 恢复执行'];
  const THINKING_PATTERN = /^💭|^\/\*THINK|^<thinking>|^<thought>|^\[思考\]|^\[THINK/i;
  const msgs = allMsgs.filter(m => {
    if (THINKING_PATTERN.test(m.content.trim())) return false;
    if (m.role === 'system') {
      return !STATUS_PREFIXES.some(p => m.content.startsWith(p));
    }
    return true;
  });

  // 合并连续同角色消息
  const mergedMsgs = msgs.reduce<typeof msgs>((acc, msg) => {
    const prev = acc[acc.length - 1];
    if (prev && prev.role === msg.role && msg.role !== 'system') {
      prev.content = prev.content + msg.content;
    } else {
      acc.push({ ...msg });
    }
    return acc;
  }, []);

  const lastMsgLen = allMsgs.length > 0 ? allMsgs[allMsgs.length - 1].content.length : 0;
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [allMsgs.length, lastMsgLen]);

  // ★ v3.2: 刷新后从 JSONL 加载任务历史（不依赖 flows 缓存）
  useEffect(() => {
    if (allMsgs.length > 0) return;
    if (!executionId) return;
    const store = useAstroStore.getState();
    // 确保 task 在 store 中存在（即使 localStorage 缓存丢失也能恢复）
    store.ensureTask(executionId, taskId);
    api.getTaskHistory(executionId, taskId).then(res => {
      if (res.ok && res.messages.length > 0) {
        const store = useAstroStore.getState();
        for (const m of res.messages) {
          store.pushTaskMessage(taskId, { role: m.role as 'system' | 'assistant', content: m.content });
        }
      }
    }).catch(() => {});
  }, [taskId, executionId, allMsgs.length]);

  const handleSend = useCallback(async (text: string) => {
    if (!text.trim() || sendingReply) return;
    setSendingReply(true);
    const store = useAstroStore.getState();
    const currentTask = store.flows
      .flatMap(f => f.tasks)
      .find(t => t.taskId === taskId);
    const currentSt = currentTask?.status || 'pending';

    store.pushTaskMessage(taskId, { role: 'user', content: text.trim() });

    if (currentSt === 'awaiting_input') {
      store.updateTaskStatus(taskId, { status: 'running', options: [], question: undefined });
    }
    if (currentSt === 'interrupted' || currentSt === 'failed') {
      store.updateTaskStatus(taskId, { status: 'running', error: undefined });
      store.pushTaskMessage(taskId, { role: 'system', content: currentSt === 'failed' ? '▶ 重试执行...' : '▶ 恢复执行...' });
    }

    const hId = currentTask?.harnessId || currentTask?.executionId;
    try {
      let steered = false;
      if (hId) {
        const sr = await api.steerHarness(hId, text.trim()).catch(() => null);
        steered = sr?.steered === true;
      }
      if (!steered) {
        store.pushTaskMessage(taskId, { role: 'system', content: '⚠ 会话中断，重建执行上下文...' });
        const sr = await api.resumeTask(executionId, taskId, text.trim(), currentTask?.agentType || 'agent').catch(() => null);
        if (!sr?.ok) throw new Error(sr?.error || '恢复请求失败');
      }
    } catch (err) {
      store.updateTaskStatus(taskId, { status: 'interrupted' });
      store.pushTaskMessage(taskId, {
        role: 'system',
        content: `✗ 恢复失败: ${err instanceof Error ? err.message : '网络错误，请重试'}`,
      });
    }
    setReplyInput('');
    setSendingReply(false);
  }, [taskId, executionId, sendingReply]);

  return (
    <div className="task-shell">
      <div className="task-shell-msgs" ref={scrollRef}>
        {mergedMsgs.length === 0 && st === 'pending' && (
          <div className="task-shell-msg"><span className="role">◆</span><span className="text" style={{ color: '#666' }}>等待执行...</span></div>
        )}
        {mergedMsgs.length === 0 && st === 'running' && (
          <div className="task-shell-msg"><span className="role">◆</span><span className="text" style={{ color: '#4488ff' }}>⏳ 执行中...</span></div>
        )}
        {mergedMsgs.map((msg, idx) => (
          <div key={idx} className="task-shell-msg">
            <span className="role">{msg.role === 'system' ? '◆' : '▸'}</span>
            <span className="text">{msg.content}</span>
            <span className="time">{new Date(msg.timestamp).toLocaleTimeString()}</span>
          </div>
        ))}
        {!!(task?.result && !allMsgs.some(m => {
          const resultText = typeof task.result === 'string' ? task.result
            : (task.result as any)?.content?.[0]?.text || JSON.stringify(task.result, null, 2);
          return m.content === resultText?.substring(0, 5000);
        })) && (() => {
          const resultText = typeof task.result === 'string' ? task.result
            : (task.result as any)?.content?.[0]?.text || JSON.stringify(task.result, null, 2);
          return resultText ? (
            <div className="task-shell-msg">
              <span className="role">▸</span>
              <span className="text">{resultText.substring(0, 10000)}</span>
            </div>
          ) : null;
        })()}
        {st === 'running' && mergedMsgs.length > 0 && (
          <div className="task-shell-msg"><span className="role">◆</span><span className="text" style={{ color: '#4488ff' }}>⏳ 执行中...</span></div>
        )}
        {st === 'interrupted' && (
          <div className="task-shell-msg">
            <span className="role">⚡</span>
            <span className="text" style={{ color: '#ff8800' }}>
              {mergedMsgs.length === 0
                ? '执行中断 · 输入指令继续'
                : `执行中断 (${new Date().toLocaleTimeString()}) · 可继续`}
            </span>
          </div>
        )}
        {st === 'failed' && (
          <div className="task-shell-msg">
            <span className="role">✗</span>
            <span className="text" style={{ color: '#ff3333' }}>执行失败 · 输入指令重试</span>
          </div>
        )}
      </div>

      {st === 'awaiting_input' && task?.options && task.options.length > 0 && (
        <div className="task-shell-options">
          {task.options.map((opt, i) => (
            <button key={i} className="task-shell-option" onClick={() => handleSend(opt)}>{opt}</button>
          ))}
        </div>
      )}

      {(st === 'interrupted' || st === 'awaiting_input' || st === 'failed') && (
        <div className="task-shell-prompt">
          <span className="prefix">$</span>
          <input
            type="text"
            value={replyInput}
            onChange={e => setReplyInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(replyInput); }
            }}
            placeholder={st === 'interrupted' ? '输入指令继续执行...' : st === 'failed' ? '输入指令重试...' : '输入回复...'}
            disabled={sendingReply}
            autoFocus
            spellCheck={false}
          />
          <button onClick={() => handleSend(replyInput)} disabled={sendingReply || !replyInput.trim()}>
            {sendingReply ? '...' : '→'}
          </button>
        </div>
      )}
    </div>
  );
};

/* ── 主组件 ── */
const ZoneB_LeftPane: React.FC = () => {
  const terminalLogs = useAstroStore((s) => s.terminalLogs);
  const artifacts = useAstroStore((s) => s.artifacts);
  const phase = useAstroStore((s) => s.phase);
  const sseConnected = useAstroStore((s) => s.sseConnected);
  const backpressure = useAstroStore((s) => s.backpressure);
  const runningTasks = useAstroStore((s) => s.runningTasks);
  const pendingTasks = useAstroStore((s) => s.pendingTasks);
  const domains = useAstroStore((s) => s.domains);

  // ★ v3.2: ZoneB tab 状态
  const zoneBActiveTab = useAstroStore((s) => s.zoneBActiveTab);
  const zoneBTabs = useAstroStore((s) => s.zoneBTabs);
  const switchZoneBTab = useAstroStore((s) => s.switchZoneBTab);
  const closeNodeInZoneB = useAstroStore((s) => s.closeNodeInZoneB);

  const logScrollRef = useRef<HTMLDivElement>(null);
  const artScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logScrollRef.current) logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
  }, [terminalLogs.length]);
  useEffect(() => {
    if (artScrollRef.current) artScrollRef.current.scrollTop = artScrollRef.current.scrollHeight;
  }, [artifacts.length]);

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };

  // 检查是否有非 logs tab
  const nodeTabs = zoneBTabs.filter((t): t is { type: 'node'; taskId: string; executionId: string; label: string } => t.type === 'node');
  const showTabRow = true;

  return (
    <div className="left-terminal-wrapper">
      {/* ★ v3.2: Tab 行 */}
      {showTabRow && (
        <div className="zoneb-tab-row">
          {/* 日志 tab 始终存在 */}
          <span
            className={`zoneb-tab${zoneBActiveTab.type === 'logs' ? ' zoneb-tab-active' : ''}`}
            onClick={() => switchZoneBTab({ type: 'logs' })}
          >
            日志
          </span>
          {/* v7 产物 tab */}
          <span
            className={`zoneb-tab${zoneBActiveTab.type === 'artifacts' ? ' zoneb-tab-active' : ''}`}
            onClick={() => switchZoneBTab({ type: 'artifacts' })}
          >
            产物
          </span>
          {nodeTabs.map((tab) => (
            <span key={tab.taskId} className={`zoneb-tab${zoneBActiveTab.type === 'node' && zoneBActiveTab.taskId === tab.taskId ? ' zoneb-tab-active' : ''}`}>
              <span onClick={() => switchZoneBTab(tab)}>{tab.label}</span>
              <span className="zoneb-tab-close" onClick={(e) => { e.stopPropagation(); closeNodeInZoneB(tab.taskId); }}>×</span>
            </span>
          ))}
        </div>
      )}

      {/* ── 日志内容（logs tab 或 fallback） ── */}
      {zoneBActiveTab.type === 'logs' ? (
        <>
          <div className="term-half top">
            <div className="term-title">
              实时日志
              <span style={{ color: '#555', fontSize: 10, marginLeft: 8 }}>
                {phase} | SSE:{sseConnected ? '✓' : '✗'} | 背压{backpressure}% | 任务{runningTasks}/{pendingTasks}
              </span>
            </div>
            <div className="logs-scroll" ref={logScrollRef}>
              {terminalLogs.length === 0 ? (
                <div className="log-row">
                  <span className="time">[--:--:--]</span>
                  <span className="log-content">系统就绪，等待指令...</span>
                </div>
              ) : (
                terminalLogs.slice(-50).map((log, idx) => (
                  <div key={idx} className="log-row">
                    <span className="time">[{fmtTime(log.time)}]</span>
                    <span className={`log-content${log.marker === 'ALERT' || log.marker === 'WARN' ? ' alert-text' : ''}`}>
                      [{log.marker}] {log.text}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="term-half bottom">
            <div className="term-title">任务交付物</div>
            <div className="divider-red" />
            <div className="logs-scroll" ref={artScrollRef}>
              {artifacts.length === 0 ? (
                <div className="log-row">
                  <span className="time">[--:--:--]</span>
                  <span className="log-content">暂无交付物，执行任务后自动生成</span>
                </div>
              ) : (
                artifacts.map((a, idx) => {
                  const icon = TYPE_ICONS[a.type] || '○';
                  const sizeKb = a.size > 0 ? ` ${(a.size / 1024).toFixed(1)}KB` : '';
                  const isManual = !a.executionId || a.executionId === 'manual';
                  return (
                    <div key={a.uuid || idx} className="log-row">
                      <span className="time">[{fmtTime(a.timestamp)}]</span>
                      <span className="log-content">
                        {icon} {a.name}
                        <span style={{ color: '#555', marginLeft: 6 }}>{a.type}{sizeKb}</span>
                        {!isManual && a.executionId && (
                          <span style={{ color: '#333', marginLeft: 6, fontSize: 10 }}>{a.executionId.slice(0, 12)}</span>
                        )}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      ) : zoneBActiveTab.type === 'artifacts' ? (
        /* v7 产物 tab */
        <div className="term-half" style={{ height: '100%' }}>
          <div className="term-title">产物列表</div>
          <ArtifactPanel />
        </div>
      ) : (
        /* ★ v3.2: 节点详情 tab */
        <div className="term-half" style={{ height: '100%' }}>
          <div className="term-title">节点详情</div>
          <NodeShell
            taskId={zoneBActiveTab.taskId}
            executionId={zoneBActiveTab.executionId}
          />
        </div>
      )}
    </div>
  );
};

export default ZoneB_LeftPane;
