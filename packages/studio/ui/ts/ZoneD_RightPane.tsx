/* ═══════════════════════════════════════════════════════════════════════
   ZoneD_RightPane.tsx — 右侧智能体交互面板（中文 + 实时事件流）
   
   ★ v3.2 多 Session 架构改造：
   - 三个模式按钮切换（chat/luban/simq）
   - 每个模式独立 liveStream + sessionId
   - 移除 @ 提及面板（selectedAgent/MentionSuggest）
   - DAG 节点点击 → openNodeInZoneB
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAstroStore, type ChatMode, type LiveStreamItem } from './stores';
import { api } from './api';
import './RightChatPanel.css';
import DagCard from './DagCard';
import type { DagPlanData } from './types';

/** 模式按钮配置 */
const MODE_BUTTONS: { mode: ChatMode; label: string; icon: string }[] = [
  { mode: 'chat', label: '聊天', icon: '💬' },
  { mode: 'luban', label: '鲁班', icon: '🔧' },
  { mode: 'simq', label: '司马迁', icon: '📖' },
];

const MODE_LABELS: Record<ChatMode, string> = {
  chat: '聊天模式',
  luban: '任务规划·鲁班',
  simq: '记忆检索·司马迁',
};

const ZoneD_RightPane: React.FC = () => {
  // 从 store 读取多模式状态
  const modeStates = useAstroStore((s) => s.modeStates);
  const activeMode = useAstroStore((s) => s.activeMode);
  const switchChatMode = useAstroStore((s) => s.switchChatMode);
  const pushToChatMode = useAstroStore((s) => s.pushToChatMode);
  const openNodeInZoneB = useAstroStore((s) => s.openNodeInZoneB);
  const addFlow = useAstroStore((s) => s.addFlow);
  const flows = useAstroStore((s) => s.flows);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputVal, setInputVal] = useState('');
  const [sending, setSending] = useState(false);

  // ── DAG 卡片 ──
  const [dagCards, setDagCards] = useState<{ executionId: string; dag: DagPlanData }[]>([]);

  const currentStream = modeStates[activeMode].liveStream;
  const lastContentLen = currentStream.length > 0 ? currentStream[currentStream.length - 1].message.length : 0;

  // 自动滚底
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [currentStream.length, lastContentLen]);

  // ── 恢复 session ──
  useEffect(() => {
    for (const mode of ['chat', 'luban', 'simq'] as ChatMode[]) {
      const savedId = localStorage.getItem(`morpex_session_${mode}`);
      if (savedId) {
        const store = useAstroStore.getState();
        store.modeStates[mode].sessionId = savedId;
        // 恢复历史（仅首次加载时）
        if (store.modeStates[mode].liveStream.length === 0) {
          api.getChatHistory(savedId).then(res => {
            if (res.ok && res.messages.length > 0) {
              const restored: LiveStreamItem[] = res.messages.map((m: any) => ({
                status: (m.status || (m.role === 'user' ? 'pending' : 'completed')) as LiveStreamItem['status'],
                message: m.content,
                region: m.region || (m.role === 'user' ? '输入' : '系统'),
                timestamp: m.timestamp,
                agent: m.agent,
              }));
              const store = useAstroStore.getState();
              for (const item of restored) {
                store.pushToChatMode(mode, item);
              }
              // 恢复 DAG 卡片
              for (const m of res.messages) {
                if (m.dag && m.content?.startsWith('__dag__:')) {
                  const eid = m.content.slice(8);
                  setDagCards((prev) => {
                    if (prev.some(d => d.executionId === eid)) return prev;
                    return [...prev, { executionId: eid, dag: m.dag }];
                  });
                }
              }
            }
          }).catch(() => {});
        }
      }
    }
  }, []);

  /** 保存消息到会话历史 */
  const saveToHistory = useCallback(async (role: 'user' | 'system', content: string, region?: string, status?: string, execId?: string) => {
    const sid = modeStates[activeMode].sessionId;
    if (!sid) return;
    try {
      await api.saveChatMessage(sid, { role, content, region, status, executionId: execId });
    } catch { /* 非关键 */ }
  }, [modeStates, activeMode]);

  // ── 发送消息 ──
  const handleSend = useCallback(async () => {
    const text = inputVal.trim();
    if (!text || sending) return;
    setInputVal('');
    setSending(true);

    const store = useAstroStore.getState();
    const mode = store.activeMode;

    // 用户消息
    store.pushToChatMode(mode, {
      status: 'pending',
      message: text,
      region: '输入',
      timestamp: Date.now(),
    });

    let userSaved = false;
    if (store.modeStates[mode].sessionId) {
      saveToHistory('user', text, '输入', 'pending');
      userSaved = true;
    }

    try {
      // 按 mode 路由
      let sessionId = store.modeStates[mode].sessionId;
      let agent: string | undefined;

      if (mode === 'luban') agent = '鲁班';
      else if (mode === 'simq') agent = '司马迁';

      const res = await api.chat(text, sessionId, agent);

      if (res.sessionId) {
        store.modeStates[mode].sessionId = res.sessionId;
        localStorage.setItem(`morpex_session_${mode}`, res.sessionId);
        if (!userSaved) {
          saveToHistory('user', text, '输入', 'pending', res.executionId);
        }
      }

      if (res.ok) {
        if (res.type === 'direct_chat' && res.output) {
          const stream = store.modeStates[mode].liveStream;
          const last = stream[stream.length - 1];
          if (last && last.status === 'running') {
            // 关闭流式输出
            store.pushToChatMode(mode, { status: 'completed' as const, message: '', region: '系统', timestamp: Date.now() });
          } else {
            store.pushToChatMode(mode, { status: 'completed' as const, message: res.output, region: '系统', timestamp: Date.now() });
          }
          saveToHistory('system', res.output, '系统', 'completed', res.executionId);
        } else if (res.type === 'dag_plan' && res.dag) {
          const eid = res.executionId || `dag_${Date.now()}`;
          setDagCards((prev) => [...prev, { executionId: eid, dag: res.dag! }]);
          store.modeStates[mode].executionId = eid;

          // 预创建 flow
          const nodes = res.dag.nodes || [];
          if (nodes.length > 0) {
            addFlow({
              id: eid,
              title: res.dag.globalIntent || '任务规划',
              tasks: nodes.map((n: any) => ({
                taskId: n.taskId,
                taskName: n.goal || n.taskId,
                agentType: n.domain || 'agent',
                status: 'pending' as const,
                deps: n.deps || [],
                executionId: eid,
                startTime: Date.now(),
              })),
              createdAt: Date.now(),
              isMultiDomain: res.dag.isMultiDomain,
              involvedDomains: res.dag.involvedDomains,
              globalIntent: res.dag.globalIntent,
            });
          }

          const marker = `__dag__:${eid}`;
          store.pushToChatMode(mode, { status: 'running' as const, message: marker, region: '系统', timestamp: Date.now() });
          try {
            await api.saveChatMessage(store.modeStates[mode].sessionId!, {
              role: 'system', content: marker, region: '系统', status: 'running',
              executionId: eid, dag: res.dag,
            });
          } catch { /* 非关键 */ }
        } else if (res.output) {
          store.pushToChatMode(mode, { status: 'completed' as const, message: res.output, region: '系统', timestamp: Date.now() });
          saveToHistory('system', res.output, '系统', 'completed', res.executionId);
        } else {
          store.pushToChatMode(mode, { status: 'completed' as const, message: `执行完成 [${res.executionId || 'ok'}]`, region: '系统', timestamp: Date.now() });
          saveToHistory('system', '执行完成', '系统', 'completed', res.executionId);
        }
      } else {
        store.pushToChatMode(mode, { status: 'failed' as const, message: res.error || '请求失败', region: '系统', timestamp: Date.now() });
        saveToHistory('system', res.error || '请求失败', '系统', 'failed', res.executionId);
      }
    } catch {
      store.pushToChatMode(store.activeMode, { status: 'failed' as const, message: '后端无响应，请检查服务状态', region: '系统', timestamp: Date.now() });
      saveToHistory('system', '后端无响应，请检查服务状态', '系统', 'failed');
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [inputVal, sending, modeStates, activeMode, saveToHistory, addFlow, pushToChatMode]);

  // 点击面板聚焦输入框
  const handlePanelClick = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };

  return (
    <div className="right-panel-container">
      <div className="chat-header">
        <span className="chat-header-title">灵台问天枢</span>
        <span className="mode-badge">{MODE_LABELS[activeMode]}</span>
        <span className="session-id-badge" title={modeStates[activeMode].sessionId || '未连接'}>
          {modeStates[activeMode].sessionId ? `#${modeStates[activeMode].sessionId!.slice(-8)}` : '新会话'}
        </span>
      </div>

      {/* ── 模式切换行 ── */}
      <div className="mode-switch-row">
        {MODE_BUTTONS.map(({ mode, label, icon }) => (
          <button
            key={mode}
            className={`mode-switch-btn${mode === activeMode ? ' mode-switch-active' : ''}`}
            onClick={() => switchChatMode(mode)}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      <div className="chat-history" ref={scrollRef}>
        {currentStream.length === 0 ? (
          <div className="chat-row system">
            <div className="chat-bubble">
              <span className="chat-prefix">[系统]</span>
              <span className="chat-body">系统就绪，等待指令...</span>
            </div>
          </div>
        ) : (
          currentStream.map((item, idx) => {
            const isDagRef = item.message.startsWith('__dag__:');
            if (isDagRef) {
              const dagExecId = item.message.slice(8);
              const dagCard = dagCards.find((d) => d.executionId === dagExecId);
              if (dagCard) {
                const flow = flows.find((f) => f.id === dagExecId);
                const nodeStatuses: Record<string, { status: string }> = {};
                if (flow) {
                  flow.tasks.forEach((t) => {
                    nodeStatuses[t.taskId] = { status: t.status };
                  });
                }
                return (
                  <div key={idx} className="chat-row system" style={{ display: 'block' }}>
                    <DagCard
                      executionId={dagExecId}
                      dag={dagCard.dag}
                      nodeStatuses={nodeStatuses}
                      onNodeClick={(taskId, goal) => {
                        openNodeInZoneB(taskId, dagExecId, (goal || taskId).slice(0, 15));
                      }}
                    />
                  </div>
                );
              }
              return (
                <div key={idx} className="chat-row system">
                  <div className="chat-bubble">
                    <span className="chat-prefix">[计划]</span>
                    <span className="chat-body">任务规划已生成 [{dagExecId}]</span>
                    <span className="chat-time">{fmtTime(item.timestamp)}</span>
                  </div>
                </div>
              );
            }

            const isUser = item.region === '输入';
            const isError = !isUser && item.status === 'failed';
            const isRecoveryBanner = !isUser && item.message.startsWith('──');
            const rowCls = isUser ? 'user' : (isError ? 'error' : (isRecoveryBanner ? 'recovery' : 'system'));
            return (
              <div key={idx} className={`chat-row ${rowCls}`}>
                <div className="chat-bubble">
                  {!isUser && (
                    <span className={`chat-prefix${isError ? ' agent' : ''}`} style={{ color: isError ? '#ff1a1a' : '#a0a0a0' }}>
                      MorPex:
                    </span>
                  )}
                  <span className="chat-body" style={isError ? { color: '#ff1a1a' } : undefined}>
                    {item.message}
                  </span>
                  <span className="chat-time">{fmtTime(item.timestamp)}</span>
                  {isUser && (
                    <span className="chat-prefix user" style={{ color: '#ffbb33' }}>
                      {item.agent || '自己'}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="chat-input-area" onClick={handlePanelClick}>
        <span className="input-prefix">$&gt;</span>
        <div className="chat-input-wrapper">
          <input
            ref={inputRef}
            className="chat-real-input"
            type="text"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={sending ? '处理中...' : `输入内容，${MODE_LABELS[activeMode]} 将处理...`}
            disabled={sending}
            autoFocus
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
};

export default ZoneD_RightPane;
