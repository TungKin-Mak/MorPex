/**
 * XJMCU WorkflowProvider — 矽杰微 MCU 固件开发工作流插件（旧接口兼容层）
 *
 * 理想架构第 9 层：领域逻辑完全隔离在 packages/workflows/xjmcu/。
 * 此 provider 供旧 WorkflowRegistry 发现；新路径请用 src/bootstrap.ts 注册 ActionPrimitive。
 */
import type { WorkflowProvider, WorkflowAction } from '@morpex/core';
import { XJMcuGenerateAction } from './src/actions/generate.js';
import { XJMcuCompileAction } from './src/actions/compile.js';
import { XJMcuPipelineAction } from './src/actions/pipeline.js';

const actions: WorkflowAction[] = [
  {
    name: 'xjmcu.generate',
    description: '生成 MCU 固件代码（main.c 骨架）',
    execute: (params) => new XJMcuGenerateAction().execute(params),
  },
  {
    name: 'xjmcu.compile',
    description: '编译 MCU 固件（buildcli）',
    execute: (params) => new XJMcuCompileAction().execute(params),
  },
  {
    name: 'xjmcu.pipeline',
    description: 'MCU 全流程：生成 → 编译 → 仿真',
    execute: (params) => new XJMcuPipelineAction().execute(params),
  },
];

export const xjmcuWorkflowProvider: WorkflowProvider = {
  name: 'xjmcu',
  version: '1.0.0',
  description: '矽杰微 XJ MCU 固件开发工作流：生成→编译→烧录→仿真',
  getActions: () => actions,
  getArtifactTypes: () => ['source_code', 'compiled_binary', 'hex_file'],
  getValidators: () => [],
  matchGoal: (goal: string) => {
    const lower = goal.toLowerCase();
    return (
      lower.includes('mcu') ||
      lower.includes('固件') ||
      lower.includes('firmware') ||
      lower.includes('矽杰') ||
      lower.includes('xjmcu')
    );
  },
};

export default xjmcuWorkflowProvider;
