/**
 * Negotiation Engine — 质询工单生命周期管理 (Phase 11.5 + 3.3)
 *
 * 核心理念：领域间不能是无序的口水战。
 * 通过 InterrogationTicket（质询工单）实现结构化协商，
 * 通过 FSM Hook 实现目标 Agent 的中断挂起与上下文注入，
 * 通过深度限制和资产哈希防止死循环。
 *
 * Phase 3.3 新增：
 *   - 震荡熔断：MAX_ALIGN_ROUNDS=3 耗尽后自动升级仲裁
 *   - LLM 生成仲裁建议
 *   - ArbitrationPrompt 接口
 *
 * 协商流程：
 *   发起质询 → 目标回应 → 接受/反驳/升级
 *       ↑                        │
 *       └──────── 反驳 ──────────←┘
 *       (depth_count ≤ MAX_DEPTH)
 *
 * 防死循环四闸门：
 *   1. 深度硬限制 (MAX_ALIGN_ROUNDS = 3)
 *   2. 资产快照比对 (Context Hash Check)
 *   3. 全局限流（每对领域最多 1 个活跃工单）
 *   4. 语义震荡熔断 → 自动升级为中央仲裁（REQUIRE_USER_CONFIRM）
 */

import type {
  InterrogationTicket,
  TicketStatus,
  ConflictType,
  TicketRound,
} from '../domains/types.js';
import { LLMProvider } from '../services/LLMProvider.js';
import { extractJson } from '../utils/extractJson.js';

/** 创建质询工单参数 */
export interface CreateTicketParams {
  source_domain: string;
  target_domain: string;
  trigger_artifact_id: string;
  conflict_type: ConflictType;
  reason: string;
  suggestion: string;
  context_snapshot?: Record<string, any>;
}

/** 协商引擎配置 */
export interface NegotiationEngineConfig {
  /** 最大协商深度（默认 3） */
  maxDepth?: number;
  /** 每对领域最大活跃工单数（默认 1） */
  maxActivePerPair?: number;
}

/** 质询事件回调 */
export interface NegotiationCallbacks {
  onTicketCreated?: (ticket: InterrogationTicket) => void;
  onTicketUpdated?: (ticket: InterrogationTicket) => void;
  onEscalated?: (ticket: InterrogationTicket) => void;
  onResolved?: (ticket: InterrogationTicket) => void;
}

/** 领域立场 */
export interface DomainPosition {
  domain: string;
  stance: string;
  keyArguments: string[];
  constraints: string[];
  proposedSolution?: string;
}

/** 仲裁提示 (Phase 3.3) */
export interface ArbitrationPrompt {
  ticketId: string;
  conflict: string;
  positionA: DomainPosition;
  positionB: DomainPosition;
  rounds: number;
  suggestions: string[];
}

/**
 * NegotiationEngine — 质询工单生命周期管理
 */
export class NegotiationEngine {
  private tickets: Map<string, InterrogationTicket> = new Map();
  private artifactHashHistory: Map<string, Set<string>> = new Map();
  private activePairs: Set<string> = new Set(); // "source->target" 格式
  private config: Required<NegotiationEngineConfig>;
  private callbacks: NegotiationCallbacks;
  private llmCaller?: (prompt: string) => Promise<string>;

  static readonly MAX_DEPTH = 3;

  constructor(
    config?: NegotiationEngineConfig,
    callbacks?: NegotiationCallbacks,
    llmCaller?: (prompt: string) => Promise<string>,
  ) {
    this.config = {
      maxDepth: config?.maxDepth ?? NegotiationEngine.MAX_DEPTH,
      maxActivePerPair: config?.maxActivePerPair ?? 1,
    };
    this.callbacks = callbacks ?? {};
    this.llmCaller = llmCaller;
  }

  // ═══════════════════════════════════════════════════════════════
  // 工单生命周期
  // ═══════════════════════════════════════════════════════════════

  /**
   * createTicket — 发起质询
   */
  createTicket(params: CreateTicketParams): InterrogationTicket {
    const pairKey = `${params.source_domain}->${params.target_domain}`;

    if (this.activePairs.has(pairKey)) {
      throw new Error(
        `[NegotiationEngine] 全局限流: ${pairKey} 之间已有活跃工单`,
      );
    }

    const artifactHash = this.computeHash(params.trigger_artifact_id, params.reason);
    if (this.isDuplicateChallenge(params.trigger_artifact_id, artifactHash)) {
      throw new Error(
        `[NegotiationEngine] 重复质询: ${params.trigger_artifact_id} 已被相同内容质询过`,
      );
    }

    const ticket: InterrogationTicket = {
      ticket_id: `tk_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
      status: 'PENDING',
      source_domain: params.source_domain,
      target_domain: params.target_domain,
      trigger_artifact_id: params.trigger_artifact_id,
      conflict_type: params.conflict_type,
      reason: params.reason,
      suggestion: params.suggestion,
      context_snapshot: params.context_snapshot ?? {},
      depth_count: 1,
      artifact_hash: artifactHash,
      history: [{
        round: 1,
        from_domain: params.source_domain,
        action: 'initiate',
        message: params.reason,
        timestamp: Date.now(),
      }],
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    this.tickets.set(ticket.ticket_id, ticket);
    this.activePairs.add(pairKey);
    this.recordHash(params.trigger_artifact_id, artifactHash);

    this.callbacks.onTicketCreated?.(ticket);
    return ticket;
  }

  /**
   * respond — 目标领域回应质询
   */
  respond(
    ticketId: string,
    action: TicketRound['action'],
    message: string,
  ): InterrogationTicket {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) {
      throw new Error(`[NegotiationEngine] 工单 ${ticketId} 不存在`);
    }

    if (ticket.status === 'ACCEPTED' || ticket.status === 'REJECTED' || ticket.status === 'ESCALATED') {
      throw new Error(`[NegotiationEngine] 工单 ${ticketId} 已关闭 (${ticket.status})`);
    }

    switch (action) {
      case 'accept':
        return this.handleAccept(ticket, message);
      case 'reject':
        return this.handleReject(ticket, message);
      case 'argue':
        return this.handleArgue(ticket, message);
      case 'escalate':
        return this.handleEscalate(ticket, message);
      default:
        throw new Error(`[NegotiationEngine] 未知动作: ${action}`);
    }
  }

  /**
   * getTicket — 获取工单
   */
  getTicket(ticketId: string): InterrogationTicket | undefined {
    return this.tickets.get(ticketId);
  }

  /**
   * getActiveTickets — 获取所有活跃工单
   */
  getActiveTickets(): InterrogationTicket[] {
    return [...this.tickets.values()].filter(
      t => t.status === 'PENDING' || t.status === 'ARGUING',
    );
  }

  /**
   * getTicketsByDomain — 获取某个领域相关的所有工单
   */
  getTicketsByDomain(domainId: string): InterrogationTicket[] {
    return [...this.tickets.values()].filter(
      t => t.source_domain === domainId || t.target_domain === domainId,
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // 防死循环检测
  // ═══════════════════════════════════════════════════════════════

  /**
   * shouldEscalate — 检查是否需要熔断升级
   */
  shouldEscalate(ticket: InterrogationTicket): boolean {
    if (ticket.depth_count > this.config.maxDepth) return true;
    if (this.isDuplicateChallenge(ticket.trigger_artifact_id, ticket.artifact_hash)) return true;
    return false;
  }

  isDuplicateChallenge(artifactId: string, hash: string): boolean {
    const seen = this.artifactHashHistory.get(artifactId);
    return seen?.has(hash) ?? false;
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase 3.3: 震荡熔断与仲裁升级
  // ═══════════════════════════════════════════════════════════════

  /**
   * escalateToArbitration — 协商深度耗尽后触发仲裁
   *
   * 1. 提取双方立场
   * 2. 调用 LLM 生成建议方案
   * 3. 触发 onEscalated 回调
   */
  async escalateToArbitration(ticket: InterrogationTicket): Promise<ArbitrationPrompt> {
    const rounds = ticket.history.filter(r => r.action === 'argue');
    const positionA = this.extractDomainPosition(ticket.source_domain, rounds);
    const positionB = this.extractDomainPosition(ticket.target_domain, rounds);

    // 确保工单状态为 ESCALATED
    if (ticket.status !== 'ESCALATED') {
      this.handleEscalate(ticket, '协商深度超过限制，自动升级为仲裁');
    }

    // 生成建议
    let suggestions: string[];
    try {
      suggestions = await this.generateSuggestions(ticket, positionA, positionB);
    } catch (err) {
      console.warn('[NegotiationEngine] LLM 仲裁建议生成失败:', err.message);
      suggestions = ['建议双方重新评估各自立场，寻找折中方案。'];
    }

    const arbPrompt: ArbitrationPrompt = {
      ticketId: ticket.ticket_id,
      conflict: ticket.reason,
      positionA,
      positionB,
      rounds: ticket.depth_count,
      suggestions,
    };

    // 触发升级回调
    this.callbacks.onEscalated?.(ticket);

    return arbPrompt;
  }

  // ═══════════════════════════════════════════════════════════════
  // 统计
  // ═══════════════════════════════════════════════════════════════

  getStats(): {
    totalTickets: number;
    activeTickets: number;
    escalatedTickets: number;
    resolvedTickets: number;
    activePairs: number;
  } {
    const all = [...this.tickets.values()];
    return {
      totalTickets: all.length,
      activeTickets: all.filter(t => t.status === 'PENDING' || t.status === 'ARGUING').length,
      escalatedTickets: all.filter(t => t.status === 'ESCALATED').length,
      resolvedTickets: all.filter(t => t.status === 'ACCEPTED' || t.status === 'REJECTED').length,
      activePairs: this.activePairs.size,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  private handleAccept(ticket: InterrogationTicket, message: string): InterrogationTicket {
    ticket.status = 'ACCEPTED';
    ticket.history.push({
      round: ticket.depth_count + 1,
      from_domain: ticket.target_domain,
      action: 'accept',
      message,
      timestamp: Date.now(),
    });
    ticket.updated_at = Date.now();
    this.releasePair(ticket);
    this.callbacks.onTicketUpdated?.(ticket);
    this.callbacks.onResolved?.(ticket);
    return ticket;
  }

  private handleReject(ticket: InterrogationTicket, message: string): InterrogationTicket {
    ticket.status = 'REJECTED';
    ticket.history.push({
      round: ticket.depth_count + 1,
      from_domain: ticket.target_domain,
      action: 'reject',
      message,
      timestamp: Date.now(),
    });
    ticket.updated_at = Date.now();
    this.releasePair(ticket);
    this.callbacks.onTicketUpdated?.(ticket);
    this.callbacks.onResolved?.(ticket);
    return ticket;
  }

  private handleArgue(ticket: InterrogationTicket, message: string): InterrogationTicket {
    ticket.depth_count++;
    ticket.status = 'ARGUING';
    ticket.history.push({
      round: ticket.depth_count,
      from_domain: ticket.target_domain,
      action: 'argue',
      message,
      artifact_hash: ticket.artifact_hash,
      timestamp: Date.now(),
    });
    ticket.updated_at = Date.now();

    if (ticket.depth_count > this.config.maxDepth) {
      return this.handleEscalate(ticket, `协商深度超过限制(${this.config.maxDepth})，自动升级`);
    }

    this.callbacks.onTicketUpdated?.(ticket);
    return ticket;
  }

  private handleEscalate(ticket: InterrogationTicket, message: string): InterrogationTicket {
    ticket.status = 'ESCALATED';
    ticket.history.push({
      round: ticket.depth_count,
      from_domain: ticket.target_domain,
      action: 'escalate',
      message,
      timestamp: Date.now(),
    });
    ticket.updated_at = Date.now();
    this.releasePair(ticket);
    this.callbacks.onTicketUpdated?.(ticket);
    this.callbacks.onEscalated?.(ticket);
    return ticket;
  }

  private releasePair(ticket: InterrogationTicket): void {
    const pairKey = `${ticket.source_domain}->${ticket.target_domain}`;
    this.activePairs.delete(pairKey);
  }

  /**
   * extractDomainPosition — 从协商历史中提取领域立场
   */
  private extractDomainPosition(domainId: string, rounds: TicketRound[]): DomainPosition {
    const domainRounds = rounds.filter(r => r.from_domain === domainId);
    const keyArguments = domainRounds.map(r => r.message);
    const lastMessage = domainRounds[domainRounds.length - 1];

    return {
      domain: domainId,
      stance: lastMessage?.message ?? '未明确表态',
      keyArguments: keyArguments.length > 0 ? keyArguments : ['无具体论述'],
      constraints: [],
    };
  }

  /**
   * generateSuggestions — 使用 LLM 生成仲裁建议
   */
  private async generateSuggestions(
    ticket: InterrogationTicket,
    positionA: DomainPosition,
    positionB: DomainPosition,
  ): Promise<string[]> {
    const caller = this.llmCaller ?? LLMProvider.get();
    const prompt = `你是一个技术仲裁专家。请分析以下领域间的冲突，给出 2-3 个可行的解决方案建议。

冲突原因: ${ticket.reason}
冲突类型: ${ticket.conflict_type}
当前轮次: ${ticket.depth_count}

甲方 (${positionA.domain}):
  立场: ${positionA.stance}
  关键论述: ${positionA.keyArguments.join('; ')}

乙方 (${positionB.domain}):
  立场: ${positionB.stance}
  关键论述: ${positionB.keyArguments.join('; ')}

请输出 JSON 数组格式的建议:
["方案1: ...", "方案2: ...", "方案3: ..."]`;

    try {
      const raw = await caller(prompt);
      const json = extractJson(raw);
      if (json) {
        const parsed = JSON.parse(json);
        if (Array.isArray(parsed)) return parsed.filter(s => typeof s === 'string');
      }
    } catch {
      // fallback below
    }

    return [
      `方案一: 优先满足 ${positionA.domain} 的核心需求，${positionB.domain} 做出相应调整`,
      `方案二: 引入第三方领域进行技术评估和仲裁`,
      `方案三: 需要用户确认 — REQUIRE_USER_CONFIRM`,
    ];
  }

  private computeHash(artifactId: string, reason: string): string {
    const str = `${artifactId}:${reason}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }

  private recordHash(artifactId: string, hash: string): void {
    if (!this.artifactHashHistory.has(artifactId)) {
      this.artifactHashHistory.set(artifactId, new Set());
    }
    this.artifactHashHistory.get(artifactId)!.add(hash);
  }
}
