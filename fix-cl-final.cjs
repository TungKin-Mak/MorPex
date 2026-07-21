const fs = require('fs');
const c = fs.readFileSync('E:/Morpex/packages/core/src/runtime/cognitive-loop/CognitiveLoop.ts', 'utf-8');
const lines = c.split('\n');

// PROBLEM 1: Methods were inserted at line ~103 (inside process method)
// Find and remove the wrongly inserted section
// The section starts with "// ===== Phase 8: Workflow Evolution (v8.5) ====="
// and ends with "// ===== Phase 9: Brain Persist (v8.5) =====" block + method

let removeStart = -1;
let removeEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('Workflow Evolution (v8.5)') || 
      (lines[i].includes('Phase 8') && lines[i].includes('Workflow'))) {
    removeStart = i;
    console.log('Found Phase 8 at line ' + (i+1) + ': ' + lines[i]);
  }
  if (removeStart > 0 && lines[i].includes('MessageGateway') && i > removeStart + 15) {
    removeEnd = i;
    break;
  }
}

// Actually, let's just find ALL the wrongly inserted code and the correct location
// Print a section around the process method to understand the damage
console.log('\n--- Lines 150-180 (around process method) ---');
for (let i = 149; i < Math.min(180, lines.length); i++) console.log((i+1) + ': ' + lines[i]);

console.log('\n--- Lines 580-600 (around MessageGateway section) ---');
for (let i = 579; i < Math.min(610, lines.length); i++) console.log((i+1) + ': ' + lines[i]);
