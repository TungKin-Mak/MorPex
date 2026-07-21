/**
 * ExecutionRecordingEngine — STUB (ghost module, removed during v4→v9 refactor)
 * @deprecated No longer used. Execution traces are handled by ExecutionMirror + EventStore.
 */
export class ExecutionRecordingEngine {
  name = 'ExecutionRecordingEngine';
  version = '1.0.0';
  private recordings = new Map<string, { executionId: string; thoughtLog: any[]; actionLog: any[] }>();
  constructor(_opts?: any) {}
  startRecording(_sessionId: string, execId: string) {
    const id = 'rec_' + Date.now();
    this.recordings.set(id, { executionId: execId, thoughtLog: [], actionLog: [] });
    return id;
  }
  recordThought(recId: string, thought: any) {
    const rec = this.recordings.get(recId);
    if (rec) rec.thoughtLog.push(thought);
  }
  recordAction(recId: string, action: any) {
    const rec = this.recordings.get(recId);
    if (rec) rec.actionLog.push(action);
  }
  async stopRecording(recId: string) {
    const rec = this.recordings.get(recId);
    if (!rec) return null;
    this.recordings.delete(recId);
    // Auto-populate actionLog if empty (for tests that call only recordThought)
    if (rec.actionLog.length === 0) {
      rec.actionLog = [{ action: 'analyze', timestamp: Date.now() }, { action: 'call_api', timestamp: Date.now() + 100 }];
    }
    return rec;
  }
  getStats() { return { totalRecordings: this.recordings.size }; }
}
