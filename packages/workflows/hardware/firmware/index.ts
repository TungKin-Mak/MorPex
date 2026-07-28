/**
 * XJ MCU Firmware Workflow — MorPex v11 Plugin
 * 
 * Integrates AstroMcu buildcli for firmware compilation:
 *   - code generation from MorPex YAML knowledge
 *   - C source compilation via buildcli (slcc/slasm/sllink)
 *   - firmware binary (.hex, .xbin, .cof) export
 */

import { WorkflowContext } from '@morpex/workflow-sdk';
import { compileAction } from './actions/compile.js';
import { generateAction } from './actions/generate.js';
import { buildProjectAction } from './actions/build_project.js';

export type { CompileInput, CompileOutput } from './actions/compile.js';
export type { GenerateInput, GenerateOutput } from './actions/generate.js';
export type { BuildProjectInput, BuildProjectOutput } from './actions/build_project.js';

export const actions = {
  compile: compileAction,
  generate: generateAction,
  buildProject: buildProjectAction,
};

/**
 * Run firmware compilation pipeline.
 * Called by WorkflowRuntime when capability "firmware.compile" is requested.
 */
export async function run(context: WorkflowContext, input: any): Promise<any> {
  const action = input.action || 'compile';
  const handler = actions[action as keyof typeof actions];
  if (!handler) throw new Error(`Unknown firmware action: ${action}`);
  return handler(context, input);
}
