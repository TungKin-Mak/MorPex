/**
 * MorPexCore — 公共 API 入口
 *
 * v3.1 Phase 2: 此文件已简化为 barrel re-export。
 * 所有实际导出委托给 ./src/index.ts。
 * 目录迁移完成后，src/ 将成为唯一源码目录。
 *
 * 使用方式：
 *   ```typescript
 *   import { bootstrapMorPexCore } from '@morpex/core';
 *   const kernel = await bootstrapMorPexCore(runtime);
 *   ```
 */

export * from './src/index.js';
