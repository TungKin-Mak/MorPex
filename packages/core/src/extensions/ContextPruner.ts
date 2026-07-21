/**
 * ContextPruner — STUB (replaced by CompactionPolicy)
 * @deprecated Use SlidingWindowCompaction from compaction/CompactionPolicy.js
 */
export class ContextPruner {
  name = 'ContextPruner';
  version = '1.0.0';
  constructor(_opts?: any) {}
  getStats() { return { totalPruned: 0 }; }
  getStatus() { return { name: 'ContextPruner', phase: 'running' }; }
}
