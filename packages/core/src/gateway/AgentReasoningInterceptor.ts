/**
 * AgentReasoningInterceptor — STUB (removed during v4→v9 refactor)
 * @deprecated Reasoning interceptor functionality integrated into CognitivePipeline
 */
export class AgentReasoningInterceptor {
  name = 'AgentReasoningInterceptor';
  version = '1.0.0';
  constructor(_opts?: any) {}
  async wrap<T>(fn: () => Promise<T>): Promise<T> { return fn(); }
  async checkAction(_action: any) { return { allowed: true, reason: 'stub' }; }
  async processObservation(_obs: any) { return { processed: true }; }
  getStats() { return { actionsChecked: 0, actionsBlocked: 0 }; }
}
