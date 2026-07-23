/**
 * MorPex Pi Type Adapter — Central type-level bridge
 *
 * ═══════════════════════════════════════════════════════════════════
 * IMPORTANT: THIS IS THE ONLY FILE WHERE Pi TYPES ARE IMPORTED.
 * All other core files MUST import Pi types from here:
 *   import { MPAgentTool } from '../adapters/index.js';
 * ═══════════════════════════════════════════════════════════════════
 *
 * Goal:
 *   When Pi API changes, ONLY this file needs updating.
 */

// ── pi-agent-core types (type-only imports) ──
import type { AgentTool as _PiAgentTool, AgentToolResult as _PiAgentToolResult, AgentMessage as _PiAgentMessage, AgentEvent as _PiAgentEvent, Session as _PiSession, ExecutionEnv as _PiExecutionEnv, AgentHarness as _PiAgentHarness } from '@earendil-works/pi-agent-core';

// ── pi-ai types (type-only imports) ──
import type { ThinkingLevel as _PiThinkingLevel } from '@earendil-works/pi-ai';

// ═══════════════════════════════════════════════════════════════════
// MP-prefixed aliases (preferred for new code)
// ═══════════════════════════════════════════════════════════════════

/** MorPex AgentTool — wraps pi-agent-core AgentTool */
export type MPAgentTool = _PiAgentTool;

/** MorPex AgentToolResult — pi 0.80.10 no longer generic */
export type MPAgentToolResult = _PiAgentToolResult;

/** MorPex AgentMessage */
export type MPAgentMessage = _PiAgentMessage;

/** MorPex AgentEvent */
export type MPAgentEvent = _PiAgentEvent;

/** MorPex Session */
export type MPSession = _PiSession;

/** MorPex ThinkingLevel */
export type MPThinkingLevel = _PiThinkingLevel;

/** MorPex ExecutionEnv */
export type MPExecutionEnv = _PiExecutionEnv;

/** MorPex AgentHarness */
export type MPAgentHarness = _PiAgentHarness;

// ═══════════════════════════════════════════════════════════════════
// Original name aliases (backward compat during migration)
// ═══════════════════════════════════════════════════════════════════

export type AgentTool = MPAgentTool;
/** Concrete AgentToolResult (backward compat) */
export type AgentToolResult = _PiAgentToolResult;
/** Concrete AgentToolResult (backward compat, alias) */
export type AgentToolResult_T = AgentToolResult;
export type AgentMessage = MPAgentMessage;
export type AgentEvent = MPAgentEvent;
export type Session = MPSession;
export type ExecutionEnv = MPExecutionEnv;
export type ThinkingLevel = MPThinkingLevel;
/** Backward compat: AgentHarness */
export type AgentHarness = MPAgentHarness;

// ═══════════════════════════════════════════════════════════════════
// Re-export key types that core files commonly extract from Pi
// ═══════════════════════════════════════════════════════════════════

/** Session metadata from pi-agent-core Session */
export type MPSessionMetadata = Record<string, unknown>;
