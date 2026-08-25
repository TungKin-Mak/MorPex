/**
 * SpaceService 提示词资产（P1 #3 内联 prompt 收编·收尾批）
 *
 * 从 governance/control-plane/SpaceService.ts 内联模板逐字抽离（只做资产化，不做文案调优）。
 * 零依赖（无 import）→ 无循环依赖风险；纯函数/字符串 → tree-shaking 友好。
 */

/**
 * 构建部门经理 persona 提示
 * @param name 部门中文名（已解析别名后的最终名）
 * @param providerDescription 提供方描述（可能 undefined）
 * @param capabilityNames 能力名列表（action.name[]）
 */
export function buildManagerPersona(
  name: string,
  providerDescription: string | undefined,
  capabilityNames: string[],
): string {
  return `你是${name}的经理。部门职责：${providerDescription ?? '负责本部门领域任务'}。本部门可用能力：${capabilityNames.join('、') || '通用能力'}。请以经理口吻接单、澄清、拆解任务给工位，工位按任务复杂度动态编排。`;
}

/**
 * 构建部门路由提示（供 LLM 路由 prompt 注入）
 * @param name 部门中文名
 * @param providerDescription 提供方描述
 * @param capabilityNames 能力名列表
 * @param wfId 工作流 id
 */
export function buildRouteHint(
  name: string,
  providerDescription: string | undefined,
  capabilityNames: string[],
  wfId: string,
): string {
  return [
    `部门：${name}`,
    providerDescription ? `职责：${providerDescription}` : '',
    capabilityNames.length > 0 ? `能力/动作：${capabilityNames.join('、')}` : '',
    `工作流：${wfId}`,
  ]
    .filter(Boolean)
    .join('。');
}
