const fs = require('fs');

// 1. Fix bootstrap.ts — remove attachMemoryEngine call (method was deleted from ExecutionGateway)
let bs = fs.readFileSync('packages/core/bootstrap.ts', 'utf8');
bs = bs.replace(
  "  // 6. Phase 13: 初始化 MemoryActivationEngine 并接入 Gateway\n  // 每次 Agent 执行前，Gateway.execute() 自动激活记忆并注入 Harness\n  const memoryEngine = new MemoryActivationEngine();\n  kernel.gateway.attachMemoryEngine(memoryEngine);\n  console.log('  ├─ Memory: ActivationEngine connected to Gateway (Phase 13)');",
  "  // 6. Phase 13: MemoryActivationEngine (保留实例供后续使用)\n  // Gateway 不再直接持有 MemoryEngine 引用；通过 EventBus 通信\n  const memoryEngine = new MemoryActivationEngine();\n  console.log('  ├─ Memory: ActivationEngine initialized (Phase 13)');"
);
fs.writeFileSync('packages/core/bootstrap.ts', bs);
console.log('Fixed bootstrap.ts');

// 2. Fix ExecutionGateway.ts — remove ghost import and related code
let eg = fs.readFileSync('packages/core/src/gateway/ExecutionGateway.ts', 'utf8');
// Remove the import
eg = eg.replace(
  "// ★ v3.0 OpenSpace Fusion import\nimport type { ExecutionRecordingEngine } from '../mirror/ExecutionRecordingEngine.js';\n\n",
  "// ★ v3.0 ExecutionRecordingEngine was removed — recording handled by EventStore\n\n"
);
// Replace the typed field with any
eg = eg.replace(
  "private _recordingEngine: ExecutionRecordingEngine | null = null;",
  "private _recordingEngine: any = null;  // was ExecutionRecordingEngine (module deleted)"
);
// Fix setRecordingEngine parameter type
eg = eg.replace(
  "setRecordingEngine(engine: ExecutionRecordingEngine | null): void {",
  "setRecordingEngine(engine: any): void {"
);
fs.writeFileSync('packages/core/src/gateway/ExecutionGateway.ts', eg);
console.log('Fixed ExecutionGateway.ts');

// 3. Fix auditor/index.ts — import DimensionScore from types.js directly
let ai = fs.readFileSync('packages/core/src/auditor/index.ts', 'utf8');
ai = ai.replace(
  "export type { DimensionScore as ScoringDimension, ScoreResult } from './ScoringEngine.js';",
  "export type { ScoreResult } from './ScoringEngine.js';\nexport type { DimensionScore as ScoringDimension } from './types.js';"
);
fs.writeFileSync('packages/core/src/auditor/index.ts', ai);
console.log('Fixed auditor/index.ts');
