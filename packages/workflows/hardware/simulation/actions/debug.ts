/**
 * Simulation Action — Debug / Run / Read Registers / Read RAM
 */

import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface DebugInput {
  xbinPath: string;
  action: 'freerun' | 'regs' | 'ram' | 'step' | 'stop';
  runTime?: number;       // seconds for freerun
  ramAddr?: string;       // e.g. "0x06" for single, "0x06 0x0A" for range
  expect?: string;        // e.g. "{0x06}=0x10"
}

export interface DebugOutput {
  success: boolean;
  registers?: Record<string, number>;
  memory?: Record<string, number>;
  pcl?: number;
  errors?: string[];
  rawOutput?: string;
}

const TOOLCHAIN = resolve(__dirname, '../../../../../AstroM/_archive/toolchains/AstroMcu');

export async function debugAction(context: any, input: DebugInput): Promise<DebugOutput> {
  const { xbinPath, action, runTime, ramAddr } = input;

  try {
    let cmd: string;

    switch (action) {
      case 'freerun':
        cmd = `python -m astrocli freerun "${xbinPath}"`;
        break;
      case 'regs':
        cmd = `python -m astrocli regs --json`;
        break;
      case 'ram':
        cmd = `python -m astrocli ram ${ramAddr} --json`;
        break;
      case 'step':
        cmd = `python -m astrocli step "${xbinPath}" -n ${runTime || 5}`;
        break;
      default:
        cmd = `python -m astrocli ${action} "${xbinPath}"`;
    }

    const result = execSync(cmd, {
      cwd: TOOLCHAIN,
      encoding: 'utf-8',
      timeout: (runTime || 10) * 1000 + 30_000,
    });

    // Parse JSON output if available
    const jsonLines = result.split('\n').filter(l => l.startsWith('{'));
    let registers: Record<string, number> | undefined;
    let memory: Record<string, number> | undefined;

    for (const line of jsonLines) {
      try {
        const data = JSON.parse(line);
        if (data.registers) registers = data.registers;
        if (data.memory) memory = data.memory;
        if (data.status === 'ok') break;
      } catch { /* skip non-JSON */ }
    }

    return {
      success: true,
      registers,
      memory,
      rawOutput: result,
    };
  } catch (err: any) {
    return {
      success: false,
      errors: [err.stderr || err.message || String(err)],
      rawOutput: err.stdout,
    };
  }
}
