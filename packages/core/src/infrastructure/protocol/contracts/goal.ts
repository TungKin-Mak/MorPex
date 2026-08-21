/**
 * Goal Intelligence — 共享类型
 */
import type { IntentKind } from '../../../cognition/planning/goal-intelligence/IntentClassifier.js';

export interface GoalContext {
  goalId: string;
  objective: string;
  domain?: string;
  /** 意图：chat（闲聊直答）| task（执行任务）。默认 task */
  intent?: IntentKind;
  constraints: {
    budget?: number;
    deadline?: string;
    platform?: string;
    quality?: 'draft' | 'standard' | 'production';
    [key: string]: unknown;
  };
  requiredCapabilities: string[];
  missingInformation: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface GoalParseResult {
  objective: string;
  domain?: string;
  subGoals: string[];
  confidence: number;
}
