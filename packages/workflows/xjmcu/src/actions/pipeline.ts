/**
 * XJMCU Pipeline Action — 全流程：生成 → 编译 → 仿真
 * ActionPrimitive 标准实现（理想架构第 9 层）
 *
 * 端到端流水线：
 *   1. gen     — 生成 main.c（如未提供 source）
 *   2. compile — buildcli 编译（产出 firmware.xbin）
 *   3. flash   — astrocli 仿真运行（best-effort）
 */
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import type { ActionPrimitive, ActionResult } from '@morpex/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TC = resolve(__dirname, '../../toolchain');

export class XJMcuPipelineAction implements ActionPrimitive {
  name = 'xjmcu.pipeline';
  description = 'XJ MCU 全流程：生成 → 编译 → 仿真（默认芯片 XC8P9530）';
  inputSchema = {
    type: 'object',
    properties: {
      chip: { type: 'string', description: '芯片型号（默认 XC8P9530）' },
      source: { type: 'string', description: 'C 源码路径（可选，缺省自动生成）' },
      output: { type: 'string', description: '输出目录（可选）' },
    },
  };

  canHandle(task: string): number {
    const t = task.toLowerCase();
    return /xjmcu|矽杰|mcu|固件|firmware|pipeline|流水线|全流程/.test(t) ? 0.9 : 0;
  }

  async execute(params: Record<string, unknown>, _context?: { departmentId?: string }): Promise<ActionResult> {
    const chip = (params.chip as string) || 'XC8P9530';
    const source = params.source as string | undefined;
    const output = params.output as string | undefined;

    const d = output || resolve(process.cwd(), 'build/xjmcu_' + chip);
    if (!existsSync(d)) mkdirSync(d, { recursive: true });

    const r: {
      chip: string;
      steps: Record<string, unknown>;
    } = { chip, steps: {} };
    const sp = source || resolve(d, chip + '_main.c');
    if (!source) writeFileSync(sp, `#include "${chip}.h"\nvoid main(void){while(1){}}\n`);
    r.steps.gen = { src: sp };

    const bd = resolve(d, 'build');
    try {
      execSync(`python -m buildcli build --chip ${chip} --src "${sp}" --output "${bd}"`, {
        cwd: TC,
        encoding: 'utf-8',
        timeout: 120000,
      });
      r.steps.compile = {
        ok: true,
        xbin: existsSync(resolve(bd, 'firmware.xbin')) ? resolve(bd, 'firmware.xbin') : null,
      };
    } catch (e: any) {
      r.steps.compile = { ok: false, err: String(e.message || e).slice(0, 100) };
    }

    const xbin = (r.steps.compile as { xbin?: string } | undefined)?.xbin;
    if (xbin) {
      try {
        execSync(`python -m astrocli freerun "${xbin}"`, { cwd: TC, timeout: 30000 });
        r.steps.flash = { ok: true };
      } catch {
        r.steps.flash = { ok: false };
      }
    }

    return { success: true, data: r };
  }
}

// 兼容旧 run(ctx, i) 动态导入路径
export default async function (ctx: any, i: any) {
  return new XJMcuPipelineAction().execute(i, ctx);
}
