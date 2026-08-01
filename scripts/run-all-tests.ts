#!/usr/bin/env npx tsx
/**
 * run-all-tests.ts — MorPex 全量测试启动器（委托统一 Runner）
 *
 * 历史：旧实现引用不存在的 `test-full-pipeline.ts` 且仅 1 项，已废弃。
 * 现统一由 `scripts/run-everything.ts` 分层编排全部测试（静态/单元/系统/脚本式核心/生产/CLI）。
 *
 * 用法:
 *   npx tsx scripts/run-all-tests.ts               # 全量
 *   npx tsx scripts/run-all-tests.ts --quick       # 静态 + 单元
 *   npx tsx scripts/run-all-tests.ts --skip-static # 跳过静态门禁
 */
import { spawn } from 'node:child_process';
import * as path from 'node:path';

const args = process.argv.slice(2);
const scriptPath = path.resolve(import.meta.dirname ?? __dirname, 'run-everything.ts');

const child = spawn('npx', ['tsx', scriptPath, ...args], { stdio: 'inherit', shell: true });
child.on('close', (code) => process.exit(code ?? 1));
child.on('error', (err) => { console.error(err); process.exit(2); });
