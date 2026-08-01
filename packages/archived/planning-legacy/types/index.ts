/**
 * Planning Intelligence Layer — 统一类型导出
 *
 * 将原有的单一 types.ts（1850 行）拆分为 7 个聚焦文件后，
 * 此文件作为 barrel 重新导出所有类型，保持向后兼容。
 *
 * 拆分好处:
 *   - 每个文件聚焦单一职责
 *   - 减少编译单元大小
 *   - 类型搜索更快
 *   - 修改范围更小
 *
 * @module extensions/planning/types
 */

export * from './plan-templates.js';
export * from './evaluation.js';
export * from './config.js';
export * from './simulation.js';
export * from './extension-lifecycle.js';
export * from './pipeline-types.js';
export * from './engines.js';
