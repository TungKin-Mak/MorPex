/**
 * MorPex Pi Utilities Adapter — Central runtime bridge to Pi packages
 *
 * ═══════════════════════════════════════════════════════════════════
 * ALL pi-agent-core classes go through PiBridge static getters.
 * When pi packages upgrade, only PiBridge needs changing.
 *
 * pi-ai compat functions (Type, getModel, parseJsonWithRepair) still
 * import directly from compat layer — these are runtime-stable APIs
 * that rarely change. PiBridge wraps the inference path (generateText).
 * ═══════════════════════════════════════════════════════════════════
 */

import { PiBridge } from './pi-bridge/index.js';
import { Type as _piType } from '@earendil-works/pi-ai/compat';
import { parseJsonWithRepair as _piParseJsonWithRepair } from '@earendil-works/pi-ai/compat';
import { getModel as _piGetModel } from '@earendil-works/pi-ai/compat';

// ═══════════════════════════════════════════════════════════════════
// pi-ai compat — stable runtime surface
// ═══════════════════════════════════════════════════════════════════

export const mpType = _piType;
export const mpGetModel = _piGetModel;
export const mpParseJsonWithRepair: ((json: string) => any) | undefined = _piParseJsonWithRepair;

// ═══════════════════════════════════════════════════════════════════
// pi-agent-core — through PiBridge statics
// ═══════════════════════════════════════════════════════════════════

export const mpUuidv7: () => string = PiBridge.uuidv7;

/** NodeExecutionEnv class (from PiBridge static) */
export const MpNodeExecutionEnv = PiBridge.NodeEnvClass;

/** AgentHarness class (from PiBridge static) */
export const MpAgentHarness = PiBridge.AgentHarnessClass;

/** InMemorySessionRepo class (from PiBridge static) */
export const MpInMemorySessionRepo = PiBridge.SessionRepoClass;

// ═══════════════════════════════════════════════════════════════════
// Backward-compat aliases (original names)
// ═══════════════════════════════════════════════════════════════════

export const uuidv7 = PiBridge.uuidv7;
export const Type = _piType;
export const getModel = _piGetModel;
export const NodeExecutionEnv = PiBridge.NodeEnvClass;
export const AgentHarness = PiBridge.AgentHarnessClass;
export const InMemorySessionRepo = PiBridge.SessionRepoClass;
