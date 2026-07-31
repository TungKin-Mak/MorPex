/**
 * XJMCU Compile Action — 编译固件（buildcli）
 * ActionPrimitive 标准实现（理想架构第 9 层）
 *
 * 调用 buildcli 将 C 源码编译为 XJ MCU 固件（firmware.hex / firmware.xbin）。
 */
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import type { ActionPrimitive, ActionResult } from '@morpex/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TC = resolve(__dirname, '../../toolchain');

export class XJMcuCompileAction implements ActionPrimitive {
  name = 'xjmcu.compile';
  description = '编译 XJ MCU 固件：buildcli build --chip <chip> --src <source>，产出 firmware.hex / firmware.xbin';
  inputSchema = {
    type: 'object',
    properties: {
      chip: { type: 'string', description: '芯片型号（如 XC8P9530）' },
      source: { type: 'string', description: 'C 源码文件路径' },
      output: { type: 'string', description: '输出目录（可选，默认 build/<chip>）' },
    },
    required: ['chip', 'source'],
  };

  canHandle(task: string): number {
    const t = task.toLowerCase();
    return /xjmcu|矽杰|mcu|固件|firmware|编译|compile|build/.test(t) ? 0.85 : 0;
  }

  async execute(params: Record<string, unknown>, _context?: { departmentId?: string }): Promise<ActionResult> {
    const chip = params.chip as string | undefined;
    const source = params.source as string | undefined;
    const output = params.output as string | undefined;
    if (!chip || !source) return { success: false, error: 'xjmcu.compile: chip 与 source 必填' };

    const d = output || resolve(process.cwd(), 'build/' + chip);
    if (!existsSync(d)) mkdirSync(d, { recursive: true });

    try {
      execSync(`python -m buildcli build --chip ${chip} --src "${source}" --output "${d}"`, {
        cwd: TC,
        encoding: 'utf-8',
        timeout: 120000,
      });
      return {
        success: true,
        data: {
          hex: existsSync(resolve(d, 'firmware.hex')) ? resolve(d, 'firmware.hex') : null,
          xbin: existsSync(resolve(d, 'firmware.xbin')) ? resolve(d, 'firmware.xbin') : null,
        },
      };
    } catch (e: any) {
      return { success: false, error: e.stderr || e.message };
    }
  }
}

// 兼容旧 run(ctx, i) 动态导入路径（src/index.ts legacy run）
export default async function (ctx: any, i: any) {
  return new XJMcuCompileAction().execute(i, ctx);
}
