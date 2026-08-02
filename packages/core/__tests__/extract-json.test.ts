/**
 * extractJson 工具测试（L8 Infrastructure/utils）— 此前零覆盖（178 stmt / 0%）
 *
 * 覆盖：纯 JSON / 代码块包裹 / 散文夹杂 / 嵌套括号 / 截断修复 /
 *       无效输入返回 null / extractJsonAsync LLM 重试
 */
import { describe, it, expect } from 'vitest';
import { extractJson, extractJsonAsync } from '../src/infrastructure/utils/extractJson.js';

describe('extractJson — 基础提取', () => {
  it('纯 JSON 对象原样返回', () => {
    const raw = '{"name":"morpex","version":11}';
    expect(extractJson(raw)).toBe(raw);
  });

  it('```json 代码块内提取', () => {
    const raw = '解析结果如下：\n```json\n{"a":1,"b":[1,2,3]}\n```\n以上就是。';
    const r = extractJson(raw);
    expect(r).toBe('{"a":1,"b":[1,2,3]}');
  });

  it('散文夹杂 JSON → 括号匹配提取', () => {
    const raw = '本次分析结论是 {"status":"ok","count":5} 请据此执行。';
    const r = extractJson(raw);
    expect(r).toBe('{"status":"ok","count":5}');
  });

  it('深层嵌套括号 → 正确提取顶层对象', () => {
    const raw = 'before {"a":{"b":{"c":{"d":[1,2,{"e":"深"}]}}}} after';
    const r = extractJson(raw);
    expect(() => JSON.parse(r!)).not.toThrow();
    expect(JSON.parse(r!).a.b.c.d).toHaveLength(3);
  });
});

describe('extractJson — 截断修复与无效输入', () => {
  it('截断 JSON（缺右括号）→ repair 补齐为有效 JSON', () => {
    const raw = '{"name":"morpex","items":[1,2,3]';
    const r = extractJson(raw);
    expect(r).not.toBeNull();
    expect(() => JSON.parse(r!)).not.toThrow();
    expect(JSON.parse(r!).name).toBe('morpex');
  });

  it('无 JSON（纯文本）→ null', () => {
    expect(extractJson('这是一段没有 JSON 的文本')).toBeNull();
  });

  it('repair:false → 不尝试修复截断，返回 null', () => {
    const raw = '{"a":1';
    expect(extractJson(raw, { repair: false })).toBeNull();
  });
});

describe('extractJsonAsync — LLM 重试', () => {
  it('同步可提取 → 直接返回（不调 LLM）', async () => {
    let llmCalled = false;
    const r = await extractJsonAsync('{"ok":true}', {
      retryWithLLM: true,
      llmCaller: async () => { llmCalled = true; return '{"ok":true}'; },
    });
    expect(r).toBe('{"ok":true}');
    expect(llmCalled).toBe(false);
  });

  it('同步失败 + retryWithLLM + llmCaller → LLM 结果返回', async () => {
    const r = await extractJsonAsync('无法解析的文本', {
      retryWithLLM: true,
      llmCaller: async () => '{"from":"llm","value":42}',
    });
    expect(r).toBe('{"from":"llm","value":42}');
  });

  it('无 llmCaller → 返回 null', async () => {
    expect(await extractJsonAsync('无法解析的文本')).toBeNull();
  });
});
