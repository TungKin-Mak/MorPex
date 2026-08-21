/**
 * Studio REST API 响应类型（手写，镜像后端契约）。
 *
 * 权威源：packages/studio/server/__tests__/api-contract.test.ts + StudioServer.ts / RuntimeAPI.ts。
 * 已知结构使用精确类型；后端未承诺结构 / 返回字段随版本变化的端点使用宽松类型
 * （unknown 字段 + 最小已知接口），禁止 any。
 */

// ── 系统状态 ──
export interface HealthResponse {
  ok: boolean;
  uptime: number;
  bootedAt: string;
  runtime: string;
}

export interface StatusResponse {
  phase: string;
  departments: number;
  artifacts: number;
  controlPlane: { goal: boolean; policies: number };
  governance: unknown | null;
}

export interface ConfigResponse {
  version: string;
  engine: string;
  port: number;
}

export interface GovernanceResponse {
  ok: boolean;
  health: unknown | null;
  cost: unknown | null;
  delivery: unknown | null;
}

export interface OntologyStatsResponse {
  ok: boolean;
  guard: boolean;
  service: boolean;
}

export interface SystemHealthResponse {
  ok?: boolean;
  status?: unknown;
  message?: string;
  error?: string;
}

// ── 会话 ──
export interface SessionMeta {
  id: string;
  name?: string;
  createdAt: number;
}

export interface SessionsResponse {
  sessions: SessionMeta[];
}

export interface CreateSessionResponse {
  ok: boolean;
  sessionId: string;
}

// ── 会话 17h：删除会话 ──
export interface DeleteSessionResponse {
  ok: boolean;
  deleted: boolean;
}

// ── 会话 17h：文件上传（base64 JSON）──
export interface UploadResponse {
  ok: boolean;
  fileId: string;
  name: string;
  size: number;
  mimeType?: string;
  isText: boolean;
}

// ── 会话 17h：模型列表 / 切换（全局生效）──
export interface ModelInfoView {
  id: string; // 'provider/model'
  provider: string;
  model: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  isActive?: boolean;
}

export interface ModelsResponse {
  ok: boolean;
  active: string;
  models: ModelInfoView[];
}

export interface SetActiveModelResponse {
  ok: boolean;
  active: string;
}

export interface HistoryMessage {
  role: string;
  content: string;
  timestamp: number;
}

export interface SessionHistoryResponse {
  ok: boolean;
  messages: HistoryMessage[];
}

// ── P1：Space 组织模型（总部/部门空间树）──
export interface Space {
  id: string; // 'hq' | `dept_${departmentId}`
  type: 'hq' | 'department' | 'task';
  name: string; // 中文名：软件部/电商部/嵌入式部/硬件部
  icon?: string;
  parentId: string | null;
  departmentId?: string;
  workflowId?: string;
  managerPersona?: string;
  capabilities?: string[];
  createdAt: number;
}

export interface SpacesResponse {
  ok: boolean;
  tree?: { hq: Space; departments: Space[] };
  error?: string;
}

/** 空间消息：在 HistoryMessage 基础上带 Space 归属（后端未实现时后端忽略，前端优雅降级）。 */
export interface SpaceMessage extends HistoryMessage {
  kind?: 'chat' | 'task';
  spaceId?: string;
  threadId?: string;
}

export interface SpaceMessagesResponse {
  ok: boolean;
  messages?: SpaceMessage[];
  error?: string;
}

// ── P2：AgentMailbox 跨部门/工位交流（只读旁观）──
export interface MailMessage {
  id: string;
  from: string; // 'station:<agentType>' | 'dept:<workflowId>' | 'agent:<name>'
  to: string;
  spaceId: string;
  taskId?: string;
  goal?: string;
  question: string;
  reply?: string;
  status: 'pending' | 'replied' | 'timeout';
  createdAt: number;
  repliedAt?: number;
}

export interface MailboxResponse {
  ok: boolean;
  messages?: MailMessage[];
  error?: string;
}

export interface MailboxSendRequest {
  from: string;
  to: string;
  spaceId: string;
  taskId?: string;
  goal?: string;
  question: string;
}

// ── P3-A：HumanDecision 统一决策队列（plan/ask/approval 聚合视图）──
export interface DecisionItem {
  id: string;
  kind: 'plan' | 'ask' | 'approval';
  title?: string;
  question?: string;
  options?: string[];
  goal?: string;
  spaceId?: string;
  meta?: { planFile?: string; riskLevel?: string; summary?: string };
  status?: string;
}

export interface DecisionsResponse {
  ok: boolean;
  decisions?: DecisionItem[];
  error?: string;
}

// ── P3-B：工作流热插拔（安装 → 生成部门 Space）──
export interface InstallableWorkflow {
  id: string;
  name: string;
  description?: string;
  installed?: boolean;
}

export interface InstallableResponse {
  ok: boolean;
  workflows?: InstallableWorkflow[];
  error?: string;
}

export interface InstallWorkflowResponse {
  ok: boolean;
  error?: string;
}

// ── 组件会话条目（17i.4：步骤实时思考/输出轮询）──
/** message 条目附带 contentBlocks（原始块数组：text/toolCall/toolResult）；content 为纯文本。 */
export interface AgentSessionEntryMessage {
  type?: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string | number;
  role?: string;
  content?: string;
  contentBlocks?: Array<Record<string, unknown>>;
  /** 17i.9：toolResult 消息的工具名（在消息级，不在块级）。 */
  toolName?: string;
  toolCallId?: string;
  [k: string]: unknown;
}

export interface AgentSessionEntriesResponse {
  ok: boolean;
  path?: string;
  entries?: AgentSessionEntryMessage[];
}

// ── 人工审批（17i.5）──
export interface PendingApproval {
  id: string;
  artifactId?: string;
  artifactName?: string;
  riskLevel?: string;
  summary?: string;
  action?: string;
  description?: string;
  decision?: string;
  [k: string]: unknown;
}

export interface ApprovalPendingResponse {
  ok: boolean;
  approvals: PendingApproval[];
}

// ── 17i.15：LLM 自主问用户（ask_user 工具）──
export interface PendingAsk {
  id: string;
  question: string;
  options?: string[];
  sessionId?: string;
}

export interface AskPendingResponse {
  ok: boolean;
  asks: PendingAsk[];
}

// ── 17i.22：规划方案确认 ──
export interface PendingPlan {
  id: string;
  goal: string;
  planFile: string;
  stepNames: string[];
}

export interface PlanPendingResponse {
  ok: boolean;
  plans: PendingPlan[];
}

// ── 对话与执行 ──
/** chat/send 与 execute 返回 executeGoal / executionEngine 的执行结果，字段随后端演进变化。 */
export type ChatSendResponse = { [k: string]: unknown } & {
  ok?: boolean;
  error?: string;
  /** P1：任务被路由到的部门空间（chat/send 响应，前端据此显示「已转交 X 部门」）。 */
  routedTo?: { spaceId?: string; departmentName?: string };
  /** P1：消息所属 Space id。 */
  spaceId?: string;
};
export type ExecuteResponse = { [k: string]: unknown } & { ok?: boolean; error?: string };

export interface ExecutionByIdResponse {
  executionId: string;
  mission: unknown | null;
}

// ── 观测聚合 ──
export interface ExecutionStatsResponse {
  ok: boolean;
  stats: {
    execution: {
      byMode: Record<string, { success: number; total: number; avgDuration: number; successRate: number }>;
      totalSuccessRate: number;
    };
    steps: {
      totalSteps: number;
      failed: number;
      emptyParamFails: number;
      safetyFails: number;
      emptyParamRate: number;
      totalRetries: number;
    };
    assembly: {
      count: number;
      avgDurationMs: number;
      avgInfoDensity: number;
    };
    cost: {
      totalTokens: number;
      totalCost: number;
    };
    generatedAt: number;
  };
}

export interface ExecutionTask {
  executionId: string;
  goal: string;
  ok: boolean;
  durationMs: number;
  mode: string;
  tokens: number;
}

export interface ExecutionTasksResponse {
  ok: boolean;
  tasks: ExecutionTask[];
  total: number;
}

export interface AnomaliesResponse {
  ok: boolean;
  anomalies: unknown[];
}

export interface EvolutionChangesResponse {
  ok: boolean;
  changes: unknown[];
  pending: number;
  strategies: unknown[];
}

// ── 产物 ──
export interface ArtifactsListResponse {
  artifacts: unknown[];
  count?: number;
}

export interface ArtifactByIdResponse {
  artifact: unknown | null;
}

export interface ArtifactGraphResponse {
  ok?: boolean;
  nodes?: unknown[];
  edges?: unknown[];
}

export interface ArtifactLineageResponse {
  ok?: boolean;
  artifactId?: string;
  ancestors?: number;
  descendants?: number;
  ancestorNodes?: unknown[];
  descendantNodes?: unknown[];
}

// ── 记忆 ──
export interface MemoryRecallResponse {
  ok: boolean;
  hits: unknown[];
  error?: string;
}

export interface MemoryRememberResponse {
  ok: boolean;
  error?: string;
}

export interface MemoryActivateInput {
  text?: string;
  executionStatus?: string;
  goal?: string;
  currentStep?: number;
  totalSteps?: number;
  completedSteps?: string[];
  errors?: string[];
  tags?: string[];
}

export interface MemoryActivateResponse {
  ok?: boolean;
  memories?: unknown[];
  activationScore?: number;
  contextBias?: unknown;
  error?: string;
}

// ── 学习 ──
export interface LearningStatsResponse {
  ok?: boolean;
  experienceExtractor?: unknown;
  planEvaluator?: unknown;
  templateEvolution?: unknown;
  error?: string;
}

// ── 运行时 ──
export interface RuntimeExecutionMeta {
  id: string;
  state: string;
  transitions: number;
  updatedAt?: number;
  createdAt?: number;
}

export interface RuntimeExecutionsResponse {
  ok?: boolean;
  count?: number;
  executions: unknown[];
}

export interface RuntimeExecutionByIdResponse {
  ok?: boolean;
  execution?: {
    id: string;
    latest: unknown;
    snapshots: unknown[];
    dagResult: unknown;
  };
  error?: string;
}

// ── P-A：任务状态投影（服务端真相源；切视图/重启后前端可恢复工作台）──
export interface TaskStepProjection {
  nodeId: string;
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed';
}
export interface TaskDagProjection {
  nodes: Array<{ id: string; name: string; deps: string[] }>;
  edges: Array<{ from: string; to: string }>;
}
export interface TaskProjection {
  missionId: string;
  goal: string;
  executionId?: string;
  spaceId?: string;
  departmentId?: string;
  progress: string;
  steps: TaskStepProjection[];
  dag?: TaskDagProjection | null;
  createdAt: number;
  updatedAt: number;
}
export interface TaskProjectionResponse { ok: boolean; task?: TaskProjection | null; }
export interface TasksListResponse { ok: boolean; tasks?: Array<{ missionId: string; goal: string; progress: string; status: string; updatedAt: number }>; }
