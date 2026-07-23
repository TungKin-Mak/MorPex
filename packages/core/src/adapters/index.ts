/**
 * MorPex Core Adapter Layer — Barrel export
 *
 * All Pi-adjacent types and utilities are re-exported from here.
 * Core business logic may import from this barrel:
 *
 *   import { MPAgentTool, Type } from '../adapters/index.js';
 *
 * ═══════════════════════════════════════════════════════════════════
 * ARCHITECTURAL BOUNDARY
 *   Only files in packages/core/src/adapters/ may directly import
 *   from @earendil-works/* packages.
 * ═══════════════════════════════════════════════════════════════════
 */

// ── Types (pi-types.ts) ──
export type {
  MPAgentTool, MPAgentToolResult, MPAgentMessage,
  MPAgentEvent, MPSession, MPThinkingLevel, MPExecutionEnv,
  MPAgentHarness,
  AgentTool, AgentToolResult, AgentMessage, AgentEvent,
  Session, ExecutionEnv, ThinkingLevel,
} from './pi-types.js';

// ── pi-ai TypeBox (pi-ai-types.ts) ──
export { Type } from './pi-ai-types.js';
export type { Static, TSchema } from './pi-ai-types.js';

// ── Runtime utilities (pi-utils.ts) ──
export {
  mpUuidv7, mpType, mpGetModel,
  MpNodeExecutionEnv, MpAgentHarness, MpInMemorySessionRepo,
  uuidv7, getModel, NodeExecutionEnv, AgentHarness, InMemorySessionRepo,
} from './pi-utils.js';

// ── Identity (identity.ts) ──
export { generateShortUUID } from './identity.js';

// ── Model registry (model-registry.ts) ──
export { piModelRegistry } from './model-registry.js';
export type { ModelInfo, ProviderInfo } from './model-registry.js';

// ── Thinking level (thinking-level.ts) ──
export { thinkingLevelControl } from './thinking-level.js';

// ── Agent spawner (agent-spawner.ts) ──
export { agentSpawner } from './agent-spawner.js';

// ── PiBridge (v11 stable abstraction) ──
export { PiBridge } from './pi-bridge/index.js';
export type { GenerateParams, GenerateResult, ModelInfo as PiModelInfo } from './pi-bridge/index.js';
