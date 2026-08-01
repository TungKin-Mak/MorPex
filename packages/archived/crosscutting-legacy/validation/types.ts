/**
 * Phase 9 — Validation Suite Shared Types
 */

export interface ValidationReport {
  suite: string;
  timestamp: number;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  };
  results: TestResult[];
  healthScore: number;
  recommendations: string[];
}

export interface TestResult {
  name: string;
  category: string;
  status: 'passed' | 'failed' | 'skipped' | 'error';
  duration: number;
  assertions: number;
  passedAssertions: number;
  details: string[];
  errors: string[];
  trace?: ExecutionTraceEntry[];
}

export interface ExecutionTraceEntry {
  step: string;
  event: string;
  traceId: string;
  executionId: string;
  stateTransition?: string;
  timestamp: number;
  duration?: number;
  status: 'ok' | 'fail' | 'skip';
  detail?: string;
}

export interface ExecutionTraceReport {
  executionId: string;
  scenario: string;
  startedAt: number;
  completedAt: number;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  steps: ExecutionTraceEntry[];
  success: boolean;
}

export interface FSMStateValidation {
  state: string;
  validTransitions: string[];
  invalidTransitions: string[];
  persistable: boolean;
  recoverySupported: boolean;
  validated: boolean;
}

export interface RecoveryValidationResult {
  scenario: string;
  simulatedFailure: string;
  checkpointCreated: boolean;
  recoveryPlanGenerated: boolean;
  replaySuccessful: boolean;
  executionContinued: boolean;
  dataLost: boolean;
  duration: number;
}

export interface LearningValidationResult {
  taskType: string;
  firstRun: {
    planner: string;
    agent: string;
    tool: string;
    template: string;
    strategy: string;
  };
  secondRun: {
    planner: string;
    agent: string;
    tool: string;
    template: string;
    strategy: string;
  };
  behaviorChanged: boolean;
  changes: string[];
}
