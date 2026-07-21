/* ═══════════════════════════════════════════════════════════════════════
   stores.ts — AstroM 全局状态（Zustand）
   Pure black/white/red palette, no rounded corners
   ═══════════════════════════════════════════════════════════════════════ */

import { create } from 'zustand';
import {
  fetchRuntimeExecutions as apiFetchRuntimeExecutions,
  fetchArtifactsV7 as apiFetchArtifactsV7,
  fetchArtifactLineage as apiFetchArtifactLineage,
  fetchArchitectureHealth as apiFetchArchitectureHealth,
  validateSystem as apiValidateSystem,
  activateMemory as apiActivateMemory,
} from './api';

// ── 多 Session 模式 ──
export type ChatMode = 'chat' | 'luban' | 'simq';

export interface ModeState {
  sessionId?: string;
  liveStream: LiveStreamItem[];
  executionId?: string;
}

export interface LiveStreamItem {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'interrupted';
  message: string;
  region: string;
  timestamp: number;
  agent?: string;
}

export type ZoneBTab =
  | { type: 'logs' }
  | { type: 'node'; taskId: string; executionId: string; label: string }
  | { type: 'artifacts' };

export interface DagFlow {
  id: string;
  title: string;
  tasks: DagTask[];
  createdAt: number;
  isMultiDomain?: boolean;
  involvedDomains?: string[];
  globalIntent?: string;
}

export interface DagTask {
  taskId: string;
  taskName: string;
  agentType: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'rerouting' | 'skipped' | 'completed' | 'awaiting_input' | 'interrupted';
  deps: string[];
  executionId?: string;
  startTime?: number;
  result?: unknown;
  error?: string;
  /** 节点执行过程中的消息/会话记录 */
  messages?: { role: 'system' | 'user' | 'assistant'; content: string; timestamp: number }[];
  /** pi 核 harness ID（steer 注入用户回复用） */
  harnessId?: string;
  /** ask_user 的问题和选项（渲染选择框用） */
  question?: string;
  options?: string[];
}

export interface DomainInfo {
  id: string;
  name: string;
  status: 'active' | 'sleeping' | 'woken_up';
  workers: { id: string; role: string; state: string; specialty: string }[];
}

export interface ArtifactInfo {
  uuid: string;
  name: string;
  type: 'code' | 'document' | 'config' | 'schema' | 'report' | 'plan' | 'structured_data';
  size: number;
  timestamp: number;
  executionId?: string;
}

export interface AstroStore {
  phase: string;
  uptime: number;
  execCount: number;
  sseConnected: boolean;
  pluginCount: number;
  activeExecutions: number;
  memoryAvailable: boolean;
  aiEngineReady: boolean;
  memoryKb: number;
  memoryTotalKb: number;
  vectorCount: number;
  gatewayStatus: string;

  setSystemStatus: (partial: Partial<Pick<AstroStore,
    'phase' | 'uptime' | 'pluginCount' | 'activeExecutions' |
    'memoryAvailable' | 'aiEngineReady' | 'memoryKb' | 'memoryTotalKb' |
    'vectorCount' | 'gatewayStatus'
  >>) => void;
  incrementExec: () => void;
  decrementExec: () => void;
  setSseConnected: (v: boolean) => void;

  flows: DagFlow[];
  addFlow: (flow: DagFlow) => void;
  upsertFlow: (flow: DagFlow) => void;
  updateTaskStatus: (taskId: string, patch: Partial<DagTask>) => void;
  pushTaskMessage: (taskId: string, msg: { role: 'system' | 'user' | 'assistant'; content: string }) => void;
  /** ★ v3.2: 确保 task 存在于某个 flow 中（不存在则自动创建），用于刷新恢复 */
  ensureTask: (executionId: string, taskId: string, opts?: { taskName?: string; agentType?: string; domain?: string }) => void;
  clearFlows: () => void;
  /** 从 localStorage 恢复缓存的 flow 状态 */
  loadFlowsFromCache: () => DagFlow[];
  /** 清除 localStorage 的 flow 缓存 */
  clearFlowsCache: () => void;

  domains: DomainInfo[];
  setDomains: (domains: DomainInfo[]) => void;
  updateDomainStatus: (id: string, status: DomainInfo['status']) => void;

  artifacts: ArtifactInfo[];
  addArtifact: (a: ArtifactInfo) => void;
  setArtifacts: (list: ArtifactInfo[]) => void;

  backpressure: number;
  fsmPhase: string;
  runningTasks: number;
  pendingTasks: number;
  updateTelemetry: (partial: Partial<Pick<AstroStore,
    'backpressure' | 'fsmPhase' | 'runningTasks' | 'pendingTasks'
  >>) => void;

  memTotalIndexed: number;
  memMainPool: number;
  memArchivePool: number;
  memTempPool: number;
  memGateRejectRate: string;
  memVecCount: number;
  setMemoryStats: (partial: Partial<Pick<AstroStore,
    'memTotalIndexed' | 'memMainPool' | 'memArchivePool' |
    'memTempPool' | 'memGateRejectRate' | 'memVecCount'
  >>) => void;

  brainAlert: boolean;
  alertRegion: string | null;
  brainExploded: boolean;
  setBrainAlert: (region: string | null) => void;
  clearBrainAlert: () => void;
  setBrainExploded: (v: boolean) => void;

  /** 终端日志 — SSE 驱动，ZoneB 消费 */
  terminalLogs: { marker: string; text: string; time: number }[];
  pushTerminalLog: (marker: string, text: string) => void;
  clearTerminalLogs: () => void;

  // ── 脑区活动追踪 ──
  activeBrainRegion: 'FRONTAL' | 'PARIETAL' | 'TEMPORAL' | 'OCCIPITAL' | 'CEREBELLUM' | null;
  brainActivityPhase: 'idle' | 'planning' | 'reasoning' | 'executing';
  brainDataParticles: { from: string; to: string; progress: number; id: number }[];
  setBrainActivity: (region: 'FRONTAL' | 'PARIETAL' | 'TEMPORAL' | 'OCCIPITAL' | 'CEREBELLUM' | null, phase: 'idle' | 'planning' | 'reasoning' | 'executing') => void;
  addDataParticle: (from: string, to: string) => void;
  tickDataParticles: () => void;

  // ── 实时执行流 ──
  liveStream: LiveStreamItem[];
  pushLiveStream: (status: LiveStreamItem['status'], message: string, region: string, agent?: string) => void;
  clearLiveStream: () => void;
  restoreLiveStream: (items: LiveStreamItem[]) => void;

  // ── 多 Session 模式状态 ──
  modeStates: Record<ChatMode, ModeState>;
  activeMode: ChatMode;
  switchChatMode: (mode: ChatMode) => void;
  pushToChatMode: (mode: ChatMode, item: LiveStreamItem) => void;
  /** 将指定 mode 最后一条 running 替换为 completed，可选替换文本 */
  finalizeStream: (mode: ChatMode, finalText?: string) => void;

  // ── ZoneB 节点 tab ──
  zoneBActiveTab: ZoneBTab;
  zoneBTabs: ZoneBTab[];
  openNodeInZoneB: (taskId: string, executionId: string, label: string) => void;
  closeNodeInZoneB: (taskId: string) => void;
  switchZoneBTab: (tab: ZoneBTab) => void;

  // ── 命令栏脉冲 ──
  commandSubmitted: boolean;
  triggerCommandPulse: () => void;

  // ═══════════════════════════════════════════════════════════════
  // v7 Runtime Slice
  // ═══════════════════════════════════════════════════════════════
  runtimeExecutions: import('./types').Execution[];
  selectedExecution: string | null;
  fetchRuntimeExecutions: () => Promise<void>;
  selectRuntimeExecution: (id: string | null) => void;

  // ═══════════════════════════════════════════════════════════════
  // v7 Artifact Slice
  // ═══════════════════════════════════════════════════════════════
  v7Artifacts: import('./types').ArtifactV7[];
  artifactGraph: import('./types').GraphData | null;
  artifactLineage: import('./types').LineageData | null;
  fetchV7Artifacts: () => Promise<void>;
  selectV7Artifact: (id: string | null) => Promise<void>;

  // ═══════════════════════════════════════════════════════════════
  // v7 Health Slice
  // ═══════════════════════════════════════════════════════════════
  healthReport: import('./types').HealthReport | null;
  fetchHealth: () => Promise<void>;
  validateSystem: () => Promise<{ passed: boolean; healthScore: number } | null>;

  // ═══════════════════════════════════════════════════════════════
  // v7 Memory Slice
  // ═══════════════════════════════════════════════════════════════
  memoryActivationResult: import('./types').MemoryResult | null;
  activateMemory: (context: import('./types').MemoryContext) => Promise<void>;
}

export const useAstroStore = create<AstroStore>((set) => ({
  phase: 'IDLE',
  uptime: 0,
  execCount: 0,
  sseConnected: false,
  pluginCount: 0,
  activeExecutions: 0,
  memoryAvailable: false,
  aiEngineReady: false,
  memoryKb: 500,
  memoryTotalKb: 4096,
  vectorCount: 142,
  gatewayStatus: 'ACTIVE',

  setSystemStatus: (partial) => set(partial),
  incrementExec: () => set((s) => ({ execCount: s.execCount + 1 })),
  decrementExec: () => set((s) => ({ execCount: Math.max(0, s.execCount - 1) })),
  setSseConnected: (v) => set({ sseConnected: v }),

  flows: [],
  addFlow: (flow) =>
    set((s) => {
      if (s.flows.some((f) => f.id === flow.id)) return s;
      return { flows: [...s.flows, flow] };
    }),
  upsertFlow: (flow: DagFlow) =>
    set((s) => {
      const idx = s.flows.findIndex((f) => f.id === flow.id);
      if (idx >= 0) {
        const updated = [...s.flows];
        updated[idx] = flow;
        return { flows: updated };
      }
      return { flows: [...s.flows, flow] };
    }),
  updateTaskStatus: (taskId, patch) =>
    set((s) => {
      const newFlows = s.flows.map((f) => ({
        ...f,
        tasks: f.tasks.map((t) =>
          t.taskId === taskId ? { ...t, ...patch } : t
        ),
      }));
      // 自动持久化到 localStorage
      try {
        localStorage.setItem('morpex_flows_cache', JSON.stringify(newFlows));
      } catch { /* quota exceeded, ignore */ }
      return { flows: newFlows };
    }),
  pushTaskMessage: (taskId, msg) =>
    set((s) => ({
      flows: s.flows.map((f) => ({
        ...f,
        tasks: f.tasks.map((t) => {
          if (t.taskId !== taskId) return t;
          const msgs = t.messages ?? [];
          const last = msgs[msgs.length - 1];
          // 连续同角色消息合并（流式输出）
          if (last && last.role === msg.role && msg.role === 'assistant') {
            const merged = { ...last, content: last.content + msg.content, timestamp: Date.now() };
            return { ...t, messages: [...msgs.slice(0, -1), merged] };
          }
          return { ...t, messages: [...msgs, { ...msg, timestamp: Date.now() }] };
        }),
      })),
    })),
  /** ★ v3.2: 确保 task 存在于某个 flow 中 — 刷新恢复关键方法 */
  ensureTask: (executionId, taskId, opts) =>
    set((s) => {
      // 已存在则跳过
      const exists = s.flows.some((f) => f.tasks.some((t) => t.taskId === taskId));
      if (exists) return s;

      // 查找是否已有该 executionId 的 flow
      const existingFlow = s.flows.find((f) => f.id === executionId);
      if (existingFlow) {
        // 追加 task 到已有 flow
        return {
          flows: s.flows.map((f) => {
            if (f.id !== executionId) return f;
            return {
              ...f,
              tasks: [...f.tasks, {
                taskId,
                taskName: opts?.taskName || taskId,
                agentType: opts?.agentType || (opts?.domain || 'agent'),
                status: 'pending' as const,
                deps: [],
                executionId,
                startTime: Date.now(),
                messages: [],
              }],
            };
          }),
        };
      }

      // 创建新 flow
      const newFlow: DagFlow = {
        id: executionId,
        title: opts?.taskName || `任务执行 ${executionId.slice(0, 8)}`,
        tasks: [{
          taskId,
          taskName: opts?.taskName || taskId,
          agentType: opts?.agentType || (opts?.domain || 'agent'),
          status: 'pending' as const,
          deps: [],
          executionId,
          startTime: Date.now(),
          messages: [],
        }],
        createdAt: Date.now(),
      };
      return { flows: [...s.flows, newFlow] };
    }),

  clearFlows: () => {
    set({ flows: [] });
  },
  loadFlowsFromCache: () => {
    try {
      const raw = localStorage.getItem('morpex_flows_cache');
      if (raw) {
        const cached = JSON.parse(raw) as DagFlow[];
        set({ flows: cached });
        return cached;
      }
    } catch { /* corrupt cache */ }
    return [];
  },
  clearFlowsCache: () => {
    try { localStorage.removeItem('morpex_flows_cache'); } catch {}
  },

  domains: [],
  setDomains: (domains) => set({ domains }),
  updateDomainStatus: (id, status) =>
    set((s) => ({
      domains: s.domains.map((d) => d.id === id ? { ...d, status } : d),
    })),

  artifacts: [],
  addArtifact: (a) => set((s) => ({ artifacts: [...s.artifacts, a] })),
  setArtifacts: (list) => set({ artifacts: list }),

  backpressure: 87,
  fsmPhase: 'RUNNING',
  runningTasks: 2,
  pendingTasks: 3,
  updateTelemetry: (partial) => set(partial),

  memTotalIndexed: 0,
  memMainPool: 0,
  memArchivePool: 0,
  memTempPool: 0,
  memGateRejectRate: '12.0%',
  memVecCount: 0,
  setMemoryStats: (partial) => set(partial),

  brainAlert: false,
  alertRegion: null,
  brainExploded: false,
  setBrainAlert: (region) => set({ brainAlert: true, alertRegion: region }),
  clearBrainAlert: () => set({ brainAlert: false, alertRegion: null }),
  setBrainExploded: (v) => set({ brainExploded: v }),

  // 终端日志 — SSE 实时驱动
  terminalLogs: [],
  pushTerminalLog: (marker, text) =>
    set((s) => ({
      terminalLogs: [...s.terminalLogs.slice(-100), { marker, text, time: Date.now() }],
    })),
  clearTerminalLogs: () => set({ terminalLogs: [] }),

  // ── 脑区活动 ──
  activeBrainRegion: null,
  brainActivityPhase: 'idle',
  brainDataParticles: [],
  setBrainActivity: (region, phase) => set({ activeBrainRegion: region, brainActivityPhase: phase }),
  addDataParticle: (from, to) =>
    set((s) => ({
      brainDataParticles: [...s.brainDataParticles, { from, to, progress: 0, id: Date.now() + Math.random() }],
    })),
  tickDataParticles: () =>
    set((s) => ({
      brainDataParticles: s.brainDataParticles
        .map((p) => ({ ...p, progress: p.progress + 0.03 }))
        .filter((p) => p.progress < 1),
    })),

  // ── 实时执行流 ──
  liveStream: [],
  pushLiveStream: (status, message, region, agent) =>
    set((s) => {
      const last = s.liveStream[s.liveStream.length - 1];
      // 连续同状态同区域的消息合并（流式输出）
      if (last && last.status === status && last.region === region && status === 'running') {
        const merged = { ...last, message: last.message + message, timestamp: Date.now(), agent: agent || last.agent };
        return { liveStream: [...s.liveStream.slice(0, -1), merged] };
      }
      return { liveStream: [...s.liveStream.slice(-50), { status, message, region, timestamp: Date.now(), agent }] };
    }),
  clearLiveStream: () => set({ liveStream: [] }),
  restoreLiveStream: (items) =>
    set({ liveStream: items.slice(-50) as any }),

  // ── 多 Session 模式状态 ──
  modeStates: {
    chat: { liveStream: [] },
    luban: { liveStream: [] },
    simq: { liveStream: [] },
  },
  activeMode: 'chat' as ChatMode,
  switchChatMode: (mode) => set({ activeMode: mode }),
  pushToChatMode: (mode, item) =>
    set((s) => {
      const stream = s.modeStates[mode]?.liveStream ?? [];
      const last = stream[stream.length - 1];
      // 护栏：已收口（最后一条是 completed/failed）则忽略后续 running delta
      if (item.status === 'running' && last && (last.status === 'completed' || last.status === 'failed')) {
        return s;
      }
      // 连续同状态 running 合并（流式输出）
      if (last && last.status === item.status && item.status === 'running' && last.region === item.region) {
        const merged = { ...last, message: last.message + item.message, timestamp: Date.now(), agent: item.agent || last.agent };
        return {
          modeStates: { ...s.modeStates, [mode]: { ...s.modeStates[mode], liveStream: [...stream.slice(0, -1), merged] } },
        };
      }
      return {
        modeStates: {
          ...s.modeStates,
          [mode]: { ...s.modeStates[mode], liveStream: [...stream.slice(-200), item] },
        },
      };
    }),
  finalizeStream: (mode, finalText) =>
    set((s) => {
      const stream = [...(s.modeStates[mode]?.liveStream ?? [])];
      if (stream.length === 0) return s;
      const last = stream[stream.length - 1];
      if (last.status !== 'running') return s;
      // 用 HTTP 全量文本覆盖 SSE 累积文本，确保完整
      stream[stream.length - 1] = { ...last, status: 'completed' as const, message: finalText ?? last.message };
      return {
        modeStates: { ...s.modeStates, [mode]: { ...s.modeStates[mode], liveStream: stream } },
      };
    }),

  // ── ZoneB 节点 tab ──
  zoneBActiveTab: { type: 'logs' } as ZoneBTab,
  zoneBTabs: [] as ZoneBTab[],
  openNodeInZoneB: (taskId, executionId, label) =>
    set((s) => {
      const existing = s.zoneBTabs.find(
        (t) => t.type === 'node' && t.taskId === taskId && t.executionId === executionId
      );
      if (existing) {
        return { zoneBActiveTab: existing };
      }
      const newTab: ZoneBTab = { type: 'node', taskId, executionId, label };
      return {
        zoneBTabs: [...s.zoneBTabs, newTab],
        zoneBActiveTab: newTab,
      };
    }),
  closeNodeInZoneB: (taskId) =>
    set((s) => {
      const newTabs = s.zoneBTabs.filter(
        (t) => !(t.type === 'node' && t.taskId === taskId)
      );
      let newActive = s.zoneBActiveTab;
      if (s.zoneBActiveTab.type === 'node' && s.zoneBActiveTab.taskId === taskId) {
        newActive = newTabs.length > 0 ? newTabs[newTabs.length - 1] : { type: 'logs' };
      }
      return { zoneBTabs: newTabs, zoneBActiveTab: newActive };
    }),
  switchZoneBTab: (tab) => set({ zoneBActiveTab: tab }),

  // ── 命令栏脉冲 ──
  commandSubmitted: false,
  triggerCommandPulse: () => {
    set({ commandSubmitted: true });
    setTimeout(() => set({ commandSubmitted: false }), 400);
  },

  // ═══════════════════════════════════════════════════════════════
  // v7 Runtime Slice
  // ═══════════════════════════════════════════════════════════════
  runtimeExecutions: [],
  selectedExecution: null,
  fetchRuntimeExecutions: async () => {
    try {
      const res = await apiFetchRuntimeExecutions();
      set({ runtimeExecutions: res.executions });
    } catch { /* backend unreachable */ }
  },
  selectRuntimeExecution: (id) => set({ selectedExecution: id }),

  // ═══════════════════════════════════════════════════════════════
  // v7 Artifact Slice
  // ═══════════════════════════════════════════════════════════════
  v7Artifacts: [],
  artifactGraph: null,
  artifactLineage: null,
  fetchV7Artifacts: async () => {
    try {
      const res = await apiFetchArtifactsV7();
      set({ v7Artifacts: res.artifacts });
    } catch { /* backend unreachable */ }
  },
  selectV7Artifact: async (id) => {
    set({ artifactLineage: null });
    if (!id) return;
    try {
      const lineage = await apiFetchArtifactLineage(id);
      set({ artifactLineage: lineage });
    } catch { /* backend unreachable */ }
  },

  // ═══════════════════════════════════════════════════════════════
  // v7 Health Slice
  // ═══════════════════════════════════════════════════════════════
  healthReport: null,
  fetchHealth: async () => {
    try {
      const report = await apiFetchArchitectureHealth();
      set({ healthReport: report });
    } catch { /* backend unreachable */ }
  },
  validateSystem: async () => {
    try {
      const result = await apiValidateSystem();
      return { passed: result.passed, healthScore: result.healthScore };
    } catch { return null; }
  },

  // ═══════════════════════════════════════════════════════════════
  // v7 Memory Slice
  // ═══════════════════════════════════════════════════════════════
  memoryActivationResult: null,
  activateMemory: async (context) => {
    try {
      const result = await apiActivateMemory(context);
      set({ memoryActivationResult: result });
    } catch { /* backend unreachable */ }
  },
}));
