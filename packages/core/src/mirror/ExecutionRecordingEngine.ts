/**
 * ExecutionRecordingEngine — Structured execution recording and replay
 *
 * OpenSpace Fusion: Phase 4 — Execution Recording Engine
 *
 * Records the full execution lifecycle (thoughts, actions, observations, DAG snapshots)
 * for post-hoc analysis, template extraction, and debugging.
 *
 * Compared to the existing ExecutionMirror (which is a passive observer recording
 * EventBus events), this engine is an active recorder that:
 *   1. Tracks the execution lifecycle explicitly (start → record → stop)
 *   2. Captures structured thought/action/observation entries
 *   3. Takes DAG topology snapshots at key points
 *   4. Supports template extraction from recordings (CAPTURED evolution)
 *
 * Integration points:
 *   - ExecutionGateway.execute() → start/stop recording around adapter calls
 *   - AgentReasoningInterceptor → recordThought/recordAction/recordObservation
 *   - TemplateManager.captureFromExecution() → extract templates from recordings
 *
 * @see upgrade-plan-openspace-fusion.md §6
 * @see ExecutionMirror.ts — existing passive observer
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { EvolutionType } from '../extensions/planning/TemplateManager.js';
import type { PlanTemplate, PlanNodeSkeleton } from '../extensions/planning/types.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

/** A single thought entry during agent reasoning */
export interface ThoughtEntry {
  timestamp: number;
  sentence: string;
  intercepted: boolean;
  interceptionReason?: string;
}

/** A single tool action (call or attempt) */
export interface ActionEntry {
  timestamp: number;
  toolName: string;
  toolArgs: Record<string, unknown>;
  blocked: boolean;
  blockReason?: string;
  result?: {
    success: boolean;
    data: unknown;
    latencyMs: number;
    error?: string;
  };
}

/** A single observation (tool result, agent error, node completion) */
export interface ObservationEntry {
  timestamp: number;
  type: 'tool_result' | 'agent_error' | 'node_complete';
  data: unknown;
  isError: boolean;
  correctionInjected: boolean;
  injectionContent?: string;
}

/** DAG topology snapshot at a point in time */
export interface DAGSnapshot {
  timestamp: number;
  phase: 'before_node' | 'after_node';
  nodeId: string;
  totalNodes: number;
  completedNodes: number;
  pendingNodes: number;
  failedNodes: number;
}

/** Complete execution recording */
export interface ExecutionRecording {
  /** Unique recording ID */
  recordingId: string;
  /** Session ID */
  sessionId: string;
  /** Execution ID */
  executionId: string;
  /** Recording start time */
  startedAt: number;
  /** Recording completion time */
  completedAt: number;
  /** Thought log (agent reasoning steps) */
  thoughtLog: ThoughtEntry[];
  /** Action log (tool calls) */
  actionLog: ActionEntry[];
  /** Observation log (results and errors) */
  observationLog: ObservationEntry[];
  /** DAG topology snapshots */
  dagSnapshots: DAGSnapshot[];
  /** Optional template evolution metadata */
  templateEvolution?: {
    evolutionType: EvolutionType;
    templateId: string;
  };
}

/** Recording engine configuration */
export interface RecordingConfig {
  /** Storage directory for recordings */
  storageDir: string;
  /** Whether to auto-extract templates from successful recordings */
  autoExtractTemplates: boolean;
  /** Maximum recordings per session before rotation */
  maxRecordingsPerSession: number;
}

/** Default recording config */
export const DEFAULT_RECORDING_CONFIG: RecordingConfig = {
  storageDir: './data/recordings',
  autoExtractTemplates: true,
  maxRecordingsPerSession: 50,
};

// ═══════════════════════════════════════════════════════════════
// Type aliases for backward compatibility with index.ts exports
// ═══════════════════════════════════════════════════════════════

/** @deprecated Use ThoughtEntry instead */
export type RecordedThought = ThoughtEntry;
/** @deprecated Use ActionEntry instead */
export type RecordedAction = ActionEntry;
/** @deprecated Use ObservationEntry instead */
export type RecordedObservation = ObservationEntry;
/** @deprecated Use DAGSnapshot instead */
export type RecordedDAGSnapshot = DAGSnapshot;

/** Recording statistics */
export interface RecordingStats {
  totalRecordings: number;
  avgDurationMs: number;
  avgThoughtCount: number;
  avgActionCount: number;
  totalErrors: number;
}

// ═══════════════════════════════════════════════════════════════
// ExecutionRecordingEngine
// ═══════════════════════════════════════════════════════════════

export class ExecutionRecordingEngine {
  private activeRecordings: Map<string, ExecutionRecording> = new Map();
  private config: RecordingConfig;

  constructor(config?: Partial<RecordingConfig>) {
    this.config = { ...DEFAULT_RECORDING_CONFIG, ...config };
  }

  // ═══════════════════════════════════════════════════════════════
  // Lifecycle: start / stop
  // ═══════════════════════════════════════════════════════════════

  /**
   * startRecording — Begin recording an execution.
   *
   * @param sessionId - Active session ID
   * @param executionId - Execution ID
   * @returns The recording ID for subsequent record*() calls
   */
  startRecording(sessionId: string, executionId: string): string {
    const recordingId = `rec_${executionId}_${Date.now()}`;

    this.activeRecordings.set(recordingId, {
      recordingId,
      sessionId,
      executionId,
      startedAt: Date.now(),
      completedAt: 0,
      thoughtLog: [],
      actionLog: [],
      observationLog: [],
      dagSnapshots: [],
    });

    return recordingId;
  }

  /**
   * stopRecording — Finalize and persist a recording.
   *
   * Persists the recording to disk as JSON in:
   *   {storageDir}/{sessionId}/{recordingId}.json
   *
   * @param recordingId - Recording ID from startRecording()
   * @returns The finalized recording
   */
  async stopRecording(recordingId: string): Promise<ExecutionRecording> {
    const recording = this.activeRecordings.get(recordingId);
    if (!recording) {
      throw new Error(`Recording not found: ${recordingId}`);
    }

    recording.completedAt = Date.now();

    // Persist to disk
    const dir = path.join(this.config.storageDir, recording.sessionId);
    await fsp.mkdir(dir, { recursive: true });

    const filePath = path.join(dir, `${recordingId}.json`);
    await fsp.writeFile(filePath, JSON.stringify(recording, null, 2), 'utf-8');

    // Remove from active recordings
    this.activeRecordings.delete(recordingId);

    return recording;
  }

  // ═══════════════════════════════════════════════════════════════
  // Recording methods
  // ═══════════════════════════════════════════════════════════════

  /**
   * recordThought — Record an agent reasoning thought step.
   */
  recordThought(recordingId: string, entry: Omit<ThoughtEntry, 'timestamp'>): void {
    const recording = this.activeRecordings.get(recordingId);
    if (!recording) return;

    recording.thoughtLog.push({
      ...entry,
      timestamp: Date.now(),
    });
  }

  /**
   * recordAction — Record a tool call action.
   */
  recordAction(recordingId: string, entry: Omit<ActionEntry, 'timestamp'>): void {
    const recording = this.activeRecordings.get(recordingId);
    if (!recording) return;

    recording.actionLog.push({
      ...entry,
      timestamp: Date.now(),
    });
  }

  /**
   * recordObservation — Record an observation (tool result, error, etc.).
   */
  recordObservation(recordingId: string, entry: Omit<ObservationEntry, 'timestamp'>): void {
    const recording = this.activeRecordings.get(recordingId);
    if (!recording) return;

    recording.observationLog.push({
      ...entry,
      timestamp: Date.now(),
    });
  }

  /**
   * recordDAGSnapshot — Record a DAG topology snapshot.
   */
  recordDAGSnapshot(recordingId: string, entry: Omit<DAGSnapshot, 'timestamp'>): void {
    const recording = this.activeRecordings.get(recordingId);
    if (!recording) return;

    recording.dagSnapshots.push({
      ...entry,
      timestamp: Date.now(),
    });
  }

  /**
   * setTemplateEvolution — Associate a template evolution with the recording.
   */
  setTemplateEvolution(
    recordingId: string,
    evolution: { evolutionType: EvolutionType; templateId: string },
  ): void {
    const recording = this.activeRecordings.get(recordingId);
    if (!recording) return;

    recording.templateEvolution = evolution;
  }

  // ═══════════════════════════════════════════════════════════════
  // Query / Retrieval
  // ═══════════════════════════════════════════════════════════════

  /**
   * getRecording — Load a recording from disk by ID.
   *
   * @param recordingId - Recording ID
   * @returns The recording, or null if not found
   */
  async getRecording(recordingId: string): Promise<ExecutionRecording | null> {
    // Check active recordings first
    const active = this.activeRecordings.get(recordingId);
    if (active) return active;

    // Search on disk
    try {
      const sessions = await fsp.readdir(this.config.storageDir);
      for (const session of sessions) {
        const sessionDir = path.join(this.config.storageDir, session);
        const filePath = path.join(sessionDir, `${recordingId}.json`);
        try {
          const content = await fsp.readFile(filePath, 'utf-8');
          return JSON.parse(content) as ExecutionRecording;
        } catch {
          // File not in this session directory
        }
      }
    } catch {
      // Storage directory doesn't exist
    }

    return null;
  }

  /**
   * getSessionRecordings — Get all recordings for a session.
   *
   * @param sessionId - Session ID
   * @returns Array of recordings, sorted by start time descending
   */
  async getSessionRecordings(sessionId: string): Promise<ExecutionRecording[]> {
    const recordings: ExecutionRecording[] = [];

    // Check active recordings for this session
    for (const rec of this.activeRecordings.values()) {
      if (rec.sessionId === sessionId) {
        recordings.push(rec);
      }
    }

    // Load from disk
    const sessionDir = path.join(this.config.storageDir, sessionId);
    try {
      const files = await fsp.readdir(sessionDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const content = await fsp.readFile(path.join(sessionDir, file), 'utf-8');
          const rec = JSON.parse(content) as ExecutionRecording;
          recordings.push(rec);
        } catch {
          // Skip corrupt files
        }
      }
    } catch {
      // Directory doesn't exist
    }

    // Sort by start time descending (newest first)
    recordings.sort((a, b) => b.startedAt - a.startedAt);

    return recordings;
  }

  /**
   * getActiveRecording — Get a currently-active recording by ID.
   */
  getActiveRecording(recordingId: string): ExecutionRecording | null {
    return this.activeRecordings.get(recordingId) ?? null;
  }

  /**
   * getActiveRecordingCount — Get count of currently active recordings.
   */
  getActiveRecordingCount(): number {
    return this.activeRecordings.size;
  }

  // ═══════════════════════════════════════════════════════════════
  // Template Extraction from Recordings
  // ═══════════════════════════════════════════════════════════════

  /**
   * extractTemplateFromRecording — Extract a PlanTemplate from a recording.
   *
   * Analyzes the thought/action/observation sequence to derive
   * a DAG skeleton suitable for CAPTURED evolution.
   *
   * @param recording - Complete execution recording
   * @returns A PlanTemplate, or null if the recording is unsuitable
   */
  extractTemplateFromRecording(recording: ExecutionRecording): PlanTemplate | null {
    // Must have completed
    if (recording.completedAt === 0) return null;

    // Must have actions to form a template
    if (recording.actionLog.length === 0) return null;

    // Build node skeletons from DAG snapshots and action log
    const nodeSkeletons = this.buildNodeSkeletonsFromRecording(recording);
    if (nodeSkeletons.length === 0) return null;

    // Count successful vs failed actions for quality scoring
    const successfulActions = recording.actionLog.filter(
      a => !a.blocked && a.result?.success !== false,
    ).length;

    const totalActions = recording.actionLog.length;
    const successRate = totalActions > 0 ? successfulActions / totalActions : 0.5;

    // Template name from session + execution
    const name = `rec_${recording.sessionId.slice(0, 8)}_${recording.executionId.slice(0, 8)}`;

    const template: PlanTemplate = {
      templateId: `tpl_from_rec_${recording.recordingId}`,
      name,
      description: `Extracted from recording ${recording.recordingId} (${recording.actionLog.length} actions)`,
      tags: [recording.sessionId],
      nodeSkeletons,
      successRate,
      avgDurationMs: recording.completedAt - recording.startedAt,
      avgTokensUsed: 0,
      usageCount: 1,
      lastUsedAt: Date.now(),
      createdAt: Date.now(),
      sourceExecutionIds: [recording.executionId],
      version: 1,
      qualityScore: successRate,
    };

    return template;
  }

  /**
   * buildNodeSkeletonsFromRecording — Derive DAG node skeletons from recorded events.
   */
  private buildNodeSkeletonsFromRecording(recording: ExecutionRecording): PlanNodeSkeleton[] {
    // Group actions by nodeId if available from DAG snapshots
    const nodeMap = new Map<string, Set<string>>();

    // Use DAG snapshots to identify unique nodes
    const seenNodeIds = new Set<string>();
    for (const snapshot of recording.dagSnapshots) {
      if (!seenNodeIds.has(snapshot.nodeId)) {
        seenNodeIds.add(snapshot.nodeId);
        nodeMap.set(snapshot.nodeId, new Set());
      }
    }

    // If no DAG snapshots, group by tool name as a heuristic
    if (nodeMap.size === 0) {
      for (const action of recording.actionLog) {
        const group = action.toolName;
        if (!nodeMap.has(group)) {
          nodeMap.set(group, new Set());
        }
        nodeMap.get(group)!.add(action.toolName);
      }
    }

    // Build skeletons from node groups
    const skeletons: PlanNodeSkeleton[] = [];
    for (const [nodeId, tools] of nodeMap) {
      skeletons.push({
        role: nodeId,
        domain: 'general',
        deps: [],
        expectedArtifacts: [...tools].map(t => `output_from_${t}`),
        optional: false,
      });
    }

    return skeletons;
  }

  // ═══════════════════════════════════════════════════════════════
  // Stats & Utility
  // ═══════════════════════════════════════════════════════════════

  /**
   * getStats — Aggregate statistics across all recordings.
   */
  async getStats(): Promise<{
    totalRecordings: number;
    avgDurationMs: number;
    avgThoughtCount: number;
    avgActionCount: number;
    totalErrors: number;
  }> {
    let totalRecordings = 0;
    let totalDurationMs = 0;
    let totalThoughts = 0;
    let totalActions = 0;
    let totalErrors = 0;

    // Count active recordings
    for (const rec of this.activeRecordings.values()) {
      totalRecordings++;
      if (rec.completedAt > 0) {
        totalDurationMs += rec.completedAt - rec.startedAt;
      }
      totalThoughts += rec.thoughtLog.length;
      totalActions += rec.actionLog.length;
      totalErrors += rec.observationLog.filter(o => o.isError).length;
    }

    // Scan disk-stored recordings
    try {
      const sessions = await fsp.readdir(this.config.storageDir);
      for (const session of sessions) {
        const sessionDir = path.join(this.config.storageDir, session);
        try {
          const files = await fsp.readdir(sessionDir);
          for (const file of files) {
            if (!file.endsWith('.json')) continue;
            totalRecordings++;
            try {
              const content = await fsp.readFile(path.join(sessionDir, file), 'utf-8');
              const rec = JSON.parse(content) as ExecutionRecording;
              if (rec.completedAt > 0) {
                totalDurationMs += rec.completedAt - rec.startedAt;
              }
              totalThoughts += rec.thoughtLog.length;
              totalActions += rec.actionLog.length;
              totalErrors += rec.observationLog.filter(o => o.isError).length;
            } catch {
              // Skip corrupt
            }
          }
        } catch {
          // Skip inaccessible
        }
      }
    } catch {
      // No storage directory
    }

    return {
      totalRecordings,
      avgDurationMs: totalRecordings > 0 ? Math.round(totalDurationMs / totalRecordings) : 0,
      avgThoughtCount: totalRecordings > 0 ? Math.round(totalThoughts / totalRecordings) : 0,
      avgActionCount: totalRecordings > 0 ? Math.round(totalActions / totalRecordings) : 0,
      totalErrors,
    };
  }

  /**
   * clearStaleRecordings — Remove recordings older than a specified age.
   *
   * @param maxAgeMs - Maximum age in milliseconds (default: 7 days)
   */
  async clearStaleRecordings(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    try {
      const sessions = await fsp.readdir(this.config.storageDir);
      for (const session of sessions) {
        const sessionDir = path.join(this.config.storageDir, session);
        try {
          const files = await fsp.readdir(sessionDir);
          for (const file of files) {
            if (!file.endsWith('.json')) continue;
            const filePath = path.join(sessionDir, file);
            try {
              const stat = await fsp.stat(filePath);
              if (stat.mtimeMs < cutoff) {
                await fsp.unlink(filePath);
                removed++;
              }
            } catch {
              // Skip
            }
          }
        } catch {
          // Skip
        }
      }
    } catch {
      // No storage directory
    }

    return removed;
  }

  /**
   * abortRecording — Abort and discard an in-progress recording without persisting.
   */
  abortRecording(recordingId: string): boolean {
    return this.activeRecordings.delete(recordingId);
  }
}
