/**
 * Firmware Compile Action
 * 
 * Calls AstroMcu buildcli to compile C source into firmware binary.
 * Supports all XJ MCU chips (XC8P8616, XC8P9530, etc.)
 */

import { execSync } from 'child_process';
import { resolve } from 'path';
import { existsSync } from 'fs';

export interface CompileInput {
  chip: string;
  source: string | string[];
  output?: string;
  configWords?: string;
  projectName?: string;
}

export interface CompileOutput {
  success: boolean;
  hexPath?: string;
  xbinPath?: string;
  cofPath?: string;
  mapPath?: string;
  romUsage?: number;
  ramUsage?: number;
  errors?: string[];
}

const TOOLCHAIN = resolve(__dirname, '../../../../../AstroM/_archive/toolchains/AstroMcu');

export async function compileAction(context: any, input: CompileInput): Promise<CompileOutput> {
  const { chip, source, output, configWords, projectName } = input;
  
  if (!chip) throw new Error('chip is required');
  if (!source) throw new Error('source file(s) are required');

  const srcFiles = Array.isArray(source) ? source : [source];
  const outDir = output || resolve(process.cwd(), 'build/firmware');
  const name = projectName || 'firmware';

  // Build args
  const args = [
    '-m', 'buildcli', 'build',
    '--chip', chip,
    '--src', ...srcFiles,
    '--output', outDir,
    '--name', name,
  ];
  if (configWords) args.push('--config', configWords);

  try {
    const result = execSync(`python ${args.join(' ')}`, {
      cwd: TOOLCHAIN,
      encoding: 'utf-8',
      timeout: 120_000,
    });

    // Parse build output for artifacts
    const hexPath = resolve(outDir, 'firmware.hex');
    const xbinPath = resolve(outDir, 'firmware.xbin');
    const cofPath = resolve(outDir, 'firmware.cof');
    const mapPath = resolve(outDir, 'firmware.map');

    // Extract ROM/RAM usage from map file
    let romUsage = 0;
    let ramUsage = 0;
    if (existsSync(mapPath)) {
      const mapContent = require('fs').readFileSync(mapPath, 'utf-8');
      const romMatch = mapContent.match(/ROM\s+usage:\s*(\d+)/i);
      const ramMatch = mapContent.match(/RAM\s+usage:\s*(\d+)/i);
      if (romMatch) romUsage = parseInt(romMatch[1]);
      if (ramMatch) ramUsage = parseInt(ramMatch[1]);
    }

    return {
      success: true,
      hexPath: existsSync(hexPath) ? hexPath : undefined,
      xbinPath: existsSync(xbinPath) ? xbinPath : undefined,
      cofPath: existsSync(cofPath) ? cofPath : undefined,
      mapPath: existsSync(mapPath) ? mapPath : undefined,
      romUsage,
      ramUsage,
    };
  } catch (err: any) {
    return {
      success: false,
      errors: [err.stderr || err.message || String(err)],
    };
  }
}
