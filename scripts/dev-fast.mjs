// scripts/dev-fast.mjs — 开发快启后端（MORPEX_DEV_FAST=1 + Node 原生 watch）
// 跳过 EventStore 状态重建（2963+ 产物/图），重启秒级；需查产物/图谱时用 npm run dev:backend。
process.env.MORPEX_DEV_FAST = '1';
import { spawn } from 'node:child_process';

const child = spawn(
  'node',
  ['--watch', '--import', 'tsx', 'packages/studio/server/index.ts'],
  { stdio: 'inherit', shell: true },
);
child.on('exit', (code) => process.exit(code ?? 0));
