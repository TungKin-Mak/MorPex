const fs = require('fs');
let c = fs.readFileSync('packages/core/src/runtime/cognitive-loop/CognitiveLoop.ts', 'utf8');

// 1. Add type imports
c = c.replace(
  "import type { CognitiveContext, DetectedIntent, LoopStats } from './types.js';",
  "import type { CognitiveContext, DetectedIntent, LoopStats, WorkflowCandidateEntry, BehaviorDriftEntry } from './types.js';"
);

// 2. Add fields
c = c.replace(
  'private done: Mission[] = [];',
  'private done: Mission[] = [];\n  private autoReg = false;\n  private autoExec = false;\n  private pendingWf: WorkflowCandidateEntry[] = [];\n  private pendingDrift: BehaviorDriftEntry[] = [];\n  private lastProfile: any = null;\n  private goalMgr: any = null;'
);

// 3. Parse opts
c = c.replace(
  'this.brain = opts.brain ?? null;',
  'this.brain = opts.brain ?? null; this.goalMgr = opts.goalManager ?? null; this.autoReg = opts.autoRegisterWorkflows ?? false; this.autoExec = opts.autoExecuteWorkflows ?? false;'
);

// 4. Replace mineWorkflows
const oldMine = '  async mineWorkflows(_ctx: CognitiveContext): Promise<void> {\n    if (!this.workflowMiner || !this.workflowRegistry || this.done.length < 3) return;\n    try {\n      const names = this.workflowRegistry.getAll().map((w: any) => w.name);\n      const candidates = await this.workflowMiner.mine(this.done, names);\n      for (const c of candidates) {\n        if (c.confidence > 0.8) {\n          const r = this.workflowRegistry.register(c);\n          if (c.confidence > 0.9) this.workflowRegistry.activate(r.id);\n        }\n      }\n      if (this.workflowExecutor && candidates.length) await this.workflowExecutor.executeScheduled();\n    } catch {}\n  }';

const newMine = '  async mineWorkflows(_ctx: CognitiveContext): Promise<void> {\n    if (!this.workflowMiner || !this.workflowRegistry || this.done.length < 3) return;\n    try {\n      const names = this.workflowRegistry.getAll().map((w: any) => w.name);\n      const candidates = await this.workflowMiner.mine(this.done, names);\n      for (const c of candidates) {\n        if (c.confidence < 0.6) continue;\n        const entry: WorkflowCandidateEntry = {\n          id: "wfc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),\n          name: c.name, description: c.description, confidence: c.confidence,\n          steps: c.steps.length, sourceMissionIds: c.sourceMissionIds,\n          detectedAt: Date.now(), status: "pending",\n        };\n        this.pendingWf.push(entry);\n        this.bus.emit({\n          id: "evt_wfc_" + entry.id, type: "workflow.candidate", timestamp: Date.now(),\n          executionId: "cl", source: "workflow-miner",\n          payload: { candidateId: entry.id, name: c.name, confidence: c.confidence, pending: true },\n        });\n        if (this.autoReg && c.confidence > 0.8) {\n          const r = this.workflowRegistry.register(c); entry.status = "approved";\n          if (c.confidence > 0.9 && this.autoExec) this.workflowRegistry.activate(r.id);\n        } else {\n          console.log("[CL] candidate workflow (pending): " + c.name + " c=" + c.confidence.toFixed(2));\n        }\n      }\n      if (this.autoExec && this.workflowExecutor && candidates.length) await this.workflowExecutor.executeScheduled();\n    } catch {}\n  }';

c = c.replace(oldMine, newMine);

fs.writeFileSync('packages/core/src/runtime/cognitive-loop/CognitiveLoop.ts', c);
console.log('Part 1 done, lines:', c.split('\n').length);
