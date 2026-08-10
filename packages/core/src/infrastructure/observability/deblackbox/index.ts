/**
 * deblackbox — 去黑盒化公共基础设施（L0/L1/L2 三层记录）
 *
 * 配套：docs/DEBLACKBOX_PLAN.md；所有黑盒埋点（llm.call / gate.decision /
 * context.retrieval / planner.decision / execution.path / ...）统一经
 * DeblackboxRecorder.record() 接入。
 */

export { RecordPolicy } from './RecordPolicy.js';
export type { DeblackboxLevel, RecordPolicySnapshot } from './RecordPolicy.js';
export { DEBLACKBOX_DEFAULT_TTL, DEBLACKBOX_DEFAULT_SAMPLING } from './RecordPolicy.js';

export { DeblackboxDetailStore } from './DeblackboxDetailStore.js';
export type { DeblackboxDetailRecord } from './DeblackboxDetailStore.js';

export { DeblackboxRecorder, getSharedDeblackboxRecorder, resetSharedDeblackboxRecorder } from './DeblackboxRecorder.js';
export type { DeblackboxRecord } from './DeblackboxRecorder.js';

export { RecordCleaner } from './RecordCleaner.js';
export type { RecordCleanerResult } from './RecordCleaner.js';
