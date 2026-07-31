/**
 * Hardware Workflow Bootstrap — 注册 ActionPrimitive（理想架构第 9 层）
 *
 * 由 bootstrapUnified 在启动时调用；幂等（DomainPrimitiveRegistry 覆盖注册）。
 */
import { DomainPrimitiveRegistry } from '@morpex/core';
import {
  HardwareGenerateAction,
  HardwareCompileAction,
  HardwareBuildProjectAction,
  HardwareFlashAction,
  HardwareDebugAction,
} from './actions/hardware-actions.js';
import { registerHardwareRules } from './rules/hardware-rules.js';

export async function bootstrapHardwareWorkflow(_domain = 'hardware'): Promise<void> {
  DomainPrimitiveRegistry.registerMultiple([
    new HardwareGenerateAction(),
    new HardwareCompileAction(),
    new HardwareBuildProjectAction(),
    new HardwareFlashAction(),
    new HardwareDebugAction(),
  ]);
  // No Domain Logic in Core：FCC/RoHS 合规规则由插件注册
  registerHardwareRules();
  console.log('[Workflow:hardware] ✅ 插件已就绪（5 个 ActionPrimitive + 领域规则已注册）');
}

export default bootstrapHardwareWorkflow;
