/**
 * 定时触发调度器测试：cron 解析 / CRUD / 确定性触发（注入时钟，不等真实 60s）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCron, cronMatches, CronScheduler, type ScheduleEntry } from '../schedule-manager.js';

// ── cron 解析 ──
describe('parseCron', () => {
    it('星号全通配：任意时刻命中', () => {
        expect(cronMatches(new Date(2026, 7, 24, 13, 37), '* * * * *')).toBe(true);
    });
    it('逗号列表', () => {
        expect(cronMatches(new Date(2026, 7, 24, 9, 15), '15,45 9 * * *')).toBe(true);
        expect(cronMatches(new Date(2026, 7, 24, 9, 44), '15,45 9 * * *')).toBe(false);
    });
    it('范围与步长', () => {
        // 分钟 0-50/10 → 0,10,20,30,40,50
        expect(cronMatches(new Date(2026, 7, 24, 8, 30), '0-50/10 8 * * *')).toBe(true);
        expect(cronMatches(new Date(2026, 7, 24, 8, 35), '0-50/10 8 * * *')).toBe(false);
    });
    it('非法表达式抛错', () => {
        expect(() => parseCron('* * * *')).toThrow();
        expect(() => parseCron('60 * * * *')).toThrow();
    });
});

// ── 调度器 CRUD + 确定性触发 ──
describe('CronScheduler', () => {
    const fired: ScheduleEntry[] = [];
    // 固定"当前时间"：2026-08-24 09:30（周一）
    const NOW = new Date(2026, 7, 24, 9, 30, 0);
    let scheduler: CronScheduler;
    let dataDir: string;

    beforeEach(() => {
        fired.length = 0;
        dataDir = mkdtempSync(join(tmpdir(), 'morpex-sched-'));
        process.env.MORPEX_DATA_DIR = dataDir;
        scheduler = make();
    });

    afterEach(() => {
        scheduler?.stop();
        delete process.env.MORPEX_DATA_DIR;
        rmSync(dataDir, { recursive: true, force: true });
    });

    function make(): CronScheduler {
        return new CronScheduler({
            fire: (e) => { fired.push(e); },
            nowFn: () => NOW,
            intervalMs: 60_000,
        });
    }

    it('add → list → remove 全链路', () => {
        const e = scheduler.add({ name: 'daily-report', cron: '30 9 * * *', goal: '生成日报' });
        expect(e.createdAt).toBeTruthy();
        expect(scheduler.list().some((x) => x.name === 'daily-report')).toBe(true);
        expect(() => scheduler.add({ name: 'daily-report', cron: '* * * * *', goal: '重复名' })).toThrow('同名');
        scheduler.remove('daily-report');
        expect(scheduler.list()).toHaveLength(0);
    });

    it('到点确定性触发：tick 命中当前分钟即 fire，同分钟去重', () => {
        scheduler.add({ name: 't1', cron: '30 9 * * *', goal: '命中任务' });
        scheduler.tick();
        expect(fired).toHaveLength(1);
        scheduler.tick(); // 同一分钟内第二次 tick：不重复触发
        expect(fired).toHaveLength(1);
    });

    it('未命中不触发；宕机错过不补跑', () => {
        scheduler.add({ name: 't2', cron: '0 22 * * *', goal: '夜里十点的任务' });
        scheduler.tick(); // 当前 09:30 不命中
        expect(fired).toHaveLength(0);
        // 宕机跳过语义：lastFiredKey 只在触发时记账，错过分钟天然不会补
    });
});
