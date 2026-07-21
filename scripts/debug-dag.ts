import { run } from '../tests/unit/dag.test.js';
const r = await run();
console.log('Passed:', r.assertionsPassed, '/', r.assertions);
console.log('Errors:', JSON.stringify(r.errors));
