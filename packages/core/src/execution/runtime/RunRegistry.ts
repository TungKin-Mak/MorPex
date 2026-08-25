/**
 * RunRegistry — 运行控制注册表（U2+U3）
 *
 * missionId → { paused, cancelled } 的进程内注册表。
 * StudioServer 路由写标志；DAGRuntime 的 shouldPause/shouldCancel 钩子读标志。
 * 放在 core 侧是因为 DAGRuntime（core）需要读取，而它不能反向依赖 server 层。
 *
 * 持久化语义：pause/cancel 动作同时由调用方经 EventBus 发 run.paused/run.cancelled
 * 事件落入 PersistentMissionStore——重启后"已取消"不复活，"暂停中"重启后视为可 resume。
 */

interface RunControl {
  paused: boolean;
  cancelled: boolean;
}

const controls = new Map<string, RunControl>();

function ensure(id: string): RunControl {
  let c = controls.get(id);
  if (!c) {
    c = { paused: false, cancelled: false };
    controls.set(id, c);
  }
  return c;
}

export const RunRegistry = {
  pause(id: string): void {
    ensure(id).paused = true;
  },
  /** 解除暂停（活跃循环下一轮迭代恢复调度） */
  resume(id: string): void {
    const c = controls.get(id);
    if (c) c.paused = false;
  },
  cancel(id: string): void {
    ensure(id).cancelled = true;
    ensure(id).paused = false; // 取消优先于暂停
  },
  /** P0-2：重启后从事件源重放水合运行控制态（paused/cancelled 不因进程重启丢失/复活） */
  hydrate(id: string, state: 'paused' | 'cancelled' | 'running'): void {
    if (state === 'paused') { const c = ensure(id); c.paused = true; c.cancelled = false; }
    else if (state === 'cancelled') { const c = ensure(id); c.cancelled = true; } // cancelled 不复活
    // running：无操作（活跃态不需要恢复内存标志）
  },
  isPaused(id: string): boolean {
    return controls.get(id)?.paused ?? false;
  },
  isCancelled(id: string): boolean {
    return controls.get(id)?.cancelled ?? false;
  },
  getState(id: string): { paused: boolean; cancelled: boolean } {
    const c = controls.get(id);
    return { paused: c?.paused ?? false, cancelled: c?.cancelled ?? false };
  },
  /** 测试隔离：清空全部标志 */
  resetForTest(): void {
    controls.clear();
  },
};
