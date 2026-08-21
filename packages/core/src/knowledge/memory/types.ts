/**
 * knowledge/memory/types.ts — 记忆记录类型（由 execution/harness/types 迁移，精简 P0）
 *
 * 原 MemoryRecord 定义在已移除的 execution/harness/types.ts；本类型被
 * MemoryActivationEngine / MemoryApiBus 消费，本地化以避免对遗留模块的引用。
 */
export interface MemoryRecord {
  id: string;
  content: string;
  type: 'task' | 'domain' | 'pattern' | 'error' | 'experience';
  relevanceScore: number;
  timestamp: number;
  metadata?: Record<string, any>;
}