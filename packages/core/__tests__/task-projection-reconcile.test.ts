/**
 * F5 尾巴收尾测试：投影防抖窗口崩溃 → 事件源校正补齐
 *
 * 场景：任务状态变迁后、防抖落盘（500ms）触发前进程崩溃 →
 * 快照文件落后于真相源 → restore() 读到旧快照，reconcileWithTruth() 按事件源校正。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStateProjector } from '../src/execution/TaskStateProjector.js';

let dataDir: string;

beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'morpex-proj-'));
});

afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
});

function makeProjector(): TaskStateProjector {
    return new TaskStateProjector(dataDir);
}

describe('F5 尾巴·事件源校正', () => {
    it('快照缺失 + 任务未完结 → reconcile 重建投影并同步落盘', () => {
        const proj = makeProjector();
        // 崩溃场景：防抖没来得及写盘，data/tasks 下无快照文件
        proj.setTruthSource(() => [{ missionId: 'm1', status: 'ACTIVE', objective: '清理临时文件' }]);
        const n = proj.reconcileWithTruth();
        expect(n).toBe(1);
        // 同步落盘（不等防抖）
        expect(existsSync(join(dataDir, 'tasks', 'm1.json'))).toBe(true);
        const restored = makeProjector();
        restored.restore();
        expect(restored.get('m1')?.status).toBe('running');
        expect(restored.get('m1')?.goal).toBe('清理临时文件');
    });

    it('快照状态落后（done 已写但快照仍 running）→ 校正为 done', () => {
        const proj = makeProjector();
        // 先制造一个 running 快照（模拟旧时刻落盘）
        proj.setTruthSource(() => [{ missionId: 'm2', status: 'ACTIVE' }]);
        proj.reconcileWithTruth();
        const snap = JSON.parse(readFileSync(join(dataDir, 'tasks', 'm2.json'), 'utf-8'));
        expect(snap.status).toBe('running');
        // 进程"重启"：新实例 restore 读到旧快照；但真相源已 COMPLETED
        const proj2 = makeProjector();
        proj2.restore();
        expect(proj2.get('m2')?.status).toBe('running'); // 快照兜底生效
        proj2.setTruthSource(() => [{ missionId: 'm2', status: 'COMPLETED' }]);
        expect(proj2.reconcileWithTruth()).toBe(1);
        expect(proj2.get('m2')?.status).toBe('done');
    });

    it('已完结任务且无任何投影痕迹 → 不凭空造条目（防噪音）', () => {
        const proj = makeProjector();
        proj.setTruthSource(() => [{ missionId: 'ghost', status: 'COMPLETED' }]);
        expect(proj.reconcileWithTruth()).toBe(0);
        expect(proj.get('ghost')).toBeUndefined();
    });

    it('状态一致 → 校正数为 0（幂等）', () => {
        const proj = makeProjector();
        proj.setTruthSource(() => [{ missionId: 'm3', status: 'ACTIVE', objective: 'x' }]);
        proj.reconcileWithTruth();
        expect(proj.reconcileWithTruth()).toBe(0);
    });
});
