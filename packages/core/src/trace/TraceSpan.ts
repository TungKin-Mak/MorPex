export interface TraceSpan {
  spanId: string;
  parentSpanId?: string;
  name: string;
  type: 'goal' | 'mission' | 'plan' | 'task' | 'agent' | 'tool' | 'artifact' | 'verification';
  status: 'STARTED' | 'COMPLETED' | 'FAILED';
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata: Record<string, unknown>;
  tags: string[];
}
