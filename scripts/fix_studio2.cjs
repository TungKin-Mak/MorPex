const fs = require('fs');
let content = fs.readFileSync('E:/Morpex/packages/studio/server/StudioServer.ts', 'utf-8');

// The broken area starts from the BrainPersistor.persist line
const brokenStart = '          BrainPersistor.persist(this.v8PersonalBrain, this.wiki).catch(err => {';
const idx = content.indexOf(brokenStart);
console.log('Found at', idx);

// Find where the catch block should end and the old code starts bleeding in
// The old code has this line which doesn't belong in the new version:
const oldBleed = "console.log('  └─ v8 BehaviorTimer ✅ (24h 周期检测)');";
const bleedIdx = content.indexOf(oldBleed, idx);
console.log('Bleed at', bleedIdx);

// From the broken catch to the end of the bleed line
const endBleed = bleedIdx + oldBleed.length;

// Replace from the broken .catch to the end of the bleed
// Find the correct start - the if block opening
const ifBlockStart = content.lastIndexOf('if (this.v8PersonalBrain && this.wiki)', idx);

console.log('if block at', ifBlockStart);

// Build the fixed code
const beforeFix = content.substring(ifBlockStart, bleedIdx);
console.log('Before fix:');
console.log(beforeFix);

// The fix: close the catch block properly and add the rest of the method
const fixedBlock = `        if (this.v8PersonalBrain && this.wiki) {
          BrainPersistor.persist(this.v8PersonalBrain, this.wiki).catch(err => {
            console.warn("[BrainPersistor] 异步持久化失败:", err);
          });
        }
        return result;
      });

      await this.v8Gateway.start();
      console.log("  ├─ v8.5 CogLoop    ✅ (全链路 7 阶段编排)");

      // ═══════════════════════════════════════════════════════
      // v8.5: BehaviorTwin 周期性调度（每 24h）
      // ═══════════════════════════════════════════════════════`;

const result = content.substring(0, ifBlockStart) + fixedBlock + content.substring(endBleed);
fs.writeFileSync('E:/Morpex/packages/studio/server/StudioServer.ts', result, 'utf-8');
console.log('Fixed!');
