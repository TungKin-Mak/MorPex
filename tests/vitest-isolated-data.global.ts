/**
 * 全量测试的数据隔离：每个运行周期使用独立 data 目录（MORPEX_DATA_DIR），
 * 运行前清空、运行后清理——防止单测断言被真实运行累积状态污染
 * （曾出现 artifact getAll() 读出 3030 条历史产物的假失败）。
 */
import { rmSync } from 'node:fs';

const dir = 'data/.vitest-run';

export default function (): void | (() => void) {
  rmSync(dir, { recursive: true, force: true });
  return () => {
    rmSync(dir, { recursive: true, force: true });
  };
}
