/**
 * ArbitrationHandler — 仲裁处理器 (Phase 11.5)
 *
 * 当质询工单升级到 ESCALATED 状态时，
 * 仲裁处理器负责：
 *   1. 停止相关 DAG 执行
 *   2. 向前端推送 human.interrogation_escalated 事件
 *   3. 等待人类裁决
 *   4. 将裁决结果回注到相关领域
 */

import type { InterrogationTicket } from '../domains/types.js';

/** 仲裁裁决 */
export interface ArbitrationVerdict {
  ticket_id: string;
  verdict: 'accept_source' | 'accept_target' | 'modify_both' | 'override';
  reason: string;
  instructions: string;
  decided_by: 'human' | 'auto_escalation';
  decided_at: number;
}

/** 仲裁回调 */
export interface ArbitrationCallbacks {
  /** 向前端推送仲裁事件 */
  onEscalated?: (ticket: InterrogationTicket) => void;
  /** 仲裁完成后的处理 */
  onVerdictReached?: (verdict: ArbitrationVerdict, ticket: InterrogationTicket) => void;
}

/**
 * ArbitrationHandler — 仲裁处理器
 */
export class ArbitrationHandler {
  private pendingArbitrations: Map<string, { ticket: InterrogationTicket; promise: Promise<ArbitrationVerdict>; resolve: (v: ArbitrationVerdict) => void }> = new Map();
  private callbacks: ArbitrationCallbacks;

  constructor(callbacks?: ArbitrationCallbacks) {
    this.callbacks = callbacks ?? {};
  }

  /**
   * escalate — 升级质询到仲裁
   *
   * 返回一个 Promise，当人类做出裁决时 resolve。
   *
   * @param ticket - 已升级的质询工单
   * @returns Promise<ArbitrationVerdict> - 人类裁决结果
   */
  escalate(ticket: InterrogationTicket): Promise<ArbitrationVerdict> {
    // 创建可外部 resolve 的 Promise
    let resolveFn: (v: ArbitrationVerdict) => void;
    const promise = new Promise<ArbitrationVerdict>((resolve) => {
      resolveFn = resolve;
    });

    this.pendingArbitrations.set(ticket.ticket_id, {
      ticket,
      promise,
      resolve: resolveFn!,
    });

    // 触发回调（向前端推送）
    this.callbacks.onEscalated?.(ticket);

    console.log(`[ArbitrationHandler] 🚨 仲裁升级: ${ticket.ticket_id}`);
    console.log(`  ├─ 发起方: ${ticket.source_domain}`);
    console.log(`  ├─ 目标方: ${ticket.target_domain}`);
    console.log(`  ├─ 冲突: ${ticket.conflict_type}`);
    console.log(`  ├─ 理由: ${ticket.reason}`);
    console.log(`  └─ 建议: ${ticket.suggestion}`);

    return promise;
  }

  /**
   * resolve — 人类做出裁决
   *
   * @param ticketId - 工单 ID
   * @param verdict - 裁决结果
   */
  resolve(ticketId: string, verdict: Omit<ArbitrationVerdict, 'ticket_id' | 'decided_at' | 'decided_by'>): boolean {
    const pending = this.pendingArbitrations.get(ticketId);
    if (!pending) {
      console.warn(`[ArbitrationHandler] 工单 ${ticketId} 不在等待仲裁列表`);
      return false;
    }

    const fullVerdict: ArbitrationVerdict = {
      ...verdict,
      ticket_id: ticketId,
      decided_by: 'human',
      decided_at: Date.now(),
    };

    pending.resolve(fullVerdict);
    this.pendingArbitrations.delete(ticketId);

    this.callbacks.onVerdictReached?.(fullVerdict, pending.ticket);
    console.log(`[ArbitrationHandler] ✅ 仲裁完成: ${ticketId} → ${verdict.verdict}`);

    return true;
  }

  /**
   * autoResolve — 自动裁决（超时或系统决策）
   *
   * @param ticketId - 工单 ID
   * @param verdict - 自动裁决结果
   */
  autoResolve(ticketId: string, verdict: Omit<ArbitrationVerdict, 'ticket_id' | 'decided_at' | 'decided_by'>): boolean {
    const pending = this.pendingArbitrations.get(ticketId);
    if (!pending) return false;

    const fullVerdict: ArbitrationVerdict = {
      ...verdict,
      ticket_id: ticketId,
      decided_by: 'auto_escalation',
      decided_at: Date.now(),
    };

    pending.resolve(fullVerdict);
    this.pendingArbitrations.delete(ticketId);

    this.callbacks.onVerdictReached?.(fullVerdict, pending.ticket);
    console.log(`[ArbitrationHandler] 🤖 自动裁决: ${ticketId} → ${verdict.verdict}`);

    return true;
  }

  /**
   * getPendingArbitrations — 获取所有待仲裁的工单
   */
  getPendingArbitrations(): Array<{ ticket: InterrogationTicket }> {
    return [...this.pendingArbitrations.values()].map(p => ({
      ticket: p.ticket,
    }));
  }

  /**
   * getPendingCount — 获取待仲裁数量
   */
  get pendingCount(): number {
    return this.pendingArbitrations.size;
  }
}
