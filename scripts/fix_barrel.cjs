const fs = require('fs');
let c = fs.readFileSync('packages/core/src/index.ts', 'utf8');

// Strategy: for each duplicate pair, remove the export from the older/less-canonical module.
// Keep v8 runtime/cognition/evolution/control exports as canonical.
// Remove duplicates from planes/, domains/, industry/, learning/, extensions/ where they collide.

const fixes = [
  // 1. ExecutionState: keep runtime FSM enum (value export), remove agent-plane type
  { from: "export type {\n  HarnessContext,\n  IntentContext,\n  PlanContext,\n  MemoryContext,\n  ArtifactContext,\n  ExecutionState,\n  PermissionContext,\n  ExperienceContext,\n} from './planes/agent-plane/index.js';",
    to: "export type {\n  HarnessContext,\n  IntentContext,\n  PlanContext,\n  MemoryContext,\n  ArtifactContext,\n  ExecutionState as HarnessExecutionState,\n  PermissionContext,\n  ExperienceContext,\n} from './planes/agent-plane/index.js';" },

  // 2. ArtifactRef from agent-plane (line 41) — conflicts with domains/types (line 102). Keep domains, alias agent-plane.
  { from: "export type { MemoryRecord, ArtifactRef, Experience, HarnessEventCallback } from './planes/agent-plane/index.js';",
    to: "export type { MemoryRecord, ArtifactRef as AgentArtifactRef, Experience as AgentExperience, HarnessEventCallback } from './planes/agent-plane/index.js';" },

  // 3. ArtifactRef from domains/types (line 102) — keep as canonical
  // Already fine, no change needed

  // 4. ArtifactNode + LineageQuery: keep from knowledge-plane (line 122), remove from extensions (line 460/463)
  // These are handled below

  // 5. Constraints from control-plane/intent (line 131) — conflicts with common/types (line 406). Keep common/types.
  { from: "export type { Constraints } from './planes/control-plane/intent/index.js';",
    to: "// Constraints exported from common/types.js below (canonical)\nexport type { Constraints as IntentConstraints } from './planes/control-plane/intent/index.js';" },

  // 6. Experience from learning (line 138) — conflicts with agent-plane (already aliased as AgentExperience)
  // Keep learning's Experience as canonical
  // Already fine

  // 7. PlanEvaluation, OptimizationSuggestion, PlanTemplate from learning (lines 139-141) — conflicts with extensions (lines 480/486/320) and cognition (line 320)
  // Keep learning as canonical, alias extensions
  { from: "export type { PlanEvaluation } from './learning/index.js';",
    to: "// PlanEvaluation kept from learning (canonical); extensions re-export aliased below\nexport type { PlanEvaluation } from './learning/index.js';" },

  // 8. WorkflowStep from industry (line 215) — conflicts with cognition (line 319). Keep cognition.
  { from: "export type {\n  IndustryType,\n  IndustryAdapter,\n  IndustryPluginConfig,\n  WorkflowTemplate,\n  WorkflowStep,\n} from './industry/types.js';",
    to: "export type {\n  IndustryType,\n  IndustryAdapter,\n  IndustryPluginConfig,\n  WorkflowTemplate,\n  WorkflowStep as IndustryWorkflowStep,\n} from './industry/types.js';" },

  // 9. OptimizationSuggestion from cognition (line 320) — conflicts with learning (line 140). Keep learning, alias cognition.
  { from: "export type {\n  WorkflowPattern,\n  WorkflowStep,\n  OptimizationSuggestion,\n  AutomationAssessment,\n  IntelligenceReport,\n} from './cognition/index.js';",
    to: "export type {\n  WorkflowPattern,\n  WorkflowStep,\n  OptimizationSuggestion as WorkflowOptimizationSuggestion,\n  AutomationAssessment,\n  IntelligenceReport,\n} from './cognition/index.js';" },

  // 10. ExecutionResult from evolution (line 357) — conflicts with another location (line 404). Keep evolution.
  // Line 404 is from RuntimeAPI or similar — check and alias

  // 11. Constraints from common/types (line 406) — keep as canonical (already handled above)

  // 12. ArtifactNode + LineageQuery from extensions (lines 460, 463) — alias to avoid conflict with knowledge-plane
  // Find and fix these
];

// Apply simple text replacements
for (const fix of fixes) {
  if (c.includes(fix.from)) {
    c = c.replace(fix.from, fix.to);
    console.log('Fixed: ' + fix.from.substring(0, 50) + '...');
  } else {
    console.log('NOT FOUND: ' + fix.from.substring(0, 50) + '...');
  }
}

// Now handle extensions duplicates (ArtifactNode, LineageQuery, Constraints, PlanTemplate, PlanEvaluation, ExecutionResult)
// Find the extensions export block and alias duplicates
const extBlock = `export type {
  ArtifactNode,
  LineageEdge,
  LineageGraph,
  LineageQuery,
  LineageQueryResult,`;
if (c.includes(extBlock)) {
  c = c.replace(extBlock, `export type {
  ArtifactNode as ExtensionArtifactNode,
  LineageEdge,
  LineageGraph,
  LineageQuery as ExtensionLineageQuery,
  LineageQueryResult,`);
  console.log('Fixed extensions: ArtifactNode, LineageQuery');
}

// Fix ExecutionResult from extensions (line 404 area)
// Find 'ExecutionResult' in extensions context
const extExec = `  PlanTemplate,
  PlanNodeSkeleton,
  PlanExecutionRecord,`;
if (c.includes(extExec)) {
  c = c.replace(extExec, `  PlanTemplate as ExtensionPlanTemplate,
  PlanNodeSkeleton,
  PlanExecutionRecord,`);
  console.log('Fixed extensions: PlanTemplate');
}

// Fix PlanEvaluation from extensions
const extPlanEval = `  PlanEvaluation,
  PlanDimensionScores,`;
if (c.includes(extPlanEval)) {
  c = c.replace(extPlanEval, `  PlanEvaluation as ExtensionPlanEvaluation,
  PlanDimensionScores,`);
  console.log('Fixed extensions: PlanEvaluation');
}

// Fix ExecutionResult from extensions — find the line
const extExecRes = `export type {
  ArtifactNode,
  LineageEdge,`;
// Already handled above

fs.writeFileSync('packages/core/src/index.ts', c);
console.log('\nBarrel fixes applied');
