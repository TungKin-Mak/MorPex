/**
 * Firmware Build Project Action
 * 
 * End-to-end project build: generate code → compile → produce binaries.
 * Combines generate + compile into one action for convenience.
 */

import { generateAction, GenerateInput } from './generate.js';
import { compileAction, CompileInput, CompileOutput } from './compile.js';

export interface BuildProjectInput {
  chip: string;
  requirement?: string;
  source?: string | string[];
  output?: string;
  configWords?: string;
  projectName?: string;
}

export interface BuildProjectOutput {
  success: boolean;
  generation?: any;
  compilation?: CompileOutput;
  errors?: string[];
}

export async function buildProjectAction(context: any, input: BuildProjectInput): Promise<BuildProjectOutput> {
  const { chip, requirement, source, output, configWords, projectName } = input;

  // Step 1: Generate code if requirement given and no source provided
  let srcFiles = source;
  if (!srcFiles && requirement) {
    const genResult = await generateAction(context, {
      chip,
      requirement,
      outputDir: output,
    });
    if (!genResult.success || !genResult.sourcePath) {
      return {
        success: false,
        generation: genResult,
        errors: ['Code generation failed'],
      };
    }
    srcFiles = genResult.sourcePath;
  }

  if (!srcFiles) {
    throw new Error('Either source or requirement must be provided');
  }

  // Step 2: Compile
  const compileResult = await compileAction(context, {
    chip,
    source: srcFiles,
    output,
    configWords,
    projectName,
  });

  return {
    success: compileResult.success,
    compilation: compileResult,
    errors: compileResult.errors,
  };
}
