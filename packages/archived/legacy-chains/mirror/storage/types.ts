/**
 * Mirror Storage — 存储接口定义
 *
 * 定义 MirrorStorage 接口，不绑定具体后端。
 * Phase 0 使用 JSONL 文件实现，未来可替换为 SQLite / PostgreSQL / VectorDB。
 */

import type { MirrorRecord, MirrorStats } from '../../common/types.js';

/**
 * MirrorStorage — 镜像存储后端接口
 *
 * 职责：
 *   - append：写入记录（不阻塞主路径）
 *   - query：按 executionId 查询
 *   - getStats：获取统计信息
 *
 * 设计约束：
 *   - 异步写入，不阻塞主路径
 *   - 不绑定存储后端实现
 */
export interface MirrorStorage {
  /**
   * 追加一条记录
   * 实现应为 fire-and-forget 或独立队列处理
   */
  append(record: MirrorRecord): Promise<void>;

  /**
   * 按 executionId 查询所有关联记录
   * 扫描后返回匹配结果
   */
  query(executionId: string): Promise<MirrorRecord[]>;

  /**
   * 获取存储统计信息
   */
  getStats(): MirrorStats;

  /**
   * 初始化存储（创建目录/文件等）
   */
  initialize(): Promise<void>;

  /**
   * 关闭存储，释放资源
   */
  close(): Promise<void>;
}
