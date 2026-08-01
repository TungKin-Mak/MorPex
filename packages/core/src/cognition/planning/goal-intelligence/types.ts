export interface GoalParseResult {
  objective: string;
  domain?: string;
  subGoals: string[];
  confidence: number;
}
