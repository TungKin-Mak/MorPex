import { LearningValidator } from '../packages/core/src/validation/LearningValidator.js';

async function main() {
  console.log('Running LearningValidator...');
  const lv = new LearningValidator();
  try {
    const r = await lv.run();
    console.log('Status:', r.status);
    console.log('Assertions:', r.passedAssertions + '/' + r.assertions);
    console.log('Errors:', JSON.stringify(r.errors));
    console.log('Details:', r.details.slice(0, 10));
  } catch (e: any) {
    console.error('Validator threw:', e.message);
    console.error(e.stack);
  }
}
main();
