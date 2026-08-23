/**
 * XJMCU Simulate Action — astrocli 仿真运行固件
 * ActionPrimitive 标准实现（理想架构第 9 层）
 *
 * 从 pipeline.ts 抽取共用：astrocli freerun 仿真，校验固件功能时序。
 * 手册步骤 xjmcu.simulate 与 MCP 工具 xjmcu_simulate 共用本实现。
 */
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import type { ActionPrimitive, ActionResult } from '@morpex/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const TOOLCHAIN_DIR = resolve(__dirname, '../../toolchain');

export class XJMcuSimulateAction implements ActionPrimitive {
  name = 'xjmcu.simulate';
  description = 'astrocli 仿真运行 XJ MCU 固件（freerun），产出 simulation_report';
  inputSchema = {
    type: 'object',
    properties: {
      xbin: { type: 'string', description: '固件 .xbin 文件路径' },
      timeout_ms: { type: 'number', description: '仿真超时毫秒（默认 30000）' },
    },
    required: ['xbin'],
  };

  canHandle(task: string): number {
    const t = task.toLowerCase();
    return /xjmcu|矽杰|mcu|固件|firmware|仿真|simulate|simulation/.test(t) ? 0.85 : 0;
  }

  async execute(params: Record<string, unknown>, _context?: { departmentId?: string }): Promise<ActionResult> {
    const xbin = params.xbin as string | undefined;
    const timeoutMs = Number(params.timeout_ms ?? 30000);
    if (!xbin) return { success: false, error: 'xjmcu.simulate: xbin 必填' };
    if (!existsSync(xbin)) return { success: false, error: `xjmcu.simulate: 固件不存在 ${xbin}` };

    try {
      const stdout = execSync(`python -m astrocli freerun "${resolve(xbin)}"`, {
        cwd: TOOLCHAIN_DIR,
        encoding: 'utf-8',
        timeout: timeoutMs,
      });
      return {
        success: true,
        data: {
          xbin,
          ok: true,
          simulation_report: String(stdout ?? '').slice(0, 2000) || 'freerun 完成（无输出）',
        },
      };
    } catch (e: any) {
      return {
        success: true, // 仿真失败不阻塞交付：报告失败详情，由手册 on_failure:skip 决策
        data: {
          xbin,
          ok: false,
          simulation_report: `仿真失败: ${String(e.stderr || e.message || e).slice(0, 500)}`,
        },
      };
    }
  }
}
