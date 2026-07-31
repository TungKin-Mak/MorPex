/**
 * Hardware Workflow — 硬件设计插件（理想架构第 9 层）
 *
 * 领域逻辑完全隔离在 packages/workflows/hardware/（firmware + simulation）。
 */
export {
  HardwareGenerateAction,
  HardwareCompileAction,
  HardwareBuildProjectAction,
  HardwareFlashAction,
  HardwareDebugAction,
} from './actions/hardware-actions.js';
export { bootstrapHardwareWorkflow } from './bootstrap.js';
