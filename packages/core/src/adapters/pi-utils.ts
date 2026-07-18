/**
 * MorPex Pi Utilities Adapter — Central runtime bridge to Pi packages
 *
 * ═══════════════════════════════════════════════════════════════════
 * IMPORTANT: THIS IS THE ONLY FILE WHERE Pi PACKAGES ARE IMPORTED
 * FOR RUNTIME CODE. ALL other core files must use the re-exports from here.
 *
 * When:
 *   - uuidv7 changes in pi-agent-core → fix uuidv7 export here
 *   - Type changes in pi-ai → fix mpType export here
 *   - getModel signature changes in pi-ai → fix mpGetModel export here
 * ═══════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════
// pi-agent-core runtime imports
// ═══════════════════════════════════════════════════════════════════

import { uuidv7 as _piUuidv7 } from '@earendil-works/pi-agent-core';

// ═══════════════════════════════════════════════════════════════════
// pi-ai runtime imports
// ═══════════════════════════════════════════════════════════════════

import { Type as _piType } from '@earendil-works/pi-ai';
import { getModel as _piGetModel } from '@earendil-works/pi-ai';
import { parseJsonWithRepair as _piParseJsonWithRepair } from '@earendil-works/pi-ai';

// ═══════════════════════════════════════════════════════════════════
// pi-agent-core node runtime import
// ═══════════════════════════════════════════════════════════════════

import { NodeExecutionEnv as _PiNodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import { AgentHarness as _PiAgentHarness } from '@earendil-works/pi-agent-core';
import { InMemorySessionRepo as _PiInMemorySessionRepo } from '@earendil-works/pi-agent-core';

// ═══════════════════════════════════════════════════════════════════
// Exported utilities — MP prefix for new code
// ═══════════════════════════════════════════════════════════════════

/** UUID v7 generator (wraps pi-agent-core uuidv7) */
export const mpUuidv7: () => string = _piUuidv7;

/** TypeBox Type builder (wraps pi-ai Type) */
export const mpType = _piType;

/** Model resolver (wraps pi-ai getModel) */
export const mpGetModel = _piGetModel;

/** JSON parser with auto-repair (wraps pi-ai parseJsonWithRepair) */
export const mpParseJsonWithRepair: ((json: string) => any) | undefined = _piParseJsonWithRepair;

/** NodeExecutionEnv (wraps pi-agent-core/node NodeExecutionEnv) */
export const MpNodeExecutionEnv = _PiNodeExecutionEnv;

/** AgentHarness (wraps pi-agent-core AgentHarness) */
export const MpAgentHarness = _PiAgentHarness;

/** InMemorySessionRepo (wraps pi-agent-core InMemorySessionRepo) */
export const MpInMemorySessionRepo = _PiInMemorySessionRepo;

// ═══════════════════════════════════════════════════════════════════
// Backward-compat original names (migration bridge)
// ═══════════════════════════════════════════════════════════════════

export const uuidv7 = _piUuidv7;
export const Type = _piType;
export const getModel = _piGetModel;
export const NodeExecutionEnv = _PiNodeExecutionEnv;
export const AgentHarness = _PiAgentHarness;
export const InMemorySessionRepo = _PiInMemorySessionRepo;
