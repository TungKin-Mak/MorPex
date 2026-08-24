/**
 * U1·G2 — 统一错误/结果压缩器测试
 *
 * 覆盖：四段结构、长度上界（≤800）、堆栈关键帧（剥 node_modules）、中文内容、
 * clip 截断语义、formatResults 依赖的 clip 行为。
 */
import { describe, it, expect } from 'vitest';
import { compactFailure, clip, COMPACT_FAILURE_MAX } from '../src/execution/orchestration/error-compactor.js';

const LONG_STACK = [
  'Error: 数据库连接失败',
  '    at Connection.connect (/project/src/db/client.ts:42:15)',
  '    at async /project/src/service/user.ts:88:9',
  '    at node_modules/better-sqlite3/lib/index.js:100:5',
  '    at node_modules/express/lib/router/index.js:300:7',
].join('\n');

describe('compactFailure — 四段结构与上界', () => {
  it('输出包含四段标签', () => {
    const out = compactFailure({ step: 'db-init', err: new Error('连接超时') });
    expect(out).toContain('【失败了什么】');
    expect(out).toContain('【为什么】');
    expect(out).toContain('【试过什么】');
    expect(out).toContain('【建议下一步】');
  });

  it('总长 ≤ 800 上界（超长堆栈被压缩）', () => {
    const big = new Error('x'.repeat(5000));
    (big as { stack?: string }).stack = `Error: x\n${'    at a (/p/f.ts:1:1)\n'.repeat(200)}`;
    const out = compactFailure({ step: 'huge', err: big });
    expect(out.length).toBeLessThanOrEqual(COMPACT_FAILURE_MAX + 10); // 允许截断标记
    expect(out).toContain('[截断]');
  });

  it('含中文的错误信息完整保留在第一段', () => {
    const out = compactFailure({ step: '部署', err: new Error('目标目录不存在：/srv/app') });
    expect(out).toContain('部署');
    expect(out).toContain('目标目录不存在');
  });

  it('堆栈剥掉 node_modules 帧，保留项目帧', () => {
    const err = new Error('数据库连接失败');
    (err as { stack?: string }).stack = LONG_STACK;
    const out = compactFailure({ step: 'db', err });
    expect(out).toContain('client.ts:42');
    expect(out).not.toContain('node_modules');
  });

  it('按错误类型给建议：超时 → 检查可用性/配置', () => {
    const out = compactFailure({ step: 'call', err: new Error('request timeout after 30s') });
    expect(out).toContain('超时配置');
  });

  it('attempts 计数进「试过什么」段', () => {
    const out = compactFailure({ step: 's', err: new Error('e'), attempts: 2 });
    expect(out).toContain('已自动重试 2 次');
  });

  it('非 Error 输入（字符串）也能压缩', () => {
    const out = compactFailure({ step: 's', err: '就失败了' });
    expect(out).toContain('就失败了');
  });
});

describe('clip — 截断助手', () => {
  it('短文本原样返回', () => {
    expect(clip('你好世界', 100)).toBe('你好世界');
  });
  it('超长文本截断并带标记', () => {
    const out = clip('啊'.repeat(3000), 2000);
    expect(out.length).toBeLessThanOrEqual(2010);
    expect(out.endsWith('[截断]')).toBe(true);
  });
  it('对象走 JSON.stringify 后截断', () => {
    const out = clip({ a: 'x'.repeat(3000) }, 500);
    expect(out.length).toBeLessThanOrEqual(510);
  });
  it('null/undefined → 空串', () => {
    expect(clip(null, 10)).toBe('');
    expect(clip(undefined, 10)).toBe('');
  });
});

describe('clip — 不可序列化对象兜底（optimizer 补）', () => {
  it('循环引用对象不抛异常，返回占位符', () => {
    const a: Record<string, unknown> = { name: 'circular' };
    a['self'] = a;
    expect(() => clip(a, 100)).not.toThrow();
    expect(clip(a, 100)).toContain('不可序列化');
  });
});
