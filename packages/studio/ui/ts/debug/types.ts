/* ═══════════════════════════════════════════════════════════════════════
   debug/types.ts — Debug Page 类型定义
   ═══════════════════════════════════════════════════════════════════════ */

export interface TraceEvent {
  id: string;
  taskId: string;
  executionId: string;
  timestamp: number;
  module: {
    name: string;
    layer: string;
    version: string;
  };
  eventType: 'MODULE_START' | 'MODULE_END' | 'DATA_FLOW' | 'ERROR' | 'STATE_CHANGE' | 'TOOL_CALL';
  input?: unknown;
  output?: unknown;
  metadata?: {
    agentId?: string;
    nodeId?: string;
    latency?: number;
    [key: string]: unknown;
  };
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

export interface ModuleCoverage {
  moduleCoverage: number;
  pathCoverage: Record<string, number>;
  dataFlowCoverage: number;
  totalModules: number;
  activatedModules: number;
  unusedModules: string[];
}

export interface SystemStats {
  totalTasks: number;
  totalEvents: number;
  successCount: number;
  failedCount: number;
  avgLatency: number;
  moduleCoverage: number;
  pathCoverage: number;
  dataFlowCoverage: number;
  activatedModules: number;
  totalModules: number;
  unusedModules: string[];
}

export interface TaskTimelineEntry {
  taskId: string;
  modules: string[];
  startTime: number;
  endTime?: number;
}

export interface ModuleHeartbeat {
  name: string;
  version: string;
  layer: string;
  status: 'online' | 'degraded' | 'offline' | 'unknown';
  registeredAt: number;
  lastHeartbeat: number;
}

export interface ModuleHealthReport {
  heartbeats: ModuleHeartbeat[];
  onlineCount: number;
  totalCount: number;
  onlineButUnused: Array<{ name: string; layer: string }>;
  exercisedModules: string[];
}
