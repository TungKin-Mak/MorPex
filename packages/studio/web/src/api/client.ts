/**
 * Studio REST API 客户端 — 全项目唯一拼 '/api/...' 路径的地方。
 *
 * 覆盖 UI 消费的 REST 端点（对应 StudioServer.ts + RuntimeAPI.ts 的契约镜像）；
 * 未接入视图的端点（evolution 审批 / agent-sessions 等）保留为 API 面，后续视图可直接消费。
 * 契约权威源：packages/studio/server/__tests__/api-contract.test.ts。
 */
import { get, post, del } from './http.js';
import type {
  AgentSessionEntriesResponse,
  AnomaliesResponse,
  ApprovalPendingResponse,
  AskPendingResponse,
  PlanPendingResponse,
  ArtifactByIdResponse,
  ArtifactGraphResponse,
  ArtifactLineageResponse,
  ArtifactsListResponse,
  ChatSendResponse,
  ConfigResponse,
  CreateSessionResponse,
  DecisionsResponse,
  DeleteSessionResponse,
  EvolutionChangesResponse,
  ExecutionByIdResponse,
  ExecutionStatsResponse,
  ExecutionTasksResponse,
  ExecuteResponse,
  GovernanceResponse,
  HealthResponse,
  InstallableResponse,
  InstallWorkflowResponse,
  LearningStatsResponse,
  MailboxResponse,
  MailboxSendRequest,
  MemoryActivateInput,
  MemoryActivateResponse,
  MemoryRecallResponse,
  MemoryRememberResponse,
  ModelsResponse,
  OntologyStatsResponse,
  RuntimeExecutionByIdResponse,
  RuntimeExecutionsResponse,
  SessionHistoryResponse,
  SessionsResponse,
  SetActiveModelResponse,
  SpaceMessagesResponse,
  TaskProjectionResponse,
  TasksListResponse,
  SpacesResponse,
  StatusResponse,
  SystemHealthResponse,
  UploadResponse,
} from './types.js';

export interface ChatSendOptions {
  departmentId?: string;
  departmentName?: string;
  /** P1：目标 Space id（'hq' 或 `dept_${departmentId}`）——任务在该 Space 内路由/落库。 */
  spaceId?: string;
  sessionId?: string;
  /** 会话 17h：附件（先经 /api/files/upload 上传拿到 fileId） */
  attachments?: Array<{ fileId: string; name?: string }>;
  /** 17i.22：Goal 模式（全自动执行，跳过规划方案确认） */
  goalMode?: boolean;
}

export interface ExecuteOptions {
  departmentId?: string;
  context?: string;
  contextHint?: string;
  maxTaskRerun?: number;
}

export const api = {
  // ── 系统状态 ──
  getHealth: (): Promise<HealthResponse> => get('/api/health'),
  getStatus: (): Promise<StatusResponse> => get('/api/status'),
  getConfig: (): Promise<ConfigResponse> => get('/api/config'),
  getGovernance: (): Promise<GovernanceResponse> => get('/api/governance'),
  getOntologyStats: (): Promise<OntologyStatsResponse> => get('/api/ontology/stats'),
  getSystemHealth: (): Promise<SystemHealthResponse> => get('/api/system/health'),

  // ── 会话 ──
  listSessions: (): Promise<SessionsResponse> => get('/api/sessions'),

  // ── P1：Space 组织模型（总部/部门空间树）──
  getSpaces: (): Promise<SpacesResponse> => get('/api/spaces'),
  getSpaceMessages: (spaceId: string, sessionId?: string): Promise<SpaceMessagesResponse> =>
    get(`/api/spaces/${encodeURIComponent(spaceId)}/messages${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`),

  createSession: (name?: string): Promise<CreateSessionResponse> =>
    post('/api/session/create', { name }),
  getSessionHistory: (id: string): Promise<SessionHistoryResponse> =>
    get(`/api/session/${encodeURIComponent(id)}/history`),
  /** 会话 17h：删除会话（幂等） */
  deleteSession: (id: string): Promise<DeleteSessionResponse> =>
    del(`/api/session/${encodeURIComponent(id)}`),

  // ── 文件上传（会话页附件；base64 JSON，上限 5MB） ──
  uploadFile: (input: { name: string; contentBase64: string }): Promise<UploadResponse> =>
    post('/api/files/upload', input),

  // ── 模型切换（全局生效） ──
  getModels: (): Promise<ModelsResponse> => get('/api/models'),
  setActiveModel: (modelId: string): Promise<SetActiveModelResponse> =>
    post('/api/models/active', { modelId }),

  // ── 组件会话条目（17i.4：步骤实时思考/输出；path 来自 execution.step.started 的 sessionPath） ──
  getSessionEntries: (path: string): Promise<AgentSessionEntriesResponse> =>
    get(`/api/agent-sessions/entries?path=${encodeURIComponent(path)}`),

  // ── 人工审批（17i.5：web 路径高风险操作会 waitForDecision 阻塞，需前端提示并决议） ──
  getPendingApprovals: (): Promise<ApprovalPendingResponse> => get('/api/approval/pending'),
  decideApproval: (id: string, decision: 'APPROVED' | 'REJECTED'): Promise<{ ok: boolean; id: string; decision: string }> =>
    post(`/api/approval/${encodeURIComponent(id)}/decide`, { decision }),

  // ── 17i.15：LLM 自主问用户（ask_user 工具） ──
  getPendingAsks: (): Promise<AskPendingResponse> => get('/api/ask/pending'),
  answerAsk: (id: string, answer: string): Promise<{ ok: boolean; id: string; answer: string }> =>
    post(`/api/ask/${encodeURIComponent(id)}/answer`, { answer }),

  // ── 17i.22：规划方案确认（Goal 模式自动跳过） ──
  getPendingPlans: (): Promise<PlanPendingResponse> => get('/api/plan/pending'),
  continuePlan: (id: string): Promise<{ ok: boolean; id: string }> =>
    post(`/api/plan/${encodeURIComponent(id)}/continue`, {}),
  getPlanFile: (path: string): Promise<{ ok: boolean; path?: string; content?: string }> =>
    get(`/api/plan/file?path=${encodeURIComponent(path)}`),

  // ── P2：AgentMailbox（工位/部门间交流，只读旁观）──
  getMailboxMessages: (spaceId: string): Promise<MailboxResponse> =>
    get(`/api/mailbox/${encodeURIComponent(spaceId)}`),
  mailboxSend: (req: MailboxSendRequest): Promise<MailboxResponse> =>
    post('/api/mailbox/send', req),

  // ── P3-A：HumanDecision 统一决策队列 ──
  getPendingDecisions: (): Promise<DecisionsResponse> => get('/api/decisions/pending'),
  // P-A：任务状态投影（服务端真相源；切视图/重启后恢复工作台）
  getTaskProjection: (missionId: string): Promise<TaskProjectionResponse> => get(`/api/tasks/${encodeURIComponent(missionId)}`),
  getTasks: (): Promise<TasksListResponse> => get('/api/tasks'),
  respondDecision: (id: string, decision?: string, answer?: string): Promise<{ ok: boolean }> =>
    post(`/api/decisions/${encodeURIComponent(id)}/respond`, {
      ...(decision !== undefined ? { decision } : {}),
      ...(answer !== undefined ? { answer } : {}),
    }),

  // ── P3-B：工作流热插拔（安装工作流 → 生成部门 Space）──
  getInstallableWorkflows: (): Promise<InstallableResponse> => get('/api/space/installable'),
  installWorkflow: (workflowId: string): Promise<InstallWorkflowResponse> =>
    post('/api/space/install-workflow', { workflowId }),

  // ── 17i.23：系统打开文件（office/md/txt/代码等） ──
  openSystemFile: (path: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
    post('/api/files/open', { path }),

  // ── 17i.24：应用内查看文件（text/md/代码/docx/xlsx） ──
  getFileView: (path: string): Promise<{
    ok: boolean;
    path?: string;
    kind?: string;
    content?: string;
    html?: string;
    reason?: string;
    name?: string;
    size?: number;
  }> => get(`/api/files/view?path=${encodeURIComponent(path)}`),

  // ── 对话与执行 ──
  sendChat: (message: string, opts?: ChatSendOptions): Promise<ChatSendResponse> =>
    post('/api/chat/send', { message, ...opts }),
  execute: (goal: string, opts?: ExecuteOptions): Promise<ExecuteResponse> =>
    post('/api/execute', { goal, ...opts }),
  getExecution: (executionId: string): Promise<ExecutionByIdResponse> =>
    get(`/api/execution/${encodeURIComponent(executionId)}`),

  // ── 观测聚合 ──
  getExecutionStats: (): Promise<ExecutionStatsResponse> => get('/api/execution-stats'),
  getExecutionTasks: (limit?: number): Promise<ExecutionTasksResponse> =>
    get(limit != null && limit > 0 ? `/api/execution-stats/tasks?limit=${limit}` : '/api/execution-stats/tasks'),
  getAnomalies: (): Promise<AnomaliesResponse> => get('/api/anomalies'),
  getEvolutionChanges: (): Promise<EvolutionChangesResponse> => get('/api/evolution/changes'),

  // ── 产物 ──
  listArtifacts: (): Promise<ArtifactsListResponse> => get('/api/artifacts'),
  getArtifactList: (): Promise<ArtifactsListResponse> => get('/api/artifacts/list'),
  getArtifact: (id: string): Promise<ArtifactByIdResponse> =>
    get(`/api/artifacts/${encodeURIComponent(id)}`),
  getArtifactGraph: (): Promise<ArtifactGraphResponse> => get('/api/artifacts/graph'),
  getArtifactLineage: (id: string): Promise<ArtifactLineageResponse> =>
    get(`/api/artifacts/lineage/${encodeURIComponent(id)}`),

  // ── 记忆 ──
  recallMemory: (q: string): Promise<MemoryRecallResponse> =>
    get(`/api/memory/recall?q=${encodeURIComponent(q)}`),
  rememberMemory: (content: string, source?: string): Promise<MemoryRememberResponse> =>
    post('/api/memory/remember', { content, source: source ?? 'studio-web' }),
  activateMemory: (input?: MemoryActivateInput): Promise<MemoryActivateResponse> =>
    post('/api/memory/activate', input ?? {}),

  // ── 学习 ──
  getLearningStats: (): Promise<LearningStatsResponse> => get('/api/learning/stats'),

  // ── 运行时 ──
  getRuntimeExecutions: (): Promise<RuntimeExecutionsResponse> => get('/api/runtime/executions'),
  getRuntimeExecution: (id: string): Promise<RuntimeExecutionByIdResponse> =>
    get(`/api/runtime/execution/${encodeURIComponent(id)}`),
} as const;

export type ApiClient = typeof api;
