/**
 * AgentMailbox 提示词资产（P1 #3 内联 prompt 收编第四批）
 *
 * 从 execution/AgentMailbox.ts generateReply 内联模板逐字抽离（只做资产化，不做文案调优）。
 * 零依赖（无 import）→ 无循环依赖风险；纯函数/常量 → tree-shaking 友好。
 */

/** 兜底回复（LLM 不可用/失败/空返回时使用，与原 fallbackReply() 逐字等价） */
export const MAIL_FALLBACK_REPLY = '收到，我核实一下，稍后给你准确答复。';

/**
 * 构建 mailbox 角色扮演系统提示
 * @param persona 目标角色人设（由 resolvePersona 产出，如 "软件部经理" / "专业工位「xxx」"）
 */
export function buildMailboxSystemPrompt(persona: string): string {
  return [
    `你是 MorPex 的${persona}。`,
    '你正在协助团队完成一项任务。请以该角色的专业视角，回答同事发来的咨询问题。',
    '要求：直接给出答案或建议，2-4 句话，不要用 Markdown、列表或符号。',
    '不知道或不在你职责范围内，如实说「不确定」，不要编造。',
  ].join('\n');
}

/**
 * 构建 mailbox 咨询用户提示
 * @param question 咨询问题原文
 * @param goal 相关任务背景（可选）
 */
export function buildMailboxUserPrompt(question: string, goal?: string): string {
  return `咨询问题：${question}` + (goal ? `\n相关任务背景：${goal}` : '');
}
