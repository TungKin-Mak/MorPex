/**
 * ToolQualityManager — Per-tool quality tracking with degradation detection
 *
 * OpenSpace Fusion: Phase 1 — Tool Quality Manager
 *
 * Monitors tool call success/failure per-tool, detects quality degradation
 * using sliding window analysis, and triggers automatic recovery actions.
 *
 * Integration points:
 *   - DomainDispatcher.executeDAG() → recordToolCall() after each node execution
 *   - AgentReasoningInterceptor.checkAction() → query degraded tools before execution
 *   - TemplateEvolutionEngine.fixTemplate() → triggered on degradation alert
 *
 * @see upgrade-plan-openspace-fusion.md §3
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { JSONLWriter } from '../../../../memory/src/index.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

/**
 * ToolQualityRecord — Per-tool quality snapshot
 */
export interface ToolQualityRecord {
  /** Tool name (e.g. "write_file", "exec", "model_train") */
  toolName: string;
  /** Domain scope */
  domain: string;
  /** Total call count */
  totalCalls: number;
  /** Successful calls */
  successCount: number;
  /** Failed calls */
  failureCount: number;
  /** Computed success rate (0-1) */
  successRate: number;
  /** Last successful call timestamp */
  lastSuccessAt: number;
  /** Last failure timestamp */
  lastFailureAt: number;
  /** Average latency (ms), exponential moving average */
  avgLatencyMs: number;
  /** Whether degradation is currently detected */
  degradationDetected: boolean;
  /** Reason for degradation */
  degradationReason: string;
  /** Sliding window of recent call results (true=success) */
  recentSuccessWindow: boolean[];
}

/**
 * DegradationAlert — Payload emitted when degradation is detected
 */
export interface DegradationAlert {
  toolName: string;
  domain: string;
  historicalRate: number;
  recentRate: number;
  dropPercent: number;
  detectedAt: number;
  severity: 'warning' | 'critical';
  suggestedAction: 'fix_template' | 'disable_tool' | 'increase_timeout';
}

/**
 * ToolQualityConfig — Configuration for ToolQualityManager
 */
export interface ToolQualityConfig {
  /** Sliding window size (number of recent calls to track) */
  degradationWindowSize: number;
  /**
   * Degradation threshold: degradation triggers when
   * recentSuccessRate < historicalSuccessRate × threshold
   */
  degradationThreshold: number;
  /** Minimum calls before degradation detection activates */
  minCallsForDegradationCheck: number;
  /** Auto-fix: whether to trigger template repair on degradation */
  autoFixOnDegradation: boolean;
  /** JSONL persistence path */
  storePath: string;
  /** Maximum records per-file before rotation */
  maxRecordsPerFile: number;
}

/**
 * DEFAULT_TOOL_QUALITY_CONFIG — Sensible defaults
 */
export const DEFAULT_TOOL_QUALITY_CONFIG: ToolQualityConfig = {
  degradationWindowSize: 20,
  degradationThreshold: 0.7,
  minCallsForDegradationCheck: 10,
  autoFixOnDegradation: true,
  storePath: './data/planning/tool-quality.jsonl',
  maxRecordsPerFile: 10000,
};

// ═══════════════════════════════════════════════════════════════
// ToolQualityManager
// ═══════════════════════════════════════════════════════════════

export class ToolQualityManager {
  private records: Map<string, ToolQualityRecord> = new Map();
  private config: ToolQualityConfig;
  private onDegradation: ((alert: DegradationAlert) => Promise<void>) | null = null;
  private jsonlWriter: JSONLWriter | null = null;

  /** ★ MemoryWiki 持久化 */
  private wiki: MemoryWiki | null = null;

  constructor(config?: Partial<ToolQualityConfig>) {
    this.config = { ...DEFAULT_TOOL_QUALITY_CONFIG, ...config };
  }

  /** ★ MemoryWiki 注入 */
  setWiki(wiki: MemoryWiki): void {
    this.wiki = wiki;
  }

  // ═══════════════════════════════════════════════════════════════
  // Core: recordToolCall
  // ═══════════════════════════════════════════════════════════════

  /**
   * recordToolCall — Record a tool call result.
   *
   * Updates sliding window, recalculates metrics, and checks for degradation.
   * Should be called by DomainDispatcher after each DAG node execution.
   *
   * @param toolName - Name of the tool
   * @param domain   - Domain of the tool
   * @param success  - Whether the call succeeded
   * @param latencyMs - Call latency in milliseconds
   */
  recordToolCall(
    toolName: string,
    domain: string,
    success: boolean,
    latencyMs: number,
  ): void {
    const key = this.buildKey(toolName, domain);
    let record = this.records.get(key);

    if (!record) {
      record = this.createRecord(toolName, domain);
      this.records.set(key, record);
    }

    // Update counters
    record.totalCalls++;
    if (success) {
      record.successCount++;
      record.lastSuccessAt = Date.now();
    } else {
      record.failureCount++;
      record.lastFailureAt = Date.now();
    }

    // Update success rate (recalculate)
    record.successRate = record.totalCalls > 0
      ? record.successCount / record.totalCalls
      : 1.0;

    // Update latency (exponential moving average, α=0.2)
    record.avgLatencyMs = record.avgLatencyMs === 0
      ? latencyMs
      : record.avgLatencyMs * 0.8 + latencyMs * 0.2;

    // Update sliding window
    record.recentSuccessWindow.push(success);
    if (record.recentSuccessWindow.length > this.config.degradationWindowSize) {
      record.recentSuccessWindow.shift();
    }

    // Check for degradation
    if (record.totalCalls >= this.config.minCallsForDegradationCheck) {
      this.checkDegradation(key, record);
    }

    // ★ MemoryWiki 持久化
    if (this.wiki?.ready) {
      this.wiki.remember({
        id: `tq_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        type: 'ToolQuality',
        name: toolName,
        data: {
          tool_name: toolName,
          call_success: success ? 1 : 0,
          latency_ms: latencyMs,
          error_message: null,
          degradation_alert: 0,
          timestamp: Date.now(),
        },
      }).catch(() => {});
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Degradation Detection
  // ═══════════════════════════════════════════════════════════════

  /**
   * checkDegradation — Detect if a tool's quality has degraded.
   *
   * Degradation condition:
   *   recentWindowSuccessRate < historicalSuccessRate × degradationThreshold
   *
   * Example:
   *   historicalRate = 0.90, threshold = 0.7
   *   recentRate = 0.60 < 0.90 × 0.7 = 0.63 → DEGRADATION!
   */
  private checkDegradation(key: string, record: ToolQualityRecord): void {
    const historicalRate = record.successRate;
    const windowSize = record.recentSuccessWindow.length;
    const recentSuccesses = record.recentSuccessWindow.filter(Boolean).length;
    const recentRate = windowSize > 0 ? recentSuccesses / windowSize : 1.0;

    const threshold = historicalRate * this.config.degradationThreshold;

    const isDegraded = recentRate < threshold;
    const wasDegraded = record.degradationDetected;

    if (isDegraded && !wasDegraded) {
      // New degradation detected
      record.degradationDetected = true;
      record.degradationReason =
        `Recent ${windowSize} calls: ${(recentRate * 100).toFixed(1)}% ` +
        `< global ${(historicalRate * 100).toFixed(1)}% × ${this.config.degradationThreshold} ` +
        `= ${(threshold * 100).toFixed(1)}%`;

      const alert: DegradationAlert = {
        toolName: record.toolName,
        domain: record.domain,
        historicalRate,
        recentRate,
        dropPercent: historicalRate > 0
          ? (historicalRate - recentRate) / historicalRate
          : 0,
        detectedAt: Date.now(),
        severity: recentRate < threshold * 0.5 ? 'critical' : 'warning',
        suggestedAction: this.suggestAction(record),
      };

      console.warn(
        `[ToolQuality] ⚠️ Degradation detected: ${key}\n` +
        `  Historical: ${(historicalRate * 100).toFixed(1)}%  ` +
        `Recent: ${(recentRate * 100).toFixed(1)}%\n` +
        `  Severity: ${alert.severity}  Action: ${alert.suggestedAction}`
      );

      // Fire callback for auto-fix
      if (this.config.autoFixOnDegradation && this.onDegradation) {
        this.onDegradation(alert).catch(err =>
          console.error(`[ToolQuality] Auto-fix failed:`, err)
        );
      }

    } else if (!isDegraded && wasDegraded) {
      // Recovery detected
      record.degradationDetected = false;
      record.degradationReason = '';
      console.log(
        `[ToolQuality] ✅ Tool recovered: ${key} ` +
        `(recent ${(recentRate * 100).toFixed(1)}% >= threshold ${(threshold * 100).toFixed(1)}%)`
      );
    }
  }

  /**
   * suggestAction — Determine the best action based on failure patterns.
   */
  private suggestAction(record: ToolQualityRecord): DegradationAlert['suggestedAction'] {
    // High latency → increase timeout
    if (record.avgLatencyMs > 30000) return 'increase_timeout';

    // Mostly failures → disable tool
    if (record.recentSuccessWindow.filter(Boolean).length < 3) return 'disable_tool';

    // General degradation → fix template
    return 'fix_template';
  }

  // ═══════════════════════════════════════════════════════════════
  // Query Methods
  // ═══════════════════════════════════════════════════════════════

  /**
   * getAllQuality — Get all tool quality records, sorted by success rate ascending.
   */
  getAllQuality(): ToolQualityRecord[] {
    return [...this.records.values()]
      .sort((a, b) => a.successRate - b.successRate);
  }

  /**
   * getDegradedTools — Get all tools currently in degradation state.
   */
  getDegradedTools(): ToolQualityRecord[] {
    return this.getAllQuality().filter(r => r.degradationDetected);
  }

  /**
   * getToolQuality — Get quality record for a specific tool.
   *
   * @param toolName - Tool name
   * @param domain   - Optional domain filter. If omitted, searches across all domains.
   */
  getToolQuality(toolName: string, domain?: string): ToolQualityRecord | null {
    if (domain) {
      return this.records.get(this.buildKey(toolName, domain)) ?? null;
    }
    // Cross-domain search
    for (const record of this.records.values()) {
      if (record.toolName === toolName) return record;
    }
    return null;
  }

  /**
   * isToolDegraded — Quick check if a tool is currently degraded.
   */
  isToolDegraded(toolName: string, domain?: string): boolean {
    const record = this.getToolQuality(toolName, domain);
    return record !== null && record.degradationDetected;
  }

  // ═══════════════════════════════════════════════════════════════
  // Callback Registration
  // ═══════════════════════════════════════════════════════════════

  /**
   * onDegradationDetected — Register callback for degradation alerts.
   *
   * Used by TemplateEvolutionEngine to auto-fix templates when a tool degrades.
   *
   * @param callback - Async callback receiving DegradationAlert
   */
  onDegradationDetected(callback: (alert: DegradationAlert) => Promise<void>): void {
    this.onDegradation = callback;
  }

  // ═══════════════════════════════════════════════════════════════
  // Persistence
  // ═══════════════════════════════════════════════════════════════

  /**
   * persist — Append current snapshots to JSONL store.
   *
   * Each record is serialized as a JSON line with computed properties
   * explicitly included (since TypeScript getters are not serialized).
   */
  async persist(): Promise<void> {
    const dir = path.dirname(this.config.storePath);
    await fsp.mkdir(dir, { recursive: true });

    const lines = [...this.records.values()].map(r => JSON.stringify({
      toolName: r.toolName,
      domain: r.domain,
      totalCalls: r.totalCalls,
      successCount: r.successCount,
      failureCount: r.failureCount,
      successRate: r.successRate,
      lastSuccessAt: r.lastSuccessAt,
      lastFailureAt: r.lastFailureAt,
      avgLatencyMs: r.avgLatencyMs,
      degradationDetected: r.degradationDetected,
      degradationReason: r.degradationReason,
      recentSuccessWindow: r.recentSuccessWindow,
      persistedAt: Date.now(),
    }));

    // 微批处理写入（JSONLWriter 缓冲 500ms/50行）
    if (!this.jsonlWriter) {
      this.jsonlWriter = new JSONLWriter({ filePath: this.config.storePath });
    }
    for (const r of rotatedRecords) {
      this.jsonlWriter.append(r);
    }

    // Check file size and rotate if needed
    await this.maybeRotate();
  }

  /**
   * load — Load quality records from JSONL store.
   */
  async load(): Promise<void> {
    try {
      const content = await fsp.readFile(this.config.storePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      // Only load the last N records (most recent snapshots)
      const relevantLines = lines.slice(-this.config.maxRecordsPerFile);

      for (const line of relevantLines) {
        try {
          const data = JSON.parse(line);
          if (data.toolName && data.domain) {
            const key = this.buildKey(data.toolName, data.domain);
            // Only keep if never seen, or update if more recent
            if (!this.records.has(key)) {
              this.records.set(key, {
                toolName: data.toolName,
                domain: data.domain,
                totalCalls: data.totalCalls ?? 0,
                successCount: data.successCount ?? 0,
                failureCount: data.failureCount ?? 0,
                successRate: data.successRate ?? 1.0,
                lastSuccessAt: data.lastSuccessAt ?? 0,
                lastFailureAt: data.lastFailureAt ?? 0,
                avgLatencyMs: data.avgLatencyMs ?? 0,
                degradationDetected: data.degradationDetected ?? false,
                degradationReason: data.degradationReason ?? '',
                recentSuccessWindow: data.recentSuccessWindow ?? [],
              });
            }
          }
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // File does not exist yet, start fresh
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Stats & Reset
  // ═══════════════════════════════════════════════════════════════

  /**
   * getStats — Get aggregate statistics across all tools.
   */
  getStats(): {
    totalTools: number;
    degradedTools: number;
    totalCalls: number;
    overallSuccessRate: number;
  } {
    const all = [...this.records.values()];
    const totalCalls = all.reduce((s, r) => s + r.totalCalls, 0);
    const totalSuccess = all.reduce((s, r) => s + r.successCount, 0);
    return {
      totalTools: all.length,
      degradedTools: all.filter(r => r.degradationDetected).length,
      totalCalls,
      overallSuccessRate: totalCalls > 0 ? totalSuccess / totalCalls : 1.0,
    };
  }

  /**
   * reset — Reset all sliding windows and degradation flags.
   *
   * Keeps the records but clears transient state.
   */
  reset(): void {
    for (const record of this.records.values()) {
      record.recentSuccessWindow = [];
      record.degradationDetected = false;
      record.degradationReason = '';
    }
  }

  /**
   * clear — Remove all records.
   */
  clear(): void {
    this.records.clear();
  }

  // ═══════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════

  private buildKey(toolName: string, domain: string): string {
    return `${domain}:${toolName}`;
  }

  private createRecord(toolName: string, domain: string): ToolQualityRecord {
    return {
      toolName,
      domain,
      totalCalls: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 1.0,
      lastSuccessAt: 0,
      lastFailureAt: 0,
      avgLatencyMs: 0,
      degradationDetected: false,
      degradationReason: '',
      recentSuccessWindow: [],
    };
  }

  private async maybeRotate(): Promise<void> {
    try {
      const stat = await fsp.stat(this.config.storePath);
      if (stat.size > 10 * 1024 * 1024) {
        // Rotate: rename current → archived with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const dir = path.dirname(this.config.storePath);
        const base = path.basename(this.config.storePath, '.jsonl');
        await fsp.rename(
          this.config.storePath,
          path.join(dir, `${base}-${timestamp}.jsonl`),
        );
        console.log(`[ToolQuality] Rotated store → ${base}-${timestamp}.jsonl`);
      }
    } catch {
      // Rotation is best-effort
    }
  }
}
