/* ═══════════════════════════════════════════════════════════════════════
   NodeDialog.tsx — DAG 节点执行会话对话框
   显示节点的执行会话（状态变化 + 输出结果），类似聊天窗口
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useEffect, useRef, useState } from 'react';
import { useAstroStore } from './stores';
import { api } from './api';

interface NodeDialogProps {
  /** 当前选中的 taskId */
  taskId: string | null;
  onClose: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#666',
  running: '#4488ff',
  completed: '#33cc55',
  failed: '#ff3333',
  awaiting_input: '#ffbb33',
  interrupted: '#ff8800',
};

const STATUS_LABELS: Record<string, string> = {
  pending: '等待执行',
  running: '执行中',
  completed: '已完成',
  failed: '异常',
  awaiting_input: '需输入',
  interrupted: '中断',
};

const NodeDialog: React.FC<NodeDialogProps> = ({ taskId, onClose }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [replyInput, setReplyInput] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  // 从 store 中查找任务
  const task = useAstroStore((s) => {
    if (!taskId) return null;
    for (const flow of s.flows) {
      const found = flow.tasks.find((t) => t.taskId === taskId);
      if (found) return found;
    }
    return null;
  });

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [task?.messages?.length]);

  // 刷新后消息为空时，从 JSONL 加载
  useEffect(() => {
    if (!taskId || !task) return;
    if (task.messages && task.messages.length > 0) return; // 已有消息（SSE 实时推送）
    const execId = task.executionId;
    if (!execId) return;
    api.getTaskHistory(execId, taskId).then(res => {
      if (res.ok && res.messages.length > 0) {
        const store = useAstroStore.getState();
        for (const m of res.messages) {
          store.pushTaskMessage(taskId, { role: m.role as 'system' | 'assistant', content: m.content });
        }
      }
    }).catch(() => {});
  }, [taskId, task?.executionId]);

  if (!taskId || !task) return null;

  const st = task.status || 'pending';
  const msgs = task.messages ?? [];

  return (
    <div className="node-dialog-overlay" onClick={onClose}>
      <div className="node-dialog" onClick={(e) => e.stopPropagation()}>
        {/* ── 头部：节点身份 + 状态 ── */}
        <div className="node-dialog-header">
          <div className="node-dialog-title-area">
            <span className="node-dialog-title">{task.taskName || task.taskId}</span>
            <span className="node-dialog-subtitle">[{task.agentType}]</span>
            <span className="node-dialog-status-badge" style={{ color: STATUS_COLORS[st] }}>
              ● {STATUS_LABELS[st]}
            </span>
          </div>
          <button className="node-dialog-close" onClick={onClose}>×</button>
        </div>

        {/* ── 元信息栏 ── */}
        <div className="node-dialog-meta">
          <span className="meta-item">ID: {task.taskId}</span>
          <span className="meta-item">领域: {task.agentType}</span>
          {task.deps && task.deps.length > 0 && (
            <span className="meta-item">依赖: {task.deps.join(', ')}</span>
          )}
        </div>

        {/* ── 执行会话区 ── */}
        <div className="node-dialog-session" ref={scrollRef}>
          {msgs.length === 0 && st === 'pending' && (
            <div className="session-empty">等待执行...</div>
          )}
          {msgs.length === 0 && st === 'running' && (
            <div className="session-empty" style={{ color: '#4488ff' }}>⏳ 执行中...</div>
          )}
          {msgs.map((msg, idx) => (
            <div key={idx} className={`session-msg session-${msg.role}`}>
              <div className="session-msg-role">
                {msg.role === 'system' ? '◆' : '▸'}
              </div>
              <div className="session-msg-content">
                <pre className="session-msg-text">{msg.content}</pre>
                <span className="session-msg-time">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
              </div>
            </div>
          ))}

          {/* 运行中的动画提示 */}
          {st === 'running' && (
            <div className="session-msg session-system">
              <div className="session-msg-role">◆</div>
              <div className="session-msg-content">
                <span className="session-msg-text" style={{ color: '#4488ff' }}>⏳ 执行中...</span>
              </div>
            </div>
          )}

          {/* ── 中断状态：显示中断提示 + 继续执行输入框 ── */}
          {st === 'interrupted' && (
            <>
              <div className="node-reply-area" style={{ borderTop: '1px solid #ff8800' }}>
                <div className="session-msg session-system">
                  <div className="session-msg-role">⚡</div>
                  <div className="session-msg-content">
                    <span className="session-msg-text" style={{ color: '#ff8800' }}>
                      执行中断 — 刷新导致执行中断。输入内容可尝试继续执行此节点。
                    </span>
                  </div>
                </div>
                <div className="node-reply-row" style={{ marginTop: 8 }}>
                  <input
                    className="node-reply-input"
                    type="text"
                    value={replyInput}
                    onChange={e => setReplyInput(e.target.value)}
                    onKeyDown={async e => {
                      if (e.key === 'Enter' && !e.shiftKey && replyInput.trim() && !sendingReply) {
                        e.preventDefault();
                        setSendingReply(true);
                        const hId = task.harnessId || task.executionId;
                        if (hId) {
                          await api.steerHarness(hId, replyInput.trim()).catch(() => {});
                          useAstroStore.getState().pushTaskMessage(taskId, { role: 'user', content: replyInput.trim() });
                          setReplyInput('');
                        } else {
                          // 没有 harnessId，走聊天接口继续
                          const sid = localStorage.getItem('morpex_session_id') || undefined;
                          useAstroStore.getState().pushLiveStream('pending', replyInput.trim(), '输入');
                          const res = await api.chat(replyInput.trim(), sid).catch(() => null);
                          if (res?.ok && res.output) {
                            useAstroStore.getState().pushLiveStream('completed', res.output, '系统');
                            useAstroStore.getState().pushTaskMessage(taskId, { role: 'assistant', content: res.output });
                          }
                          setReplyInput('');
                        }
                        setSendingReply(false);
                      }
                    }}
                    placeholder="输入指令继续执行此节点..."
                    disabled={sendingReply}
                    autoFocus
                  />
                  <button
                    className="node-reply-send"
                    onClick={async () => {
                      if (!replyInput.trim() || sendingReply) return;
                      setSendingReply(true);
                      const hId = task.harnessId || task.executionId;
                      if (hId) {
                        await api.steerHarness(hId, replyInput.trim()).catch(() => {});
                        useAstroStore.getState().pushTaskMessage(taskId, { role: 'user', content: replyInput.trim() });
                        setReplyInput('');
                      } else {
                        const sid = localStorage.getItem('morpex_session_id') || undefined;
                        useAstroStore.getState().pushLiveStream('pending', replyInput.trim(), '输入');
                        const res = await api.chat(replyInput.trim(), sid).catch(() => null);
                        if (res?.ok && res.output) {
                          useAstroStore.getState().pushLiveStream('completed', res.output, '系统');
                          useAstroStore.getState().pushTaskMessage(taskId, { role: 'assistant', content: res.output });
                        }
                        setReplyInput('');
                      }
                      setSendingReply(false);
                    }}
                    disabled={sendingReply}
                  >
                    {sendingReply ? '...' : '继续'}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── 等待输入：选项按钮 + 输入框 ── */}
          {st === 'awaiting_input' && (
            <div className="node-reply-area">
              {task.options && task.options.length > 0 && (
                <div className="node-reply-options">
                  {task.options.map((opt: string, i: number) => (
                    <button
                      key={i}
                      className="node-reply-option-btn"
                      onClick={async () => {
                        const hId = task.harnessId || task.executionId;
                        if (hId) {
                          await api.steerHarness(hId, opt).catch(() => {});
                          useAstroStore.getState().pushTaskMessage(taskId, { role: 'user', content: opt });
                        }
                      }}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
              <div className="node-reply-row">
                <input
                  className="node-reply-input"
                  type="text"
                  value={replyInput}
                  onChange={e => setReplyInput(e.target.value)}
                  onKeyDown={async e => {
                    if (e.key === 'Enter' && !e.shiftKey && replyInput.trim() && !sendingReply) {
                      e.preventDefault();
                      setSendingReply(true);
                      const hId = task.harnessId || task.executionId;
                      if (hId) {
                        await api.steerHarness(hId, replyInput.trim()).catch(() => {});
                        useAstroStore.getState().pushTaskMessage(taskId, { role: 'user', content: replyInput.trim() });
                        setReplyInput('');
                      }
                      setSendingReply(false);
                    }
                  }}
                  placeholder={task.options?.length ? '或直接输入...' : '输入回复...'}
                  disabled={sendingReply}
                  autoFocus
                />
                <button
                  className="node-reply-send"
                  onClick={async () => {
                    if (!replyInput.trim() || sendingReply) return;
                    setSendingReply(true);
                    const hId = task.harnessId || task.executionId;
                    if (hId) {
                      await api.steerHarness(hId, replyInput.trim()).catch(() => {});
                      useAstroStore.getState().pushTaskMessage(taskId, { role: 'user', content: replyInput.trim() });
                      setReplyInput('');
                    }
                    setSendingReply(false);
                  }}
                  disabled={sendingReply}
                >
                  {sendingReply ? '...' : '→'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NodeDialog;
