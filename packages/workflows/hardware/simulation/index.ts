/**
 * XJ MCU Simulation Workflow — MorPex v11 Plugin
 * 
 * Integrates AstroMcu astrocli for hardware simulation:
 *   - flash firmware to MCU
 *   - debug (freerun / step / stop)
 *   - read registers and memory
 */

import { flashAction } from './actions/flash.js';
import { debugAction } from './actions/debug.js';

export type { FlashInput, FlashOutput } from './actions/flash.js';
export type { DebugInput, DebugOutput } from './actions/debug.js';

export const actions = {
  flash: flashAction,
  debug: debugAction,
};

export async function run(context: any, input: any): Promise<any> {
  const action = input.action || 'flash';
  const handler = actions[action as keyof typeof actions];
  if (!handler) throw new Error(`Unknown simulation action: ${action}`);
  return handler(context, input);
}
