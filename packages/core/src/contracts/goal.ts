/**
 * Goal Intelligence — 共享类型
 */
export interface GoalContext {
  goalId: string;
  objective: string;
  domain?: string;
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
