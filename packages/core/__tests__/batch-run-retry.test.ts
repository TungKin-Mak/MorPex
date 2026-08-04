/**
 * batch-run 容错逻辑测试 — retryableWaitMs（限流/过载识别）
 *
 * 覆盖：HTTP 429/5xx、GLM-4.7-Flash 限流（业务码 1305 / 访问量过大）、
 *      普通错误（不重试）、undefined
 */
import { describe, it, expect } from 'vitest';
import { retryableWaitMs } from '../../../scripts/batch-run.js';

describe('batch-run.retryableWaitMs', () => {
  it('HTTP 429（限流）→ 可重试 15s', () => {
    expect(retryableWaitMs('HTTP 429 Too Many Requests')).toBe(15000);
  });

  it('HTTP 5xx（服务器错误）→ 可重试 15s', () => {
    expect(retryableWaitMs('502 Bad Gateway')).toBe(15000);
  });

  it('GLM-4.7-Flash 限流（业务码 1305）→ 可重试 30s', () => {
    expect(
      retryableWaitMs('{"error":{"code":"1305","message":"该模型当前访问量过大，请您稍后再试"}}'),
    ).toBe(30000);
  });

  it('GLM 限流关键词（访问量过大/稍后再试）→ 可重试 30s', () => {
    expect(retryableWaitMs('该模型当前访问量过大，请您稍后再试')).toBe(30000);
    expect(retryableWaitMs('限流中，请稍后')).toBe(30000);
  });

  it('普通业务错误 → 不可重试（返回 0）', () => {
    expect(retryableWaitMs('KnowledgeQueryPrimitive: query 参数不能为空')).toBe(0);
  });

  it('undefined → 不可重试', () => {
    expect(retryableWaitMs(undefined)).toBe(0);
  });
});
