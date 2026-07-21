const fs = require('fs');

// Fix ReadArtifactTool: undefined → null
let rat = fs.readFileSync('packages/core/src/tools/ReadArtifactTool.ts', 'utf8');
rat = rat.replace('this.registry.resolve(uri)', 'this.registry.resolve(uri) ?? null');
fs.writeFileSync('packages/core/src/tools/ReadArtifactTool.ts', rat);
console.log('Fixed ReadArtifactTool');

// Fix RuntimeAPI: replace .passed with computed value
let rta = fs.readFileSync('packages/studio/server/RuntimeAPI.ts', 'utf8');
rta = rta.replace(
  "passed: result.passed,",
  "passed: result.summary?.passed === result.summary?.total,"
);
fs.writeFileSync('packages/studio/server/RuntimeAPI.ts', rta);
console.log('Fixed RuntimeAPI');
