/**
 * RouterLite — 精简版领域路由模块
 *
 * Phase 3 / 智能与适配层
 *
 * 替代完整的 CrossDomainRouter（LLM 拆解、动态领域发现），
 * 只保留：
 *   1. 静态领域路由表（domain → handler 映射）
 *   2. 按领域名称路由任务
 *   3. 无动态发现
 *
 * 完整 CrossDomainRouter 仍然可用（如需要），RouterLite
 * 提供更轻量的替代选择。
 *
 * 使用方式：
 *   const router = new RouterLite();
 *   router.registerDomain('编程', (task) => `编程部执行: ${task}`);
 *   router.registerDomain('电商', (task) => `电商部执行: ${task}`);
 *   const result = router.route('编程', '优化算法');
 */

export type DomainHandler = (task: string, context?: Record<string, unknown>) => string | Promise<string>;

export interface DomainRoute {
  domain: string;
  handler: DomainHandler;
  description?: string;
}

export class RouterLite {
  private routes: Map<string, DomainRoute> = new Map();

  registerDomain(domain: string, handler: DomainHandler, description?: string): void {
    this.routes.set(domain.toLowerCase(), { domain, handler, description });
  }

  route(domain: string, task: string, context?: Record<string, unknown>): string | Promise<string> {
    const route = this.routes.get(domain.toLowerCase());
    if (!route) {
      throw new Error(`未知领域 "${domain}"。已注册领域: ${this.listDomains().join(', ') || '(无)'}`);
    }
    return route.handler(task, context);
  }

  hasDomain(domain: string): boolean {
    return this.routes.has(domain.toLowerCase());
  }

  listDomains(): string[] {
    return [...this.routes.keys()];
  }

  removeDomain(domain: string): boolean {
    return this.routes.delete(domain.toLowerCase());
  }

  clear(): void {
    this.routes.clear();
  }
}
