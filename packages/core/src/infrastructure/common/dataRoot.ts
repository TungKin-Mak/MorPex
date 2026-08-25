/**
 * dataRoot.ts — 统一数据根目录解析
 *
 * 单一真相源：所有运行时数据（快照/事件库/上传/计划）都落在 getDataRoot() 之下。
 * 默认 <cwd>/data；测试可用 MORPEX_DATA_DIR 环境变量覆盖到隔离目录，
 * 防止断言型单测被真实运行累积状态污染（如 getAll() 读出数千条历史产物）。
 */
import { resolve } from 'node:path';

export function getDataRoot(): string {
  return process.env.MORPEX_DATA_DIR ? resolve(process.env.MORPEX_DATA_DIR) : resolve('data');
}
