/**
 * migrate.ts — JSONL → SQLite 迁移脚本
 *
 * 读取 31 个 JSONL 文件，解析后写入 MemoryWiki 的 SQLite 表。
 * 单向迁移：JSONL → SQLite（JSONL 文件保留，不删除）。
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { MemoryWiki } from './MemoryWiki.js';
import type { MigrationSource, MigrationResult, MemoryItem } from './types.js';

// ═══════════════════════════════════════════════════════════════
// 迁移源定义（JSONL 文件 → SQLite 表映射）
// ═══════════════════════════════════════════════════════════════

export function getMigrationSources(dataDir: string): MigrationSource[] {
  const resolveJsonl = (relativePath: string): string =>
    path.resolve(dataDir, relativePath);

  return [
    // ── Layer 2: 情节记忆 ──
    {
      path: resolveJsonl('planning/experiences/plan-records.jsonl'),
      table: 'plan_records',
      parser: (line: Record<string, unknown>) => ({
        id: (line.recordId ?? line.executionId ?? `rec_${Date.now()}`) as string,
        type: 'PlanRecord',
        name: (line.userInput as string)?.slice(0, 100) ?? 'unknown',
        data: {
          execution_id: line.executionId,
          task_id: line.taskId,
          round: line.round,
          user_input: line.userInput,
          input_tags: JSON.stringify(line.inputTags ?? []),
          s3_method: line.s3Method,
          s3_tokens_used: line.s3TokensUsed ?? 0,
          plan_score: line.planScore ?? line.score ?? 0,
          execution_success: line.executionSuccess ?? (line.success ? 1 : 0),
          duration_ms: line.executionDurationMs ?? line.totalDurationMs ?? 0,
          artifact_count: line.artifactCount ?? 0,
          created_at: line.createdAt,
        },
      }),
    },
    {
      path: resolveJsonl('planning/templates/plan-templates.jsonl'),
      table: 'plan_templates',
      parser: (line: Record<string, unknown>) => ({
        id: (line.templateId ?? `tpl_${Date.now()}`) as string,
        type: 'PlanTemplate',
        name: (line.name as string) ?? 'unknown',
        data: {
          tags: JSON.stringify(line.tags ?? []),
          success_rate: line.successRate ?? 0,
          usage_count: line.usageCount ?? 0,
          version: line.version ?? 1,
        },
      }),
    },
    {
      path: resolveJsonl('planning/template-lineages.jsonl'),
      table: 'template_lineages',
      parser: (line: Record<string, unknown>) => ({
        id: `tli_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'TemplateLineage',
        name: (line.templateId as string) ?? 'unknown',
        data: {
          template_id: line.templateId,
          parent_template_id: line.parentTemplateId,
          evolution_type: line.evolutionType,
          evolution_reason: line.evolutionReason,
          timestamp: line.timestamp,
        },
      }),
    },
    {
      path: resolveJsonl('history/tasks.jsonl'),
      table: 'history_records',
      parser: (line: Record<string, unknown>) => ({
        id: (line.id ?? `hist_${Date.now()}`) as string,
        type: 'HistoryRecord',
        name: (line.type as string) ?? 'task',
        data: {
          type: 'task',
          execution_id: line.executionId,
          task_id: line.taskId,
          data_json: JSON.stringify(line),
        },
      }),
    },
    // ── Layer 3: 程序记忆 ──
    {
      path: resolveJsonl('planning/traces/tool-quality.jsonl'),
      table: 'tool_quality',
      parser: (line: Record<string, unknown>) => ({
        id: (line.id ?? `tq_${Date.now()}`) as string,
        type: 'ToolQuality',
        name: (line.toolName as string) ?? 'unknown',
        data: {
          tool_name: line.toolName,
          call_success: line.success ? 1 : 0,
          latency_ms: line.latencyMs ?? 0,
          error_message: line.errorMessage,
          timestamp: line.timestamp,
        },
      }),
    },
    {
      path: resolveJsonl('planning/intelligence-state.jsonl'),
      table: 'intelligence_state',
      parser: (line: Record<string, unknown>) => ({
        id: 'singleton',
        type: 'IntelligenceState',
        name: 'learning_state',
        data: {
          execution_count: line.executionCount ?? 0,
          score_history: JSON.stringify(line.scoreHistory ?? []),
          weights_json: JSON.stringify(line.weights ?? {}),
          last_weight_tuning_at: line.lastWeightTuningAt,
          last_template_evolution_at: line.lastTemplateEvolutionAt,
        },
      }),
    },
    // ── Layer 5: 元记忆 ──
    {
      path: resolveJsonl('planning/errors.jsonl'),
      table: 'error_logs',
      parser: (line: Record<string, unknown>) => {
        const error = (line.error ?? line) as Record<string, unknown>;
        return {
          id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'ErrorLog',
          name: (error.errorMessage as string)?.slice(0, 100) ?? 'error',
          data: {
            session_id: line.sessionId,
            execution_id: line.executionId,
            node_id: error.nodeId,
            error_type: error.errorType ?? error.category,
            error_message: error.errorMessage ?? error.message,
            retry_count: error.retryCount ?? 0,
            healing_attempted: error.healingAttempted ? 1 : 0,
            healing_succeeded: error.healingSucceeded ? 1 : 0,
            timestamp: line.timestamp ?? Date.now(),
          },
        };
      },
    },
    {
      path: resolveJsonl('planning/error-reports.jsonl'),
      table: 'error_reports',
      parser: (line: Record<string, unknown>) => ({
        id: (line.id ?? `erpt_${Date.now()}`) as string,
        type: 'ErrorReport',
        name: `session_${line.sessionId}`,
        data: {
          session_id: line.sessionId,
          total_errors: line.totalErrors ?? 0,
          categories_json: JSON.stringify(line.categories ?? {}),
          root_cause: line.rootCause,
          suggestions_json: JSON.stringify(line.suggestions ?? []),
        },
      }),
    },
    {
      path: resolveJsonl('planning/traces/decision-traces.jsonl'),
      table: 'decision_traces',
      parser: (line: Record<string, unknown>) => ({
        id: (line.id ?? `dt_${Date.now()}`) as string,
        type: 'DecisionTrace',
        name: `exec_${line.executionId}`,
        data: {
          execution_id: line.executionId,
          winner_strategy: line.winnerStrategy ?? line.winner,
          winner_score: line.winnerScore,
          risk_appetite: line.riskAppetite,
        },
      }),
    },
    {
      path: resolveJsonl('planning/traces/deviation-traces.jsonl'),
      table: 'deviation_logs',
      parser: (line: Record<string, unknown>) => ({
        id: (line.id ?? `dev_${Date.now()}`) as string,
        type: 'DeviationLog',
        name: `session_${line.sessionId}`,
        data: {
          session_id: line.sessionId,
          execution_id: line.executionId,
          deviation_type: line.deviationType,
          count: line.count ?? 1,
          circuit_broken: line.circuitBroken ? 1 : 0,
          timestamp: line.timestamp,
        },
      }),
    },
  ];
}

// ═══════════════════════════════════════════════════════════════
// 迁移执行
// ═══════════════════════════════════════════════════════════════

export async function migrateJSONLtoSQLite(
  wiki: MemoryWiki,
  dataDir: string,
): Promise<MigrationResult[]> {
  const sources = getMigrationSources(dataDir);
  const results: MigrationResult[] = [];

  for (const source of sources) {
    const startTime = Date.now();
    const result: MigrationResult = {
      source: source.path,
      table: source.table,
      rowsRead: 0,
      rowsWritten: 0,
      errors: [],
      durationMs: 0,
    };

    try {
      const content = await fsp.readFile(source.path, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      result.rowsRead = lines.length;

      const items: MemoryItem[] = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          const item = source.parser(parsed);
          items.push(item);
          result.rowsWritten++;
        } catch (parseErr: unknown) {
          result.errors.push(`Parse error: ${(parseErr as Error).message}`);
        }
      }

      if (items.length > 0) {
        await wiki.rememberMany(items);
      }

      console.log(`  ✅ ${path.basename(source.path)}: ${result.rowsWritten}/${result.rowsRead} rows → ${source.table}`);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (msg.includes('ENOENT') || msg.includes('no such file')) {
        console.log(`  ⊘ ${path.basename(source.path)}: 文件不存在，跳过`);
      } else {
        result.errors.push(msg);
        console.log(`  ❌ ${path.basename(source.path)}: ${msg}`);
      }
    }

    result.durationMs = Date.now() - startTime;
    results.push(result);
  }

  return results;
}
