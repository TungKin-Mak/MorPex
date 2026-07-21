const fs = require('fs');
let content = fs.readFileSync('E:/Morpex/packages/studio/server/StudioServer.ts', 'utf-8');

const marker = 'BrainPersistor.persist(this.v8PersonalBrain, this.wiki).catch(err => {';
const idx = content.indexOf(marker);
console.log('Found marker at', idx);
console.log('Context:', content.substring(idx - 30, idx + 200));
