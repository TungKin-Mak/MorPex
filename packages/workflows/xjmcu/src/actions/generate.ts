/**
 * XJMCU Generate Action — 生成固件源码骨架
 * ActionPrimitive 标准实现（理想架构第 9 层）
 *
 * 生成 main.c（含芯片头文件引用与需求注释），为编译提供输入。
 */
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import type { ActionPrimitive, ActionResult } from '@morpex/core';

export class XJMcuGenerateAction implements ActionPrimitive {
  name = 'xjmcu.generate';
  description = '生成 XJ MCU C 源码骨架（main.c + 芯片头文件引用）';
  inputSchema = {
    type: 'object',
    properties: {
      chip: { type: 'string', description: '芯片型号（如 XC8P9530）' },
      requirement: { type: 'string', description: '功能需求描述（写入注释）' },
      output: { type: 'string', description: '输出目录（可选，默认 build/gen）' },
    },
    required: ['chip'],
  };

  canHandle(task: string): number {
    const t = task.toLowerCase();
    return /xjmcu|矽杰|mcu|固件|firmware|生成|generate/.test(t) ? 0.85 : 0;
  }

  async execute(params: Record<string, unknown>, _context?: { departmentId?: string }): Promise<ActionResult> {
    const chip = params.chip as string | undefined;
    const requirement = params.requirement as string | undefined;
    const output = params.output as string | undefined;
    if (!chip) return { success: false, error: 'xjmcu.generate: chip 必填' };

    const d = output || resolve(process.cwd(), 'build/gen');
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
    const s = resolve(d, chip + '_main.c');
    const req = requirement ? `// requirement: ${String(requirement).slice(0, 200)}\n` : '';
    writeFileSync(s, `// ${chip}\n${req}#include "${chip}.h"\nvoid main(void){while(1){}}\n`);

    return { success: true, data: { sourcePath: s } };
  }
}

// 兼容旧 run(ctx, i) 动态导入路径
export default async function (ctx: any, i: any) {
  return new XJMcuGenerateAction().execute(i, ctx);
}
