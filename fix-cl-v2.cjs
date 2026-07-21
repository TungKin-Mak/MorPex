const fs = require('fs');
let c = fs.readFileSync('E:/Morpex/packages/core/src/runtime/cognitive-loop/CognitiveLoop.ts', 'utf-8');
let lines = c.split('\n');

// Step 1: Remove wrongly inserted methods (lines 105-162)
// These start with "  // Phase 8: Workflow Evolution (v8.5)" and end with the persistBrain method + blank
console.log('Before cleanup: ' + lines.length + ' lines');

// Find the corrupted section
let corruptStart = -1;
let corruptEnd = -1;
for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  if (t.startsWith('// Phase 8:') && t.includes('Workflow Evolution')) {
    corruptStart = i;
  }
  // After corruptStart, find where the JSDoc is broken (missing /**)
  if (corruptStart > 0 && lines[i].trim().startsWith('* @param msg - 来自 MessageGateway')) {
    // This is the line after the corrupt section
    // The line before it should be the one before the class/method
    // Actually, this is now broken. The `/**` was corrupted.
    // Find where the next proper method starts - look for `async`
    corruptEnd = i;
    break;
  }
}
console.log('Corrupt section: lines ' + (corruptStart+1) + ' to ' + (corruptEnd !== -1 ? corruptEnd : lines.length));

if (corruptStart > 0 && corruptEnd > corruptStart) {
  // Remove the corrupt section
  lines.splice(corruptStart, corruptEnd - corruptStart);
  console.log('Removed corrupt section. Lines: ' + lines.length);
}

// Step 2: Find the broken JSDoc and fix it
for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  if (t === '* @param msg - 来自 MessageGateway 的 IncomingMessage') {
    // Check if the previous line has the opening /**
    if (!lines[i-1].trim().startsWith('/**')) {
      // Insert the missing /** 
      lines.splice(i, 0, '  /**');
      console.log('Fixed JSDoc at line ' + (i+1));
    }
    break;
  }
}

// Step 3: Add methods before the real MessageGateway section
let msgGwIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === '// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550' && 
      lines[i+1] && lines[i+1].trim() === '// MessageGateway \u96c6\u6210') {
    msgGwIdx = i;
    console.log('Found MessageGateway section at line ' + (i+1));
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
    "            console.log('[CL] WF reg: ' + registered.name + ' c=' + candidate.confidence);",
    '            if (candidate.confidence > 0.9) this.workflowRegistry.activate(registered.id);',
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
    "        console.warn('[CL] WF miner err:', err.message || String(err));",
    '      }',
    '      if (this.workflowExecutor) {',
    '        try {',
    '          const n = await this.workflowExecutor.executeScheduled();',
    "          if (n > 0) console.log('[CL] Auto-exec ' + n + ' wf');",
    '        } catch (err) {',
    "          console.warn('[CL] WF exec err:', err.message || String(err));",
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
    "      console.warn('[CL] Brain persist err:', err.message || String(err));",
    '    }',
    '  }',
    '',
  ];
  lines.splice(msgGwIdx, 0, ...methods);
  console.log('Methods inserted at line ' + (msgGwIdx + 1));
}

// Step 4: Restore phase calls in process method
// Find the completed phase assignment and add workflow + brain before it
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('ctx.phase') && lines[i].includes('completed') && !lines[i].includes('finalType')) {
    // Check if evolveWorkflow is already before it
    const contextBefore = lines.slice(Math.max(0,i-5), i).join('\n');
    if (!contextBefore.includes('evolveWorkflow')) {
      lines.splice(i, 0, '', '      // v8.5: Workflow Evolution', '      await this.evolveWorkflow(ctx);', '', '      // v8.5: Brain Persist', '      await this.persistBrain(ctx);', '');
      console.log('Phase calls inserted before line ' + (i+1));
    }
    break;
  }
}

fs.writeFileSync('E:/Morpex/packages/core/src/runtime/cognitive-loop/CognitiveLoop.ts', lines.join('\n'), 'utf-8');
console.log('Done. Final lines:', lines.length);
