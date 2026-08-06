/**
 * ExperienceInjectionService — 任务间经验主动注入（会话 16d · P2 上下文装配效率 2）
 *
 * 闭环：16c 经验沉淀（LearningEventDetector 产出可学习事件）→ 本服务在下次装配时按
 * goal/domain 匹配相似任务经验 → 注入规避提示到聚焦上下文（预防性，比事后拦截省钱）。
 *
 * 匹配策略（无 embedding，确定性关键词/domain）：
 *   - 按 domain 匹配：事件 capability 含 domain，或 goal 含 capability 名
 *   - 命中空参模式 → 提示填全参数；安全拦截 → 提示先取 Gate 凭证；高重试 → 提示一次填全
 *
 * @packageDocumentation
 */

import type { LearningEvent } from './LearningEventDetector.js';

export interface ExperienceSource {
  getEvents(): LearningEvent[];
}

export class ExperienceInjectionService {
  constructor(private readonly source: ExperienceSource) {}

  /**
   * inject — 按 goal/domain 匹配已沉淀经验，返回规避提示文本（无匹配 → null）
   */
  inject(goal: string, domain?: string): string | null {
    const all = this.source.getEvents();
    if (all.length === 0) return null;

    // 匹配：goal 含事件 capability 名，或 domain 含于 capability / capability 含于 domain
    const lowerGoal = goal.toLowerCase();
    const lowerDomain = domain?.toLowerCase() ?? '';
    const matched = all.filter(ev => {
      const cap = ev.capability.toLowerCase();
      return (lowerDomain && (cap.includes(lowerDomain) || lowerDomain.includes(cap)))
        || (cap.length > 2 && lowerGoal.includes(cap));
    });

    // 无匹配事件 → 仍注入全局高频模式（空参/安全拦截是跨领域通用痛点）
    const types = new Set(matched.map(ev => ev.type));
    const hints: string[] = [];
    if (types.has('empty-param') || (matched.length === 0 && all.some(e => e.type === 'empty-param'))) {
      hints.push('⚠️ 历史任务多次因【工具参数为空】失败：调用工具必须一次填全必需参数（knowledge 需 query、shell 需 command、api 需 url+method、file 需 operation+path），禁止省略。');
    }
    if (types.has('safety-block') || (matched.length === 0 && all.some(e => e.type === 'safety-block'))) {
      hints.push('⚠️ 历史任务出现【安全拦截】（缺 Gate 凭证）：破坏性操作（写文件/执行命令/调外部 API）须先经知识检索取得凭证，否则会被硬拦。');
    }
    if (types.has('high-retry')) {
      hints.push('⚠️ 历史任务出现【反复重试】：一次调用把参数填完整，避免思考模式空转。');
    }
    if (hints.length === 0) return null;
    return hints.join('\n');
  }
}
