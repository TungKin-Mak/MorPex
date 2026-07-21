const fs = require('fs');

// 1. Remove GatewayMissionHandler from mission/adapters/index.ts
let mai = fs.readFileSync('packages/core/src/runtime/mission/adapters/index.ts', 'utf8');
mai = mai.replace("export { GatewayMissionHandler } from './GatewayHandler.js';\n", '');
// Update comment
mai = mai.replace(' *   GatewayMissionHandler — MessageGateway → MissionRuntime\n', ' *   GatewayMissionHandler — deprecated, replaced by CognitiveLoop\n');
mai = mai.replace("export { MetaPlannerAdapter, DAGExecutorAdapter, GatewayMissionHandler } from './mission/index.js';", "export { MetaPlannerAdapter, DAGExecutorAdapter } from './mission/index.js';");
fs.writeFileSync('packages/core/src/runtime/mission/adapters/index.ts', mai);
console.log('Fixed adapters/index.ts');

// 2. Remove GatewayMissionHandler from runtime/index.ts
let ri = fs.readFileSync('packages/core/src/runtime/index.ts', 'utf8');
ri = ri.replace("export { MetaPlannerAdapter, DAGExecutorAdapter, GatewayMissionHandler } from './mission/index.js';", "export { MetaPlannerAdapter, DAGExecutorAdapter } from './mission/index.js';");
fs.writeFileSync('packages/core/src/runtime/index.ts', ri);
console.log('Fixed runtime/index.ts');

// 3. Remove GatewayMissionHandler from core/src/index.ts
let ci = fs.readFileSync('packages/core/src/index.ts', 'utf8');
ci = ci.replace("export { MetaPlannerAdapter, DAGExecutorAdapter, GatewayMissionHandler } from './runtime/index.js';", "export { MetaPlannerAdapter, DAGExecutorAdapter } from './runtime/index.js';");
fs.writeFileSync('packages/core/src/index.ts', ci);
console.log('Fixed core/src/index.ts');
