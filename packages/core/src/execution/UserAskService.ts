/**
 * UserAskService — LLM 自主决策的「问用户」机制（17i.15）
 *
 * 背景：OpenCode/其它 agent 框架中，LLM 在推理时可能决定需要用户决策（问技术栈/选方案等）。
 * 本服务提供 `ask_user` 工具：LLM 调用它时，引擎**暂停**等待用户回答（promise 阻塞），
 * 前端把问题以拟人对话呈现，用户回答后经 /api/ask/:id/answer 决议，工具返回回答，agent 继续。
 *
 * 与 ApprovalGate 同构：request（工具调用→event）→ wait（promise）→ decide（endpoint）。
 */

import type { EventBus } from '../infrastructure/common/EventBus.js';
import { recordDecision, resolveDecision } from './DecisionStore.js';

export interface AskRequest {
  question: string;
  options?: string[];
  sessionId?: string;
}

export interface PendingAsk {
  id: string;
  question: string;
  options?: string[];
  sessionId?: string;
  resolve: (answer: string) => void;
}

const pending = new Map<string, PendingAsk>();
let seq = 0;
let askEventBus: EventBus | null = null;

/** 进程级设置 EventBus（工具发射 user.ask 事件；StudioServer 可同用）。 */
export function setAskEventBus(bus: EventBus): void {
  askEventBus = bus;
}

/** 创建 ask_user 工具定义（供 agent 工具列表注册；execute 阻塞直到用户回答/超时）。 */
export function createAskUserTool(opts: { timeoutMs?: number; sessionId?: string; spaceId?: string; goal?: string } = {}): {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (p: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError: boolean }>;
} {
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000; // 默认 5 分钟
  return {
    name: 'ask_user',
    label: 'ask_user',
    description:
      '当你需要用户决策或补充信息时调用（例如确认技术栈、选择方案、澄清需求）。' +
      '传入 question（面向用户的自然语言问题）与可选 options（可选项列表）。调用后任务会暂停等待用户回答。',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '面向用户的自然语言问题，如「你希望用什么技术栈实现？」' },
        options: { type: 'array', items: { type: 'string' }, description: '可选答案（如技术栈候选），可省略' },
      },
      required: ['question'],
    },
    execute: (params: Record<string, unknown>) =>
      new Promise<{ content: Array<{ type: string; text: string }>; isError: boolean }>((resolve) => {
        const id = `ask_${Date.now()}_${++seq}`;
        // 17k.7：LLM 未传具体问题时，用任务 goal 生成明确提示（用户知道要补什么、和哪个任务相关）
        const rawQuestion = String(params.question ?? '').trim();
        const question = rawQuestion
          || (opts.goal && opts.goal.trim()
            ? `请补充关于「${opts.goal.trim().slice(0, 40)}」的需求细节（例如具体功能、技术栈、交付标准等），回答后任务继续。`
            : '需要你补充一些信息');
        const options = Array.isArray(params.options)
          ? params.options.filter((o): o is string => typeof o === 'string')
          : undefined;
        // 超时兜底：不阻断任务
        const timer = setTimeout(() => {
          pending.delete(id);
          resolveDecision(id); // 17k.7：超时后不再显示「需回复」（任务已继续/可能失败，回答无意义）
          resolve({
            content: [{ type: 'text', text: `[ask_user 超时] 未在 ${Math.round(timeoutMs / 1000)}s 内收到用户回答，已按「不指定」继续。` }],
            isError: false,
          });
        }, timeoutMs);
        pending.set(id, {
          id,
          question,
          options,
          sessionId: opts.sessionId,
          resolve: (answer: string) => {
            clearTimeout(timer);
            pending.delete(id);
            resolve({ content: [{ type: 'text', text: `用户回答：${answer}` }], isError: false });
          },
        });
        // 前端据此弹出拟人对话问题
        askEventBus?.emit({
          id: `evt_${id}`,
          type: 'user.ask',
          timestamp: Date.now(),
          executionId: `ask_${id}`,
          source: 'user-ask-service',
          payload: { askId: id, question, options, sessionId: opts.sessionId ?? null },
        });
        // P-B：未决决策持久化（后端重启可恢复）；带归属键（spaceId/goal）供前端按部门/任务展示
        recordDecision({ id, kind: 'ask', question, options, spaceId: opts.spaceId, goal: opts.goal, meta: { sessionId: opts.sessionId ?? null } });
      }),
  };
}

/** 用户回答 → 决议待答（找到则 resolve 阻塞中的 ask_user，agent 继续）。 */
export function answerAsk(id: string, answer: string): boolean {
  const ask = pending.get(id);
  if (!ask) {
    resolveDecision(id); // 17k.7：底层 Map 无（如重启后）→ 也清持久化，避免前端无限显示未决
    return false;
  }
  resolveDecision(id); // P-B：标记已决议
  ask.resolve(answer);
  return true;
}

/** 查询待答列表（供端点/调试）。 */
export function getPendingAsks(): Array<{ id: string; question: string; options?: string[]; sessionId?: string }> {
  return [...pending.values()].map((a) => ({ id: a.id, question: a.question, options: a.options, sessionId: a.sessionId }));
}
