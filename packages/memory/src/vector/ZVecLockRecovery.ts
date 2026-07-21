/**
 * ZVecLockRecovery — zvec 路径恢复工具
 *
 * 重要发现：zvec 自带崩溃恢复机制（ZVecOpen 会检测 crash residue 并自动修复）。
 * 删除 LOCK 文件反而会破坏恢复流程，导致 "Can't open lock file"。
 *
 * 因此本模块只做一件事：如果 dataPath 是文件而非目录，删除该文件。
 * 不再删除任何 LOCK 文件！
 */

import * as fs from 'fs';
import * as path from 'path';

export function recoverZVecLocks(dataPath: string): { cleaned: number; warning: string[] } {
  const warning: string[] = [];
  const resolved = path.resolve(dataPath);

  if (!fs.existsSync(resolved)) return { cleaned: 0, warning };

  // 如果路径是文件而非目录，删除文件（不创建目录 — ZVecCreateAndOpen 负责）
  try {
    const pathStat = fs.statSync(resolved);
    if (pathStat.isFile()) {
      console.warn(`[ZVecLock] ⚠️ dataPath 是文件而非目录，正在修复: ${resolved}`);
      fs.unlinkSync(resolved);
      console.log(`[ZVecLock] ✅ 已删除文件（不创建目录，由 zvec 负责）`);
      return { cleaned: 1, warning };
    }
  } catch (e: unknown) {
    warning.push(`path validation failed: ${e instanceof Error ? e.message : String(e)}`);
    return { cleaned: 0, warning };
  }

  return { cleaned: 0, warning };
}
