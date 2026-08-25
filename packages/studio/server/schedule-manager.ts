/**
 * schedule-manager.ts — 定时触发调度器（12-Factor F11 收尾：cron 触发入口）
 *
 * 职责：
 *   1. 简化版 5 段 cron 解析（分 时 日 月 周；支持 * , - / 数字）——自写而非引依赖：
 *      一人规模下 node-cron 等依赖的边界特性（时区/秒段/年段）均用不到，50 行自写更可控
 *   2. 计划真相源：data/schedules.json（tmp+rename 原子写，仓库既有模式）
 *   3. tick 循环：每分钟检查命中并触发 fire 回调；触发去重按"分钟键"（同一分钟不重复）
 *
 * 补跑策略（有意为之）：宕机期间错过的触发一律跳过不补跑——
 *   定时任务的语义是"到点做一次"，补跑 N 分钟前的日报/摘要价值存疑且有副作用重复风险；
 *   错过事实经 lastFiredAt 可审计。若未来需要补跑语义，应做成显式的独立能力。
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getDataRoot } from '../../core/src/infrastructure/common/dataRoot.js';

export interface ScheduleEntry {
    name: string;
    cron: string;
    goal: string;
    sessionId?: string;
    goalMode?: boolean;
    createdAt: string;
    /** 最近一次触发的分钟键 `${YYYY-MM-DD HH:mm}`，防同分钟重复触发 + 宕机跳过的审计依据 */
    lastFiredKey?: string;
}

// ── cron 解析（简化版 5 段）──

interface CronFields {
    minutes: Set<number>;
    hours: Set<number>;
    daysOfMonth: Set<number>;
    months: Set<number>;
    daysOfWeek: Set<number>;
}

/** 解析单字段：支持 * , - / 与数字。返回该字段的合法值集合。 */
function parseField(field: string, min: number, max: number): Set<number> {
    const out = new Set<number>();
    for (const part of field.split(',')) {
        const [rangePart, stepPart] = part.split('/');
        const step = stepPart ? parseInt(stepPart, 10) : 1;
        if (!Number.isFinite(step) || step < 1) throw new Error(`cron 步长非法: "${part}"`);
        let lo = min, hi = max;
        if (rangePart !== '*') {
            const dash = rangePart.indexOf('-');
            if (dash >= 0) {
                lo = parseInt(rangePart.slice(0, dash), 10);
                hi = parseInt(rangePart.slice(dash + 1), 10);
            } else {
                lo = hi = parseInt(rangePart, 10);
            }
            if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error(`cron 数值非法: "${part}"`);
        }
        if (lo < min || hi > max || lo > hi) throw new Error(`cron 范围越界: "${part}"（字段合法域 ${min}-${max}）`);
        for (let v = lo; v <= hi; v += step) out.add(v);
    }
    return out;
}

/** 解析 5 段 cron 表达式。抛错即表达式非法。 */
export function parseCron(expr: string): CronFields {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) throw new Error(`cron 需要 5 段（分 时 日 月 周）: "${expr}"`);
    return {
        minutes: parseField(parts[0], 0, 59),
        hours: parseField(parts[1], 0, 23),
        daysOfMonth: parseField(parts[2], 1, 31),
        months: parseField(parts[3], 1, 12),
        // 周日=0 或 7（对齐 crontab 惯例）
        daysOfWeek: parseField(parts[4] === '7' ? '0' : parts[4], 0, 6),
    };
}

/** 判定某一时刻是否命中 cron（分钟粒度）。 */
export function cronMatches(date: Date, expr: string): boolean {
    const f = parseCron(expr);
    return f.minutes.has(date.getMinutes())
        && f.hours.has(date.getHours())
        && f.daysOfMonth.has(date.getDate())
        && f.months.has(date.getMonth() + 1)
        && f.daysOfWeek.has(date.getDay());
}

// ── 存储（JSON 真相源，tmp+rename 原子写）──

function schedulesPath(): string {
    return join(getDataRoot(), 'schedules.json');
}

function loadSchedules(): ScheduleEntry[] {
    try {
        if (!existsSync(schedulesPath())) return [];
        const raw = JSON.parse(readFileSync(schedulesPath(), 'utf-8'));
        return Array.isArray(raw) ? raw : [];
    } catch (err) {
        console.warn('[Scheduler] schedules.json 读取失败，按空表启动:', (err as Error).message);
        return [];
    }
}

function saveSchedules(entries: ScheduleEntry[]): void {
    const p = schedulesPath();
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, JSON.stringify(entries, null, 2));
    renameSync(tmp, p); // 同目录原子替换：读者要么见旧完整版要么新完整版
}

// ── 调度器 ──

export interface CronSchedulerOptions {
    /** 到点触发回调（由 StudioServer 注入：委派 chatSendHandler 走 executeGoal 全链路） */
    fire: (entry: ScheduleEntry) => void | Promise<void>;
    /** 注入时钟便于测试确定性；缺省系统时间 */
    nowFn?: () => Date;
    /** tick 间隔毫秒；缺省 30s（分钟粒度任务留双倍余量防漂移错过） */
    intervalMs?: number;
}

export class CronScheduler {
    private timer: ReturnType<typeof setInterval> | null = null;
    private opts: Required<Pick<CronSchedulerOptions, 'nowFn' | 'intervalMs'>>;

    constructor(private options: CronSchedulerOptions) {
        this.opts = { nowFn: options.nowFn ?? (() => new Date()), intervalMs: options.intervalMs ?? 30_000 };
    }

    list(): ScheduleEntry[] {
        return loadSchedules();
    }

    add(entry: Omit<ScheduleEntry, 'createdAt'>): ScheduleEntry {
        parseCron(entry.cron); // 先验证合法性再入库
        if (!entry.goal?.trim()) throw new Error('goal required');
        const all = loadSchedules();
        if (all.some((e) => e.name === entry.name)) throw new Error(`同名计划已存在: ${entry.name}`);
        const full: ScheduleEntry = { ...entry, createdAt: new Date().toISOString() };
        all.push(full);
        saveSchedules(all);
        return full;
    }

    remove(name: string): boolean {
        const all = loadSchedules();
        const next = all.filter((e) => e.name !== name);
        if (next.length === all.length) return false;
        saveSchedules(next);
        return true;
    }

    /** 启动每分钟级 tick。调度器内部异常只记日志，绝不拖垮主进程。 */
    start(): void {
        if (this.timer) return;
        this.timer = setInterval(() => {
            try {
                this.tick();
            } catch (err) {
                console.error('[Scheduler] tick 异常（已吞掉不影响主进程）:', (err as Error).message);
            }
        }, this.opts.intervalMs);
        this.timer.unref?.();
    }

    stop(): void {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
    }

    /** 单次检查：命中当前分钟且未触发过的计划 → fire 并记账。供测试直接调用（确定性验证）。 */
    tick(): void {
        const now = this.opts.nowFn();
        const minuteKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const all = loadSchedules();
        let dirty = false;
        for (const e of all) {
            let hits = false;
            try {
                hits = cronMatches(now, e.cron);
            } catch (err) {
                console.warn(`[Scheduler] 计划 "${e.name}" cron 非法，跳过: ${(err as Error).message}`);
                continue;
            }
            if (!hits || e.lastFiredKey === minuteKey) continue;
            e.lastFiredKey = minuteKey;
            dirty = true;
            console.log(`[Scheduler] ⏰ 触发定时任务 "${e.name}" (${e.cron})`);
            try {
                const r = this.options.fire(e);
                if (r instanceof Promise) r.catch((err) => console.error(`[Scheduler] "${e.name}" 触发回调异常:`, (err as Error).message));
            } catch (err) {
                console.error(`[Scheduler] "${e.name}" 触发回调同步异常:`, (err as Error).message);
            }
        }
        if (dirty) saveSchedules(all);
    }
}
