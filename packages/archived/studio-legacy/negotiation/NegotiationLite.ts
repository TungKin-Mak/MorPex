/**
 * NegotiationLite — 精简版协商模块
 *
 * Phase 3 / 智能与适配层
 *
 * 替代原有的完整 NegotiationEngine（多轮 Ticket 升级、全局限流），
 * 只保留：
 *   1. 创建协商工单（描述 + 参与方）
 *   2. 快速决策（approve / reject）
 *   3. 无多轮升级
 *
 * 完整 NegotiationEngine 仍然可用（如需要），NegotiationLite
 * 提供更轻量的替代选择。
 *
 * 使用方式：
 *   const negotiator = new NegotiationLite();
 *   const ticket = negotiator.createTicket('资源冲突', ['dept-a', 'dept-b']);
 *   negotiator.resolve(ticket.id, 'approve', 'ceo-1');
 */

export type LiteTicketStatus = 'open' | 'approved' | 'rejected';
export type Resolution = 'approve' | 'reject';

export interface LiteTicket {
  id: string;
  description: string;
  participants: string[];
  status: LiteTicketStatus;
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
  resolution?: Resolution;
}

export class NegotiationLite {
  private tickets: Map<string, LiteTicket> = new Map();
  private counter = 0;

  createTicket(description: string, participants: string[]): LiteTicket {
    const id = `ticket_${++this.counter}_${Date.now()}`;
    const ticket: LiteTicket = {
      id,
      description,
      participants,
      status: 'open',
      createdAt: Date.now(),
    };
    this.tickets.set(id, ticket);
    return ticket;
  }

  resolve(ticketId: string, resolution: Resolution, resolvedBy: string): boolean {
    const ticket = this.tickets.get(ticketId);
    if (!ticket || ticket.status !== 'open') return false;
    ticket.status = resolution === 'approve' ? 'approved' : 'rejected';
    ticket.resolvedAt = Date.now();
    ticket.resolvedBy = resolvedBy;
    ticket.resolution = resolution;
    return true;
  }

  getTicket(ticketId: string): LiteTicket | undefined {
    return this.tickets.get(ticketId);
  }

  listOpenTickets(): LiteTicket[] {
    return [...this.tickets.values()].filter(t => t.status === 'open');
  }

  listTickets(status?: LiteTicketStatus): LiteTicket[] {
    return status
      ? [...this.tickets.values()].filter(t => t.status === status)
      : [...this.tickets.values()];
  }
}
