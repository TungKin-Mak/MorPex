/* ═══════════════════════════════════════════════════════════════════════
   api.ts — AstroM API 层
   极简 REST + SSE 客户端。只保留前端真正调用的函数。
   ═══════════════════════════════════════════════════════════════════════ */

import type {
  SystemStatus,
  EngineStatus,
  ChatResponse,
  MemoryStats,
  KgData,
  DomainResponse,
  ArtifactsResponse,
  SseEvent,
  SseEventHandler,
} from './types';

// ═════════════════════════════════════════════════════════════════════
// HTTP 工具
// ═════════════════════════════════════════════════════════════════════

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${url} → ${res.status}`);
  return res.json();
}

// ═════════════════════════════════════════════════════════════════════
// REST API
// ═════════════════════════════════════════════════════════════════════

export const api = {
  /** 系统状态 */
  status: (): Promise<SystemStatus> =>
    get<SystemStatus>('/api/status'),

  /** 引擎状态 */
  engineStatus: (): Promise<EngineStatus> =>
    get<EngineStatus>('/api/ai/status'),

  /** 健康检查 */
  health: (): Promise<{ ok: boolean; uptime: number }> =>
    get('/api/health'),

  /** 主聊天端点（支持附灵 Agent 参数） */
  chat: (content: string, sessionId?: string, agent?: string): Promise<ChatResponse> =>
    post<ChatResponse>('/api/chat/message', { content, session_id: sessionId, agent }),

  /** 记忆统计 */
  memoryStats: (): Promise<MemoryStats> =>
    get<MemoryStats>('/api/memory/stats'),

  /** 知识图谱数据 */
  kgData: (): Promise<KgData> =>
    get<KgData>('/api/knowledge-graph/data'),

  /** 领域列表 */
  domains: (): Promise<DomainResponse> =>
    get<DomainResponse>('/api/domains'),

  /** 产物列表 */
  artifacts: (executionId?: string): Promise<ArtifactsResponse> =>
    get<ArtifactsResponse>(`/api/artifacts${executionId ? `?executionId=${executionId}` : ''}`),

  /** Agent 建议列表（@ 提及面板数据源） */
  agentSuggestions: (): Promise<{ ok: boolean; agents: { key: string; name: string; desc: string }[] }> =>
    get('/api/agents/suggestions'),

  /** 保存一条聊天消息到会话历史（支持 dag 等附加字段） */
  saveChatMessage: (sessionId: string, msg: Record<string, any>) =>
    post(`/api/session/${encodeURIComponent(sessionId)}/message`, msg),

  /** 获取会话历史（刷新恢复用） */
  getChatHistory: (sessionId: string): Promise<import('./types').ChatHistoryResponse> =>
    get(`/api/session/${encodeURIComponent(sessionId)}/history`),

  /** ★ v3.2: 获取所有活跃 session（刷新后重建 flows 的回退数据源） */
  getSessions: (): Promise<{ ok: boolean; sessions: { id: string; mode: string; status: string; taskId?: string; executionId?: string; domainId?: string }[] }> =>
    get('/api/sessions'),

  /** 保存节点执行消息 */
  saveTaskMessage: (execId: string, taskId: string, msg: { role: string; content: string }) =>
    post(`/api/task/${encodeURIComponent(execId)}/${encodeURIComponent(taskId)}/message`, msg),

  /** 获取节点执行历史 */
  getTaskHistory: (execId: string, taskId: string): Promise<{ ok: boolean; messages: { role: string; content: string; timestamp: number }[] }> =>
    get(`/api/task/${encodeURIComponent(execId)}/${encodeURIComponent(taskId)}/history`),

  /** 回复节点询问 */
  /** 回复等待用户输入的节点（通过 harness steer） */
  steerHarness: (harnessId: string, reply: string): Promise<{ ok: boolean; steered: boolean }> =>
    post(`/api/harness/${encodeURIComponent(harnessId)}/steer`, { reply }),

  /** 恢复中断的任务（重建 harness + 上下文） */
  resumeTask: (executionId: string, taskId: string, input: string, domain: string): Promise<{ ok: boolean; resumed?: boolean; error?: string }> =>
    post('/api/task/resume', { executionId, taskId, input, domain }),

  /** 获取单次 DAG 执行状态快照（无 SSE 时轮询恢复） */
  getExecution: (executionId: string): Promise<any> =>
    get(`/api/execution/${encodeURIComponent(executionId)}`),

  /** 获取最近执行列表 */
  getRecentExecutions: (limit?: number): Promise<{ ok: boolean; count: number; executions: any[] }> =>
    get(`/api/executions/recent${limit ? `?limit=${limit}` : ''}`),

  /** 紧急中止 */
  abort: (): Promise<{ ok: boolean }> =>
    post('/api/ai/abort'),
};

// ═════════════════════════════════════════════════════════════════════
// SSE 客户端
// ═════════════════════════════════════════════════════════════════════

export type SseHandlerMap = Record<string, SseEventHandler>;

/**
 * 连接 SSE 全局流，自动重连（指数退避）。
 *
 * @param handlers  事件类型 → 处理器。可用 '*' 作为兜底。
 * @returns         断开函数
 */
export function connectSSE(handlers: SseHandlerMap & { '*'?: SseEventHandler }): () => void {
  let es: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let retryDelay = 1000;

  function connect() {
    if (stopped) return;
    es?.close();
    es = new EventSource('/api/stream/global');

    es.onmessage = (event) => {
      try {
        const msg: SseEvent = JSON.parse(event.data);
        const handler = handlers[msg.type];
        if (handler) handler(msg.payload ?? (msg as unknown as Record<string, unknown>));
        if (handlers['*']) handlers['*'](msg as unknown as Record<string, unknown>);
      } catch { /* skip malformed */ }
      retryDelay = 1000; // reset on success
    };

    es.onerror = () => {
      es?.close();
      es = null;
      if (!stopped) {
        timer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30000); // 1s → 2s → 4s → … → 30s max
      }
    };
  }

  connect();
  return () => {
    stopped = true;
    es?.close();
    if (timer) clearTimeout(timer);
  };
}

// ═════════════════════════════════════════════════════════════════════
// v7 API — 架构健康 & 运行时
// ═════════════════════════════════════════════════════════════════════

export async function fetchArchitectureHealth(): Promise<import('./types').HealthReport> {
  return get<import('./types').HealthReport>('/api/architecture/health');
}

export async function fetchRuntimeExecutions(): Promise<{ executions: import('./types').Execution[] }> {
  return get('/api/runtime/executions');
}

export async function fetchRuntimeExecution(id: string): Promise<import('./types').ExecutionDetail> {
  return get(`/api/runtime/execution/${encodeURIComponent(id)}`);
}

export async function fetchArtifactsV7(): Promise<{ artifacts: import('./types').ArtifactV7[] }> {
  return get('/api/artifacts/list');
}

export async function fetchArtifactGraph(): Promise<import('./types').GraphData> {
  return get('/api/artifacts/graph');
}

export async function fetchArtifactLineage(id: string): Promise<import('./types').LineageData> {
  return get(`/api/artifacts/lineage/${encodeURIComponent(id)}`);
}

export async function activateMemory(context: import('./types').MemoryContext): Promise<import('./types').MemoryResult> {
  return post('/api/memory/activate', context);
}

export async function fetchLearningStats(): Promise<import('./types').LearningStats> {
  return get('/api/learning/stats');
}

export async function fetchSystemHealth(): Promise<import('./types').SystemHealth> {
  return get('/api/system/health');
}

export async function validateSystem(): Promise<{ passed: boolean; healthScore: number; details: unknown }> {
  return post('/api/system/validate');
}
