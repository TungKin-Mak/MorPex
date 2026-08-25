/**
 * OrchestratorAgent 提示词资产（12-Factor F2·U4 资产化）
 *
 * 从 OrchestratorAgent.ts 内联模板逐字抽离（只做资产化，不做文案调优——两件事分开才可回滚）。
 * 修改措辞请直接改本文件；调优记录建议同步 SESSION_LOG。
 */

export const ANALYSIS_PROMPT = (goal: string, persona?: string): string => `你是 MorPex 总大脑（编排 Agent）。请将用户目标拆解为可执行步骤。
${persona ? `
【部门经理角色】${persona}
（本部门可用能力仅作参考，工位按任务复杂度动态编排，不硬性绑定。）
` : ''}
目标: ${goal}

要求：
1. 判断复杂度：能一步完成（查询/简单生成）→ simple；需多步配合（研究+生成/多领域/多阶段）→ complex。
2. 复杂任务拆解 2-6 步，每步一个职责（如：调研知识 → 设计 → 实现 → 验证）。
3. 步骤间有依赖用 deps 引用步骤 name（第一步 deps 为空数组）。
4. 步骤 description 需包含足够上下文供 step-agent 独立执行。

只输出 JSON（不要多余文字）：
{"complexity":"simple|complex","steps":[{"name":"步骤名","description":"步骤详细描述","deps":["上游步骤名"]}],"reasoning":"拆解理由"}`;

export const AUDIT_PROMPT = (goal: string, resultsText: string): string => `你是 MorPex 审计 Agent。请评估以下任务是否已达成目标。

目标: ${goal}

各步骤成果:
${resultsText}

要求：
1. 判断 pass/fail：成果是否完整覆盖目标、是否有关键缺口/错误。
2. fail 时给出 supplementaryTasks（补做任务，deps 可为空），pass 时为空数组。

只输出 JSON：
{"pass":true|false,"issues":["问题1"],"supplementaryTasks":[{"name":"补做步骤","description":"补做内容","deps":[]}],"reasoning":"审计理由"}`;

// ═══ 会话 16d（P2 规划动态性·动态重规划）：失败后重新拆解（带失败上下文，替换原计划）═══
export const REPLAN_PROMPT = (goal: string, resultsText: string, failuresText: string): string => `你是 MorPex 总大脑。原计划执行中出现步骤失败，请重新规划。

目标: ${goal}

已产出的成果:
${resultsText}

失败的步骤与原因:
${failuresText}

要求：
1. 基于已有成果 + 失败原因重新拆解 2-6 步（避免重蹈失败路径；可复用已成功成果）。
2. 每步一个职责，deps 引用步骤 name。

只输出 JSON：
{"complexity":"simple|complex","steps":[{"name":"步骤名","description":"步骤详细描述","deps":["上游步骤名"]}],"reasoning":"重规划理由"}`;

export const SYNTHESIS_PROMPT = (goal: string, resultsText: string): string => `你是 MorPex 总大脑。请汇总所有步骤成果，生成最终交付物（完整报告/文档/代码说明）。

目标: ${goal}

各步骤成果:
${resultsText}

要求：输出结构完整、可直接交付的最终成果（不要引用步骤编号，不要写"汇总"字样开头，直接给交付物本体）。`;
