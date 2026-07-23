/**
 * ThinkingLevelControl — 推理深度控制（迁移到 contracts 适配层）
 *
 * v3.x 重构完成：所有 pi-ai 直接依赖集中在 adapters/thinking-level.ts。
 * 迁移 contracts 后，可通过 InferencePort.getCapabilities() 替换此模块。
 *
 * pi-ai 直接依赖已隔离到适配层（adapters/thinking-level.ts）。
 */

import { thinkingLevelControl } from '../adapters/thinking-level.js';
import type { ThinkingLevel } from '../adapters/thinking-level.js';

export type { ThinkingLevel };

/** 所有可用的推理深度级别 */
export const THINKING_LEVELS: ThinkingLevel[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** 推理深度中文标签 */
export const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '很高',
  max: '最大',
};

/** 默认推理深度 */
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'medium';

/**
 * 获取模型支持的推理深度级别
 */
export function getSupportedLevels(modelId: string): ThinkingLevel[] {
  return thinkingLevelControl.getSupportedLevels(modelId);
}

/**
 * 钳制推理深度到模型支持的范围内
 */
export function clampLevel(modelId: string, level: ThinkingLevel): ThinkingLevel {
  return thinkingLevelControl.clampLevel(modelId, level);
}

/**
 * 解析字符串为 ThinkingLevel，无效值返回默认级别
 */
export function parseThinkingLevel(value: string, defaultLevel: ThinkingLevel = DEFAULT_THINKING_LEVEL): ThinkingLevel {
  const lower = value.toLowerCase().trim() as ThinkingLevel;
  return THINKING_LEVELS.includes(lower) ? lower : defaultLevel;
}

/** 清空模型缓存（在模型配置变更时调用） */
export function clearModelCache(): void {
  thinkingLevelControl.clearCache();
}
