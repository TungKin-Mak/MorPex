const fs = require('fs');
let content = fs.readFileSync('E:/Morpex/packages/studio/server/StudioServer.ts', 'utf-8');

// Find the broken area around asMessageHandler
const marker = "asMessageHandler()(msg)";
const idx = content.indexOf(marker);
console.log("Found marker at", idx);

// Show context
console.log("BEFORE:", content.substring(idx - 50, idx + 250));
