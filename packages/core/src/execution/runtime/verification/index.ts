/**
 * runtime/verification — Verification Engine Barrel
 *
 * Phase 4 / MorPex v8: 验证引擎统一导出入口。
 */

export { VerificationEngine } from './VerificationEngine.js';
export type {
  VerificationResult,
  VerificationCheck,
  VerificationIssue,
  VerificationEngineConfig,
} from './types.js';
