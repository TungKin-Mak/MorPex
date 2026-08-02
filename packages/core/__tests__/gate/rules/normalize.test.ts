/**
 * gate/rules/normalize — 文本规范化管道测试
 *
 * 验证变体归一：AirPods / air pods / ＡｉｒＰｏｄｓ（全角）→ 全部归一化为 airpods
 */
import { describe, it, expect } from 'vitest';
import { normalizeText, normalizePattern } from '../../../src/gate/rules/normalize.js';

describe('gate/rules/normalize', () => {
  it('NFKC 全角→半角 + 小写 + 去空白：三种变体归一为同一结果', () => {
    expect(normalizeText('AirPods')).toBe('airpods');
    expect(normalizeText('air pods')).toBe('airpods');
    expect(normalizeText('ＡｉｒＰｏｄｓ')).toBe('airpods');
  });

  it('同一正则对三种变体全部命中', () => {
    const re = new RegExp(normalizePattern('AirPods'), 'i');
    expect('airpods'.match(re)?.[0]).toBe('airpods');
    expect(normalizeText('air pods').match(re)?.[0]).toBe('airpods');
    expect(normalizeText('ＡｉｒＰｏｄｓ').match(re)?.[0]).toBe('airpods');
  });

  it('中文不变、去空白：苹果耳机', () => {
    expect(normalizeText('苹果 耳机')).toBe('苹果耳机');
  });

  it('多词模式（|）规范化后保留正则语义', () => {
    const re = new RegExp(normalizePattern('Apple|iPhone|AirPods'), 'i');
    expect('我的 apple 很好用'.normalize('NFKC').toLowerCase().replace(/\s+/g, '')).toMatch(re);
  });
});
