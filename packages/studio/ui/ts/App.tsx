/* ═══════════════════════════════════════════════════════════════════════
   App.tsx — ASTROM KERNEL 根组件 v5.0
   
   数据流:
   1. 启动时从 REST API 获取 system/domains/artifacts/memory → 写入 store
   2. SSE 全局连线 — 实时事件 → store + OmniTerminal
   3. 后端不可用时优雅降级为 mock 数据
   4. 视觉层: MatrixGrid (CSS Grid 赛博朋克面板)
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useState, useCallback, useEffect } from 'react';
import { useAstroStore, type DomainInfo, type ArtifactInfo, type DagTask } from './stores';
import { api, connectSSE } from './api';
import { writeToOmniTerminal } from './overlays/OmniTerminal';
import { showClarifySlots } from './overlays/ClarifySlots';
import { setInterrogationTicket, dismissInterrogation } from './overlays/InterrogationMatrix';
import MatrixGrid from './MatrixGrid';
import OmniTerminal from './overlays/OmniTerminal';
import ClarifySlots from './overlays/ClarifySlots';
import InterrogationMatrix from './overlays/InterrogationMatrix';
import SlideoverDrawer from './overlays/SlideoverDrawer';
import KeyboardShortcuts from './overlays/KeyboardShortcuts';

const ANSI_RED = '\x1b[31m';
const ANSI_RESET = '\x1b[0m';

/** 同时写入 xterm 终端 (OmniTerminal) + Zustand store (ZoneB) */
function logToAll(marker: string, text: string) {
  writeToOmniTerminal(`${ANSI_RED}[${marker}]${ANSI_RESET} ${text}`);
  useAstroStore.getState().pushTerminalLog(marker, text);
}

const App: React.FC = () => {
  const [terminalVisible, setTerminalVisible] = useState(false);

  const handleToggleTerminal = useCallback(() => setTerminalVisible((v) => !v), []);
  const handleAbort = useCallback(() => window.dispatchEvent(new CustomEvent('brain-emergency-stop')), []);
  const handleClearTemp = useCallback(() => window.dispatchEvent(new CustomEvent('clear-temp-pool')), []);

  // ── 监听 TopBar 的自定义事件 ──
  useEffect(() => {
    const handler = () => setTerminalVisible((v) => !v);
    window.addEventListener('toggle-terminal', handler);
    return () => window.removeEventListener('toggle-terminal', handler);
  }, []);

  // ════════════════════════════════════════════════════════════════
  //  1. 初始化: REST API → store (带 mock 降级)
  // ════════════════════════════════════════════════════════════════
  useEffect(() => {
    const init = async () => {
      const s = useAstroStore.getState();
      let backendOk = true;

      // 1a. 系统状态
      try {
        const st = await api.status();
        s.setSystemStatus({
          phase: st.phase,
          uptime: st.uptime,
          pluginCount: st.pluginCount,
          activeExecutions: st.activeExecutions,
          memoryAvailable: st.memory_available,
          aiEngineReady: st.ai_engine,
        });
        logToAll('INIT', `System online — phase: ${st.phase}`);
      } catch {
        backendOk = false;
        logToAll('INIT', 'Backend unreachable — using mock data');
        s.setSystemStatus({
          phase: 'RUNNING', uptime: 84321, pluginCount: 12,
          activeExecutions: 2, memoryAvailable: true, aiEngineReady: true,
        });
      }

      // 1b. Domains
      try {
        const dRes = await api.domains();
        if (dRes.domains && dRes.domains.length > 0) {
          const mapped: DomainInfo[] = dRes.domains.map((d: any) => {
            const skillList: string[] = Array.isArray(d.skills)
              ? d.skills : (d.output_artifacts || []).map((a: string) => a.toUpperCase());
            return {
              id: d.domain_id, name: d.domain_name || d.domain_id,
              status: (d.status === 'active' ? 'active' : 'sleeping') as DomainInfo['status'],
              workers: skillList.map((sk: string, i: number) => ({
                id: `${d.domain_id}-w${i}`, role: sk,
                state: d.status === 'active' ? 'working' : 'idle', specialty: sk,
              })),
            };
          });
          s.setDomains(mapped);
          logToAll('INIT', `${mapped.length} domains loaded`);
        }
      } catch {
        s.setDomains([
          { id: 'mcu_control', name: 'MCU_Control', status: 'active', workers: [] },
          { id: 'reverse_eng', name: 'Reverse_Eng', status: 'active', workers: [] },
          { id: 'rag_engine', name: 'RAG_Engine', status: 'sleeping', workers: [] },
        ]);
        if (backendOk) logToAll('INIT', 'Domains fetch failed — mock loaded');
      }

      // 1c. Artifacts
      try {
        const aRes = await api.artifacts();
        if (aRes.projects && aRes.projects.length > 0) {
          const mapped: ArtifactInfo[] = aRes.projects.flatMap((p: any) =>
            (p.files || []).map((f: any) => {
              const ext = (f.name || '').split('.').pop()?.toLowerCase() || '';
              const typeMap: Record<string, ArtifactInfo['type']> = {
                js: 'code', ts: 'code', py: 'code', c: 'code',
                html: 'code', css: 'code',
                md: 'document', txt: 'document',
                json: 'config', yaml: 'config', log: 'report',
              };
              return {
                uuid: `${p.id}_${f.name}`, name: f.name || f.path || 'unknown',
                type: typeMap[ext] || 'document', size: f.size || 0,
                timestamp: f.modifiedAt || Date.now(), executionId: p.id,
              };
            })
          );
          s.setArtifacts(mapped);
          logToAll('INIT', `${mapped.length} artifacts loaded`);
        }
      } catch { if (backendOk) logToAll('INIT', 'Artifacts fetch failed'); }

      // 1d. Memory stats
      try {
        const mRes = await api.memoryStats();
        const p = mRes.stats?.provenance;
        const g = mRes.stats?.gate;
        const v = mRes.stats?.v2;
        s.setMemoryStats({
          memTotalIndexed: p?.totalIndexed ?? 0,
          memMainPool: p?.mainPoolCount ?? 0,
          memArchivePool: p?.archiveCount ?? 0,
          memTempPool: v?.tempPoolSize ?? 0,
          memGateRejectRate: g?.rejectRate ?? '0%',
          memVecCount: p?.totalIndexed ?? 0,
        });
        logToAll('INIT', `Memory: ${p?.totalIndexed ?? 0} indexed, Gate: ${g?.rejectRate ?? '0%'}`);
      } catch {
        s.setMemoryStats({
          memTotalIndexed: 1500, memMainPool: 384, memArchivePool: 1200,
          memTempPool: 64, memGateRejectRate: '12.0%', memVecCount: 1500,
        });
      }

      // 1e. ★ v3.2: 从 localStorage 恢复 flows 缓存（刷新后保留任务节点状态）
      const cached = s.loadFlowsFromCache();
      if (cached.length > 0) {
        logToAll('INIT', `${cached.length} flows restored from cache (${cached.reduce((sum, f) => sum + f.tasks.length, 0)} tasks)`);
      } else {
        // ★ 回退：localStorage 为空时从后端 /api/sessions 重建最小 flows
        try {
          const sessionsRes = await api.getSessions();
          if (sessionsRes.ok && sessionsRes.sessions.length > 0) {
            const taskSessions = sessionsRes.sessions.filter(s => s.mode === 'task');
            // 按 executionId 分组
            const byExec = new Map<string, typeof taskSessions>();
            for (const sess of taskSessions) {
              if (!sess.executionId) continue;
              if (!byExec.has(sess.executionId)) byExec.set(sess.executionId, []);
              byExec.get(sess.executionId)!.push(sess);
            }
            for (const [execId, tasks] of byExec) {
              s.addFlow({
                id: execId,
                title: `任务执行 ${execId.slice(0, 8)}`,
                tasks: tasks.map(t => ({
                  taskId: t.taskId || t.id,
                  taskName: t.taskId || t.id,
                  agentType: t.domainId || 'agent',
                  status: (t.status === 'running' ? 'running' : t.status === 'completed' ? 'completed' : 'pending') as DagTask['status'],
                  deps: [],
                  executionId: execId,
                  startTime: Date.now(),
                })),
                createdAt: Date.now(),
              });
            }
            logToAll('INIT', `${byExec.size} flows rebuilt from backend sessions (${taskSessions.length} tasks)`);
          }
        } catch { /* backend unreachable, flows stay empty until user action */ }
      }
    };
    init();
  }, []);

  // ════════════════════════════════════════════════════════════════
  //  2. SSE 全局连线 — 实时事件驱动
  // ════════════════════════════════════════════════════════════════
  useEffect(() => {
    const s = useAstroStore.getState();
    const disconnect = connectSSE({
      'runtime.execution.started': () => {
        s.incrementExec();
        logToAll('EXEC', 'Task started');
        s.pushToChatMode('luban', { status: 'running', message: '任务开始执行', region: '系统', timestamp: Date.now() });
      },
      'runtime.execution.completed': () => {
        s.decrementExec();
        logToAll('EXEC', 'Task completed');
        s.pushToChatMode('luban', { status: 'completed', message: '任务执行完成', region: '系统', timestamp: Date.now() });
      },
      'runtime.fsm.transition': (data) => {
        const to = (data.to || data.state || '') as string;
        if (to) { s.updateTelemetry({ fsmPhase: to }); logToAll('FSM', `→ ${to}`); }
      },
      'runtime.task.started': (data) => {
        const taskId = data.taskId as string;
        const execId = data.executionId as string;
        if (taskId) {
          s.updateTaskStatus(taskId, { status: 'running' });
          const msg = `▶ 开始执行 ${data.goal || data.domain || ''}`;
          s.pushTaskMessage(taskId, { role: 'system', content: msg });
          s.updateTelemetry({ runningTasks: s.runningTasks + 1, pendingTasks: Math.max(0, s.pendingTasks - 1) });
          if (execId) api.saveTaskMessage(execId, taskId, { role: 'system', content: msg }).catch(() => {});
        }
      },
      'runtime.task.completed': (data) => {
        const taskId = data.taskId as string;
        const execId = data.executionId as string;
        const status = (data.status as string) || 'completed';
        if (taskId) {
          const patch: any = { status: status as 'completed' };
          if (status === 'failed' && data.error) {
            patch.error = data.error;
            const msg = `✗ 执行失败: ${data.error}`;
            s.pushTaskMessage(taskId, { role: 'system', content: msg });
            if (execId) api.saveTaskMessage(execId, taskId, { role: 'system', content: msg }).catch(() => {});
          } else {
            const msg = '✓ 执行完成';
            s.pushTaskMessage(taskId, { role: 'system', content: msg });
            if (execId) api.saveTaskMessage(execId, taskId, { role: 'system', content: msg }).catch(() => {});
          }
          if (data.output) {
            patch.result = data.output;
            let outStr = '';
            const raw: any = data.output;
            if (typeof raw === 'string') {
              outStr = raw;
            } else if (raw?.content && Array.isArray(raw.content)) {
              outStr = raw.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('\n');
            } else {
              outStr = JSON.stringify(raw, null, 2);
            }
            const clipped = outStr.substring(0, 5000);
            s.pushTaskMessage(taskId, { role: 'assistant', content: clipped });
            if (execId) api.saveTaskMessage(execId, taskId, { role: 'assistant', content: clipped }).catch(() => {});
          }
          s.updateTaskStatus(taskId, patch);
          s.updateTelemetry({ runningTasks: Math.max(0, s.runningTasks - 1) });
        }
      },
      'runtime.task.awaiting_input': (data) => {
        const taskId = data.taskId as string;
        const harnessId = data.harnessId as string;
        const question = data.question as string;
        const options = (data.options as string[]) || [];
        if (taskId && question) {
          s.updateTaskStatus(taskId, { status: 'awaiting_input', harnessId, question, options });
          s.pushTaskMessage(taskId, { role: 'system', content: `❓ ${question}` });
          if ((data as any).executionId) api.saveTaskMessage((data as any).executionId, taskId, { role: 'system', content: question }).catch(() => {});
        }
      },
      'dag.created': (data) => {
        const payload = (data.payload || data) as any;
        if (payload.flowId && payload.tasks) {
          s.addFlow({
            id: payload.flowId, title: payload.title || '',
            tasks: payload.tasks.map((t: any) => ({
              taskId: t.taskId, taskName: t.taskName || '',
              agentType: t.agentType || 'agent', status: t.status || 'pending',
              deps: t.deps || [], executionId: payload.flowId, startTime: Date.now(),
            })),
            createdAt: Date.now(),
          });
          logToAll('DAG', `Flow ${payload.flowId} — ${payload.tasks.length} tasks`);
          s.pushToChatMode('luban', { status: 'running', message: `执行计划: ${payload.tasks.length} 个任务已创建`, region: '系统', timestamp: Date.now() });
        }
      },
      'cross_domain.dag_created': (data) => {
        const payload = (data.payload || data) as any;
        const dag = (payload.dag || []) as any[];
        const flowId = payload.flowId || ('cross-domain-' + Date.now());
        if (dag.length > 0) {
          s.addFlow({
            id: flowId,
            title: payload.globalIntent || payload.analysis?.globalIntent || 'Cross-Domain DAG',
            tasks: dag.map((n: any) => ({
              taskId: n.taskId, taskName: n.goal || n.taskId,
              agentType: n.domain || 'agent', status: n.status || 'pending',
              deps: n.deps || [], executionId: flowId, startTime: Date.now(),
            })),
            createdAt: Date.now(), isMultiDomain: payload.isMultiDomain || payload.analysis?.isMultiDomain,
            involvedDomains: payload.involvedDomains || payload.analysis?.involvedDomains,
            globalIntent: payload.globalIntent || payload.analysis?.globalIntent,
          });
          logToAll('DAG', `Flow ${flowId} — ${dag.length} tasks`);
        }
      },
      'artifact.created': (data) => {
        const payload = (data.payload || data) as any;
        s.addArtifact({
          uuid: payload.uuid || `art_${Date.now()}`, name: payload.name || payload.path || 'artifact',
          type: (payload.type || 'document') as any, size: payload.size || 0,
          timestamp: payload.timestamp || Date.now(), executionId: payload.executionId,
        });
        logToAll('ARTIFACT', `${payload.name || ''}`);
        s.pushToChatMode('luban', { status: 'completed', message: `产物生成: ${payload.name || payload.path || ''}`, region: '系统', timestamp: Date.now() });
      },
      'scheduler.backpressure': (data) => {
        const payload = (data.payload || data) as any;
        s.updateTelemetry({ backpressure: payload.value || payload.level || 0 });
      },
      'intent.clarify': (data) => {
        const payload = (data.payload || data) as any;
        showClarifySlots(payload.question || payload.text || '请确认意图', payload.options || ['YES_BUF', 'NO_BUF']);
      },
      'cross-domain.interrogation': (data) => { setInterrogationTicket(data.payload || data); },
      'cross-domain.arbitration': () => dismissInterrogation(),
      'message_update': (data) => {
        const payload = (data.payload || data) as any;
        logToAll('MSG', `type=${data.type} keys=${Object.keys(payload).join(',')} preview=${JSON.stringify(payload).substring(0, 100)}`);
        // 尝试所有可能的字段名
        const delta = (payload.delta || payload.text || payload.content || payload.message || payload.output || payload.result || payload.data) as string;
        if (delta) {
          useAstroStore.getState().pushToChatMode('chat', { status: 'running', message: delta, region: '系统', timestamp: Date.now() });
          // 同步到正在执行的第一个 running 任务
          const st = useAstroStore.getState();
          for (const f of st.flows) {
            const running = f.tasks.find(t => t.status === 'running');
            if (running) {
              st.pushTaskMessage(running.taskId, { role: 'assistant', content: delta });
              break;
            }
          }
        }
      },
      'tool_execution_start': (data) => {
        const payload = (data.payload || data) as any;
        const name = payload.toolName || payload.name || '';
        logToAll('TOOL', `${name} [START]`);
        useAstroStore.getState().pushToChatMode('luban', { status: 'running', message: `调用工具: ${name}`, region: '系统', timestamp: Date.now() });
      },
      'tool_execution_end': () => {
        logToAll('TOOL', 'done');
        useAstroStore.getState().pushToChatMode('luban', { status: 'completed', message: '工具调用完成', region: '系统', timestamp: Date.now() });
      },
      'domain.waking': (data) => {
        const payload = (data.payload || data) as any;
        logToAll('DOMAIN', `${payload.domainId || ''} waking...`);
      },
      'domain.active': (data) => {
        const payload = (data.payload || data) as any;
        useAstroStore.getState().updateDomainStatus(payload.domainId as string, 'active');
        logToAll('DOMAIN', `${payload.domainId || ''} active`);
      },
      'domain.sleeping': (data) => {
        const payload = (data.payload || data) as any;
        useAstroStore.getState().updateDomainStatus(payload.domainId as string, 'sleeping');
      },
      'heartbeat': () => logToAll('SYS', '♥ heartbeat'),
      'memory.recall': (data) => {
        const pool = (data.pool || 'MAIN_POOL') as string;
        window.dispatchEvent(new CustomEvent('memory-rag-flash', { detail: { pool } }));
      },
      'dag.node.failed': (data) => {
        const taskId = (data.taskId || data.nodeId || '') as string;
        if (taskId) {
          s.updateTaskStatus(taskId, { status: 'failed' });
          s.setBrainAlert('PARIETAL');
          setTimeout(() => s.clearBrainAlert(), 3000);
        }
      },

      // 调试：打印所有未知事件类型
      '*': (data: any) => {
        if (data.type && data.type !== 'heartbeat') {
          logToAll('SSE?', `${data.type}: ${JSON.stringify(data).substring(0, 120)}`);
        }
      },
    });

    s.setSseConnected(true);
    logToAll('SSE', 'Connected — real-time stream active');

    return () => {
      disconnect();
      s.setSseConnected(false);
    };
  }, []);

  return (
    <>
      <MatrixGrid />
      <OmniTerminal visible={terminalVisible} onClose={() => setTerminalVisible(false)} />
      <InterrogationMatrix />
      <SlideoverDrawer />
      <ClarifySlots />
      <KeyboardShortcuts
        onToggleTerminal={handleToggleTerminal}
        onClearTemp={handleClearTemp}
        onAbort={handleAbort}
      />
    </>
  );
};

export default App;
