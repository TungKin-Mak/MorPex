// @ts-nocheck
console.log('starting...');
const { RecoveryValidator } = await import('../packages/core/src/validation/RecoveryValidator.js');
console.log('imported');
const rv = new RecoveryValidator();
console.log('running...');
const r = await rv.run();
console.log('done, errors:', r.errors.length);
r.errors.forEach(e => console.log('  -', e));
