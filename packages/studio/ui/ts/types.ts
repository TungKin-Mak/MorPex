/* ═══════════════════════════════════════════════════════════════════════
   types.ts — AstroM 纯类型定义
   零逻辑，只定义前端需要的接口类型。
   ═══════════════════════════════════════════════════════════════════════ */

// ── System Status ────────────────────────────────────────────

export interface SystemStatus {
  ok: boolean;
  phase: string;
  uptime: number;
  pluginCount: number;
  activeExecutions: number;
  ai_engine: boolean;
  memory_available: boolean;
  timestamp: number;
}

export interface EngineStatus {
  ok: boolean;
  running: boolean;
  engine_info?: {
    model_id?: string;
    model_name?: string;
    running?: boolean;
  };
}

// ── API Response ─────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  ok: boolean;
  error?: string;
  [key: string]: T | boolean | string | undefined;
}

// ── Chat ─────────────────────────────────────────────────────

export interface ChatResponse {
  ok: boolean;
  type?: 'execution_complete' | 'clarification' | 'rejected' | 'direct_chat' | 'dag_plan';
  output?: string;
  executionId?: string;
  error?: string;
  sessionId?: string;
  questions?: ClarifyQuestion[];
  artifacts?: ArtifactMeta[];
  dag?: DagPlanData;
  analysis?: {
    globalIntent?: string;
    isMultiDomain?: boolean;
    involvedDomains?: string[];
    reasoning?: string;
  };
}

export interface DagPlanData {
  nodes: DagNodeMeta[];
  isMultiDomain?: boolean;
  involvedDomains?: string[];
  globalIntent?: string;
  reasoning?: string;
  agent?: string;
}

export interface DagNodeMeta {
  taskId: string;
  domain: string;
  goal: string;
  deps: string[];
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'interrupted' | 'awaiting_input';
  name?: string;
  description?: string;
  result?: any;
  error?: string;
}

export interface ClarifyQuestion {
  id: string;
  question: string;
  type: 'choice' | 'open';
  options?: string[];
}

export interface ArtifactMeta {
  name: string;
  type: string;
  path: string;
}

// ── SSE Events ──────────────────────────────────────────────

export interface SseEvent {
  id: string;
  type: string;
  timestamp: number;
  executionId: string;
  source: string;
  payload: Record<string, unknown>;
}

export type SseEventHandler = (data: Record<string, unknown>) => void;

// ── Sessions ─────────────────────────────────────────────────

export interface SessionInfo {
  id: string;
  createdAt: number;
  name?: string;
  messageCount?: number;
}

// ── History ──────────────────────────────────────────────────

export interface HistoryResponse {
  ok: boolean;
  executionId: string;
  history: unknown | null;
  mirror: unknown[];
  memory: unknown[];
  artifacts: unknown[];
}

// ── Knowledge Graph ──────────────────────────────────────────

export interface KgData {
  nodes: { id: string; label: string; type: string }[];
  edges: { source: string; target: string; type: string }[];
}

// ── Memory Stats ────────────────────────────────────────────

export interface MemoryStats {
  ok: boolean;
  stats?: {
    provenance?: {
      totalIndexed: number;
      mainPoolCount: number;
      archiveCount: number;
      correctionCount: number;
    };
    gate?: {
      total: number;
      rejected: number;
      rejectRate: string;
    };
    v2?: {
      tempPoolSize: number;
      currentStage: string;
    };
  };
}

// ── Domains ──────────────────────────────────────────────────

export interface DomainResponse {
  ok: boolean;
  domains?: Array<{
    domain_id: string;
    domain_name: string;
    version: string;
    skills: string[];
    status: string;
  }>;
}

// ── Artifacts ────────────────────────────────────────────────

export interface ArtifactsResponse {
  ok: boolean;
  projects?: Array<{
    id: string;
    files: Array<{ name: string; path: string }>;
  }>;
}

// ── Workers ──────────────────────────────────────────────────

export interface WorkerInfo {
  id: string;
  role: string;
  state: string;
  specialty?: string;
}

// ── 会话历史 ──

export interface ChatHistoryMessage {
  role: 'user' | 'system';
  content: string;
  region?: string;
  status?: string;
  executionId?: string;
  timestamp: number;
  dag?: any;  // DAG 计划数据，刷新恢复 DagCard 用
}

export interface ChatHistoryResponse {
  ok: boolean;
  sessionId: string;
  count: number;
  messages: ChatHistoryMessage[];
}

// ── v7 Architecture Health ──────────────────────────────────

export interface HealthReport {
  score: number;
  breakdown: HealthDimension[];
  runtimeCoverage: RuntimeCoverage;
  events: number;
  deadModules: number;
}

export interface HealthDimension {
  dimension: string;
  score: number;
  max: number;
  status: string;
}

export interface RuntimeCoverage {
  total: number;
  active: number;
  publicApi: number;
  dead: number;
}

// ── v7 Runtime Executions ───────────────────────────────────

export interface Execution {
  id: string;
  state: string;
  transitions: string[];
}

export interface ExecutionDetail {
  execution: {
    latest: Record<string, unknown>;
    snapshots: unknown[];
    dagResult: unknown;
  };
}

// ── v7 Artifacts ────────────────────────────────────────────

export interface ArtifactV7 {
  id: string;
  name: string;
  type: string;
  version: string;
  status: string;
}

export interface GraphData {
  nodes: { id: string; label: string; type: string }[];
  edges: { source: string; target: string; type: string }[];
}

export interface LineageData {
  ancestors: string[];
  descendants: string[];
  ancestorNodes: ArtifactV7[];
  descendantNodes: ArtifactV7[];
}

// ── v7 Memory ───────────────────────────────────────────────

export interface MemoryContext {
  executionStatus: string;
  goal: string;
}

export interface MemoryResult {
  memories: unknown[];
  activationScore: number;
  contextBias: string;
}

// ── v7 Learning ─────────────────────────────────────────────

export interface LearningStats {
  templateEvolution: {
    totalTemplates: number;
    avgSuccessRate: number;
  };
}

// ── v7 System Health ────────────────────────────────────────

export interface SystemHealth {
  architectureCoverage: number;
  scenarioSuccessRate: number;
  testsPassed: number;
}
