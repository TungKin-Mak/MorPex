/**
 * Hardware WorkflowProvider — 硬件设计工作流插件（旧接口兼容层）
 *
 * 理想架构第 9 层：领域逻辑完全隔离在 packages/workflows/hardware/。
 * 此 provider 供旧 WorkflowRegistry 发现；新路径请用 src/bootstrap.ts 注册 ActionPrimitive。
 */
import type { WorkflowProvider, WorkflowAction } from '@morpex/core';
import { generateAction } from './firmware/actions/generate.js';
import { compileAction } from './firmware/actions/compile.js';
import { buildProjectAction } from './firmware/actions/build_project.js';
import { flashAction } from './simulation/actions/flash.js';
import { debugAction } from './simulation/actions/debug.js';

const actions: WorkflowAction[] = [
  {
    name: 'hardware.generate_firmware',
    description: '生成固件 C 源码',
    execute: async (p) => toResult(await generateAction({}, p as never)),
  },
  {
    name: 'hardware.compile_firmware',
    description: '编译固件（hex/xbin）',
    execute: async (p) => toResult(await compileAction({}, p as never)),
  },
  {
    name: 'hardware.build_project',
    description: '端到端工程构建',
    execute: async (p) => toResult(await buildProjectAction({}, p as never)),
  },
  {
    name: 'hardware.flash_firmware',
    description: '烧录固件到 MCU',
    execute: async (p) => toResult(await flashAction({}, p as never)),
  },
  {
    name: 'hardware.debug_regs',
    description: '调试寄存器读取',
    execute: async (p) => toResult(await debugAction({}, p as never)),
  },
];

function toResult(o: { success: boolean; errors?: string[] }): { success: boolean; data?: unknown; error?: string } {
  return o.success ? { success: true, data: o } : { success: false, error: (o.errors ?? ['hardware action failed']).join('; ') };
}

export const hardwareWorkflowProvider: WorkflowProvider = {
  name: 'hardware',
  version: '1.2.0',
  description: '硬件设计工作流：PCB、Firmware、Simulation',
  getActions: () => actions,
  getArtifactTypes: () => ['SourceCode', 'HexBinary', 'XBINBinary', 'BuildReport', 'SimulationReport', 'RegisterDump'],
  getValidators: () => ['DFMChecker', 'FCCompliance', 'CodeValidator', 'MemoryBoundChecker'],
  matchGoal: (goal: string) => {
    const lower = goal.toLowerCase();
    return (
      lower.includes('硬件') || lower.includes('hardware') ||
      lower.includes('固件') || lower.includes('firmware') ||
      lower.includes('pcb') || lower.includes('mcu') ||
      lower.includes('芯片') || lower.includes('仿真')
    );
  },
};

export default hardwareWorkflowProvider;
