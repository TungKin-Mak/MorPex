/**
 * Trace Plane — 统一 Trace Schema
 *
 * 所有模块必须产生 TraceEvent，由 TraceBus 统一收集、存储、广播。
 */

export interface TraceEvent {
  id: string;
  taskId: string;
  executionId: string;
  timestamp: number;

  module: {
    name: string;
    layer: string;   // 'control-plane' | 'runtime' | 'knowledge' | 'interaction' | 'evolution'
    version: string;
  };

  eventType:
    | 'MODULE_START'
    | 'MODULE_END'
    | 'DATA_FLOW'
    | 'ERROR'
    | 'STATE_CHANGE'
    | 'TOOL_CALL';

  input?: unknown;
  output?: unknown;

  metadata?: {
    agentId?: string;
    nodeId?: string;
    latency?: number;
    [key: string]: unknown;
  };
}

export interface ModuleRegistration {
  id: string;
  name: string;
  layer: string;
  version: string;
}

export interface CoverageSnapshot {
  moduleCoverage: number;       // 0–1, activatedModules / totalModules
  pathCoverage: Record<string, number>; // pathId → count
  dataFlowCoverage: number;      // 0–1, complete flows / total flows
  totalModules: number;
  activatedModules: number;
  unusedModules: string[];
}

export interface GraphNode {
  id: string;
  moduleName: string;
  layer: string;
  status: 'idle' | 'running' | 'success' | 'failed' | 'retry';
  taskId: string;
  startTime?: number;
  endTime?: number;
  input?: unknown;
  output?: unknown;
  children: string[];
  parents: string[];
}

export interface TaskTimelineEntry {
  taskId: string;
  modules: string[];
  startTime: number;
  endTime?: number;
}

export interface SystemStats {
  totalTasks: number;
  successCount: number;
  failedCount: number;
  avgLatency: number;        // ms
  moduleCoverage: number;
  pathCoverage: number;
  dataFlowCoverage: number;
  activatedModules: number;
  totalModules: number;
  unusedModules: string[];
}

// ── v9.2 真实模块注册表 (74 modules across 7 layers) ──
// 来源: docs/ARCHITECTURE.md Module Inventory
export const DEFAULT_MODULES: ModuleRegistration[] = [
  // ═══ Control Plane (13) ═══
  { id: 'policy-engine',             name: 'policy-engine',             layer: 'control-plane', version: '9.2.0' },
  { id: 'risk-analyzer',             name: 'risk-analyzer',             layer: 'control-plane', version: '9.2.0' },
  { id: 'permission-model',          name: 'permission-model',          layer: 'control-plane', version: '9.2.0' },
  { id: 'audit-trail',               name: 'audit-trail',               layer: 'control-plane', version: '9.2.0' },
  { id: 'org-policy-engine',         name: 'org-policy-engine',         layer: 'control-plane', version: '9.2.0' },
  { id: 'intent-plugin',             name: 'intent-plugin',             layer: 'control-plane', version: '9.2.0' },
  { id: 'industry-plugin',           name: 'industry-plugin',           layer: 'control-plane', version: '9.2.0' },
  { id: 'meta-planner',              name: 'meta-planner',              layer: 'control-plane', version: '9.2.0' },
  { id: 'circuit-breaker',           name: 'circuit-breaker',           layer: 'control-plane', version: '9.2.0' },
  { id: 'error-handler',             name: 'error-handler',             layer: 'control-plane', version: '9.2.0' },
  { id: 'retry-policy',              name: 'retry-policy',              layer: 'control-plane', version: '9.2.0' },
  { id: 'metrics-collector',         name: 'metrics-collector',         layer: 'control-plane', version: '9.2.0' },
  { id: 'health-check',              name: 'health-check',              layer: 'control-plane', version: '9.2.0' },

  // ═══ Cognitive Pipeline (12) ═══
  { id: 'cognitive-pipeline',        name: 'cognitive-pipeline',        layer: 'control-plane', version: '9.2.0' },
  { id: 'context-stage',             name: 'context-stage',             layer: 'control-plane', version: '9.2.0' },
  { id: 'intent-stage',              name: 'intent-stage',              layer: 'control-plane', version: '9.2.0' },
  { id: 'goal-stage',                name: 'goal-stage',                layer: 'control-plane', version: '9.2.0' },
  { id: 'twin-stage',                name: 'twin-stage',                layer: 'control-plane', version: '9.2.0' },
  { id: 'planning-stage',            name: 'planning-stage',            layer: 'control-plane', version: '9.2.0' },
  { id: 'execution-stage',           name: 'execution-stage',           layer: 'control-plane', version: '9.2.0' },
  { id: 'learning-stage',            name: 'learning-stage',            layer: 'control-plane', version: '9.2.0' },
  { id: 'evolution-stage',           name: 'evolution-stage',           layer: 'control-plane', version: '9.2.0' },
  { id: 'persistence-stage',         name: 'persistence-stage',         layer: 'control-plane', version: '9.2.0' },
  { id: 'verification-engine',       name: 'verification-engine',       layer: 'control-plane', version: '9.2.0' },
  { id: 'approval-engine',           name: 'approval-engine',           layer: 'control-plane', version: '9.2.0' },

  // ═══ Runtime Kernel (16) ═══
  { id: 'mission-runtime',           name: 'mission-runtime',           layer: 'runtime', version: '9.2.0' },
  { id: 'mission-fsm',               name: 'mission-fsm',               layer: 'runtime', version: '9.2.0' },
  { id: 'dag-runtime',               name: 'dag-runtime',               layer: 'runtime', version: '9.2.0' },
  { id: 'execution-fsm',             name: 'execution-fsm',             layer: 'runtime', version: '9.2.0' },
  { id: 'checkpoint-manager',        name: 'checkpoint-manager',        layer: 'runtime', version: '9.2.0' },
  { id: 'recovery-manager',          name: 'recovery-manager',          layer: 'runtime', version: '9.2.0' },
  { id: 'sandbox-manager',           name: 'sandbox-manager',           layer: 'runtime', version: '9.2.0' },
  { id: 'budget-manager',            name: 'budget-manager',            layer: 'runtime', version: '9.2.0' },
  { id: 'compensation-engine',       name: 'compensation-engine',       layer: 'runtime', version: '9.2.0' },
  { id: 'domain-dispatcher',         name: 'domain-dispatcher',         layer: 'runtime', version: '9.2.0' },
  { id: 'cross-domain-router',       name: 'cross-domain-router',       layer: 'runtime', version: '9.2.0' },
  { id: 'negotiation-engine',        name: 'negotiation-engine',        layer: 'runtime', version: '9.2.0' },
  { id: 'arbitration-handler',       name: 'arbitration-handler',       layer: 'runtime', version: '9.2.0' },
  { id: 'session-manager',           name: 'session-manager',           layer: 'runtime', version: '9.2.0' },
  { id: 'session-repo',              name: 'session-repo',              layer: 'runtime', version: '9.2.0' },
  { id: 'session-store',           name: 'session-store',           layer: 'runtime', version: '9.2.0' },
  { id: 'dag-executor-adapter',      name: 'dag-executor-adapter',      layer: 'runtime', version: '9.2.0' },
  { id: 'message-gateway',           name: 'message-gateway',           layer: 'interaction', version: '9.2.0' },
  { id: 'meta-planner-adapter',      name: 'meta-planner-adapter',      layer: 'control-plane', version: '9.2.0' },
  { id: 'artifact-writer',           name: 'artifact-writer',           layer: 'knowledge', version: '9.2.0' },
  { id: 'studio-orchestrator',       name: 'studio-orchestrator',       layer: 'runtime', version: '9.2.0' },
  { id: 'event-sourcing-store',      name: 'event-sourcing-store',      layer: 'runtime', version: '9.2.0' },
  { id: 'doc-watcher',               name: 'doc-watcher',               layer: 'knowledge', version: '9.2.0' },
  { id: 'doc-topology',              name: 'doc-topology',              layer: 'knowledge', version: '9.2.0' },
  { id: 'domain-manager',            name: 'domain-manager',            layer: 'runtime', version: '9.2.0' },

  // ═══ Knowledge Plane (14) ═══
  { id: 'behavior-twin',             name: 'behavior-twin',             layer: 'knowledge', version: '9.2.0' },
  { id: 'decision-twin',             name: 'decision-twin',             layer: 'knowledge', version: '9.2.0' },
  { id: 'personal-brain',            name: 'personal-brain',            layer: 'knowledge', version: '9.2.0' },
  { id: 'preference-model',          name: 'preference-model',          layer: 'knowledge', version: '9.2.0' },
  { id: 'goal-manager',              name: 'goal-manager',              layer: 'knowledge', version: '9.2.0' },
  { id: 'goal-graph',                name: 'goal-graph',                layer: 'knowledge', version: '9.2.0' },
  { id: 'knowledge-graph',           name: 'knowledge-graph',           layer: 'knowledge', version: '9.2.0' },
  { id: 'artifact-registry',         name: 'artifact-registry',         layer: 'knowledge', version: '9.2.0' },
  { id: 'memory-wiki',               name: 'memory-wiki',               layer: 'knowledge', version: '9.2.0' },
  { id: 'memory-retriever',          name: 'memory-retriever',          layer: 'knowledge', version: '9.2.0' },
  { id: 'zvec-storage',              name: 'zvec-storage',              layer: 'knowledge', version: '9.2.0' },
  { id: 'history-store',             name: 'history-store',             layer: 'knowledge', version: '9.2.0' },
  { id: 'brain-persistor',           name: 'brain-persistor',           layer: 'knowledge', version: '9.2.0' },
  { id: 'workflow-intelligence',     name: 'workflow-intelligence',     layer: 'knowledge', version: '9.2.0' },

  // ═══ Agent Plane (8) ═══
  { id: 'agent-registry',            name: 'agent-registry',            layer: 'runtime', version: '9.2.0' },
  { id: 'agent-scheduler',           name: 'agent-scheduler',           layer: 'runtime', version: '9.2.0' },
  { id: 'agent-message-bus',         name: 'agent-message-bus',         layer: 'runtime', version: '9.2.0' },
  { id: 'collaboration-manager',     name: 'collaboration-manager',     layer: 'runtime', version: '9.2.0' },
  { id: 'team-formation-engine',     name: 'team-formation-engine',     layer: 'runtime', version: '9.2.0' },
  { id: 'cross-agent-learning',      name: 'cross-agent-learning',      layer: 'runtime', version: '9.2.0' },
  { id: 'shared-memory-manager',     name: 'shared-memory-manager',     layer: 'runtime', version: '9.2.0' },
  { id: 'agent-memory-isolation',    name: 'agent-memory-isolation',    layer: 'runtime', version: '9.2.0' },
  { id: 'context-assembly-engine',   name: 'context-assembly-engine',   layer: 'control-plane', version: '9.2.0' },
  { id: 'unified-event-store',       name: 'unified-event-store',       layer: 'runtime', version: '9.2.0' },
  { id: 'artifact-plane',            name: 'artifact-plane',            layer: 'knowledge', version: '9.2.0' },

  // ═══ Evolution Plane (3) ═══
  { id: 'workflow-miner',            name: 'workflow-miner',            layer: 'evolution', version: '9.2.0' },
  { id: 'workflow-registry',         name: 'workflow-registry',         layer: 'evolution', version: '9.2.0' },
  { id: 'workflow-executor',        name: 'workflow-executor',        layer: 'evolution', version: '9.2.0' },

  // ═══ Cognitive Loop (1) ═══
  { id: 'cognitive-loop',           name: 'cognitive-loop',           layer: 'control-plane', version: '9.2.0' },
];

// ═══════════════════════════════════════════════════════════════════
// Module Heartbeat (自检系统)
// ═══════════════════════════════════════════════════════════════════

export interface ModuleHeartbeat {
  name: string;
  version: string;
  layer: string;
  status: 'online' | 'degraded' | 'offline' | 'unknown';
  registeredAt: number;
  lastHeartbeat: number;
  metadata?: Record<string, unknown>;
}

export interface ModuleHealthReport {
  heartbeats: ModuleHeartbeat[];
  onlineCount: number;
  totalCount: number;
  /** Modules with heartbeat + status=online but zero trace events */
  onlineButUnused: Array<{ name: string; layer: string }>;
  /** Modules that have been exercised (have MODULE_START events) */
  exercisedModules: string[];
}
