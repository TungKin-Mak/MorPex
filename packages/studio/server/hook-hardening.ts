/**
 * hook-hardening — /api/hooks/trigger 公网入口加固三件套（P0-1）
 *
 * ① HookDedup：event-id 去重（JSON 真相源 + 原子写 + 7 天清理）
 *    - 客户端传 x-morpex-event-id header（或 body.eventId）时启用幂等；
 *      未传则跳过去重（兼容旧调用方，at-least-once 语义）。
 *    - 记录时机 = 请求被受理（通过全部校验、即将委派执行）——即 idempotency-key
 *      标准语义：委派本身就是副作用，受理即记账，下游 5xx 不回滚记账。
 * ② createFixedWindowLimiter：固定窗口限流（每 secret 每分钟 ≤N 次，env 可配）。
 *    一人本地规模：进程内计数即可，拒绝分布式令牌桶。
 * ③ GOAL_MAX_CHARS：goal 长度硬上限（超限 413）。全局 express.json limit=10mb
 *    是外边界，此处是业务级细粒度上限。
 *
 * 定位声明：本文件全部是**拦截/安全兜底层**，不含任何"触发判断"逻辑，
 * 与"触发全 LLM 化"原则无冲突。
 */
import { mkdirSync, readFileSync, existsSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** goal 业务级长度上限（超过 413 Payload Too Large） */
export const HOOK_GOAL_MAX_CHARS = 10_000;

export interface DedupRecord {
  [eventId: string]: { at: number };
}

/**
 * event-id 去重表（JSON 文件真相源 + 原子写）
 * - isKnown(id)：true = 该事件已处理过
 * - record(id)：受理即记账
 * - 加载时自动清理 ttlDays 前的旧记录，防无限增长
 */
export class HookDedup {
  private records: DedupRecord = {};
  private dirty = false;

  constructor(private readonly filePath: string, private readonly ttlDays = 7) {
    this.load();
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8')) as DedupRecord;
      const cutoff = Date.now() - this.ttlDays * 86_400_000;
      for (const [id, rec] of Object.entries(raw)) {
        if (rec?.at > cutoff) this.records[id] = rec; // 过期条目顺带清理
      }
    } catch (err) {
      console.warn('[HookDedup] 去重表加载失败（按空表继续）:', (err as Error).message);
    }
  }

  isKnown(eventId: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.records, eventId);
  }

  record(eventId: string): void {
    this.records[eventId] = { at: Date.now() };
    this.dirty = true;
    this.persist();
  }

  /** 原子写（tmp+rename），写失败仅告警——去重是尽力而为的幂等增强，不阻塞主流程 */
  private persist(): void {
    if (!this.dirty) return;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.records));
      renameSync(tmp, this.filePath);
      this.dirty = false;
    } catch (err) {
      console.warn('[HookDedup] 去重表写入失败:', (err as Error).message);
    }
  }
}

/**
 * 固定窗口限流器（进程内计数）。
 * allow(key)：窗口内未超 maxPerMin 返回 true 并计数；超限返回 false。
 * key 通常为固定值（单 secret），预留多 secret 扩展位。
 */
export function createFixedWindowLimiter(maxPerMin: number): (key: string) => boolean {
  let windowStart = 0;
  let count = 0;
  return (_key: string): boolean => {
    const now = Date.now();
    if (now - windowStart >= 60_000) {
      windowStart = now;
      count = 0;
    }
    if (count >= maxPerMin) return false;
    count++;
    return true;
  };
}

/** 从 env 解析限流阈值（默认 30/min；非法值回落默认） */
export function resolveHookRateLimit(envValue: string | undefined): number {
  const n = Number.parseInt(envValue ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
}
