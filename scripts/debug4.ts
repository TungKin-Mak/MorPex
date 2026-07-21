import { RecoveryValidator } from '../packages/core/src/validation/RecoveryValidator.js';
const rv = new RecoveryValidator();
const r = await rv.run();
for (const e of r.errors) console.log('ERROR:', e);
