/**
 * Security Middleware 测试（L4 接口面 / 安全加固）— 此前零测试
 *
 * 覆盖 createSecurityMiddleware 返回的 5 个中间件：
 *   - requireApiKey：开放模式放行 / 配置后缺 key 401 / 正确 key（header+query）/ observability+stream 豁免
 *   - securityHeaders：6 个安全响应头
 *   - corsHeaders：CORS 头
 *   - rateLimit：窗口内超限 429 + X-RateLimit 头
 *   - inputValidation：超长 content 截断 + session_id 强转
 *   - applySecurityMiddleware：注册 5 个中间件
 */
import { describe, it, expect } from 'vitest';
import {
  createSecurityMiddleware,
  applySecurityMiddleware,
  type SecurityConfig,
} from '../security-middleware.js';

// ── Express 风格 mock ──

function mockReq(overrides: Partial<{ path: string; headers: Record<string, string>; query: Record<string, string>; body: Record<string, unknown>; ip: string }> = {}) {
  return {
    path: overrides.path ?? '/api/health',
    headers: overrides.headers ?? {},
    query: overrides.query ?? {},
    body: overrides.body ?? {},
    ip: overrides.ip ?? '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  } as any;
}

function mockRes() {
  const res: any = {
    _headers: {} as Record<string, string>,
    _statusCode: 200,
    _body: undefined,
    setHeader(k: string, v: string) { res._headers[k] = v; return res; },
    status(code: number) { res._statusCode = code; return res; },
    json(body: unknown) { res._body = body; return res; },
  };
  return res;
}

function nextSpy() { let called = 0; const fn = () => { called++; }; return { fn, get called() { return called; } }; }

// ── 中间件索引：createSecurityMiddleware 返回 [cors, headers, rateLimit, inputValidation, requireApiKey] ──
function stack(config?: SecurityConfig) {
  const m = createSecurityMiddleware(config);
  return { cors: m[0], headers: m[1], rateLimit: m[2], validation: m[3], auth: m[4] };
}

describe('requireApiKey — API Key 认证', () => {
  it('未配置 API_KEY → 开放模式放行', () => {
    const { auth } = stack({});
    const n = nextSpy();
    auth(mockReq(), mockRes(), n.fn);
    expect(n.called).toBe(1);
  });

  it('配置 API_KEY + 无 key → 401', () => {
    const { auth } = stack({ apiKey: 'secret-123' });
    const res = mockRes();
    auth(mockReq({ path: '/api/execute' }), res, () => { throw new Error('不应放行'); });
    expect(res._statusCode).toBe(401);
    expect(res._body.ok).toBe(false);
  });

  it('配置 API_KEY + 错误 key → 401', () => {
    const { auth } = stack({ apiKey: 'secret-123' });
    const res = mockRes();
    auth(mockReq({ path: '/api/execute', headers: { 'x-api-key': 'wrong' } }), res, () => { throw new Error('不应放行'); });
    expect(res._statusCode).toBe(401);
  });

  it('正确 key（header x-api-key）→ 放行', () => {
    const { auth } = stack({ apiKey: 'secret-123' });
    const n = nextSpy();
    auth(mockReq({ path: '/api/execute', headers: { 'x-api-key': 'secret-123' } }), mockRes(), n.fn);
    expect(n.called).toBe(1);
  });

  it('正确 key（query api_key）→ 放行', () => {
    const { auth } = stack({ apiKey: 'secret-123' });
    const n = nextSpy();
    auth(mockReq({ path: '/api/execute', query: { api_key: 'secret-123' } }), mockRes(), n.fn);
    expect(n.called).toBe(1);
  });

  it('observability 端点豁免（debug 面板无需 key）', () => {
    const { auth } = stack({ apiKey: 'secret-123' });
    const n = nextSpy();
    auth(mockReq({ path: '/api/observability/health' }), mockRes(), n.fn);
    expect(n.called).toBe(1);
  });

  it('SSE 流端点豁免', () => {
    const { auth } = stack({ apiKey: 'secret-123' });
    const n = nextSpy();
    auth(mockReq({ path: '/api/stream/global' }), mockRes(), n.fn);
    expect(n.called).toBe(1);
  });

  it('非 /api/ 路径放行（静态资源）', () => {
    const { auth } = stack({ apiKey: 'secret-123' });
    const n = nextSpy();
    auth(mockReq({ path: '/index.html' }), mockRes(), n.fn);
    expect(n.called).toBe(1);
  });
});

describe('securityHeaders — 安全响应头', () => {
  it('设置 6 个安全头', () => {
    const { headers } = stack({});
    const res = mockRes();
    headers(mockReq(), res, () => {});
    expect(res._headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res._headers['X-Frame-Options']).toBe('DENY');
    expect(res._headers['X-XSS-Protection']).toBe('1; mode=block');
    expect(res._headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(res._headers['X-Permitted-Cross-Domain-Policies']).toBe('none');
    expect(res._headers['Cross-Origin-Resource-Policy']).toBe('cross-origin');
  });
});

describe('corsHeaders — CORS', () => {
  it('默认 Allow-Origin=*，可自定义', () => {
    const { cors } = stack({});
    const res = mockRes();
    cors(mockReq(), res, () => {});
    expect(res._headers['Access-Control-Allow-Origin']).toBe('*');

    const { cors: cors2 } = stack({ corsOrigin: 'https://app.example.com' });
    const res2 = mockRes();
    cors2(mockReq(), res2, () => {});
    expect(res2._headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
  });
});

describe('rateLimit — 速率限制', () => {
  it('未启用 → 全部放行', () => {
    const { rateLimit } = stack({ enableRateLimit: false });
    const n = nextSpy();
    rateLimit(mockReq(), mockRes(), n.fn);
    expect(n.called).toBe(1);
  });

  it('窗口内超过 max → 429 + X-RateLimit 头', () => {
    const { rateLimit } = stack({ enableRateLimit: true, rateLimitMax: 2, rateLimitWindowMs: 60000 });
    let n = nextSpy();
    rateLimit(mockReq(), mockRes(), n.fn);
    n = nextSpy();
    const res2 = mockRes();
    rateLimit(mockReq(), res2, n.fn);
    expect(n.called).toBe(1);
    expect(res2._headers['X-RateLimit-Remaining']).toBe(0);

    // 第 3 次超限 → 429
    const res3 = mockRes();
    rateLimit(mockReq(), res3, () => { throw new Error('不应放行'); });
    expect(res3._statusCode).toBe(429);
    expect(res3._body.error).toBe('Too Many Requests');
  });

  it('非 /api/ 路径不计数', () => {
    const { rateLimit } = stack({ enableRateLimit: true, rateLimitMax: 1, rateLimitWindowMs: 60000 });
    const n = nextSpy();
    rateLimit(mockReq({ path: '/static/app.js' }), mockRes(), n.fn);
    rateLimit(mockReq({ path: '/static/app.js' }), mockRes(), n.fn);
    expect(n.called).toBe(2);
  });
});

describe('inputValidation — 输入校验', () => {
  it('content 超长（>50000）→ 截断', () => {
    const { validation } = stack({});
    const req = mockReq({ body: { content: 'x'.repeat(60000) } });
    validation(req, mockRes(), () => {});
    expect((req.body.content as string).length).toBeLessThanOrEqual(50000 + ' [TRUNCATED]'.length);
    expect(req.body.content).toContain('[TRUNCATED]');
  });

  it('session_id 非字符串 → 强转字符串', () => {
    const { validation } = stack({});
    const req = mockReq({ body: { session_id: 12345 } });
    validation(req, mockRes(), () => {});
    expect(req.body.session_id).toBe('12345');
  });

  it('短 content 不截断、无可疑模式不告警', () => {
    const { validation } = stack({});
    const req = mockReq({ body: { content: '正常内容' } });
    validation(req, mockRes(), () => {});
    expect(req.body.content).toBe('正常内容');
  });
});

describe('applySecurityMiddleware — 应用注册', () => {
  it('向 app.use 注册 5 个中间件', () => {
    const used: Array<unknown[]> = [];
    applySecurityMiddleware({ use: (...handlers: unknown[]) => used.push(handlers) }, { apiKey: 'k' });
    expect(used).toHaveLength(5);
  });
});
