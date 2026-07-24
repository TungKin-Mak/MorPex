/**
 * Negotiation Module — 协商模块入口
 */
export { NegotiationEngine } from './NegotiationEngine.js';
export type {
  CreateTicketParams,
  NegotiationEngineConfig,
  NegotiationCallbacks,
} from './NegotiationEngine.js';

// NegotiationLite (Phase 3 — 精简替代)
export { NegotiationLite } from './NegotiationLite.js';
export type {
  LiteTicket,
  LiteTicketStatus,
  Resolution,
} from './NegotiationLite.js';
