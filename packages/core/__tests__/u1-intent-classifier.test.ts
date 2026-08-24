/**
 * U1·G1 — IntentClassifier 全面 LLM 化测试
 *
 * 覆盖：LLM 主路径（chat/task/不可解析）、降级路径（失败/超时 → 正则兜底 + warn 可观测）、
 * 未注入 LLM 时的纯启发式行为保持。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  IntentClassifier,
  resetIntentFallbackWarnForTest,
} from '../src/cognition/planning/goal-intelligence/IntentClassifier.js';

afterEach(() => {
  vi.restoreAllMocks();
  resetIntentFallbackWarnForTest(); // 限流计数是模块级状态，逐用例复位保证 warn 断言稳定
});

function llmReturning(text: string) {
  return vi.fn(async () => text);
}

function llmThrowing(err = new Error('boom')) {
  return vi.fn(async () => {
    throw err;
  });
}

describe('IntentClassifier — LLM 主路径', () => {
  it('LLM 判定 chat → chat（即使消息含任务动词）', async () => {
    const llm = llmReturning('chat');
    const r = await IntentClassifier.classify('帮我写个爬虫', llm as never);
    expect(r).toBe('chat');
    expect(llm).toHaveBeenCalledOnce();
  });

  it('LLM 判定 task → task（即使消息像问候）', async () => {
    const r = await IntentClassifier.classify('你好，帮我部署一下', llmReturning('task') as never);
    expect(r).toBe('task');
  });

  it('输出带多余文本时仍可解析', async () => {
    const r = await IntentClassifier.classify('随便什么', llmReturning('意图类别：TASK。') as never);
    expect(r).toBe('task');
  });

  it('长消息截断进 prompt（≤500 字符）', async () => {
    const llm = vi.fn(async (_s: string, prompt: string) => 'chat');
    await IntentClassifier.classify('啊'.repeat(900), llm as never);
    const passed = (llm.mock.calls[0]?.[1] as string) ?? '';
    expect(passed.length).toBeLessThanOrEqual(520);
  });
});

describe('IntentClassifier — 降级兜底路径', () => {
  it('LLM 失败 → 降级正则：强任务动词 → task，且打 warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await IntentClassifier.classify('写一个爬虫程序', llmThrowing() as never);
    expect(r).toBe('task');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('降级'));
  });

  it('LLM 失败 → 问候语降级为 chat', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await IntentClassifier.classify('你好', llmThrowing() as never);
    expect(r).toBe('chat');
  });

  it('LLM 输出不可解析 → 降级并打 warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await IntentClassifier.classify('总结这个文件', llmReturning('我不知道') as never);
    expect(r).toBe('task'); // 非疑问 + 任务动词 → 兜底 task
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('不可解析'));
  });
});

describe('IntentClassifier — 未注入 LLM（行为保持）', () => {
  it('无 LLM 时走启发式：强任务 → task', async () => {
    const r = await IntentClassifier.classify('写一个爬虫程序');
    expect(r).toBe('task');
  });
  it('无 LLM 时走启发式：问候 → chat', async () => {
    const r = await IntentClassifier.classify('你好');
    expect(r).toBe('chat');
  });
});
