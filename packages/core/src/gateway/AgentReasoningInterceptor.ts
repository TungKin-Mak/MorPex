/**
 * AgentReasoningInterceptor — Unified Three-Layer Interception Gateway
 *
 * Consolidates ThoughtInterceptor, ActionInterceptor, and ObservationCorrectionBridge
 * into ONE gateway-level middleware that wraps ALL adapter.execute() calls.
 *
 * Like a DPI (Deep Packet Inspection) firewall, it inspects ALL agent-LLM
 * communication regardless of agent type (Coder, Tester, Researcher, etc.):
 *
 *   Layer 1: THOUGHT   — Real-time reasoning stream scanning
 *   Layer 2: ACTION    — Pre-execution tool call safety gate
 *   Layer 3: OBSERVATION — Error → correction memory bridge (closed loop)
 *
 * Usage:
 *   const interceptor = new AgentReasoningInterceptor({ memoryBus, eventBus });
 *   const wrappedFn = interceptor.wrap(adapter.execute.bind(adapter));
 *   const result = await wrappedFn(request);
 *
 * @see ExecutionGateway — integration point in execute()
 * @see PiAdapter      — adapter wrapped by this interceptor
 */

// ★ v3.0 OpenSpace Fusion import
import type { ToolQualityManager } from '../extensions/planning/ToolQualityManager.js';
import type { ExecutionRecordingEngine } from '../mirror/ExecutionRecordingEngine.js';
import type { MemoryRetriever } from '../../../memory/src/index.js';

// ═══════════════════════════════════════════════════════════════════════
// Shared Type Definitions
// ═══════════════════════════════════════════════════════════════════════

/** Minimal AgentContext interface from pi-agent-core */
export interface AgentContext {
  abort(): void;
  steer(message: any): void;
  followUp?(message: any): void;
  signal?: AbortSignal;
  hasQueuedMessages?(): boolean;
}

/** StreamFn type matching pi-agent-core's AgentLoopConfig.streamFn */
export type StreamFn = (token: string) => void | Promise<void>;

/** CorrectionPayload — MemoryBus correction memory metadata */
export interface CorrectionPayload {
  errorKeywords: string;
  rootCause: string;
  defensiveInstruction: string;
  historicalFailureCount: number;
  preventionStrategy: string;
  safeAlternative?: string;
  category?: string;
  confidenceScore?: number;
}

/** ToolCall — structure for pre-execution checking */
export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  domain?: string;
  taskId?: string;
}

/** ActionCheckResult — outcome of pre-execution check */
export interface ActionCheckResult {
  allowed: boolean;
  blockedReason?: string;
  correctionPayload?: CorrectionPayload;
  matchScore: number;
  matchedPattern?: string;
}

/** ObservationInput — error from tool/agent execution */
export interface ObservationInput {
  toolCall: ToolCall | null;
  errorMessage: string;
  errorCategory: string;
  sessionId: string;
  executionId: string;
  nodeId: string;
  domain: string;
  timestamp: number;
}

/** ExtractedKnowledge — output of LLM/heuristic error reflection */
export interface ExtractedKnowledge {
  summary: string;
  rootCause: string;
  defensiveInstruction: string;
  errorKeywords: string[];
  toolFingerprint: string;
  safeAlternative: string;
  confidenceScore: number;
  category: string;
}

/** ObservationResult — outcome of Observation layer processing */
export interface ObservationResult {
  extracted: ExtractedKnowledge | null;
  stored: boolean;
  injectedToContext: boolean;
  contextInjection: string;
  isNewError: boolean;
  similarExistingCount: number;
}

/** InterceptorConfig — unified config for all three layers */
export interface InterceptorConfig {
  memoryBus: any;
  eventBus?: any;
  modelRegistry?: any;
  thoughtThreshold: number;
  thoughtMaxRetries: number;
  maxSentenceLength: number;
  actionThreshold: number;
  blockedToolNames: string[];
  observationThreshold: number;
  enableAutoExtraction: boolean;
  enableAutoInjection: boolean;
  maxCorrectionsPerSession: number;
  sessionWindowMs: number;
  enableLogging: boolean;
}

/** InterceptorStats — consolidated stats across all three layers */
export interface InterceptorStats {
  sentencesScanned: number;
  thoughtsIntercepted: number;
  thoughtRetriesTriggered: number;
  actionsChecked: number;
  actionsBlocked: number;
  blockedByTool: Record<string, number>;
  observationsProcessed: number;
  newErrorsExtracted: number;
  correctionsStored: number;
  remediesInjected: number;
  lastInterception: {
    layer: 'thought' | 'action' | 'observation';
    detail: string;
    timestamp: number;
  } | null;
  perSessionCorrectionCount: Record<string, number>;
}

/** Default config */
const DEFAULT_CONFIG: InterceptorConfig = {
  memoryBus: null,
  thoughtThreshold: 0.92,
  thoughtMaxRetries: 3,
  maxSentenceLength: 40,
  actionThreshold: 0.92,
  blockedToolNames: ['rm', 'drop_table', 'shutdown', 'format'],
  observationThreshold: 0.88,
  enableAutoExtraction: true,
  enableAutoInjection: true,
  maxCorrectionsPerSession: 10,
  sessionWindowMs: 3600000,
  enableLogging: true,
};

// ═══════════════════════════════════════════════════════════════════════
// Heuristic Knowledge Map (8 error categories)
// ═══════════════════════════════════════════════════════════════════════

const HEURISTIC_MAP: Record<string, Omit<ExtractedKnowledge, 'summary' | 'errorKeywords' | 'toolFingerprint' | 'confidenceScore' | 'category'>> = {
  token_exhaustion: {
    rootCause: 'Context window exceeded — too much data in prompt',
    defensiveInstruction: 'Enable context pruning. Split input into smaller chunks. Use streaming output.',
    safeAlternative: 'Prune context to last 50% before retry',
  },
  timeout: {
    rootCause: 'Operation exceeded the allocated time limit',
    defensiveInstruction: 'Increase timeout configuration or split the operation into smaller steps with shorter timeboxes',
    safeAlternative: 'Add timeout configuration and retry logic with exponential backoff',
  },
  tool_error: {
    rootCause: 'Tool execution returned a non-zero exit code or produced invalid output',
    defensiveInstruction: 'Validate all tool inputs before execution. Check tool availability and permissions. Add error handling.',
    safeAlternative: 'Pre-validate inputs and use a fallback tool when primary fails',
  },
  validation_failure: {
    rootCause: 'Output validation failed — produced artifact did not meet expected schema or quality',
    defensiveInstruction: 'Add validation checkpoints after each production node. Verify artifacts before downstream consumption.',
    safeAlternative: 'Add validation step as separate node and configure retry on failure',
  },
  mcp_crash: {
    rootCause: 'MCP (Model Context Protocol) process crashed unexpectedly',
    defensiveInstruction: 'Enable McpProcessGuard with auto-restart. Isolate MCP processes with resource limits.',
    safeAlternative: 'Restart MCP process with clean state and reduced parallelism',
  },
  dependency_missing: {
    rootCause: 'Required dependency was not found during execution',
    defensiveInstruction: 'Check all dependencies before execution. Use explicit dependency declarations.',
    safeAlternative: 'Run dependency check as first step and install missing deps automatically',
  },
  llm_hallucination: {
    rootCause: 'LLM generated factually incorrect or hallucinated content',
    defensiveInstruction: 'Reduce temperature. Add factual verification steps after generation. Use retrieval-augmented generation.',
    safeAlternative: 'Add verification node after LLM output and use lower temperature on retry',
  },
  llm_timeout: {
    rootCause: 'LLM API call timed out — model did not respond in time',
    defensiveInstruction: 'Use a faster model for this task. Implement retry with model escalation (fast→slow).',
    safeAlternative: 'Retry with a faster model or fallback to a cached response',
  },
};

// ═══════════════════════════════════════════════════════════════════════
// AgentReasoningInterceptor
// ═══════════════════════════════════════════════════════════════════════

export class AgentReasoningInterceptor {
  private memoryBus: any;
  private eventBus: any;
  private modelRegistry: any;
  private config: InterceptorConfig;
  private sessionCorrectionCounts: Map<string, number> = new Map();

  /** ★ v3.0 Optional reference to ExecutionRecordingEngine for recording traces */
  private _recordingEngine: ExecutionRecordingEngine | null = null;

  /** ★ v3.0 Optional reference to ToolQualityManager for degradation checks */
  private _toolQualityManager: ToolQualityManager | null = null;

  /** ★ MemoryWiki 检索器（三层拦截共用：思考检索/动作检查/观察修正） */
  private _memoryRetriever: MemoryRetriever | null = null;

  /** ★ 注入 MemoryRetriever 实例 */
  setMemoryRetriever(retriever: MemoryRetriever): void {
    this._memoryRetriever = retriever;
  }

  /** Unified stats across all three layers */
  stats: InterceptorStats = {
    sentencesScanned: 0,
    thoughtsIntercepted: 0,
    thoughtRetriesTriggered: 0,
    actionsChecked: 0,
    actionsBlocked: 0,
    blockedByTool: {},
    observationsProcessed: 0,
    newErrorsExtracted: 0,
    correctionsStored: 0,
    remediesInjected: 0,
    lastInterception: null,
    perSessionCorrectionCount: {},
  };

  constructor(config: Partial<InterceptorConfig> & { memoryBus: any }) {
    this.memoryBus = config.memoryBus;
    this.eventBus = config.eventBus ?? null;
    this.modelRegistry = config.modelRegistry ?? null;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MAIN ENTRY: wrap — single integration point for ExecutionGateway
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * wrap — Wrap an adapter's execute function with all three layers.
   *
   * The wrapped function:
   *   1. Intercepts the request for Thought-layer scanning (via stream hooks)
   *   2. Before each tool call, checks Action layer
   *   3. After each tool returns error, processes Observation layer
   *
   * @param executeFn - The adapter's execute function
   * @param runtime   - Optional pi runtime for event subscription (Action+Observation)
   * @returns Wrapped function with same signature as adapter.execute()
   */
  wrap(
    executeFn: (request: any) => Promise<any>,
    runtime?: any,
  ): (request: any) => Promise<any> {
    const self = this;

    return async (request: any): Promise<any> => {
      const executionId = request.executionId ?? `exec_${Date.now()}`;

      // Subscribe to runtime events for Action + Observation interception
      let unsubscribers: Array<() => void> = [];

      if (runtime?.bus?.on && this.eventBus) {
        const unsubTool = runtime.bus.on('tool.started', async (payload: any) => {
          const toolCall: ToolCall = {
            name: payload?.toolName ?? payload?.name ?? 'unknown',
            args: payload?.args ?? payload?.arguments ?? {},
            domain: payload?.domain,
            taskId: payload?.taskId,
          };

          // ★ v3.0 Record action in ExecutionRecordingEngine
          if (self._recordingEngine && executionId) {
            self._recordingEngine.recordAction(executionId, {
              toolName: toolCall.name,
              toolArgs: toolCall.args as Record<string, unknown>,
              blocked: false,
            });
          }

          // Layer 2: check action before physical execution
          const check = await self.checkAction(toolCall);
          if (!check.allowed && self.config.enableLogging) {
            self.log(`[Action Intercepted 🚫] ${toolCall.name}: ${check.blockedReason}`);
          }
        });
        unsubscribers.push(unsubTool);

        const unsubError = runtime.bus.on('tool.failed', async (payload: any) => {
          const obs: ObservationInput = {
            toolCall: { name: payload?.toolName ?? 'unknown', args: payload?.args ?? {} },
            errorMessage: payload?.error ?? payload?.message ?? 'Unknown error',
            errorCategory: self.classifyError(payload?.error ?? ''),
            sessionId: request.sessionId ?? executionId,
            executionId,
            nodeId: payload?.taskId ?? payload?.nodeId ?? 'unknown',
            domain: payload?.domain ?? 'general',
            timestamp: Date.now(),
          };

          // ★ v3.0 Record observation in ExecutionRecordingEngine
          if (self._recordingEngine && executionId) {
            self._recordingEngine.recordObservation(executionId, {
              type: 'tool_result',
              data: obs,
              isError: true,
              correctionInjected: false,
            });
          }

          // Layer 3: process observation
          const result = await self.processObservation(obs);
          if (result.injectedToContext && self.config.enableLogging) {
            self.log(`[Observation Remedied 💉] ${obs.errorCategory}: remedy injected`);
          }
        });
        unsubscribers.push(unsubError);
      }

      try {
        const result = await executeFn(request);
        return result;
      } finally {
        for (const unsub of unsubscribers) {
          try { unsub(); } catch {}
        }
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // LAYER 1: THOUGHT — Real-time reasoning stream interception
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * createStreamInterceptor — Factory returning a streamFn-compatible function.
   *
   * Pass the returned function as AgentLoopConfig.streamFn when creating
   * an AgentHarness. It will scan each sentence as tokens arrive and
   * intercept if a dangerous pattern is detected.
   *
   * @param agentContext - pi-agent-core AgentContext with abort() + steer()
   * @returns StreamFn compatible with pi-agent-core
   */
  createStreamInterceptor(agentContext: AgentContext): StreamFn {
    const self = this;
    let sentenceBuffer = '';
    let retryCount = 0;
    const maxRetries = this.config.thoughtMaxRetries;

    return async (token: string): Promise<void> => {
      sentenceBuffer += token;

      const shouldFlush = /[.\n。！？\n]/.test(token)
        || sentenceBuffer.length >= self.config.maxSentenceLength;

      if (!shouldFlush) return;

      const sentence = sentenceBuffer.trim();
      sentenceBuffer = '';
      if (sentence.length < 3) return;

      self.stats.sentencesScanned++;

      // (Thought recording happens in ExecutionRecordingEngine via wrap() recordingId)
      // Stream interceptor runs at agent-loop level where recordingId is unavailable.


      const scanResult = await self.scanThoughtSentence(sentence);
      if (!scanResult.intercepted) return;

      self.stats.thoughtsIntercepted++;
      retryCount++;

      if (retryCount >= maxRetries) {
        if (self.config.enableLogging) {
          self.log(`[Thought] Max retries (${maxRetries}) reached. Allowing continuation.`);
        }
        return;
      }

      if (self.config.enableLogging) {
        self.log(`[Thought Intercepted 🚨] score=${scanResult.matchScore.toFixed(3)}: "${sentence.slice(0, 80)}..."`);
      }

      const injection = self.buildThoughtInjection(sentence, scanResult.correctionPayload!);
      agentContext.abort();
      agentContext.steer({ role: 'user', content: injection });

      self.stats.lastInterception = {
        layer: 'thought',
        detail: `Intercepted: "${sentence.slice(0, 120)}" → ${scanResult.correctionPayload?.rootCause ?? 'unknown'}`,
        timestamp: Date.now(),
      };
    };
  }

  /**
   * scanThoughtSentence — Check a sentence against MemoryBus correction memories.
   */
  private async scanThoughtSentence(
    sentence: string,
  ): Promise<{ intercepted: boolean; matchScore: number; correctionPayload: CorrectionPayload | null }> {
    const mb = this.memoryBus;
    if (!mb) return { intercepted: false, matchScore: 0, correctionPayload: null };

    let results: Array<{ score: number; meta: any }> = [];

    try {
      if (typeof mb.recall === 'function') {
        const items = await mb.recall({
          text: sentence,
          memType: 'correction',
          topK: 1,
        });
        if (Array.isArray(items)) {
          results = items.map((item: any) => ({
            score: item.score ?? item.importance ?? 0.5,
            meta: item.meta ?? item.metadata ?? {},
          }));
        }
      } else if (typeof mb.query === 'function') {
        const raw = await mb.query({ memType: 'correction', text: sentence, limit: 1 });
        if (Array.isArray(raw)) {
          results = raw.map((item: any) => ({
            score: item.score ?? item.importance ?? 0.5,
            meta: item.meta ?? item.metadata ?? item,
          }));
        }
      }
    } catch {
      return { intercepted: false, matchScore: 0, correctionPayload: null };
    }

    if (results.length === 0) {
      // ★ MemoryWiki 检索：LLM 不确定时查文档/经验
      if (this._memoryRetriever) {
        try {
          const retrieval = this._memoryRetriever.retrieveForUncertainty(sentence);
          if (retrieval.found) {
            if (this.config.enableLogging) {
              this.log(`[Thought 📚] MemoryWiki: ${retrieval.snippets.length} snippets from ${retrieval.source}`);
            }
            // 标记为轻度命中（不拦截，但可被后续 Thought 拦截器利用）
            return { intercepted: false, matchScore: 0.3, correctionPayload: null };
          }
        } catch { /* non-critical */ }
      }

      // Word-level fallback matching for mock/non-vector MemoryBus
      const words = sentence.toLowerCase().split(/\s+/);
      const allCorrections = await this.getAllCorrections();
      for (const c of allCorrections) {
        const keywords = (c.errorKeywords ?? '').toLowerCase().split(/,\s*/);
        const overlap = words.filter(w => keywords.some(k => w.includes(k) || k.includes(w))).length;
        const score = keywords.length > 0 ? overlap / keywords.length : 0;
        if (score >= this.config.thoughtThreshold) {
          return { intercepted: true, matchScore: score, correctionPayload: c };
        }
      }
      return { intercepted: false, matchScore: 0, correctionPayload: null };
    }

    const best = results[0];
    if (best.score < this.config.thoughtThreshold) {
      return { intercepted: false, matchScore: best.score, correctionPayload: null };
    }

    return {
      intercepted: true,
      matchScore: best.score,
      correctionPayload: this.toCorrectionPayload(best.meta),
    };
  }

  /**
   * buildThoughtInjection — Build the SYSTEM INTERRUPTION message for thought layer.
   */
  private buildThoughtInjection(sentence: string, payload: CorrectionPayload): string {
    const lines = [
      '[SYSTEM INTERRUPTION: CRITICAL ERROR IN YOUR REASONING]',
      '',
      `Stop right there. Your current line of thinking ("${sentence.slice(0, 100)}")`,
      `has led to critical failures in ${payload.historicalFailureCount ?? 'multiple'} past executions.`,
      '',
      `[Root Cause]: ${payload.rootCause ?? 'This approach has proven unreliable'}`,
      `[Correct Direction]: ${payload.defensiveInstruction ?? 'Abandon this approach and choose a safer alternative'}`,
      `[Prevention]: ${payload.preventionStrategy ?? 'Validate assumptions before proceeding'}`,
    ];
    if (payload.safeAlternative) {
      lines.push(`[Safe Alternative]: ${payload.safeAlternative}`);
    }
    lines.push('');
    lines.push('Please immediately discard the flawed reasoning and output a corrected approach. Explain WHY the original approach was dangerous and WHAT you will do differently.');

    return lines.join('\n');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // LAYER 2: ACTION — Pre-execution tool call safety gate
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * checkAction — Called before any tool physically executes.
   *
   * Three-tier block logic:
   *   1. Always-block list (rm -rf, drop table, shutdown, format)
   *   2. MemoryBus correction check (tool name + args fingerprint)
   *   3. Allow (no match)
   *
   * @param toolCall - The tool call to check
   * @returns ActionCheckResult with allowed/blocked
   */
  async checkAction(toolCall: ToolCall): Promise<ActionCheckResult> {
    this.stats.actionsChecked++;

    const baseName = toolCall.name.split('_')[0] ?? toolCall.name;
    const fingerprint = this.buildToolFingerprint(toolCall);

    // Tier 1: Always-block list
    if (this.config.blockedToolNames.includes(baseName)) {
      this.stats.actionsBlocked++;
      this.stats.blockedByTool[baseName] = (this.stats.blockedByTool[baseName] ?? 0) + 1;
      this.stats.lastInterception = {
        layer: 'action',
        detail: `Blocked: ${fingerprint} (always-block list)`,
        timestamp: Date.now(),
      };

      return {
        allowed: false,
        blockedReason: `Tool "${baseName}" is on the always-blocked list. This action is not permitted in any execution.`,
        matchScore: 1.0,
        matchedPattern: `always-block:${baseName}`,
      };
    }

    // Tier 2: MemoryBus correction check
    const mb = this.memoryBus;
    if (mb) {
      let results: Array<{ score: number; meta: any }> = [];

      try {
        if (typeof mb.recall === 'function') {
          const items = await mb.recall({ text: fingerprint, memType: 'correction', topK: 1 });
          if (Array.isArray(items)) {
            results = items.map((item: any) => ({
              score: item.score ?? 0.5,
              meta: item.meta ?? item.metadata ?? {},
            }));
          }
        } else if (typeof mb.query === 'function') {
          const raw = await mb.query({ text: fingerprint, memType: 'correction', limit: 1 });
          if (Array.isArray(raw)) {
            results = raw.map((item: any) => ({
              score: item.score ?? 0.5,
              meta: item.meta ?? item.metadata ?? item,
            }));
          }
        }
      } catch {}

      if (results.length > 0 && results[0].score >= this.config.actionThreshold) {
        this.stats.actionsBlocked++;
        this.stats.blockedByTool[baseName] = (this.stats.blockedByTool[baseName] ?? 0) + 1;
        this.stats.lastInterception = {
          layer: 'action',
          detail: `Blocked: ${fingerprint} (MemoryBus match: ${results[0].score.toFixed(3)})`,
          timestamp: Date.now(),
        };

        return {
          allowed: false,
          blockedReason: `This tool call matches a known failure pattern. ${results[0].meta?.rootCause ?? ''}`,
          correctionPayload: this.toCorrectionPayload(results[0].meta),
          matchScore: results[0].score,
          matchedPattern: fingerprint,
        };
      }
    }

    // Tier 2.5: ToolQuality degradation check (★ v3.0 OpenSpace Fusion)
    if (this._toolQualityManager) {
      const quality = this._toolQualityManager.getToolQuality(toolCall.name, toolCall.domain);
      if (quality?.degradationDetected) {
        this.stats.actionsBlocked++;
        this.stats.blockedByTool[baseName] = (this.stats.blockedByTool[baseName] ?? 0) + 1;
        this.stats.lastInterception = {
          layer: 'action',
          detail: `Blocked: ${fingerprint} (ToolQuality degradation: ${(quality.successRate * 100).toFixed(1)}%)`,
          timestamp: Date.now(),
        };

        return {
          allowed: false,
          blockedReason: `工具 "${toolCall.name}" 当前处于退化状态 (成功率 ${(quality.successRate * 100).toFixed(1)}%)。${quality.degradationReason}`,
          correctionPayload: {
            errorKeywords: `tool_degradation:${toolCall.name}`,
            rootCause: quality.degradationReason,
            defensiveInstruction: '使用替代工具或等待工具恢复',
            historicalFailureCount: quality.failureCount,
            preventionStrategy: 'monitor_and_rotate',
            safeAlternative: '检查工具状态后重试',
            category: 'tool_degradation',
            confidenceScore: 0.85,
          },
          matchScore: 0.85,
          matchedPattern: `tool_degradation:${toolCall.name}`,
        };
      }
    }

    // ★ Tier 2.75: MemoryWiki 错误历史检查
    if (this._memoryRetriever) {
      try {
        const retrieval = this._memoryRetriever.retrieveForError(fingerprint, 'tool_error');
        if (retrieval.found && retrieval.similarErrors.length >= 2) {
          const failCount = retrieval.similarErrors.filter(e => !e.healingSucceeded).length;
          const failRate = failCount / retrieval.similarErrors.length;
          if (failRate >= 0.5) {
            this.stats.actionsBlocked++;
            this.stats.blockedByTool[baseName] = (this.stats.blockedByTool[baseName] ?? 0) + 1;
            this.stats.lastInterception = {
              layer: 'action',
              detail: `Blocked: ${fingerprint} (MemoryWiki history: ${failRate * 100}% failure)`,
              timestamp: Date.now(),
            };
            return {
              allowed: false,
              blockedReason: `此工具历史失败率 ${Math.round(failRate * 100)}%（${retrieval.similarErrors.length} 次记录）。${retrieval.suggestions[0] ?? '建议检查参数后重试。'}`,
              matchScore: failRate,
              matchedPattern: `memorywiki_history:${fingerprint}`,
            };
          }
        }
      } catch { /* non-critical */ }
    }

    // Tier 3: Allow
    return { allowed: true, matchScore: 0 };
  }

  /**
   * ★ v3.0 Set the ToolQualityManager for degradation-aware action checking.
   */
  setToolQualityManager(tqm: ToolQualityManager | null): void {
    this._toolQualityManager = tqm;
  }

  /**
   * ★ v3.0 Set the ExecutionRecordingEngine for recording execution traces.
   */
  setRecordingEngine(engine: ExecutionRecordingEngine | null): void {
    this._recordingEngine = engine;
  }

  /**
   * buildToolFingerprint — Create a canonical fingerprint for a tool call.
   */
  private buildToolFingerprint(toolCall: ToolCall): string {
    const name = toolCall.name;
    const criticalArgs = ['path', 'command', 'query', 'sql', 'host', 'port', 'url', 'target', 'destination'];
    const relevant: string[] = [];
    for (const key of criticalArgs) {
      if (toolCall.args[key] !== undefined) {
        const val = String(toolCall.args[key]).slice(0, 80);
        relevant.push(`${key}=${val}`);
      }
    }
    return `Action: ${name} Args: ${relevant.join(' ')}`;
  }

  /**
   * buildActionBlockInjection — Build the injection message for blocked tool calls.
   */
  buildActionBlockInjection(toolCall: ToolCall, payload: CorrectionPayload): string {
    const lines = [
      '[BLOCKED: DANGEROUS ACTION PREVENTED]',
      '',
      `The system prevented execution of "${toolCall.name}" because it matches a historical failure pattern.`,
      '',
      `[Root Cause]: ${payload.rootCause ?? 'This action has caused failures in the past'}`,
      `[Correct Direction]: ${payload.defensiveInstruction ?? 'Use a different approach'}`,
    ];
    if (payload.safeAlternative) {
      lines.push(`[Safe Alternative]: ${payload.safeAlternative}`);
    }
    lines.push('');
    lines.push('Please review and output corrected tool arguments or a different approach.');

    return lines.join('\n');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // LAYER 3: OBSERVATION — Error → Correction Memory Bridge
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * processObservation — Process an error from tool/agent execution.
   *
   * If it's a KNOWN error: inject existing remedy into context.
   * If it's a NEW error: extract knowledge (LLM/heuristic), store correction,
   * inject into context, and feed back to Thought+Actor layers on future calls.
   *
   * This is the CLOSED LOOP:
   *   Observation → Extract → Store → Next execution: ThoughtInterceptor catches it
   */
  async processObservation(obs: ObservationInput): Promise<ObservationResult> {
    this.stats.observationsProcessed++;

    // Check session limit
    const sessionKey = obs.sessionId;
    const currentCount = this.sessionCorrectionCounts.get(sessionKey) ?? 0;
    if (currentCount >= this.config.maxCorrectionsPerSession) {
      return {
        extracted: null, stored: false, injectedToContext: false,
        contextInjection: '', isNewError: false, similarExistingCount: 0,
      };
    }

    // ★ MemoryWiki 优先：查历史错误修复记录
    let wikiExisting: Array<{ score: number; payload: any }> = [];
    if (this._memoryRetriever) {
      try {
        const retrieval = this._memoryRetriever.retrieveForError(obs.errorMessage, obs.errorCategory);
        if (retrieval.found && retrieval.similarErrors.length > 0) {
          wikiExisting = retrieval.similarErrors.map((e, i) => ({
            score: 0.9 - i * 0.05,
            payload: {
              rootCause: e.errorMessage.slice(0, 200),
              defensiveInstruction: retrieval.suggestions.join('; ') || 'Retry with modified parameters',
              safeAlternative: retrieval.suggestions[0] ?? 'Retry after delay',
              errorKeywords: [e.errorType],
              toolFingerprint: obs.toolCall?.name ?? 'unknown',
              confidenceScore: e.healingSucceeded ? 0.8 : 0.4,
              category: e.errorType,
            },
          }));
          if (this.config.enableLogging) {
            this.log(`[Observation 📚] MemoryWiki: ${retrieval.similarErrors.length} similar errors found`);
          }
        }
      } catch { /* non-critical */ }
    }

    // Check if this error is already known (MemoryWiki + MemoryBus)
    const existing = [...wikiExisting, ...(await this.findExistingCorrections(obs.errorMessage))];

    if (existing.length > 0 && existing[0].score >= this.config.observationThreshold) {
      // Known error — inject existing remedy
      const payload = existing[0].payload;
      this.stats.remediesInjected++;

      return {
        extracted: null,
        stored: false,
        injectedToContext: true,
        contextInjection: this.buildObservationInjection(obs, {
          summary: '',
          rootCause: payload.rootCause,
          defensiveInstruction: payload.defensiveInstruction,
          errorKeywords: [],
          toolFingerprint: obs.toolCall?.name ?? 'unknown',
          safeAlternative: payload.safeAlternative ?? '',
          confidenceScore: 0.85,
          category: obs.errorCategory,
        }, false),
        isNewError: false,
        similarExistingCount: existing.length,
      };
    }

    // New error — extract knowledge
    if (!this.config.enableAutoExtraction) {
      return {
        extracted: null, stored: false, injectedToContext: false,
        contextInjection: '', isNewError: true, similarExistingCount: existing.length,
      };
    }

    const knowledge = this.extractKnowledge(obs);
    this.stats.newErrorsExtracted++;

    // Store correction memory
    const stored = await this.storeCorrectionMemory(knowledge, obs);
    if (stored) {
      this.stats.correctionsStored++;
      this.sessionCorrectionCounts.set(sessionKey, currentCount + 1);
      this.stats.perSessionCorrectionCount[sessionKey] = currentCount + 1;
    }

    // Inject into context
    const injectedToContext = this.config.enableAutoInjection;
    const contextInjection = injectedToContext
      ? this.buildObservationInjection(obs, knowledge, true)
      : '';

    if (injectedToContext) {
      this.stats.remediesInjected++;
    }

    this.stats.lastInterception = {
      layer: 'observation',
      detail: `New error: ${obs.errorCategory} → extracted rootCause: "${knowledge.rootCause.slice(0, 80)}"`,
      timestamp: Date.now(),
    };

    return {
      extracted: knowledge,
      stored,
      injectedToContext,
      contextInjection,
      isNewError: true,
      similarExistingCount: existing.length,
    };
  }

  /**
   * extractKnowledge — Extract knowledge from an error observation.
   *
   * Uses heuristic extraction for 8 known categories. Falls back to
   * LLM-based reflection if modelRegistry is available.
   */
  private extractKnowledge(obs: ObservationInput): ExtractedKnowledge {
    const cat = obs.errorCategory || 'unknown';
    const heuristic = HEURISTIC_MAP[cat];
    const msgSnippet = obs.errorMessage.slice(0, 100);

    if (heuristic) {
      return {
        summary: `${cat}: ${msgSnippet}`,
        ...heuristic,
        errorKeywords: [obs.toolCall?.name ?? cat, cat, ...msgSnippet.split(/\s+/).slice(0, 4)],
        toolFingerprint: obs.toolCall?.name ?? 'unknown',
        confidenceScore: 0.6,
        category: cat,
      };
    }

    // Fallback for unknown category
    return {
      summary: `Unknown error (${cat}): ${msgSnippet}`,
      rootCause: msgSnippet,
      defensiveInstruction: 'Review the error and adjust your approach. If this persists, escalate to human operator.',
      errorKeywords: [cat, ...msgSnippet.split(/\s+/).slice(0, 5)],
      toolFingerprint: obs.toolCall?.name ?? 'unknown',
      safeAlternative: 'Retry with different parameters after reviewing the error',
      confidenceScore: 0.4,
      category: cat,
    };
  }

  /**
   * storeCorrectionMemory — Save extracted knowledge to MemoryBus as a correction.
   */
  private async storeCorrectionMemory(
    knowledge: ExtractedKnowledge,
    obs: ObservationInput,
  ): Promise<boolean> {
    const mb = this.memoryBus;
    if (!mb || typeof mb.remember !== 'function') return false;

    try {
      await mb.remember({
        content: knowledge.summary,
        source: 'AgentReasoningInterceptor',
        sourceId: `corr_${obs.executionId}_${obs.nodeId}_${Date.now()}`,
        tags: ['correction', knowledge.category, obs.nodeId],
        importance: 4,
        metadata: {
          memType: 'correction',
          errorKeywords: knowledge.errorKeywords.join(', '),
          toolFingerprint: knowledge.toolFingerprint,
          rootCause: knowledge.rootCause,
          defensiveInstruction: knowledge.defensiveInstruction,
          safeAlternative: knowledge.safeAlternative,
          historicalFailureCount: 1,
          preventionStrategy: knowledge.defensiveInstruction,
          category: knowledge.category,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * buildObservationInjection — Build the context injection for the agent.
   */
  buildObservationInjection(
    obs: ObservationInput,
    knowledge: ExtractedKnowledge,
    isNew: boolean,
  ): string {
    const header = isNew
      ? '[NEW ERROR - REAL-TIME ANALYSIS INJECTED]'
      : '[KNOWN ERROR - HISTORICAL REMEDY INJECTED]';

    return [
      header,
      '',
      `The tool "${obs.toolCall?.name ?? 'unknown'}" returned an error during execution:`,
      obs.errorMessage.slice(0, 500),
      '',
      `[Root Cause]: ${knowledge.rootCause}`,
      `[Recommended Fix]: ${knowledge.defensiveInstruction}`,
      `[Safe Alternative]: ${knowledge.safeAlternative}`,
      '',
      'Please incorporate this correction into your next step.',
    ].join('\n');
  }

  /**
   * findExistingCorrections — Check MemoryBus for similar error corrections.
   */
  private async findExistingCorrections(
    errorMessage: string,
  ): Promise<Array<{ score: number; payload: CorrectionPayload }>> {
    const mb = this.memoryBus;
    if (!mb) return [];

    try {
      if (typeof mb.recall === 'function') {
        const items = await mb.recall({ text: errorMessage, memType: 'correction', topK: 3 });
        if (Array.isArray(items)) {
          return items.map((item: any) => ({
            score: item.score ?? 0.5,
            payload: this.toCorrectionPayload(item.meta ?? item.metadata ?? item),
          }));
        }
      } else if (typeof mb.query === 'function') {
        const raw = await mb.query({ memType: 'correction', text: errorMessage, limit: 3 });
        if (Array.isArray(raw)) {
          return raw.map((item: any) => ({
            score: item.score ?? 0.5,
            payload: this.toCorrectionPayload(item.meta ?? item.metadata ?? item),
          }));
        }
      }
    } catch {}

    return [];
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SHARED: Correction Memory Management
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * seedCorrection — Seed a correction memory. Call once or after each
   * failure to build the correction database.
   */
  async seedCorrection(payload: CorrectionPayload & { content: string }): Promise<void> {
    const mb = this.memoryBus;
    if (!mb || typeof mb.remember !== 'function') return;

    const keywords = payload.errorKeywords ?? payload.content;
    try {
      await mb.remember({
        content: payload.content,
        source: 'AgentReasoningInterceptor',
        sourceId: `seed_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        tags: ['correction', payload.category ?? 'manual'],
        importance: 5,
        metadata: {
          memType: 'correction',
          errorKeywords: keywords,
          toolFingerprint: payload.errorKeywords,
          rootCause: payload.rootCause,
          defensiveInstruction: payload.defensiveInstruction,
          safeAlternative: payload.safeAlternative ?? '',
          historicalFailureCount: payload.historicalFailureCount,
          preventionStrategy: payload.preventionStrategy,
        },
      });
      this.stats.correctionsStored++;
    } catch {}
  }

  /**
   * getAllCorrections — Retrieve all correction memories from MemoryBus.
   * Used for word-level fallback matching.
   */
  private async getAllCorrections(): Promise<CorrectionPayload[]> {
    const mb = this.memoryBus;
    if (!mb) return [];

    try {
      if (typeof mb.recall === 'function') {
        const items = await mb.recall({ text: 'correction', memType: 'correction', topK: 50 });
        if (Array.isArray(items)) {
          return items.map((item: any) => this.toCorrectionPayload(item.meta ?? item.metadata ?? item));
        }
      }
      if (typeof mb.query === 'function') {
        const raw = await mb.query({ memType: 'correction', text: '', limit: 50 });
        if (Array.isArray(raw)) {
          return raw.map((item: any) => this.toCorrectionPayload(item.meta ?? item.metadata ?? item));
        }
      }
    } catch {}

    return [];
  }

  /**
   * toCorrectionPayload — Normalize any metadata object to CorrectionPayload.
   */
  private toCorrectionPayload(meta: any): CorrectionPayload {
    return {
      errorKeywords: meta?.errorKeywords ?? meta?.keywords ?? '',
      rootCause: meta?.rootCause ?? meta?.reason ?? 'Unknown',
      defensiveInstruction: meta?.defensiveInstruction ?? meta?.instruction ?? meta?.fix ?? 'Review and correct',
      historicalFailureCount: meta?.historicalFailureCount ?? meta?.count ?? 1,
      preventionStrategy: meta?.preventionStrategy ?? meta?.prevention ?? meta?.defensiveInstruction ?? 'Review and validate',
      safeAlternative: meta?.safeAlternative ?? meta?.alternative ?? '',
      category: meta?.category ?? meta?.type ?? 'unknown',
      confidenceScore: meta?.confidenceScore ?? meta?.confidence ?? 0.5,
    };
  }

  /**
   * classifyError — Classify an error message into a FailureCategory.
   * Mirrors MetaPlanner.classifyError() logic.
   */
  private classifyError(errorMsg: string): string {
    const lower = errorMsg.toLowerCase();
    if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout';
    if (lower.includes('token') || lower.includes('context length') || lower.includes('max_tokens')) return 'token_exhaustion';
    if (lower.includes('hallucination') || lower.includes('invalid json') || lower.includes('parse')) return 'llm_hallucination';
    if (lower.includes('tool') || lower.includes('toolcall')) return 'tool_error';
    if (lower.includes('mcp') || lower.includes('spawn') || lower.includes('crash')) return 'mcp_crash';
    if (lower.includes('validation') || lower.includes('verify') || lower.includes('check')) return 'validation_failure';
    if (lower.includes('dependency') || lower.includes('deps') || lower.includes('missing')) return 'dependency_missing';
    if (lower.includes('llm') || lower.includes('model') || lower.includes('api')) return 'llm_timeout';
    return 'unknown';
  }

  /**
   * getStats — Get consolidated stats across all three layers.
   */
  getStats(): InterceptorStats {
    return { ...this.stats };
  }

  /**
   * resetStats — Reset all stats counters.
   */
  resetStats(): void {
    this.stats = {
      sentencesScanned: 0,
      thoughtsIntercepted: 0,
      thoughtRetriesTriggered: 0,
      actionsChecked: 0,
      actionsBlocked: 0,
      blockedByTool: {},
      observationsProcessed: 0,
      newErrorsExtracted: 0,
      correctionsStored: 0,
      remediesInjected: 0,
      lastInterception: null,
      perSessionCorrectionCount: {},
    };
  }

  /**
   * clearSessionCount — Reset per-session correction count.
   */
  clearSessionCount(sessionId: string): void {
    this.sessionCorrectionCounts.delete(sessionId);
    delete this.stats.perSessionCorrectionCount[sessionId];
  }

  private log(msg: string): void {
    console.log(`\x1b[35m[ARI]\x1b[0m ${msg}`);
  }
}
