/**
 * SchedulerEngine — STUB (replaced by DAG Runtime's Scheduler)
 * @deprecated Use Scheduler from runtime/dag/
 */
export class SchedulerEngine {
  runningCount = 0; queueDepth = 0;
  private queue: any[] = [];
  private completed: number = 0; private failed: number = 0;
  onTaskReady?: (t: any) => void;
  onBackpressure?: () => void;
  constructor(_opts?: any) { this.runningCount = 0; }
  enqueue(task: any) {
    this.queue.push(task);
    if (this.onTaskReady) this.onTaskReady(task);
    this.runningCount = Math.min(this.queue.length, this.runningCount + 1);
    this.queueDepth = Math.max(0, this.queue.length - this.runningCount);
    return 'enqueued';
  }
  completeTask(id: string) {
    this.completed++;
    this.runningCount = Math.max(0, this.runningCount - 1);
    this.queue = this.queue.filter((t: any) => t.id !== id);
  }
  failTask(id: string, _err: string) {
    this.failed++;
    this.runningCount = Math.max(0, this.runningCount - 1);
    this.queue = this.queue.filter((t: any) => t.id !== id);
  }
  cancelTask(id: string) {
    this.queue = this.queue.filter((t: any) => t.id !== id);
    this.runningCount = Math.max(0, this.runningCount - 1);
  }
  getTask(id: string) {
    const t = this.queue.find((x: any) => x.id === id);
    return t ? { ...t, state: 'completed' } : undefined;
  }
  get isIdle() { return this.queue.length === 0 && this.runningCount === 0; }
  getStats() {
    return { totalEnqueued: this.completed + this.failed, totalCompleted: this.completed, totalFailed: this.failed, backpressureLevel: 'none' };
  }
}
