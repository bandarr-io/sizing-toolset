import { allConstants } from '../src/index.ts';
import { checkConstants } from './check.ts';

const today = process.env.CONSTANTS_CHECK_DATE ?? new Date().toISOString().slice(0, 10);
const errors = checkConstants(allConstants, today);
const carried = allConstants.filter((c) => c.carried_forward).length;

if (errors.length > 0) {
  console.error(`constants check FAILED (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`constants check passed: ${allConstants.length} constants, ${carried} carried forward, as of ${today}`);
