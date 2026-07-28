/**
 * Simulation Action — Flash firmware to MCU
 * 
 * Calls AstroMcu astrocli to flash .xbin firmware to hardware.
 */

import { execSync } from 'child_process';
import { resolve } from 'path';
import { existsSync } from 'fs';

export interface FlashInput {
  xbinPath: string;
  chip?: string;
  timeout?: number;
}

export interface FlashOutput {
  success: boolean;
  deviceConnected: boolean;
  flashPages?: number;
  verifyOk?: boolean;
  errors?: string[];
}

const TOOLCHAIN = resolve(__dirname, '../../../../../AstroM/_archive/toolchains/AstroMcu');

export async function flashAction(context: any, input: FlashInput): Promise<FlashOutput> {
  const { xbinPath, timeout } = input;

  if (!xbinPath || !existsSync(xbinPath)) {
    throw new Error(`XBIN file not found: ${xbinPath}`);
  }

  try {
    const result = execSync(
      `python -m astrocli flash "${xbinPath}"`,
      { cwd: TOOLCHAIN, encoding: 'utf-8', timeout: timeout || 60_000 }
    );

    const pagesMatch = result.match(/VerifyPages=(\d+)/);
    const verifyOk = result.includes('Verify OK') || result.includes('校验');

    return {
      success: true,
      deviceConnected: true,
      flashPages: pagesMatch ? parseInt(pagesMatch[1]) : undefined,
      verifyOk,
    };
  } catch (err: any) {
    const stderr = err.stderr || '';
    const isDeviceError = stderr.includes('device') || stderr.includes('USB');
    return {
      success: false,
      deviceConnected: !isDeviceError,
      errors: [err.message || String(err)],
    };
  }
}
