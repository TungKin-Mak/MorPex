/**
 * XJMCU 领域平台 API 白名单规则（功能② Phase 2 — No Domain Logic in Core）
 *
 * 场景：LLM 为 XJMCU 芯片生成代码时可能误用其他平台 API（如 STM32 HAL/LL）。
 * 白名单检测器（core gate/rules/detectors ApiWhitelistDetector）扫描目标文本中
 * "厂商风格 API token"（含下划线且首字母大写），前缀不在白名单 → 命中违规 → 中断更正。
 *
 * 默认 pending（待人工确认生效）：确认后置 active 才参与匹配，避免示例规则
 * 在未确认时跨域生效。
 */

import { RuleRegistry, type RuleEntity } from '@morpex/core';

const DOMAIN = 'xjmcu';

/**
 * registerPlatformRules — 注册 XJMCU 平台 API 白名单规则（幂等，由 bootstrap 调用）
 */
export function registerPlatformRules(): void {
  const rules: RuleEntity[] = [
    {
      id: 'xjmcu_platform_api_whitelist',
      title: 'XJMCU 平台 API 白名单',
      tier: 'tier-1',
      domain: DOMAIN,
      severity: 'ERROR',
      ruleType: 'whitelist',
      target: 'proposal.payload',
      allowedApiPrefixes: ['IOCP', 'NVIC', 'SysTick', 'FLASH', 'RCC', 'TIM', 'UART', 'GPIO', 'DMA', 'ADC'],
      priority: 100,
      status: 'pending', // 待人工确认生效（演示确认闸，且不跨域误伤）
      source: 'manual',
      description: '生成代码只允许使用 XJMCU 平台 API（IOCP/NVIC/SysTick/FLASH/RCC/TIM/UART/GPIO/DMA/ADC），出现其他平台（如 STM32 HAL/LL）API 即违规',
    },
  ];
  RuleRegistry.registerMany(DOMAIN, rules);
  console.log(`[Workflow:xjmcu] ✅ 平台 API 白名单规则已注册（${rules.length} 条 ERROR，pending 待确认）`);
}
