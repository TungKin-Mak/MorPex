/**
 * Security Middleware — MorPex v9.2 生产安全加固
 *
 * 解决 GAP 6 安全审计发现的问题：
 *   1. 无认证 → 添加 API Key 验证（可选，通过环境变量启用）
 *   2. 输入校验不足 → 添加请求体大小限制和内容校验
 *   3. 无速率限制 → 添加简单的内存速率限制器
 *   4. 缺少安全头 → 添加 helmet 风格的响应头
 *
 * 使用:
 *   import { applySecurityMiddleware } from './security-middleware.js';
 *   applySecurityMiddleware(app);
 *
 * 配置 (环境变量):
 *   API_KEY               — 如果设置，所有 /api/ 端点需要此 key
 *   RATE_LIMIT_WINDOW_MS  — 速率限制窗口（默认 60000）
 *   RATE_LIMIT_MAX        — 每窗口最大请求数（默认 100）
 *   CORS_ORIGIN           — 允许的来源（默认 *）
 */

import type { Request, Response, NextFunction } from 'express';

// ═══════════════════════════════════════════════════════════════
// 速率限制器（内存实现）
// ═══════════════════════════════════════════════════════════════

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private windowMs: number;
  private max: number;

  constructor(windowMs = 60000, max = 100) {
    this.windowMs = windowMs;
    this.max = max;
  }

  /** Returns true if the request should be allowed */
  check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    let entry = this.store.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.store.set(key, entry);
    }

    entry.count++;
    const remaining = Math.max(0, this.max - entry.count);
    const allowed = entry.count <= this.max;

    // Cleanup old entries periodically
    if (this.store.size > 10000) {
      for (const [k, e] of this.store) {
        if (now > e.resetAt) this.store.delete(k);
      }
    }

    return { allowed, remaining, resetAt: entry.resetAt };
  }
}

// ═══════════════════════════════════════════════════════════════
// 中间件工厂
// ═══════════════════════════════════════════════════════════════

export interface SecurityConfig {
  apiKey?: string;
  corsOrigin?: string;
  rateLimitWindowMs?: number;
  rateLimitMax?: number;
  enableRateLimit?: boolean;
}

export function createSecurityMiddleware(config?: SecurityConfig) {
  const apiKey = config?.apiKey || process.env.API_KEY;
  const corsOrigin = config?.corsOrigin || process.env.CORS_ORIGIN || '*';
  const enableRateLimit = config?.enableRateLimit ?? (process.env.RATE_LIMIT_MAX ? true : false);
  const rateLimiter = new RateLimiter(
    config?.rateLimitWindowMs || parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    config?.rateLimitMax || parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  );

  // ═══════════════════════════════════════════════════
  // API Key 验证
  // ═══════════════════════════════════════════════════
  function requireApiKey(req: Request, res: Response, next: NextFunction): void {
    if (!apiKey) return next(); // API key not configured — skip

    // Skip for non-API paths (static files, SSE, etc.)
    if (!req.path.startsWith('/api/')) return next();

    // Allow observability endpoints without key (debug panel)
    if (req.path.startsWith('/api/observability/')) return next();

    // Allow SSE stream without key
    if (req.path.startsWith('/api/stream/')) return next();

    const provided = req.headers['x-api-key'] as string
      || req.query.api_key as string
      || '';

    if (provided === apiKey) {
      return next();
    }

    res.status(401).json({ ok: false, error: 'Unauthorized: invalid or missing API key' });
  }

  // ═══════════════════════════════════════════════════
  // 安全头
  // ═══════════════════════════════════════════════════
  function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  }

  // ═══════════════════════════════════════════════════
  // CORS 头
  // ═══════════════════════════════════════════════════
  function corsHeaders(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
    res.setHeader('Access-Control-Max-Age', '86400');
    next();
  }

  // ═══════════════════════════════════════════════════
  // 速率限制
  // ═══════════════════════════════════════════════════
  function rateLimit(req: Request, res: Response, next: NextFunction): void {
    if (!enableRateLimit) return next();

    // Only rate-limit API endpoints
    if (!req.path.startsWith('/api/')) return next();

    const key = req.headers['x-api-key'] as string
      || req.ip
      || req.socket.remoteAddress
      || 'unknown';

    const result = rateLimiter.check(key);

    res.setHeader('X-RateLimit-Limit', rateLimiter['max']);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', result.resetAt);

    if (!result.allowed) {
      res.status(429).json({
        ok: false,
        error: 'Too Many Requests',
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
      });
      return;
    }

    next();
  }

  // ═══════════════════════════════════════════════════
  // 输入校验
  // ═══════════════════════════════════════════════════
  function inputValidation(req: Request, _res: Response, next: NextFunction): void {
    // Sanitize common attack patterns
    if (req.body && typeof req.body.content === 'string') {
      const content = req.body.content;
      // Reject overly large payloads (potential DoS)
      if (content.length > 50000) {
        req.body.content = content.slice(0, 50000) + ' [TRUNCATED]';
      }
      // Strip potential SQL injection patterns (basic)
      // Note: This is not a replacement for proper parameterized queries
      if (/'.*\b(drop|delete|truncate|alter)\b.*'/i.test(content)) {
        console.warn(`[Security] 可疑 SQL 模式: ${req.ip}`);
        // Don't block, just log — actual protection is in the data layer
      }
    }

    // Validate session_id format
    if (req.body?.session_id && typeof req.body.session_id !== 'string') {
      req.body.session_id = String(req.body.session_id).slice(0, 100);
    }

    next();
  }

  // Return middleware stack
  return [corsHeaders, securityHeaders, rateLimit, inputValidation, requireApiKey];
}

/**
 * Apply security middleware to Express app.
 * Call after cors() and express.json().
 */
export function applySecurityMiddleware(
  app: { use: (...handlers: any[]) => void },
  config?: SecurityConfig,
): void {
  const middleware = createSecurityMiddleware(config);
  for (const m of middleware) {
    app.use(m);
  }
  const hasAuth = config?.apiKey || process.env.API_KEY;
  console.log(`  ├─ Security: ${hasAuth ? '🔒 API Key 认证已启用' : '🔓 开放模式 (设置 API_KEY 环境变量以启用认证)'}`);
  console.log(`  ├─ Rate Limit: ${config?.enableRateLimit ?? (process.env.RATE_LIMIT_MAX ? true : false) ? '✅ 已启用' : '⚠️ 未启用'}`);
}
