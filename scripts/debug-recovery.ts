import { RecoveryValidator } from '../packages/core/src/validation/RecoveryValidator.js';

const rv = new RecoveryValidator();
const r = await rv.run();
console.log('Status:', r.status);
console.log('Assertions:', r.passedAssertions + '/' + r.assertions);
r.errors.forEach(e => console.log('ERR:', e));
r.details.filter(d => d.startsWith('  Tool') || d.startsWith('  Mixed') || d.startsWith('  Network') || d.startsWith('  LLM') || d.startsWith('  Recovery')).forEach(d => console.log(d));
