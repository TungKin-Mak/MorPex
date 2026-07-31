/**
 * Hardware ActionPrimitive 标准实现（理想架构第 9 层）
 *
 * 包装 firmware（compile/generate/build）+ simulation（flash/debug）真实实现，
 * 提供 canHandle + execute 标准接口供 DomainPrimitiveRegistry 使用。
 */
import type { ActionPrimitive, ActionResult } from '@morpex/core';
import { compileAction } from '../../firmware/actions/compile.js';
import { generateAction } from '../../firmware/actions/generate.js';
import { buildProjectAction } from '../../firmware/actions/build_project.js';
import { flashAction } from '../../simulation/actions/flash.js';
import { debugAction } from '../../simulation/actions/debug.js';

/** 统一把 legacy output（success + errors?）转为 ActionResult */
function toResult(o: { success: boolean; errors?: string[] }): ActionResult {
  return o.success ? { success: true, data: o } : { success: false, error: (o.errors ?? ['hardware action failed']).join('; ') };
}

export class HardwareGenerateAction implements ActionPrimitive {
  name = 'hardware.generate_firmware';
  description = '生成固件 C 源码（基于 YAML 知识库 / xjmcu_workflow.py）';
  inputSchema = {
    type: 'object',
    properties: {
      chip: { type: 'string', description: '芯片型号' },
      requirement: { type: 'string', description: '功能需求' },
      outputDir: { type: 'string', description: '输出目录' },
    },
    required: ['chip', 'requirement'],
  };

  canHandle(task: string): number {
    const t = task.toLowerCase();
    return /firmware|固件|generate|生成/.test(t) && /chip|mcu|硬件|hardware/.test(t) ? 0.85 : 0;
  }

  async execute(params: Record<string, unknown>, _context?: { departmentId?: string }): Promise<ActionResult> {
    try {
      return toResult(await generateAction({}, params as never));
    } catch (e: any) {
      return { success: false, error: String(e.message || e) };
    }
  }
}

export class HardwareCompileAction implements ActionPrimitive {
  name = 'hardware.compile_firmware';
  description = '编译固件（buildcli，产出 hex/xbin）';
  inputSchema = {
    type: 'object',
    properties: {
      chip: { type: 'string', description: '芯片型号' },
      source: { type: 'array', items: { type: 'string' }, description: 'C 源码文件列表' },
      output: { type: 'string', description: '输出目录' },
    },
    required: ['chip', 'source'],
  };

  canHandle(task: string): number {
    const t = task.toLowerCase();
    return /firmware|固件|compile|编译|build/.test(t) && /chip|mcu|硬件|hardware/.test(t) ? 0.85 : 0;
  }

  async execute(params: Record<string, unknown>, _context?: { departmentId?: string }): Promise<ActionResult> {
    try {
      return toResult(await compileAction({}, params as never));
    } catch (e: any) {
      return { success: false, error: String(e.message || e) };
    }
  }
}

export class HardwareBuildProjectAction implements ActionPrimitive {
  name = 'hardware.build_project';
  description = '端到端工程构建：生成代码 → 编译 → 产出二进制';
  inputSchema = {
    type: 'object',
    properties: {
      chip: { type: 'string', description: '芯片型号' },
      requirement: { type: 'string', description: '功能需求' },
      output: { type: 'string', description: '输出目录' },
    },
    required: ['chip'],
  };

  canHandle(task: string): number {
    const t = task.toLowerCase();
    return /project|工程|build|构建/.test(t) && /chip|mcu|硬件|hardware|固件|firmware/.test(t) ? 0.9 : 0;
  }

  async execute(params: Record<string, unknown>, _context?: { departmentId?: string }): Promise<ActionResult> {
    try {
      return toResult(await buildProjectAction({}, params as never));
    } catch (e: any) {
      return { success: false, error: String(e.message || e) };
    }
  }
}

export class HardwareFlashAction implements ActionPrimitive {
  name = 'hardware.flash_firmware';
  description = '烧录固件到 MCU（astrocli）';
  inputSchema = {
    type: 'object',
    properties: {
      xbinPath: { type: 'string', description: '固件 xbin 路径' },
      chip: { type: 'string', description: '芯片型号' },
    },
    required: ['xbinPath'],
  };

  canHandle(task: string): number {
    const t = task.toLowerCase();
    return /flash|烧录|烧写/.test(t) && /mcu|芯片|chip|硬件/.test(t) ? 0.85 : 0;
  }

  async execute(params: Record<string, unknown>, _context?: { departmentId?: string }): Promise<ActionResult> {
    try {
      return toResult(await flashAction({}, params as never));
    } catch (e: any) {
      return { success: false, error: String(e.message || e) };
    }
  }
}

export class HardwareDebugAction implements ActionPrimitive {
  name = 'hardware.debug_regs';
  description = '调试寄存器读取（astrocli）';
  inputSchema = {
    type: 'object',
    properties: {
      chip: { type: 'string', description: '芯片型号' },
      regs: { type: 'array', items: { type: 'string' }, description: '寄存器列表' },
    },
  };

  canHandle(task: string): number {
    const t = task.toLowerCase();
    return /debug|调试|寄存器|regs/.test(t) && /mcu|芯片|chip|硬件/.test(t) ? 0.85 : 0;
  }

  async execute(params: Record<string, unknown>, _context?: { departmentId?: string }): Promise<ActionResult> {
    try {
      return toResult(await debugAction({}, params as never));
    } catch (e: any) {
      return { success: false, error: String(e.message || e) };
    }
  }
}
