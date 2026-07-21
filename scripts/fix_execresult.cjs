const fs = require('fs');
let c = fs.readFileSync('packages/core/src/index.ts', 'utf8');

// Alias ExecutionResult from evolution to avoid conflict with common/types
c = c.replace(
  "  EvolutionReport,\n  ExecutionResult,\n  OptimizationPlan,\n} from './evolution/index.js';",
  "  EvolutionReport,\n  ExecutionResult as WorkflowExecutionResult,\n  OptimizationPlan,\n} from './evolution/index.js';"
);

fs.writeFileSync('packages/core/src/index.ts', c);
console.log('Fixed ExecutionResult');
