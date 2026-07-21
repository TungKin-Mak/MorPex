const fs = require('fs');
const c = fs.readFileSync('E:/Morpex/packages/core/src/runtime/cognitive-loop/CognitiveLoop.ts', 'utf-8');
const lines = c.split('\n');

// 1. Add missing phase calls after twin update
// Find: "await this.updateTwin(ctx);" followed by "ctx.phase = 'completed';"
let phaseInsertPoint = -1;
let completedPhaseLine = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('ctx.phase') && lines[i].includes('completed')) {
    completedPhaseLine = i;
    // Look backwards for updateTwin
    for (let j = i-1; j >= Math.max(0, i-5); j--) {
      if (lines[j].includes('updateTwin')) {
        phaseInsertPoint = i;
        break;
      }
    }
    break;
  }
}

if (phaseInsertPoint > 0) {
  // Insert workflow evolution + brain persist BEFORE completed
  lines.splice(phaseInsertPoint, 0, 
    '',
    '      // v8.5: Workflow Evolution',
    '      await this.evolveWorkflow(ctx);',
    '',
    '      // v8.5: Brain Persist',
    '      await this.persistBrain(ctx);',
    ''
  );
  console.log('Phase calls added before line ' + (phaseInsertPoint + 1));
}

// 2. Add missing methods before 'asMessageHandler' / MessageGateway section
let msgGwIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('MessageGateway')) {
    msgGwIdx = i;
    break;
  }
}

if (msgGwIdx > 0) {
  const methods = [
    '',
    '  // ===========================================================',
    '  // Phase 8: Workflow Evolution (v8.5)',
    '  // ===========================================================',
    '',
    '  async evolveWorkflow(ctx) {',
    '    const { mission, result } = ctx;',
    '    if (!mission || !result) return;',
    "    if (result.state !== 'COMPLETED' && result.state !== 'VERIFYING') return;",
    '',
    '    if (this.workflowMiner && this.workflowRegistry) {',
    '      try {',
    '        const existingNames = this.workflowRegistry.getAll().map(function(w) { return w.name; });',
    '        const candidates = await this.workflowMiner.mine([mission], existingNames);',
    '        for (const candidate of candidates) {',
    '          if (candidate.confidence > 0.8) {',
    '            const registered = this.workflowRegistry.register(candidate);',
    "            console.log('[CognitiveLoop] WF auto-registered: ' + registered.name + ' (conf=' + candidate.confidence.toFixed(2) + ')');",
    '            if (candidate.confidence > 0.9) {',
    '              this.workflowRegistry.activate(registered.id);',
    "              console.log('[CognitiveLoop] WF auto-activated: ' + registered.name);",
    '            }',
    '            this.bus.emit({',
    "              id: 'evt_wf_' + Date.now(),",
    '              type: EventType.WORKFLOW_UPDATED,',
    '              timestamp: Date.now(),',
    '              executionId: mission.id,',
    "              source: 'cognitive-loop',",
    '              payload: { workflowId: registered.id, name: registered.name, confidence: candidate.confidence },',
    '            });',
    '          }',
    '        }',
    '      } catch (err) {',
    "        console.warn('[CognitiveLoop] WorkflowMiner err:', err.message || String(err));",
    '      }',
    '      if (this.workflowExecutor) {',
    '        try {',
    '          const n = await this.workflowExecutor.executeScheduled();',
    "          if (n > 0) console.log('[CognitiveLoop] Auto-executed ' + n + ' workflows');",
    '        } catch (err) {',
    "          console.warn('[CognitiveLoop] WF Executor err:', err.message || String(err));",
    '        }',
    '      }',
    '    }',
    '  }',
    '',
    '  // ===========================================================',
    '  // Phase 9: Brain Persist (v8.5)',
    '  // ===========================================================',
    '',
    '  async persistBrain(ctx) {',
    '    if (!this.brain) return;',
    '    try {',
    '      if (typeof this.brain.persist === "function") {',
    '        await this.brain.persist();',
    '      }',
    '    } catch (err) {',
    "      console.warn('[CognitiveLoop] Brain persist err:', err.message || String(err));",
    '    }',
    '  }',
    '',
  ];
  
  lines.splice(msgGwIdx, 0, ...methods);
  console.log('Methods added before line ' + (msgGwIdx + 1));
}

fs.writeFileSync('E:/Morpex/packages/core/src/runtime/cognitive-loop/CognitiveLoop.ts', lines.join('\n'), 'utf-8');
console.log('Done. Lines:', lines.length);
